"""Native request formats for Router models with nested media structures."""


def build_special_payload(spec, values, images, videos, audios):
    adapter = spec.adapter
    prompt = str(values.get("prompt") or "").strip()
    if spec.prompt_required and not prompt:
        raise ValueError(f"{spec.model_id}: 프롬프트를 입력하세요.")
    if adapter == "imagen_image":
        return {
            "instances": [{"prompt": prompt}],
            "parameters": {"sampleCount": 1, "aspectRatio": values.get("ratio") or "1:1"},
        }
    if adapter == "veo_video":
        if len(images) > 2:
            raise ValueError("Veo는 첫 프레임과 마지막 프레임 이미지까지 받습니다.")
        instance = {"prompt": prompt}
        for index, image in enumerate(images):
            if not image.startswith("data:image/") or ";base64," not in image:
                raise ValueError("Veo 프레임은 Base64 이미지여야 합니다.")
            mime = image[5:].split(";", 1)[0]
            value = {"bytesBase64Encoded": image.split(",", 1)[1], "mimeType": mime}
            instance["image" if index == 0 else "lastFrame"] = value
        if "lastFrame" in instance and "image" not in instance:
            raise ValueError("Veo 마지막 프레임은 첫 프레임과 함께 연결하세요.")
        parameters = {
            "sampleCount": 1,
            "durationSeconds": int(values.get("duration") or 4),
            "aspectRatio": values.get("ratio") or "16:9",
            "resolution": values.get("resolution") or "720p",
            "generateAudio": bool(values.get("generate_audio")),
        }
        if int(values.get("seed") or 0):
            parameters["seed"] = int(values["seed"])
        return {"instances": [instance], "parameters": parameters}
    if adapter == "qwen_image":
        if len(images) > 3:
            raise ValueError("Qwen Image 3 편집에는 참조 이미지 최대 3장을 연결하세요.")
        width = int(values.get("width") or 1024)
        height = int(values.get("height") or 1024)
        area = width * height
        if not 262144 <= area <= 6553600 or max(width / height, height / width) > 8:
            raise ValueError("Qwen 이미지 크기는 512²~2560² 픽셀 면적과 최대 8:1 비율이어야 합니다.")
        content = [{"image": image} for image in images] + [{"text": prompt}]
        parameters = {"n": 1, "size": f"{width}*{height}"}
        if values.get("negative_prompt"):
            parameters["negative_prompt"] = values["negative_prompt"]
        return {"input": {"messages": [{"role": "user", "content": content}]},
                "parameters": parameters}
    if adapter == "minimax_video":
        if len(images) > 2:
            raise ValueError("MiniMax H3는 첫 프레임과 마지막 프레임 두 장까지 받습니다.")
        content = [{"type": "text", "text": prompt}]
        for index, image in enumerate(images):
            content.append({"type": "image_url", "image_url": {"url": image},
                            "role": "first_frame" if index == 0 else "last_frame"})
        payload = {"content": content, "resolution": values.get("resolution") or "768P",
                   "ratio": values.get("ratio") or "16:9",
                   "duration": int(values.get("duration") or 5)}
        if int(values.get("seed") or 0):
            payload["seed"] = int(values["seed"])
        return payload
    if adapter == "synclabs_video":
        if len(videos) != 1 or len(audios) != 1:
            raise ValueError("SyncLabs Sync 3에는 비디오 한 개와 오디오 한 개를 연결하세요.")
        return {"input": [{"type": "video", "url": videos[0]},
                          {"type": "audio", "url": audios[0]}]}
    raise ValueError(f"{spec.model_id}: 요청 형식이 준비되지 않았습니다.")
