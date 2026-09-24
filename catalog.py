"""Curated Comfy Router model metadata used to build native ComfyUI controls.

Canonical IDs and request shapes are checked against the per-model OpenAPI
documents at https://docs.comfy.org/router-schemas/<provider>/<model>.json.
Limits that do not appear as maxItems in those schemas follow the matching
ComfyUI Partner node definitions; see README.md for source links.
"""

from dataclasses import dataclass


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
    requires_image: bool = False
    requires_video: bool = False
    supports_audio_only: bool = False


MODELS = (
    ModelSpec("Runway", "Gen-4", "Turbo Video", "runway/gen4_turbo", "runway_video", "VIDEO", 1, resolutions=("1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672", "1280:768", "768:1280"), durations=(5, 10), requires_image=True),
    ModelSpec("Runway", "Gen-4", "Image", "runway/gen4_image", "runway_image", "IMAGE", 3, resolutions=("1920:1080", "1080:1920", "1024:1024", "1360:768", "1080:1080", "1168:880", "1440:1080", "1080:1440", "1808:768", "2112:912")),
    ModelSpec("Runway", "Aleph", "2", "runway/aleph2", "runway_aleph", "VIDEO", 5, 1, requires_video=True),
    ModelSpec("Dreamina", "Seedance", "2.5", "byteplus/dreamina-seedance-2-5-260628", "seedance", "VIDEO", 30, 10, 10, ("480p", "720p", "1080p"), ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"), tuple(range(4, 31)), supports_audio_only=True),
    ModelSpec("Dreamina", "Seedance", "2.0", "byteplus/dreamina-seedance-2-0-260128", "seedance", "VIDEO", 9, 3, 3, ("480p", "720p", "1080p", "4k"), ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"), tuple(range(4, 16))),
    ModelSpec("Dreamina", "Seedance", "2.0 Fast", "byteplus/dreamina-seedance-2-0-fast-260128", "seedance", "VIDEO", 9, 3, 3, ("480p", "720p"), ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"), tuple(range(4, 16))),
    ModelSpec("Dreamina", "Seedance", "2.0 Mini", "byteplus/dreamina-seedance-2-0-mini", "seedance", "VIDEO", 9, 3, 3, ("480p", "720p"), ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"), tuple(range(4, 16))),
    ModelSpec("Dreamina", "Seedream", "5.0 Pro", "byteplus/seedream-5-0-pro-260628", "seedream", "IMAGE", 10, resolutions=("1K", "2K")),
    ModelSpec("Dreamina", "Seedream", "5.0 Lite", "byteplus/seedream-5-0-260128", "seedream", "IMAGE", 14, resolutions=("2K", "3K")),
    ModelSpec("OpenAI", "GPT Image", "2", "openai/gpt-image-2", "gpt_image", "IMAGE", 16, resolutions=("auto", "1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840")),
    ModelSpec("OpenAI", "GPT Image", "2.5 Flare", "openai/gpt-image-2.5-flare", "gpt_image", "IMAGE", 16, resolutions=("auto", "1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840")),
    ModelSpec("OpenAI", "GPT Image", "2.5 Sunburst", "openai/gpt-image-2.5-sunburst", "gpt_image", "IMAGE", 16, resolutions=("auto", "1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840")),
    ModelSpec("Google", "Nano Banana", "2", "vertexai/gemini-3.1-flash-image", "gemini_image", "IMAGE", 14, resolutions=("1K", "2K", "4K"), ratios=("auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")),
    ModelSpec("Google", "Nano Banana", "2 Lite", "vertexai/gemini-3.1-flash-lite-image", "gemini_image", "IMAGE", 14, resolutions=("1K",), ratios=("auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9")),
    ModelSpec("Google", "Nano Banana", "Pro", "vertexai/gemini-3-pro-image", "gemini_image", "IMAGE", 16, resolutions=("1K", "2K", "4K"), ratios=("auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9")),
    ModelSpec("BytePlus Audio", "Seed Audio", "1.0", "byteplus/seed-audio-1.0", "seed_audio", "AUDIO", 1, 0, 3),
    ModelSpec("BytePlus Audio", "Seed Audio", "1.0 Multilingual", "byteplus/seed-audio-1.0-multilingual", "seed_audio", "AUDIO", 1, 0, 3),
)

BY_ID = {spec.model_id: spec for spec in MODELS}
BY_SELECTION = {(spec.service, spec.family, spec.version): spec for spec in MODELS}


def model_label(spec: ModelSpec) -> str:
    brand = "BytePlus" if spec.family == "Seedance" else spec.service
    return f"{brand} {spec.family} {spec.version}"


BY_LABEL = {model_label(spec): spec for spec in MODELS}
BY_LEGACY_LABEL = {f"{spec.service} / {spec.family} {spec.version}": spec for spec in MODELS}

# The per-model OpenAPI documents advertise these under
# x-comfy-router-alt-providers. An empty entry means Comfy is the only route.
ALT_PROVIDERS = {
    "byteplus/dreamina-seedance-2-5-260628": ("fal", "higgsfield", "runware", "wavespeed"),
    "byteplus/dreamina-seedance-2-0-260128": ("fal", "higgsfield", "runware", "wavespeed"),
    "openai/gpt-image-2": ("fal", "runware", "wavespeed"),
    "openai/gpt-image-2.5-flare": ("fal", "runware", "wavespeed"),
    "openai/gpt-image-2.5-sunburst": ("fal", "runware", "wavespeed"),
    "vertexai/gemini-3.1-flash-image": ("fal", "runware", "wavespeed"),
    "vertexai/gemini-3-pro-image": ("fal", "runware", "wavespeed"),
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
