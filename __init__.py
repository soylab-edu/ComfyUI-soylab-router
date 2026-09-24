"""Soylab Comfy Router — local ComfyUI V3 custom node."""

import asyncio
import base64
import configparser
import json
from pathlib import Path
from uuid import uuid4

from comfy_api.latest import IO, ComfyExtension

from .catalog import ALT_PROVIDERS, BY_LABEL, MODELS, model_label
from .media import audio_from_bytes, audio_wav_bytes, image_data_uri, image_from_bytes, video_bytes, video_from_bytes
from .payload import build_payload
from .result import media_reference
from .router import RouterError, download_asset, run_model, upload_asset

WEB_DIRECTORY = "./web"
ROOT = Path(__file__).resolve().parent


def _api_key(widget_value: str) -> str:
    if widget_value and widget_value.strip():
        return widget_value.strip()
    config = configparser.ConfigParser()
    path = ROOT / "API KEY.INI"
    if path.is_file():
        config.read(path, encoding="utf-8")
        return config.get("comfy_router", "api_key", fallback="").strip()
    return ""


def _media_inputs(spec):
    inputs = []
    if spec.images:
        inputs.append(IO.Autogrow.Input(
            "reference_images",
            template=IO.Autogrow.TemplateNames(IO.Image.Input("reference_image"), names=[f"image_{i}" for i in range(1, spec.images + 1)], min=0),
            tooltip=f"참조 이미지 최대 {spec.images}장",
        ))
    if spec.videos:
        inputs.append(IO.Autogrow.Input(
            "reference_videos",
            template=IO.Autogrow.TemplateNames(IO.Video.Input("reference_video"), names=[f"video_{i}" for i in range(1, spec.videos + 1)], min=0),
            tooltip=f"참조 비디오 최대 {spec.videos}개",
        ))
    if spec.audios:
        inputs.append(IO.Autogrow.Input(
            "reference_audios",
            template=IO.Autogrow.TemplateNames(IO.Audio.Input("reference_audio"), names=[f"audio_{i}" for i in range(1, spec.audios + 1)], min=0),
            tooltip=f"참조 오디오 최대 {spec.audios}개",
        ))
    return inputs


def _model_inputs(spec):
    route_options = ["Comfy", *ALT_PROVIDERS.get(spec.model_id, ())]
    inputs = [IO.Combo.Input("execution_provider", options=route_options, display_name="Router 실행 공급자", default="Comfy", tooltip="Comfy Router 안에서 이 모델을 실행할 공급자입니다. 모델 제작사의 직접 API와는 별개입니다.")]
    inputs.append(IO.String.Input("prompt", default="", multiline=True, tooltip="생성 또는 편집 프롬프트"))
    if spec.resolutions:
        inputs.append(IO.Combo.Input("resolution", options=list(spec.resolutions), default=spec.resolutions[0], tooltip="모델에서 지원하는 해상도 또는 크기"))
    if spec.ratios:
        inputs.append(IO.Combo.Input("ratio", options=list(spec.ratios), default=spec.ratios[0], tooltip="모델에서 지원하는 화면 비율"))
    if spec.durations:
        inputs.append(IO.Combo.Input("duration", options=list(spec.durations), default=spec.durations[0], tooltip="영상 길이(초)"))
    if spec.adapter == "runway_video":
        inputs.append(IO.Int.Input("seed", default=0, min=0, max=4294967295))
    if spec.adapter == "seedance":
        inputs.append(IO.Boolean.Input("generate_audio", default=True, tooltip="영상에 오디오 생성"))
    if spec.adapter == "gpt_image":
        qualities = ["low", "medium", "high"] if spec.version == "2" else ["low", "medium", "high", "xhigh", "max"]
        inputs.append(IO.Combo.Input("quality", options=qualities, default="low"))
    inputs.extend(_media_inputs(spec))
    return inputs


def _model_input():
    options = [IO.DynamicCombo.Option(model_label(spec), _model_inputs(spec)) for spec in MODELS]
    return IO.DynamicCombo.Input("model", options=options, display_name="모델")


def _selection(model_data: dict):
    if not isinstance(model_data, dict):
        raise ValueError("모델을 선택하세요.")
    label = model_data.get("model")
    if label not in BY_LABEL:
        raise ValueError(f"Not Support: {label}")
    return BY_LABEL[label], model_data


def _ordered_values(group):
    if not group:
        return []
    if not isinstance(group, dict):
        raise ValueError("참조 입력 형식이 잘못되었습니다.")
    return [value for _, value in sorted(group.items(), key=lambda pair: int(pair[0].rsplit("_", 1)[-1])) if value is not None]


class SoylabComfyRouter(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SoylabComfyRouter",
            display_name="SOYLAB Comfy Router",
            category="Soylab/Comfy Router",
            description="Comfy Router 모델을 개인 API 키로 실행합니다. 모델에 따라 입력이 바뀝니다.",
            inputs=[
                IO.String.Input("api_key", default="", placeholder="개인 Comfy Router API 키", tooltip="비워두면 API KEY.INI에서 읽습니다. 노드에 입력한 키는 워크플로에 저장될 수 있습니다."),
                _model_input(),
                IO.String.Input("advanced_json", default="", multiline=True, advanced=True, tooltip="선택한 모델의 추가 네이티브 JSON 파라미터. model 필드는 URL에서 지정됩니다."),
            ],
            outputs=[
                IO.Image.Output("image", display_name="IMAGE"),
                IO.Video.Output("video", display_name="VIDEO"),
                IO.Audio.Output("audio", display_name="AUDIO"),
                IO.String.Output("raw_json", display_name="RAW JSON"),
                IO.String.Output("cost", display_name="COST"),
            ],
            not_idempotent=True,
        )

    @classmethod
    async def execute(cls, api_key: str, model: dict, advanced_json: str = "") -> IO.NodeOutput:
        key = _api_key(api_key)
        if not key:
            raise ValueError("개인 API 키를 입력하거나 API KEY.INI 파일에 저장하세요.")
        spec, values = _selection(model)
        images = [image_data_uri(image) for image in _ordered_values(values.get("reference_images"))]
        audios = ["data:audio/wav;base64," + base64.b64encode(audio_wav_bytes(audio)).decode("ascii") for audio in _ordered_values(values.get("reference_audios"))]
        video_inputs = _ordered_values(values.get("reference_videos"))
        videos = []
        for video in video_inputs:
            data = video_bytes(video)
            if spec.adapter == "runway_aleph":
                videos.append("data:video/mp4;base64," + base64.b64encode(data).decode("ascii"))
            else:
                videos.append(await asyncio.to_thread(upload_asset, data, f"soylab-{uuid4().hex}.mp4", "video/mp4", key))
        payload, provider = build_payload(spec, values, images, videos, audios, advanced_json)
        result, actual_credits = await asyncio.to_thread(run_model, spec.model_id, payload, key, provider)
        reference, mime = media_reference(result, spec.output)
        image = video = audio = None
        if reference is not None:
            data, content_type = (reference, mime) if isinstance(reference, bytes) else await asyncio.to_thread(download_asset, reference)
            if spec.output == "IMAGE":
                image = image_from_bytes(data)
            elif spec.output == "VIDEO":
                video = video_from_bytes(data)
            elif spec.output == "AUDIO":
                audio = audio_from_bytes(data)
        if reference is None:
            raise RouterError("Router가 완료 응답을 보냈지만 결과 미디어를 찾지 못했습니다. RAW JSON 확인이 필요합니다.")
        credits_text = f"{actual_credits:g} credits" if actual_credits is not None else "응답에 과금 정보 없음"
        cost_text = f"{spec.model_id} · {provider} · {credits_text}"
        raw = json.dumps(result, ensure_ascii=False, indent=2)
        return IO.NodeOutput(image, video, audio, raw, cost_text, ui={"soylab_router_cost": [{"model_id": spec.model_id, "provider": provider, "credits": actual_credits}]})


class SoylabRouterExtension(ComfyExtension):
    async def get_node_list(self):
        return [SoylabComfyRouter]


async def comfy_entrypoint():
    return SoylabRouterExtension()


__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
