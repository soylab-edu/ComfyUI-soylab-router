"""Refresh Router media catalog from the official model list and native OpenAPI schemas.

Run with COMFY_API_KEY or an ignored local API KEY.INI to fetch live data.
For repeatable offline checks, pass --entries, --schemas, and --providers snapshots.
API keys never enter generated files.
"""

import argparse
import configparser
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "web" / "router-data.json"
SCHEMA_FILE = ROOT / "model-schemas.json"
NON_MEDIA_PROVIDERS = {"Anthropic", "Elevenlabs", "Gemini Interactions", "HeyGen", "Meshy", "Openrouter", "Tencent"}
NON_MEDIA_IDS = {
    "bria/structured-instruction",
    "vertexai/gemini-3.1-flash-lite", "vertexai/gemini-3.7-flash",
    "vertexai/gemini-3.8-flash", "vertexai/gemini-3.1-pro-preview",
}
HIDDEN_FIELDS = {
    "model", "callback_url", "webhook_url", "webhookUrl", "webhook_secret",
    "stream", "sync", "sync_mode", "user", "projectId", "idempotency_key",
    "external_task_id", "storageUri", "pubsubTopic",
}
MEDIA_HINTS = {
    "image", "images", "img_url", "image_url", "input_image", "input_image_2",
    "input_image_3", "input_image_4", "input_image_5", "input_image_6",
    "input_image_7", "input_image_8", "input_image_9", "image_prompt",
    "reference_image", "reference_image_uri", "source_image", "control_image",
    "mask", "person", "garment", "alpha_uri", "background_url", "source_uri",
    "video", "video_url", "input_video", "videoUri", "start_video", "audio_url",
    "sound_file",
}
PROMPT_NAMES = ("prompt", "text_prompt", "prompt_text", "instruction", "object_name", "season")
CONTROL_NAMES = {
    "negative_prompt", "negativePrompt", "resolution", "target_resolution",
    "size", "max_resolution", "ratio", "aspect_ratio", "aspectRatio", "duration",
    "durationSeconds", "quality", "mode", "generation_type", "task", "seed",
    "watermark", "aigc_watermark", "generate_audio", "generateAudio", "audio",
    "sound", "shot_type", "prompt_extend", "style", "rendering_speed",
    "output_format", "scale_factor", "upscale_factor", "desired_increase",
    "light_type", "light_direction", "prompt_expansion_mode", "control_type",
    "fps", "n", "width", "height", "alpha_mode", "flavor", "skin_detail",
    "sharpen", "smart_grain", "ultra_detail", "preserve_audio",
    "output_container_and_codec", "green_shade", "background_color",
}


def media_kind(provider, model_id):
    if provider in NON_MEDIA_PROVIDERS or model_id in NON_MEDIA_IDS:
        return None
    if provider == "BytePlus" and ("seed-audio" in model_id or "/seed-2-" in model_id):
        return None
    if provider == "BytePlus":
        return "VIDEO" if "seedance" in model_id else "IMAGE"
    if provider == "OpenAI" and "gpt-image" not in model_id:
        return None
    name = model_id.split("/", 1)[1].lower()
    if provider == "Google" and "image" not in name and "imagen" not in name:
        return None
    if provider in {"Black Forest Labs", "Bria", "Moonvalley", "WaveSpeed"}:
        return "VIDEO" if "video" in name and not name.startswith("text-to-image") else "IMAGE"
    if provider == "fal":
        return "IMAGE" if name == "patina" else "VIDEO"
    if provider == "Kling":
        return "IMAGE" if "image-o1" in name else "VIDEO"
    if provider in {"Higgsfield", "LTX", "MiniMax", "Pruna", "Synclabs", "Veo"}:
        return "VIDEO"
    if provider == "Luma":
        return "VIDEO" if name.startswith("ray") else "IMAGE"
    if provider == "Runway":
        return "IMAGE" if "image" in name else "VIDEO"
    if provider == "Wan":
        return "IMAGE" if "-t2i-" in name or "-i2i-" in name else "VIDEO"
    if provider == "xAI":
        return "VIDEO" if "video" in name else "IMAGE"
    if provider == "Beeble":
        return "IMAGE"
    return "IMAGE"


def resolve(value, components):
    seen = set()
    while isinstance(value, dict) and "$ref" in value:
        ref = value["$ref"]
        if ref in seen or not ref.startswith("#/components/schemas/"):
            break
        seen.add(ref)
        value = components.get(ref.rsplit("/", 1)[1], value)
    if isinstance(value, dict) and "type" not in value:
        variants = value.get("anyOf") or value.get("oneOf") or []
        chosen = next((part for part in variants if isinstance(part, dict) and part.get("type")), None)
        if chosen:
            value = {**value, **chosen}
    return value


def usable_default(field):
    value = field.get("default")
    if value is None and isinstance(field.get("enum"), list) and field["enum"]:
        value = field["enum"][0]
    if value is None:
        return None
    return value if isinstance(value, (str, int, float, bool)) else None


def fields_for(schema, components):
    fields = []
    prompt_path = None
    prompt_required = False
    media_fields = []

    def walk(properties, path=(), required=()):
        nonlocal prompt_path, prompt_required
        for name, original in properties.items():
            if name in HIDDEN_FIELDS:
                continue
            field = resolve(original, components)
            full = (*path, name)
            # Nested input/parameters hold the useful native fields of many APIs.
            if name in ("input", "parameters") and field.get("type") == "object":
                walk(field.get("properties", {}), full, field.get("required", ()))
                continue
            if name in PROMPT_NAMES and prompt_path is None:
                prompt_path = list(full)
                prompt_required = name in required
                continue
            if name in MEDIA_HINTS or name.startswith("input_image_"):
                kind = "video" if "video" in name or name == "videoUri" else "audio" if "audio" in name or name == "sound_file" else "image"
                if name == "source_uri" and "switchx" not in str(schema):
                    kind = "video"
                media_fields.append({"name": "_".join(full), "path": list(full), "kind": kind,
                                     "required": name in required, "array": field.get("type") == "array"})
                continue
            if name in CONTROL_NAMES:
                kind = field.get("type")
                if kind not in ("string", "integer", "number", "boolean"):
                    continue
                row = {"name": "_".join(full), "path": list(full), "kind": kind,
                       "required": name in required}
                if field.get("enum"):
                    row["options"] = field["enum"]
                if usable_default(field) is not None:
                    row["default"] = usable_default(field)
                if isinstance(field.get("minimum"), (int, float)):
                    row["min"] = field["minimum"]
                if isinstance(field.get("maximum"), (int, float)):
                    row["max"] = field["maximum"]
                fields.append(row)

    walk(schema.get("properties", {}), required=schema.get("required", ()))
    return prompt_path, prompt_required, fields, media_fields


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--entries", type=Path)
    parser.add_argument("--schemas", type=Path)
    parser.add_argument("--providers", type=Path)
    args = parser.parse_args()
    if bool(args.entries) != bool(args.schemas):
        parser.error("--entries and --schemas must be supplied together")
    if args.entries:
        entries = json.loads(args.entries.read_text())
        all_schemas = json.loads(args.schemas.read_text())
        providers_markdown = args.providers.read_text() if args.providers else ""
    else:
        key = os.environ.get("COMFY_API_KEY", "").strip()
        if not key and (ROOT / "API KEY.INI").is_file():
            local = configparser.ConfigParser()
            local.read(ROOT / "API KEY.INI", encoding="utf-8")
            key = local.get("comfy_router", "api_key", fallback="").strip()
        if not key:
            parser.error("Set COMFY_API_KEY or fill API KEY.INI for a live refresh; the key is never written.")
        markdown = urllib.request.urlopen(
            "https://docs.comfy.org/development/comfy-router/models.md", timeout=30
        ).read().decode("utf-8")
        providers_markdown = urllib.request.urlopen(
            "https://docs.comfy.org/development/comfy-router/providers.md", timeout=30
        ).read().decode("utf-8")
        provider = ""
        entries = []
        for line in markdown.splitlines():
            if line.startswith("## "):
                provider = line[3:]
            match = re.match(r"\* \[([^]]+)\]\(([^)]+)\): \x60([^\x60]+)\x60", line)
            if match:
                entries.append((provider, *match.groups()))
        wanted = [model_id for provider, _, model_id, _ in entries if media_kind(provider, model_id)]
        def fetch_schema(model_id):
            request = urllib.request.Request(
                f"https://api.comfy.org/v2/models/{model_id}/openapi.json",
                headers={"X-API-Key": key})
            with urllib.request.urlopen(request, timeout=30) as response:
                return model_id, json.load(response)
        with ThreadPoolExecutor(max_workers=8) as pool:
            all_schemas = dict(pool.map(fetch_schema, wanted))
    coverage = {}
    for line in providers_markdown.splitlines():
        if not line.startswith("| ["):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        link = re.search(r"\]\(([^)]+)\)", cells[0])
        if link and len(cells) >= 6:
            coverage[link.group(1)] = [name for name, cell in zip(
                ("fal", "higgsfield", "runware", "wavespeed"), cells[2:6]
            ) if "✓" in cell]
    catalog = json.loads(DATA_FILE.read_text())
    existing = {row["model_id"]: row for row in catalog["models"]}
    snapshot = {}
    rows = []
    for provider, name, model_id, page in entries:
        kind = media_kind(provider, model_id)
        if not kind or model_id not in all_schemas:
            continue
        doc = all_schemas[model_id]
        path = doc["paths"][f"/v2/models/{model_id}"]["post"]
        schema = path["requestBody"]["content"]["application/json"]["schema"]
        components = doc.get("components", {}).get("schemas", {})
        schema = resolve(schema, components)
        prompt_path, prompt_required, controls, media = fields_for(schema, components)
        response = path["responses"]["200"]["content"]["application/json"]
        snapshot[model_id] = {"schema": schema, "components": components,
                              "response_example": response.get("example") or response.get("schema", {}).get("example")}
        if model_id in existing and "pricing" in existing[model_id] and existing[model_id].get("catalog_source") != "official_router":
            rows.append(existing[model_id])
            continue
        service = {"Black Forest Labs": "BFL", "Luma 2": "Luma", "Google": "Google", "xAI": "xAI"}.get(provider, provider)
        row = {
            "service": service, "family": name, "version": "", "display_name": f"{service} {name}",
            "model_id": model_id, "adapter": "native_schema", "output": kind,
            "images": 0, "videos": 0, "audios": 0,
            "providers": [{"name": "Comfy"}], "prompt_path": prompt_path,
            "catalog_source": "official_router",
            "pricing": {"alternates": {}},
            "prompt_required": prompt_required,
            "controls": controls, "media_fields": media,
        }
        if model_id in existing and existing[model_id].get("pricing"):
            row["pricing"] = existing[model_id]["pricing"]
        row["providers"].extend({"name": name} for name in coverage.get(page, ()))
        if provider == "Wan":
            operation = model_id.rsplit("-", 1)[-1]
            if kind == "IMAGE":
                row.update(adapter="wan_image", images=2 if "i2i" in model_id else 0,
                           requires_image="i2i" in model_id, prompt_required=True,
                           controls=[], media_fields=[])
            else:
                is_happy = "happyhorse" in model_id
                is_three = "wan3.0" in model_id
                is_27 = "wan2.7" in model_id
                is_i2v = "i2v" in model_id
                is_r2v = "r2v" in model_id
                is_edit = "edit" in model_id
                is_t2v = "t2v" in model_id
                row.update(
                    adapter="wan_video",
                    images=(10 if is_three else 9 if is_r2v and is_happy else 5 if is_27 and is_r2v else
                            4 if is_27 and is_edit else 2 if is_27 and is_i2v else 1 if is_i2v or is_edit else 0),
                    videos=(5 if is_three else 1 if is_edit else 3 if is_r2v and not is_happy else 0),
                    audios=5 if is_three else 1 if (is_27 and is_i2v) or
                           (not is_27 and not is_happy and not is_edit and not is_r2v) else 0,
                    requires_image=is_i2v or (is_r2v and is_happy),
                    requires_video=is_edit or (is_r2v and not is_happy and not is_27),
                    resolutions=["720P", "1080P"] if is_happy or is_27 or "2.6" in model_id else
                                ["720P", "480P", "1080P"],
                    ratios=["16:9", "9:16", "1:1", "4:3", "3:4"] if is_t2v or is_r2v or is_three else [],
                    durations=["auto", *range(2, 11)] if is_27 and is_edit else
                              [5, *(x for x in range(2, 31) if x != 5)] if is_three else
                              [5, *(x for x in range(3, 16) if x != 5)] if is_happy else
                              [5, *(x for x in range(2, 11) if x != 5)] if is_27 and is_r2v else
                              [5, *(x for x in range(2, 16) if x != 5)] if is_27 else
                              [5, 10] if "2.5" in model_id or is_r2v else [5, 10, 15],
                    modes=["auto", "image", "reference", "edit"] if is_three else [],
                    prompt_required=not is_edit or is_27,
                    controls=[], media_fields=[],
                )
        if model_id.startswith("byteplus/seedance-"):
            row.update(adapter="seedance", images=9, videos=3, audios=3,
                       resolutions=["720p", "480p", "1080p"],
                       ratios=["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"],
                       durations=list(range(4, 16)), modes=["auto", "image", "reference"],
                       output_formats=["mp4"], controls=[], media_fields=[], prompt_required=True)
        if model_id == "vertexai/gemini-2.5-flash-image":
            row.update(adapter="gemini_image", images=14, resolutions=["1K", "2K"],
                       ratios=["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
                       prompt_required=True, controls=[], media_fields=[])
        if provider == "Google" and "imagen" in model_id:
            row.update(adapter="imagen_image", prompt_required=True, images=0,
                       ratios=["1:1", "16:9", "9:16", "4:3", "3:4"], controls=[], media_fields=[])
        if provider == "Veo":
            row.update(adapter="veo_video", prompt_required=True, images=2,
                       resolutions=["720p", "1080p", "4k"] if "3.1" in model_id else ["720p", "1080p"],
                       ratios=["16:9", "9:16"], durations=[4, 6, 8],
                       controls=[], media_fields=[])
        if provider == "Qwen":
            row.update(adapter="qwen_image", prompt_required=True, images=3,
                       controls=[], media_fields=[])
        if provider == "MiniMax":
            row.update(adapter="minimax_video", prompt_required=True, images=2,
                       resolutions=["768P", "1080P"], ratios=["16:9", "9:16", "1:1"],
                       durations=[5, 6, 10], controls=[], media_fields=[])
        if provider == "Synclabs":
            row.update(adapter="synclabs_video", prompt_required=False, videos=1, audios=1,
                       requires_video=True, controls=[], media_fields=[])
        if model_id == "ideogram/ideogram-v3":
            row.update(prompt_path=["prompt"], prompt_required=True,
                       controls=[{"name": "rendering_speed", "path": ["rendering_speed"],
                                  "kind": "string", "default": "TURBO",
                                  "options": ["TURBO", "DEFAULT", "QUALITY"], "required": False}])
        if model_id in ("moonvalley/image-to-video", "moonvalley/video-to-video-resize"):
            row.update(prompt_path=["prompt_text"], prompt_required=False,
                       media_fields=[{"name": "image_url", "path": ["image_url"], "kind": "image",
                                      "required": model_id.endswith("image-to-video"), "array": False}]
                       if model_id.endswith("image-to-video") else
                       [{"name": "video_url", "path": ["video_url"], "kind": "video",
                         "required": True, "array": False}],
                       controls=[{"name": "control_type", "path": ["control_type"], "kind": "string",
                                  "default": "motion_control", "required": True}]
                       if model_id.endswith("video-to-video-resize") else [])
        if model_id in ("luma/ray-2", "luma/ray-flash-2"):
            for control in row["controls"]:
                if control["name"] == "duration":
                    control.update(default="5s", options=["5s", "9s"])
                if control["name"] == "resolution":
                    control.update(default="540p", options=["540p", "720p", "1080p"])
        if model_id == "kling/videos-video-extend":
            row["controls"].append({"name": "video_id", "path": ["video_id"], "kind": "string", "required": True})
        if model_id == "kling/videos-lip-sync":
            for control in row["controls"]:
                if control["name"] == "input_mode":
                    control["default"] = "audio2video"
        if model_id == "bfl/flux-3-video":
            for control in row["controls"]:
                if control["name"] == "duration":
                    control.update(kind="string", default="auto",
                                   options=["auto", *[str(i) for i in range(5, 21)]])
                if control["name"] == "mode":
                    control.update(default="t2v", options=["t2v", "i2v", "v2v", "draft_enhance"])
        rows.append(row)
    for row in rows:
        if row["model_id"] in ("beeble/switchx", "luma_2/uni-1", "luma_2/uni-1-max"):
            row["dual_output"] = True
            if row["model_id"] == "beeble/switchx":
                for field in row["media_fields"]:
                    if field["name"] == "source_uri":
                        field.update(name="source_image", required=False)
                row["media_fields"].append(
                    {"name": "source_video", "path": ["source_uri"], "kind": "video",
                     "required": False, "array": False})
            else:
                row["media_fields"] = [field for field in row["media_fields"] if field["name"] != "video"]
                row["controls"].append(
                    {"name": "type", "path": ["type"], "kind": "string",
                     "options": ["image", "video"], "default": "image", "required": False})
                row["controls"].extend([
                    {"name": "video_duration", "path": ["video", "duration"], "kind": "string",
                     "options": ["5s", "10s"], "default": "5s", "required": False},
                    {"name": "video_resolution", "path": ["video", "resolution"], "kind": "string",
                     "options": ["360p", "540p", "720p", "1080p"], "default": "720p", "required": False},
                ])
        if row["model_id"].startswith("xai/grok-imagine-video"):
            for field in row["media_fields"]:
                if field["name"] == "image":
                    field["wrap"] = "xai_image"
        if row["model_id"] in ("bfl/flux-pro-1.0-canny", "bfl/flux-pro-1.0-depth", "bfl/flux-pro-1.0-fill"):
            for field in row["media_fields"]:
                if field["name"] in ("control_image", "mask"):
                    field["encoding"] = "base64"
    catalog["models"] = rows + [row for row in catalog["models"] if row["model_id"] not in snapshot]
    DATA_FILE.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    SCHEMA_FILE.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Registered {len(rows)} media models; {len(snapshot)} current request schemas.")


if __name__ == "__main__":
    main()
