"""Convert model-specific ComfyUI controls into documented Router JSON bodies."""

import json

from .catalog import ALT_PROVIDERS, ALT_PROVIDER_RESOLUTIONS, ModelSpec, SEED_AUDIO_VOICES
from .native_payload import build_native_payload, deep_merge
from .wan_payload import build_wan_payload
from .special_payload import build_special_payload


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
    if spec.adapter != "native_schema":
        if resolution and resolution not in spec.resolutions:
            raise ValueError(f"{spec.model_id}: 해상도 {resolution}은(는) Not Support입니다.")
        ratio = values.get("ratio")
        if ratio and ratio not in spec.ratios:
            raise ValueError(f"{spec.model_id}: 비율 {ratio}은(는) Not Support입니다.")
        duration = values.get("duration")
        if duration is not None and spec.durations and (duration if duration == "auto" else int(duration)) not in spec.durations:
            raise ValueError(f"{spec.model_id}: 길이 {duration}초는 Not Support입니다.")
    provider = values.get("execution_provider") or "Comfy"
    if provider != "Comfy" and provider not in ALT_PROVIDERS.get(spec.model_id, ()):
        raise ValueError(f"{spec.model_id}: {provider} 경로는 Not Support입니다.")
    supported = ALT_PROVIDER_RESOLUTIONS.get((spec.model_id, provider))
    if resolution and supported and resolution not in supported:
        raise ValueError(f"{spec.model_id}: {provider} 경로의 {resolution} 해상도는 Not Support입니다. 지원 해상도: {', '.join(supported)}")


def build_payload(spec: ModelSpec, values: dict, images: list[str], videos: list[str], audios: list[str], advanced_json: str = "", *, first_frame=None, last_frame=None, media_values=None) -> tuple[dict, str]:
    """Media values are data URIs, public signed URLs, or raw base64 as needed."""
    _validate_selection(spec, values, images, videos, audios)
    prompt = str(values.get("prompt", "")).strip()
    if spec.prompt_required and not prompt:
        raise ValueError("프롬프트를 입력하세요.")
    resolution = _default(values, "resolution", spec.resolutions[0] if spec.resolutions else None)
    ratio = _default(values, "ratio", spec.ratios[0] if spec.ratios else None)
    duration = _default(values, "duration", spec.durations[0] if spec.durations else None)
    provider = values.get("execution_provider") or "Comfy"

    if spec.adapter == "native_schema":
        payload = build_native_payload(spec, values, media_values or {})
    elif spec.adapter in ("wan_image", "wan_video"):
        payload = build_wan_payload(spec, values, images, videos, audios)
    elif spec.adapter in ("imagen_image", "veo_video", "qwen_image", "minimax_video", "synclabs_video"):
        payload = build_special_payload(spec, values, images, videos, audios)
    elif spec.adapter == "runway_video":
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
        mode = values.get("mode") or "auto"
        if mode not in spec.modes:
            raise ValueError(f"{spec.model_id}: {mode} 모드는 Not Support입니다.")
        if last_frame and not first_frame:
            raise ValueError("마지막 프레임은 첫 프레임과 함께 연결하세요.")
        if mode == "image" and not first_frame:
            raise ValueError("image 모드에는 image_1 또는 first_frame에 첫 프레임 이미지를 연결하세요.")
        if mode == "text" and (first_frame or last_frame or images or videos or audios):
            raise ValueError("text 모드는 참조 미디어를 사용하지 않습니다. 연결을 해제하거나 auto 모드를 선택하세요.")
        if mode == "reference" and not (images or videos or audios):
            raise ValueError("reference 모드에는 image_1 등 참조 이미지·영상·오디오가 필요합니다. 첫 프레임으로 사용하려면 image 모드를 선택하세요.")
        if mode in ("edit", "extend") and not videos:
            raise ValueError(f"{mode} 모드에는 편집할 비디오 입력이 필요합니다.")
        if mode in ("edit", "extend") and provider != "Comfy":
            raise ValueError(f"{provider} Router 경로의 {mode} 모드 변환은 확인되지 않았습니다. 해당 모드는 Comfy 공급자에서 선택하세요.")
        if audios and not (images or videos) and not spec.supports_audio_only:
            raise ValueError("이 Seedance 버전은 오디오만으로 생성할 수 없습니다. 이미지 또는 비디오를 연결하세요.")
        content = [{"type": "text", "text": prompt}]
        if first_frame:
            content.append({"type": "image_url", "image_url": {"url": first_frame}, "role": "first_frame"})
        if last_frame:
            content.append({"type": "image_url", "image_url": {"url": last_frame}, "role": "last_frame"})
        content += [{"type": "image_url", "image_url": {"url": image}, "role": "reference_image"} for image in images]
        content += [{"type": "video_url", "video_url": {"url": video}, "role": "reference_video"} for video in videos]
        content += [{"type": "audio_url", "audio_url": {"url": audio}, "role": "reference_audio"} for audio in audios]
        payload = {"content": content, "resolution": resolution, "ratio": ratio, "duration": int(duration), "generate_audio": values.get("generate_audio") is not False, "seed": int(values.get("seed") or 0), "watermark": bool(values.get("watermark", False))}
        if spec.output_formats:
            output_format = values.get("output_format") or spec.output_formats[0]
            if output_format not in spec.output_formats:
                raise ValueError(f"{spec.model_id}: {output_format} 출력 형식은 Not Support입니다.")
            payload["output_format"] = output_format
        if mode in ("reference", "edit", "extend") and "edit" in spec.modes:
            payload["omni_reference_task_type"] = mode
        if mode in ("edit", "extend"):
            payload["ratio"] = "adaptive"
        if mode == "edit":
            payload["duration"] = -1
    elif spec.adapter == "seedream":
        payload = {"prompt": prompt, "size": resolution, "response_format": "url"}
        if images:
            payload["image"] = images[0] if len(images) == 1 else images
        mode = values.get("mode") or "standard"
        if spec.modes and mode not in spec.modes:
            raise ValueError(f"{spec.model_id}: {mode} 프롬프트 최적화 모드는 Not Support입니다.")
        if mode == "fast":
            if not images:
                raise ValueError("Seedream fast 프롬프트 최적화 모드에는 참조 이미지가 필요합니다.")
            payload["optimize_prompt_options"] = {"mode": "fast"}
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
        mode = values.get("mode") or "auto"
        if mode not in spec.modes:
            raise ValueError(f"{spec.model_id}: {mode} 참조 모드는 Not Support입니다.")
        if mode == "auto":
            mode = "image" if images else "audio" if audios else "text"
        if mode == "text" and (images or audios):
            raise ValueError("Seed Audio text 모드는 참조 미디어를 사용하지 않습니다.")
        if mode == "image" and (len(images) != 1 or audios):
            raise ValueError("Seed Audio image 모드에는 이미지 한 장만 연결하세요.")
        if mode == "audio" and (not audios or images):
            raise ValueError("Seed Audio audio 모드에는 오디오만 1~3개 연결하세요.")
        if mode == "preset_voice" and (images or audios):
            raise ValueError("Seed Audio preset_voice 모드에서는 참조 미디어 연결을 해제하세요.")
        if mode == "image":
            references = [{"image_data": images[0].split(",", 1)[1]}]
        elif mode == "audio":
            references = [{"audio_data": audio.split(",", 1)[1]} for audio in audios]
        elif mode == "preset_voice":
            voice = values.get("preset_voice") or next(iter(SEED_AUDIO_VOICES))
            if voice not in SEED_AUDIO_VOICES:
                raise ValueError(f"Seed Audio 기본 음성 {voice}은(는) Not Support입니다.")
            references = [{"speaker": SEED_AUDIO_VOICES[voice]}]
        else:
            references = []
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
        if spec.adapter == "native_schema":
            deep_merge(payload, extra)
        else:
            payload.update(extra)
    supported = ALT_PROVIDER_RESOLUTIONS.get((spec.model_id, provider))
    if supported and payload.get("resolution") not in supported:
        raise ValueError(f"{spec.model_id}: {provider} 경로의 {payload.get('resolution')} 해상도는 Not Support입니다. 지원 해상도: {', '.join(supported)}")
    return payload, provider
