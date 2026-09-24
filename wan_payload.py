"""Wan native Router requests, aligned with ComfyUI partner Wan node roles."""


_WAN_SIZE = {
    "480P": {"1:1": "624*624", "16:9": "832*480", "9:16": "480*832"},
    "720P": {"1:1": "960*960", "16:9": "1280*720", "9:16": "720*1280",
             "4:3": "1088*832", "3:4": "832*1088"},
    "1080P": {"1:1": "1440*1440", "16:9": "1920*1080", "9:16": "1080*1920",
              "4:3": "1632*1248", "3:4": "1248*1632"},
}


def build_wan_payload(spec, values, images, videos, audios):
    model = spec.model_id.split("/", 1)[1]
    prompt = str(values.get("prompt") or "").strip()
    if spec.prompt_required and not prompt:
        raise ValueError(f"{spec.model_id}: 프롬프트를 입력하세요.")
    negative = str(values.get("negative_prompt") or "").strip()
    seed = int(values.get("seed") or 0)
    if spec.adapter == "wan_image":
        width = int(values.get("width") or 1280)
        height = int(values.get("height") or 1280)
        if width % 16 or height % 16 or not (384 <= width <= 2048 and 384 <= height <= 2048):
            raise ValueError("Wan 이미지 너비와 높이는 384~2048의 16배수여야 합니다.")
        input_data = {"prompt": prompt}
        if negative:
            input_data["negative_prompt"] = negative
        if images:
            input_data["images"] = images
        parameters = {"size": f"{width}*{height}", "n": 1, "watermark": bool(values.get("watermark"))}
        if seed:
            parameters["seed"] = seed
        return {"input": input_data, "parameters": parameters}

    input_data = {"prompt": prompt}
    if negative:
        input_data["negative_prompt"] = negative
    resolution = values.get("resolution") or spec.resolutions[0]
    selected_duration = values.get("duration") or spec.durations[0]
    duration = 0 if model == "wan2.7-videoedit" and selected_duration == "auto" else int(selected_duration)
    parameters = {
        "resolution": resolution, "duration": duration,
        "watermark": bool(values.get("watermark")),
    }
    if seed:
        parameters["seed"] = seed
    legacy_generation = model.startswith(("wan2.5", "wan2.6")) and "-r2v" not in model
    if model.startswith("wan3.0") or legacy_generation:
        parameters["audio"] = bool(values.get("generate_audio", model.startswith("wan3.0")))
    if model.startswith("wan3.0") or legacy_generation or model in ("wan2.7-t2v", "wan2.7-i2v"):
        parameters["prompt_extend"] = bool(values.get("prompt_extend", True))
    if model.startswith(("wan2.5", "wan2.6")):
        shot_type = values.get("shot_type") or "single"
        if shot_type not in ("single", "multi"):
            raise ValueError("Wan 샷 유형은 single 또는 multi입니다.")
        parameters["shot_type"] = shot_type
    if model in ("wan2.5-t2v-preview", "wan2.6-t2v", "wan2.6-r2v"):
        ratio = values.get("ratio") or "16:9"
        try:
            parameters["size"] = _WAN_SIZE[resolution][ratio]
        except KeyError as exc:
            raise ValueError(f"{spec.model_id}: {resolution}에서 {ratio} 비율은 지원하지 않습니다.") from exc
        parameters.pop("resolution")
    elif spec.ratios and values.get("ratio"):
        parameters["ratio"] = values["ratio"]

    media = []
    if model in ("wan2.5-i2v-preview", "wan2.6-i2v"):
        if len(images) != 1:
            raise ValueError(f"{spec.model_id}: image_1에 첫 프레임 이미지 한 장을 연결하세요.")
        input_data["img_url"] = images[0]
    elif model == "wan2.6-r2v":
        if not videos:
            raise ValueError("Wan 2.6 R2V는 참조 비디오가 필요합니다.")
        input_data["reference_video_urls"] = videos
    elif model.startswith("happyhorse") and "-i2v" in model:
        if len(images) != 1:
            raise ValueError(f"{spec.model_id}: 첫 프레임 이미지 한 장이 필요합니다.")
        media = [{"type": "first_frame", "url": images[0]}]
    elif model.startswith("happyhorse") and "-r2v" in model:
        if not images or len(images) > 9 or videos:
            raise ValueError(f"{spec.model_id}: 참조 이미지 1~9장만 연결하세요.")
        media = [{"type": "reference_image", "url": image} for image in images]
    elif model.startswith("happyhorse") and "video-edit" in model:
        if len(videos) != 1:
            raise ValueError(f"{spec.model_id}: 편집할 비디오 한 개가 필요합니다.")
        media = [{"type": "video", "url": videos[0]}]
    elif model == "wan2.7-i2v":
        if not images or len(images) > 2:
            raise ValueError("Wan 2.7 I2V는 첫 프레임과 선택적 마지막 프레임을 받습니다.")
        media = [{"type": "first_frame", "url": images[0]}]
        if len(images) > 1:
            media.append({"type": "last_frame", "url": images[1]})
    elif model == "wan2.7-r2v":
        media = ([{"type": "reference_image", "url": image} for image in images]
                 + [{"type": "reference_video", "url": video} for video in videos])
        if not media:
            raise ValueError("Wan 2.7 R2V는 참조 이미지 또는 비디오가 필요합니다.")
        if len(media) > 5:
            raise ValueError("Wan 2.7 R2V는 참조 이미지와 비디오를 합쳐 최대 5개입니다.")
    elif model == "wan2.7-videoedit":
        if len(videos) != 1:
            raise ValueError("Wan 2.7 Video Edit는 편집할 비디오 한 개가 필요합니다.")
        media = [{"type": "video", "url": videos[0]}]
        media += [{"type": "reference_image", "url": image} for image in images]
        audio_setting = values.get("audio_setting") or "auto"
        if audio_setting not in ("auto", "origin"):
            raise ValueError("Wan 2.7 Video Edit의 오디오 설정은 auto 또는 origin입니다.")
        parameters["audio_setting"] = audio_setting
    elif model.startswith("wan3.0"):
        mode = values.get("mode") or "auto"
        if mode == "auto":
            mode = "edit" if videos and not images else "image" if images and len(images) <= 2 and not videos and not audios else "reference"
        if mode == "image":
            if not images or len(images) > 2 or videos:
                raise ValueError("Wan 3.0 image 모드는 이미지 1~2장만 연결하세요.")
            media = [{"type": "first_frame", "url": images[0]}]
            if len(images) == 2:
                media.append({"type": "last_frame", "url": images[1]})
        elif mode == "edit":
            if len(videos) != 1:
                raise ValueError("Wan 3.0 edit 모드는 비디오 한 개를 연결하세요.")
            media = [{"type": "video", "url": videos[0]}]
        elif mode == "reference":
            media = ([{"type": "reference_image", "url": image} for image in images]
                     + [{"type": "reference_video", "url": video} for video in videos]
                     + [{"type": "reference_audio", "url": audio} for audio in audios])
        else:
            raise ValueError(f"Wan 3.0 작업 모드 {mode}는 지원하지 않습니다.")
        audios = []
    elif images or videos:
        raise ValueError(f"{spec.model_id}: 이 모델은 해당 참조 미디어를 받지 않습니다.")

    if audios:
        if len(audios) > 1:
            raise ValueError(f"{spec.model_id}: 오디오 입력은 한 개만 연결하세요.")
        if model.startswith("wan2.7"):
            media.append({"type": "driving_audio", "url": audios[0]})
        elif not model.startswith("happyhorse"):
            input_data["audio_url"] = audios[0]
        else:
            raise ValueError(f"{spec.model_id}: 오디오 입력을 지원하지 않습니다.")
    if media:
        input_data["media"] = media
    return {"input": input_data, "parameters": parameters}
