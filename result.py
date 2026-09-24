"""Read common provider-native result shapes without changing their raw JSON."""

import base64


def media_reference(result: dict, kind: str) -> tuple[str | bytes | None, str | None]:
    """Return (URL/data URI/bytes, MIME hint) for the first generated asset."""
    if kind == "VIDEO":
        content = result.get("content")
        if isinstance(content, dict) and content.get("video_url"):
            return content["video_url"], "video/mp4"
        output = result.get("output")
        if isinstance(output, list) and output and isinstance(output[0], str):
            return output[0], "video/mp4"
        if isinstance(result.get("video_url"), str):
            return result["video_url"], "video/mp4"
    elif kind == "AUDIO":
        if isinstance(result.get("audio"), str) and result["audio"]:
            return base64.b64decode(result["audio"]), "audio/wav"
        if isinstance(result.get("url"), str):
            return result["url"], "audio/wav"
    elif kind == "IMAGE":
        output = result.get("output")
        if isinstance(output, list) and output and isinstance(output[0], str):
            return output[0], "image/png"
        data = result.get("data")
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                if first.get("b64_json"):
                    return base64.b64decode(first["b64_json"]), "image/png"
                for key in ("url", "image_url"):
                    if first.get(key):
                        return first[key], "image/png"
        candidates = result.get("candidates")
        if isinstance(candidates, list):
            for candidate in candidates:
                for part in candidate.get("content", {}).get("parts", []):
                    inline = part.get("inlineData") or part.get("inline_data")
                    if isinstance(inline, dict) and inline.get("data"):
                        return base64.b64decode(inline["data"]), inline.get("mimeType", "image/png")
                    file_data = part.get("fileData") or part.get("file_data")
                    if isinstance(file_data, dict) and file_data.get("fileUri"):
                        return file_data["fileUri"], file_data.get("mimeType", "image/png")
        if isinstance(result.get("url"), str):
            return result["url"], "image/png"
    return None, None
