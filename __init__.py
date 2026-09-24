"""Soylab Comfy Router — local ComfyUI V3 custom node."""

import asyncio
import base64
import configparser
import json
import ipaddress
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from comfy_api.latest import IO, ComfyExtension

from .catalog import ALT_PROVIDERS, BY_LABEL, BY_LEGACY_LABEL, DEFAULT_EXECUTION_PROVIDER, DEFAULT_MODEL_ID, MODELS, SEED_AUDIO_VOICES, model_label
from .media import audio_from_bytes, audio_wav_bytes, image_data_uri, image_from_bytes, video_bytes, video_from_bytes
from .key_editor import open_key_file
from .payload import build_payload
from .result import media_reference
from .router import RouterError, download_asset, run_model, upload_asset


WEB_DIRECTORY = "./web"
ROOT = Path(__file__).resolve().parent
_ROUTES_REGISTERED = False
_STAGE_TEXT = {
    "preparing": "입력 준비 중",
    "uploading": "참조 파일 전송 중",
    "submitting": "Router 서버에 요청 전송 중",
    "queued": "Router에 전달 완료 · 대기 중",
    "generating": "공급자에서 생성 중",
    "sync_waiting": "공급자 응답 대기 중",
    "collecting": "생성 완료 · 결과 수신 중",
    "downloading": "결과 파일 다운로드 중",
    "completed": "완료",
    "failed": "오류 · 실행 기록 확인",
}
_STAGE_STEP = {
    "preparing": 1, "uploading": 1,
    "submitting": 2,
    "queued": 3, "generating": 3, "sync_waiting": 3,
    "collecting": 4, "downloading": 4,
    "completed": 5,
}


def _progress_text(stage, elapsed_seconds=0, **details):
    message = _STAGE_TEXT.get(stage, stage)
    if stage == "queued" and isinstance(details.get("queue_position"), int):
        message += f" · 앞에 {details['queue_position']}건"
    step = _STAGE_STEP.get(stage)
    count = f" ({step}/5)" if step is not None else ""
    return f"SOYLAB Router{count} · {message} · {max(0, int(elapsed_seconds))}초 경과"


def _report_progress(server, node_id, stage, elapsed_seconds=0, **details):
    server.send_sync("soylab_router_status", {"node_id": node_id, "stage": stage, **details})
    server.send_progress_text(_progress_text(stage, elapsed_seconds, **details), node_id)


def _register_routes():
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    from aiohttp import web
    from server import PromptServer

    def local_request(request):
        try:
            local = ipaddress.ip_address(request.remote).is_loopback
        except (TypeError, ValueError):
            local = False
        origin = request.headers.get("Origin")
        site = request.headers.get("Sec-Fetch-Site")
        return local and (not origin or urlsplit(origin).netloc == request.host) and site in (None, "same-origin", "none")

    @PromptServer.instance.routes.get("/soylab_router/api_key_file_status")
    async def api_key_file_status(request):
        if not local_request(request):
            return web.json_response({"error": "로컬 ComfyUI 창에서만 사용할 수 있습니다."}, status=403)
        return web.json_response({"exists": (ROOT / "API KEY.INI").is_file()})

    @PromptServer.instance.routes.post("/soylab_router/open_api_key")
    async def open_api_key(request):
        if not local_request(request):
            return web.json_response({"error": "로컬 ComfyUI 창에서만 사용할 수 있습니다."}, status=403)
        try:
            open_key_file(ROOT / "API KEY.INI")
        except (OSError, FileNotFoundError) as exc:
            return web.json_response({"error": f"편집기를 열지 못했습니다: {exc}"}, status=500)
        return web.json_response({"ok": True})

    _ROUTES_REGISTERED = True


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
    default_provider = DEFAULT_EXECUTION_PROVIDER if spec.model_id == DEFAULT_MODEL_ID else "Comfy"
    inputs = [IO.Combo.Input("execution_provider", options=route_options, display_name="공급자 선택", default=default_provider, tooltip="Router 실행 경로입니다. Comfy는 파트너 모델의 기본 경로이며 모델 제작사(예: Runway)와는 다른 개념입니다. 공식 대체 경로만 선택지에 표시됩니다.")]
    if spec.adapter == "seedance":
        inputs.append(IO.Combo.Input("mode", options=list(spec.modes), display_name="작업 모드", default=spec.modes[0], tooltip="image 모드에서는 image_1=첫 프레임, image_2=마지막 프레임입니다. reference 모드에서는 참조 이미지로 사용합니다."))
    elif spec.adapter == "seedream" and spec.modes:
        inputs.append(IO.Combo.Input("mode", options=list(spec.modes), display_name="프롬프트 최적화 모드", default=spec.modes[0], tooltip="참조 이미지를 사용할 때 standard=품질 우선, fast=속도 우선. Seedream 5.0 Pro에서 지원합니다."))
    elif spec.adapter == "seed_audio" and spec.modes:
        inputs.append(IO.Combo.Input("mode", options=list(spec.modes), display_name="참조 모드", default=spec.modes[0], tooltip="auto=연결된 입력에서 판단 · text=텍스트만 · audio=오디오 참조 · image=이미지 참조 · preset_voice=기본 음성"))
        inputs.append(IO.Combo.Input("preset_voice", options=list(SEED_AUDIO_VOICES), default=next(iter(SEED_AUDIO_VOICES)), tooltip="preset_voice 모드에서 사용할 기본 음성"))
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
        inputs.append(IO.Image.Input("first_frame", optional=True, tooltip="첫 프레임 전용 입력. image 모드에서 image_1 대신 사용할 수 있습니다."))
        inputs.append(IO.Image.Input("last_frame", optional=True, tooltip="마지막 프레임 전용 입력. image 모드에서 image_2 대신 사용할 수 있습니다."))
        inputs.append(IO.Int.Input("seed", default=0, min=0, max=4294967295))
        inputs.append(IO.Boolean.Input("watermark", default=False))
        inputs.append(IO.Boolean.Input("generate_audio", default=True, tooltip="영상에 오디오 생성"))
        if spec.output_formats:
            inputs.append(IO.Combo.Input("output_format", options=list(spec.output_formats), default=spec.output_formats[0]))
    if spec.qualities:
        inputs.append(IO.Combo.Input("quality", options=list(spec.qualities), default=spec.qualities[0]))
    inputs.extend(_media_inputs(spec))
    return inputs


def _model_input():
    ordered_models = sorted(MODELS, key=lambda spec: spec.model_id != DEFAULT_MODEL_ID)
    options = [IO.DynamicCombo.Option(model_label(spec), _model_inputs(spec)) for spec in ordered_models]
    return IO.DynamicCombo.Input("model", options=options, display_name="모델")


def _selection(model_data: dict):
    if not isinstance(model_data, dict):
        raise ValueError("모델을 선택하세요.")
    label = model_data.get("model")
    spec = BY_LABEL.get(label) or BY_LEGACY_LABEL.get(label)
    if spec is None:
        raise ValueError(f"Not Support: {label}")
    return spec, model_data


def _ordered_values(group):
    if not group:
        return []
    if not isinstance(group, dict):
        raise ValueError("참조 입력 형식이 잘못되었습니다.")
    return [value for _, value in sorted(group.items(), key=lambda pair: int(pair[0].rsplit("_", 1)[-1])) if value is not None]


def _seedance_frame_aliases(mode, image_inputs, first_frame, last_frame):
    """In image mode, numbered image sockets are the start and end frames."""
    if mode != "image":
        return _ordered_values(image_inputs), first_frame, last_frame
    if image_inputs and not isinstance(image_inputs, dict):
        raise ValueError("참조 입력 형식이 잘못되었습니다.")
    image_inputs = image_inputs or {}
    if first_frame is not None and image_inputs.get("image_1") is not None:
        raise ValueError("첫 프레임은 image_1 또는 first_frame 한 곳에만 연결하세요.")
    if last_frame is not None and image_inputs.get("image_2") is not None:
        raise ValueError("마지막 프레임은 image_2 또는 last_frame 한 곳에만 연결하세요.")
    first_frame = first_frame if first_frame is not None else image_inputs.get("image_1")
    last_frame = last_frame if last_frame is not None else image_inputs.get("image_2")
    references = {key: value for key, value in image_inputs.items() if key not in ("image_1", "image_2")}
    return _ordered_values(references), first_frame, last_frame


async def _prepare_provider_images(spec, provider, payload, key, report):
    """Give Higgsfield reachable image URLs instead of inline data URIs."""
    if spec.adapter != "seedance" or provider != "higgsfield":
        return
    uploaded = {}
    for item in payload.get("content", []):
        image = item.get("image_url")
        if not isinstance(image, dict):
            continue
        uri = image.get("url")
        if not isinstance(uri, str) or not uri.startswith("data:image/png;base64,"):
            continue
        if uri not in uploaded:
            report("uploading")
            data = base64.b64decode(uri.split(",", 1)[1], validate=True)
            uploaded[uri] = await asyncio.to_thread(upload_asset, data, f"soylab-{uuid4().hex}.png", "image/png", key)
        image["url"] = uploaded[uri]


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
            hidden=[IO.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    async def execute(cls, api_key: str, model: dict, advanced_json: str = "") -> IO.NodeOutput:
        from server import PromptServer

        node_id = str(cls.hidden.unique_id)
        started_at = time.monotonic()
        progress = {"stage": "preparing", "details": {}}
        def report(stage, **details):
            progress.update(stage=stage, details=details)
            _report_progress(PromptServer.instance, node_id, stage,
                             elapsed_seconds=time.monotonic() - started_at, **details)

        async def tick_progress():
            while True:
                await asyncio.sleep(1)
                if progress["stage"] in ("completed", "failed"):
                    return
                PromptServer.instance.send_progress_text(
                    _progress_text(progress["stage"], time.monotonic() - started_at,
                                   **progress["details"]), node_id)

        report("preparing")
        ticker = asyncio.create_task(tick_progress())
        try:
            return await cls._execute_with_status(api_key, model, advanced_json, report)
        except Exception:
            report("failed")
            raise
        finally:
            ticker.cancel()

    @classmethod
    async def _execute_with_status(cls, api_key, model, advanced_json, report):
        key = _api_key(api_key)
        if not key:
            raise ValueError("개인 API 키를 입력하거나 API KEY.INI 파일에 저장하세요.")
        spec, values = _selection(model)
        image_inputs = values.get("reference_images")
        first_input = values.get("first_frame")
        last_input = values.get("last_frame")
        if spec.adapter == "seedance":
            image_values, first_input, last_input = _seedance_frame_aliases(values.get("mode"), image_inputs, first_input, last_input)
        else:
            image_values = _ordered_values(image_inputs)
        images = [image_data_uri(image) for image in image_values]
        audios = ["data:audio/wav;base64," + base64.b64encode(audio_wav_bytes(audio)).decode("ascii") for audio in _ordered_values(values.get("reference_audios"))]
        video_inputs = _ordered_values(values.get("reference_videos"))
        videos = []
        for video in video_inputs:
            report("uploading")
            data = video_bytes(video)
            if spec.adapter == "runway_aleph":
                videos.append("data:video/mp4;base64," + base64.b64encode(data).decode("ascii"))
            else:
                videos.append(await asyncio.to_thread(upload_asset, data, f"soylab-{uuid4().hex}.mp4", "video/mp4", key))
        first = image_data_uri(first_input) if first_input is not None else None
        last = image_data_uri(last_input) if last_input is not None else None
        payload, provider = build_payload(spec, values, images, videos, audios, advanced_json, first_frame=first, last_frame=last)
        await _prepare_provider_images(spec, provider, payload, key, report)
        result, actual_credits = await asyncio.to_thread(run_model, spec.model_id, payload, key, provider, report, spec.output == "IMAGE")
        report("downloading")
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
        credits_text = f"사용 크레딧 {actual_credits:g} C" if actual_credits is not None else "사용 크레딧 확인 불가 · Comfy Credit History 확인"
        cost_text = f"{spec.model_id} · {provider} · {credits_text}"
        raw = json.dumps(result, ensure_ascii=False, indent=2)
        report("completed")
        return IO.NodeOutput(image, video, audio, raw, cost_text, ui={"soylab_router_cost": [{"model_id": spec.model_id, "provider": provider, "credits": actual_credits}]})


class SoylabRouterExtension(ComfyExtension):
    async def get_node_list(self):
        return [SoylabComfyRouter]


async def comfy_entrypoint():
    _register_routes()
    return SoylabRouterExtension()


__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
