"""Comfy Router model metadata loaded from the single editable data file."""

import json
from dataclasses import dataclass, field, fields
from pathlib import Path


DATA_PATH = Path(__file__).resolve().parent / "web" / "router-data.json"
DATA = json.loads(DATA_PATH.read_text(encoding="utf-8"))
if DATA.get("schema_version") != 1:
    raise ValueError(f"Unsupported router-data.json schema: {DATA.get('schema_version')}")


@dataclass(frozen=True)
class ModelSpec:
    service: str
    family: str
    version: str
    model_id: str
    adapter: str
    output: str
    images: int = 0
    videos: int = 0
    audios: int = 0
    resolutions: tuple[str, ...] = ()
    ratios: tuple[str, ...] = ()
    durations: tuple[int, ...] = ()
    qualities: tuple[str, ...] = ()
    modes: tuple[str, ...] = ()
    output_formats: tuple[str, ...] = ()
    requires_image: bool = False
    requires_video: bool = False
    supports_audio_only: bool = False
    display_name: str = ""
    prompt_required: bool = True
    prompt_path: tuple[str, ...] = ()
    controls: tuple[dict, ...] = ()
    media_fields: tuple[dict, ...] = ()
    request_template: dict = field(default_factory=dict)
    dual_output: bool = False


def _model(row: dict) -> ModelSpec:
    allowed = {item.name for item in fields(ModelSpec)}
    values = {key: value for key, value in row.items() if key in allowed}
    for name in ("resolutions", "ratios", "durations", "qualities", "modes", "output_formats"):
        values[name] = tuple(values.get(name) or ())
    values["prompt_path"] = tuple(values.get("prompt_path") or ())
    values["controls"] = tuple(values.get("controls") or ())
    values["media_fields"] = tuple(values.get("media_fields") or ())
    return ModelSpec(**values)


MODELS = tuple(_model(row) for row in DATA["models"])
BY_ID = {spec.model_id: spec for spec in MODELS}
BY_SELECTION = {(spec.service, spec.family, spec.version): spec for spec in MODELS}
DEFAULT_MODEL_ID = DATA["default_model_id"]
DEFAULT_EXECUTION_PROVIDER = DATA["default_provider"]
SEED_AUDIO_VOICES = DATA.get("seed_audio_voices", {})


def model_label(spec: ModelSpec) -> str:
    return spec.display_name or f"{spec.service} {spec.family} {spec.version}"


BY_LABEL = {model_label(spec): spec for spec in MODELS}
BY_LEGACY_LABEL = {f"{spec.service} / {spec.family} {spec.version}": spec for spec in MODELS}
ALT_PROVIDERS = {
    row["model_id"]: tuple(route["name"] for route in row["providers"] if route["name"] != "Comfy")
    for row in DATA["models"]
}
ALT_PROVIDER_RESOLUTIONS = {
    (row["model_id"], route["name"]): tuple(route["resolutions"])
    for row in DATA["models"] for route in row["providers"] if route.get("resolutions")
}


def find_model(service: str, family: str, version: str) -> ModelSpec:
    try:
        return BY_SELECTION[(service, family, version)]
    except KeyError as exc:
        raise ValueError(f"Not Support: {service} / {family} / {version}") from exc


def services() -> tuple[str, ...]:
    return tuple(dict.fromkeys(spec.service for spec in MODELS))


def families(service: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(spec.family for spec in MODELS if spec.service == service))


def versions(service: str, family: str) -> tuple[str, ...]:
    return tuple(spec.version for spec in MODELS if spec.service == service and spec.family == family)
