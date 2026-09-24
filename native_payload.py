"""Build native Router request bodies from the checked-in model schema mapping."""

import json


def _put(target, path, value):
    current = target
    for index, key in enumerate(path[:-1]):
        next_value = [] if isinstance(path[index + 1], int) else {}
        if isinstance(current, list):
            while len(current) <= key:
                current.append(None)
            if current[key] is None:
                current[key] = next_value
            current = current[key]
        else:
            current = current.setdefault(key, next_value)
    last = path[-1]
    if isinstance(current, list):
        while len(current) <= last:
            current.append(None)
    current[last] = value


def deep_merge(target, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            deep_merge(target[key], value)
        else:
            target[key] = value
    return target


def build_native_payload(spec, values, media_values):
    payload = json.loads(json.dumps(getattr(spec, "request_template", {}) or {}))
    prompt = str(values.get("prompt") or "").strip()
    if spec.prompt_path and prompt:
        _put(payload, spec.prompt_path, prompt)
    elif spec.prompt_required and not prompt:
        raise ValueError(f"{spec.model_id}: 프롬프트 또는 지시문을 입력하세요.")
    for item in spec.controls:
        if spec.model_id.startswith("luma_2/") and item["name"] in ("video_duration", "video_resolution") and values.get("type") != "video":
            continue
        value = values.get(item["name"])
        if value in (None, ""):
            if item["required"]:
                raise ValueError(f"{spec.model_id}: {item['name']} 값을 입력하세요.")
            continue
        if value == 0 and "default" not in item and not item["required"]:
            continue
        if item.get("options") and value not in item["options"]:
            raise ValueError(f"{spec.model_id}: {item['name']} 값 {value!r}은(는) 지원하지 않습니다.")
        if item["kind"] == "integer":
            value = int(value)
        elif item["kind"] == "number":
            value = float(value)
        _put(payload, item["path"], value)
    for item in spec.media_fields:
        if spec.model_id == "beeble/switchx" and item["name"] in ("source_image", "source_video"):
            expected = "source_video" if values.get("generation_type") == "video" else "source_image"
            if item["name"] != expected:
                continue
        value = media_values.get(item["name"])
        if not value:
            if item["required"] or spec.model_id == "beeble/switchx" and item["name"] in ("source_image", "source_video"):
                raise ValueError(f"{spec.model_id}: {item['name']} 입력을 연결하세요.")
            continue
        if item.get("wrap") == "xai_image":
            value = {"type": "image_url", "url": value}
        _put(payload, item["path"], value)
    return payload
