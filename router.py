"""Small, dependency-free client for the Comfy Router API."""

import json
import mimetypes
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = "https://api.comfy.org"
MAX_RESPONSE_BYTES = 256 * 1024 * 1024


class RouterError(RuntimeError):
    pass


def _read_limited(response, limit=MAX_RESPONSE_BYTES):
    data = response.read(limit + 1)
    if len(data) > limit:
        raise RouterError("Router 응답 파일이 256 MiB 제한을 초과했습니다.")
    return data


def _request(url, *, api_key=None, method="GET", body=None, content_type=None, timeout=600):
    headers = {"User-Agent": "soylab-comfy-router/0.1"}
    if api_key:
        headers["X-API-Key"] = api_key
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _read_limited(response), dict(response.headers)
    except urllib.error.HTTPError as exc:
        body_text = exc.read(4096).decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body_text)
            message = parsed.get("message") or parsed.get("error") or body_text
        except json.JSONDecodeError:
            message = body_text
        raise RouterError(f"Comfy Router HTTP {exc.code}: {str(message)[:1000]}") from None
    except urllib.error.URLError as exc:
        raise RouterError(f"Comfy Router 연결 오류: {exc.reason}") from None


def run_model(model_id: str, payload: dict, api_key: str, provider: str = "Comfy"):
    if not api_key.strip():
        raise RouterError("API 키가 없습니다. 노드에 입력하거나 API KEY.INI에 저장하세요.")
    path = "/v2/models/" + "/".join(urllib.parse.quote(part, safe="") for part in model_id.split("/"))
    query = "" if provider == "Comfy" else "?" + urllib.parse.urlencode({"model_provider": provider, "strict_mode": "false"})
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Idempotency-Key": str(uuid.uuid4()),
        "User-Agent": "soylab-comfy-router/0.1",
    }
    request = urllib.request.Request(BASE_URL + path + query, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            result = json.loads(_read_limited(response))
            credits_header = response.headers.get("X-Comfy-Credits-Used")
            try:
                credits = float(credits_header) if credits_header else None
            except ValueError:
                credits = None
            return result, credits
    except urllib.error.HTTPError as exc:
        message = exc.read(4096).decode("utf-8", errors="replace")
        try:
            parsed = json.loads(message)
            message = parsed.get("message") or parsed.get("error") or message
        except json.JSONDecodeError:
            pass
        raise RouterError(f"Comfy Router HTTP {exc.code}: {str(message)[:1000]}") from None
    except urllib.error.URLError as exc:
        raise RouterError(f"Comfy Router 연결 오류: {exc.reason}") from None


def upload_asset(data: bytes, filename: str, mime_type: str, api_key: str) -> str:
    """Use the same signed storage flow as native Partner nodes for URL-only media."""
    create_body = json.dumps({"file_name": filename, "content_type": mime_type}).encode("utf-8")
    raw, _ = _request(BASE_URL + "/customers/storage", api_key=api_key, method="POST", body=create_body, content_type="application/json", timeout=60)
    try:
        result = json.loads(raw)
        upload_url = result["upload_url"]
        download_url = result["download_url"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RouterError("Comfy 업로드 URL을 받지 못했습니다.") from exc
    parsed = urllib.parse.urlparse(upload_url)
    if parsed.scheme != "https":
        raise RouterError("안전하지 않은 업로드 URL은 사용할 수 없습니다.")
    _request(upload_url, method="PUT", body=data, content_type=mime_type, timeout=300)
    return download_url


def download_asset(url: str) -> tuple[bytes, str]:
    if url.startswith("data:"):
        import base64
        header, encoded = url.split(",", 1)
        return base64.b64decode(encoded), header[5:].split(";")[0]
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise RouterError("결과 파일은 HTTPS URL 또는 data URI만 허용합니다.")
    data, headers = _request(url, timeout=180)
    content_type = headers.get("Content-Type", "").split(";", 1)[0]
    if not content_type:
        content_type = mimetypes.guess_type(parsed.path)[0] or "application/octet-stream"
    return data, content_type
