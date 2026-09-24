"""Convert model-specific ComfyUI controls into documented Router JSON bodies."""

import json

from .catalog import ALT_PROVIDERS, ALT_PROVIDER_RESOLUTIONS, ModelSpec


def _default(values: dict, key: str, fallback):
    value = values.get(key)
    return fallback if value in (None, "") else value


def _validate_selection(spec: ModelSpec, values: dict, images, videos, audios):
    for label, items, maximum in (("image", images, spec.images), ("video", videos, spec.videos), ("audio", audios, spec.audios)):
        if len(items) > maximum:
            raise ValueError(f"{spec.model_id}: {label} 참조는 최대 {maximum}개입니다.")
    if spec.requires_image and not images:
        raise ValueError(f"{spec.model_id}: 이미지 입력이 필요합니다.")
    if spec.requires_video and not videos:
        raise ValueError(f"{spec.model_id}: 비디오 입력이 필요합니다.")
    resolution = values.get("resolution")
    if resolution and resolution not in spec.resolutions:
        raise ValueError(f"{spec.model_id}: 해상도 {resolution}은(는) Not Support입니다.")
    ratio = values.get("ratio")
    if ratio and ratio not in spec.ratios:
        raise ValueError(f"{spec.model_id}: 비율 {ratio}은(는) Not Support입니다.")
    duration = values.get("duration")
    if duration is not None and spec.durations and int(duration) not in spec.durations:
        raise ValueError(f"{spec.model_id}: 길이 {duration}초는 Not Support입니다.")
    provider = values.get("execution_provider") or "Comfy"
    if provider != "Comfy" and provider not in ALT_PROVIDERS.get(spec.model_id, ()):
        raise ValueError(f"{spec.model_id}: {provider} 경로는 Not Support입니다.")
    supported = ALT_PROVIDER_RESOLUTIONS.get((spec.model_id, provider))
    if resolution and supported and resolution not in supported:
        raise ValueError(f"{spec.model_id}: {provider} 경로의 {resolution} 해상도는 Not Support입니다. 지원 해상도: {', '.join(supported)}")


def build_payload(spec: ModelSpec, values: dict, images: list[str], videos: list[str], audios: list[str], advanced_json: str = "") -> tuple[dict, str]:
    """Media values are data URIs, public signed URLs, or raw base64 as needed."""
    _validate_selection(spec, values, images, videos, audios)
    prompt = str(values.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("프롬프트를 입력하세요.")
    resolution = _default(values, "resolution", spec.resolutions[0] if spec.resolutions else None)
    ratio = _default(values, "ratio", spec.ratios[0] if spec.ratios else None)
    duration = _default(values, "duration", spec.durations[0] if spec.durations else None)
    provider = values.get("execution_provider") or "Comfy"

    if spec.adapter == "runway_video":
        payload = {"promptImage": images[0], "promptText": prompt, "ratio": resolution, "duration": int(duration), "seed": int(values.get("seed") or 0)}
    elif spec.adapter == "runway_image":
        payload = {"promptText": prompt, "ratio": resolution}
        if images:
            payload["referenceImages"] = [{"uri": image} for image in images]
    elif spec.adapter == "runway_aleph":
        payload = {"promptText": prompt, "videoUri": videos[0]}
        if images:
            positions = ["first"] if len(images) == 1 else ["first"] + [{"type": "position", "positionPercentage": round(i / (len(images) - 1), 3)} for i in range(1, len(images) - 1)] + ["last"]
            payload["promptImage"] = [{"uri": image, "position": position} for image, position in zip(images, positions)]
    elif spec.adapter == "seedance":
        if audios and not (images or videos) and not spec.supports_audio_only:
            raise ValueError("이 Seedance 버전은 오디오만으로 생성할 수 없습니다. 이미지 또는 비디오를 연결하세요.")
        content = [{"type": "text", "text": prompt}]
        content += [{"type": "image_url", "image_url": {"url": image}, "role": "reference_image"} for image in images]
        content += [{"type": "video_url", "video_url": {"url": video}, "role": "reference_video"} for video in videos]
        content += [{"type": "audio_url", "audio_url": {"url": audio}, "role": "reference_audio"} for audio in audios]
        payload = {"content": content, "resolution": resolution, "ratio": ratio, "duration": int(duration), "generate_audio": values.get("generate_audio") is not False}
    elif spec.adapter == "seedream":
        payload = {"prompt": prompt, "size": resolution, "response_format": "url"}
        if images:
            payload["image"] = images[0] if len(images) == 1 else images
    elif spec.adapter == "gpt_image":
        payload = {"prompt": prompt, "size": resolution, "quality": values.get("quality", "low"), "n": 1}
        if images:
            payload["image"] = images
    elif spec.adapter == "gemini_image":
        parts = [{"text": prompt}]
        for image in images:
            header, encoded = image.split(",", 1)
            parts.append({"inlineData": {"mimeType": header[5:].split(";", 1)[0], "data": encoded}})
        image_config = {"imageSize": resolution}
        if ratio and ratio != "auto":
            image_config["aspectRatio"] = ratio
        payload = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": image_config}}
    elif spec.adapter == "seed_audio":
        if images and audios:
            raise ValueError("Seed Audio는 이미지와 오디오 참조를 동시에 받을 수 없습니다.")
        references = []
        if images:
            references = [{"image_data": images[0].split(",", 1)[1]}]
        else:
            references = [{"audio_data": audio.split(",", 1)[1]} for audio in audios]
        payload = {"text_prompt": prompt, "audio_config": {"format": "wav", "sample_rate": 24000}}
        if references:
            payload["references"] = references
    else:
        raise ValueError(f"{spec.model_id}: 어댑터가 Not Support입니다.")

    if (advanced_json or "").strip():
        try:
            extra = json.loads(advanced_json)
        except json.JSONDecodeError as exc:
            raise ValueError(f"추가 JSON 형식 오류: {exc.msg}") from exc
        if not isinstance(extra, dict):
            raise ValueError("추가 JSON은 객체여야 합니다.")
        if "model" in extra:
            raise ValueError("model은 Router URL에서 지정하므로 추가 JSON에 넣을 수 없습니다.")
        payload.update(extra)
    supported = ALT_PROVIDER_RESOLUTIONS.get((spec.model_id, provider))
    if supported and payload.get("resolution") not in supported:
        raise ValueError(f"{spec.model_id}: {provider} 경로의 {payload.get('resolution')} 해상도는 Not Support입니다. 지원 해상도: {', '.join(supported)}")
    return payload, provider
