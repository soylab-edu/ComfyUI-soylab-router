"""Small, dependency-free client for the Comfy Router API."""

import json
import mimetypes
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = "https://api.comfy.org"
MAX_RESPONSE_BYTES = 256 * 1024 * 1024


class RouterError(RuntimeError):
    pass


class RouterHTTPError(RouterError):
    def __init__(self, status, error_type, message, retry_after=None, request_id=None):
        self.status = status
        self.error_type = error_type
        self.retry_after = retry_after
        self.request_id = request_id
        kind = f" [{error_type}]" if error_type else ""
        trace = f" · request_id: {request_id}" if request_id else ""
        super().__init__(f"Comfy Router HTTP {status}{kind}: {message}{trace}")


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


def _open_router(request, timeout):
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _read_limited(response), response.headers, getattr(response, "status", 200)
    except urllib.error.HTTPError as exc:
        body = exc.read(4096).decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = {}
        detail = parsed.get("detail") or parsed.get("message") or parsed.get("error") or body
        if isinstance(detail, list):
            detail = "; ".join(str(item.get("msg", item)) if isinstance(item, dict) else str(item) for item in detail)
        error_type = exc.headers.get("X-Comfy-Error-Type") or parsed.get("error_type")
        raise RouterHTTPError(exc.code, error_type, str(detail)[:1000], exc.headers.get("Retry-After"), exc.headers.get("X-Comfy-Request-Id")) from None
    except urllib.error.URLError as exc:
        raise RouterError(f"Comfy Router 연결 오류: {exc.reason}") from None


def _credits(headers):
    try:
        value = headers.get("X-Comfy-Credits-Used")
        return float(value) if value else None
    except (TypeError, ValueError):
        return None


def run_model(model_id: str, payload: dict, api_key: str, provider: str = "Comfy", on_status=None, allow_sync_fallback=True):
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
    def report(stage, **details):
        if on_status:
            on_status(stage, **details)

    report("submitting")
    submit_url = BASE_URL + path + "/requests" + query
    for attempt in range(6):
        request = urllib.request.Request(submit_url, data=data, method="POST", headers=headers)
        try:
            raw, _, _ = _open_router(request, 90)
            accepted = json.loads(raw)
            break
        except RouterHTTPError as exc:
            if exc.status == 403 and exc.error_type == "not_enabled":
                if not allow_sync_fallback:
                    raise RouterError("이 API 키 또는 모델은 Router 대기열을 사용할 수 없습니다. 장시간 영상 작업은 동기식 연결 제한으로 완료 결과를 잃을 수 있어 실행을 중단했습니다. 워크스페이스 API 키의 대기열 사용 가능 여부를 확인하세요.") from None
                report("sync_waiting")
                sync = urllib.request.Request(BASE_URL + path + query, data=data, method="POST", headers=headers)
                raw, response_headers, _ = _open_router(sync, 900)
                report("collecting")
                return json.loads(raw), _credits(response_headers)
            retryable = (exc.status == 409 and exc.error_type == "concurrency_limit_exceeded") or exc.status in (429, 504)
            if retryable and attempt < 5:
                try:
                    delay = float(exc.retry_after)
                except (TypeError, ValueError):
                    delay = 2 ** attempt
                time.sleep(max(1, min(delay, 60)))
                continue
            raise
        except RouterError as exc:
            if isinstance(exc, RouterHTTPError) or attempt == 5:
                raise
            time.sleep(min(2 ** attempt, 15))
    request_id = accepted.get("request_id")
    if not request_id or not isinstance(request_id, str):
        raise RouterError("Router 대기열에서 요청 ID를 받지 못했습니다.")
    request_path = BASE_URL + path + "/requests/" + urllib.parse.quote(request_id, safe="")
    report("queued", request_id=request_id, queue_position=accepted.get("queue_position"))
    deadline = time.monotonic() + 7200
    while time.monotonic() < deadline:
        poll = urllib.request.Request(request_path + "/status", headers={"X-API-Key": api_key})
        raw, response_headers, _ = _open_router(poll, 60)
        status = json.loads(raw)
        state = status.get("status")
        if state == "COMPLETED":
            if status.get("error_type"):
                raise RouterError(f"Comfy Router 생성 실패: {status['error_type']} · request_id: {request_id}")
            break
        if state == "IN_QUEUE":
            report("queued", request_id=request_id, queue_position=status.get("queue_position"))
        elif state == "IN_PROGRESS":
            report("generating", request_id=request_id)
        else:
            raise RouterError(f"알 수 없는 Router 작업 상태: {state}")
        try:
            delay = float(response_headers.get("Retry-After", 2))
        except (TypeError, ValueError):
            delay = 2
        time.sleep(max(1, min(delay, 60)))
    else:
        raise RouterError(f"Router 작업 확인 제한 시간이 지났습니다. request_id: {request_id}")
    report("collecting", request_id=request_id)
    for _ in range(8):
        result_request = urllib.request.Request(request_path, headers={"X-API-Key": api_key})
        raw, response_headers, status_code = _open_router(result_request, 180)
        if status_code == 200:
            return json.loads(raw), _credits(response_headers)
        if status_code != 202:
            raise RouterError(f"Router 결과 수신 오류: HTTP {status_code}")
        try:
            delay = float(response_headers.get("Retry-After", 2))
        except (TypeError, ValueError):
            delay = 2
        time.sleep(max(1, min(delay, 30)))
    raise RouterError(f"Router 결과가 아직 준비되지 않았습니다. request_id: {request_id}")


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
