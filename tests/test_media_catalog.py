"""Contract checks against the checked-in Router OpenAPI snapshot."""

import json
import unittest
from pathlib import Path

from jsonschema import Draft7Validator

from soylab_comfy_router import SoylabComfyRouter
from soylab_comfy_router.catalog import MODELS
from soylab_comfy_router.payload import build_payload
from soylab_comfy_router.result import media_reference


ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = json.loads((ROOT / "model-schemas.json").read_text(encoding="utf-8"))
IMAGE = "data:image/png;base64,AAAA"
VIDEO = "https://example.com/input.mp4"
AUDIO = "https://example.com/input.wav"


def sample_values(spec):
    values = {
        "prompt": "A red maple leaf",
        "execution_provider": "Comfy",
        "resolution": spec.resolutions[0] if spec.resolutions else None,
        "ratio": spec.ratios[0] if spec.ratios else None,
        "duration": spec.durations[0] if spec.durations else None,
    }
    if spec.modes:
        values["mode"] = spec.modes[0]
    for item in spec.controls:
        value = item.get("default")
        if value is None:
            value = item.get("options", [None])[0] if item.get("options") else (
                "test" if item["kind"] == "string" and item["required"] else
                "" if item["kind"] == "string" else 0
            )
        values[item["name"]] = value
    return values


def sample_media(spec):
    media = {}
    for item in spec.media_fields:
        if not item["required"]:
            media[item["name"]] = None
            continue
        url = {"image": "https://example.com/input.png",
               "video": VIDEO, "audio": AUDIO}[item["kind"]]
        media[item["name"]] = [url] if item["array"] else url
    if spec.model_id == "kling/videos-avatar-image2video":
        media["sound_file"] = AUDIO
    if spec.model_id == "kling/videos-lip-sync":
        media.update(input_video_url=VIDEO, input_audio_url=AUDIO)
    if spec.model_id == "beeble/switchx":
        media["source_image"] = "https://example.com/input.png"
    return media


class RouterMediaCatalogTests(unittest.TestCase):
    def test_every_published_media_model_has_a_schema_and_schema_valid_request(self):
        self.assertEqual(154, len(SCHEMAS))
        self.assertTrue(all(model_id in {spec.model_id for spec in MODELS} for model_id in SCHEMAS))
        for spec in MODELS:
            if spec.output == "AUDIO":
                continue
            with self.subTest(model=spec.model_id):
                images = [IMAGE] if spec.requires_image else []
                if spec.model_id == "wan/wan2.7-r2v":
                    images = [IMAGE]
                videos = [VIDEO] if spec.requires_video else []
                audios = [AUDIO] if spec.adapter == "synclabs_video" else []
                payload, _ = build_payload(spec, sample_values(spec), images, videos, audios,
                                           media_values=sample_media(spec))
                entry = SCHEMAS[spec.model_id]
                schema = {"components": {"schemas": entry["components"]}, **entry["schema"]}
                errors = list(Draft7Validator(schema).iter_errors(payload))
                self.assertEqual([], errors)

    def test_all_published_response_examples_yield_a_media_asset(self):
        for spec in MODELS:
            if spec.output == "AUDIO":
                continue
            with self.subTest(model=spec.model_id):
                example = SCHEMAS[spec.model_id]["response_example"]
                self.assertIsInstance(example, dict)
                reference, _ = media_reference(example, spec.output)
                self.assertIsNotNone(reference)

    def test_optional_media_inputs_follow_model_native_shape(self):
        for spec in MODELS:
            if spec.adapter != "native_schema":
                continue
            base_media = {name: value for name, value in sample_media(spec).items() if value}
            for field in spec.media_fields:
                if field["required"] or field["name"] in base_media or spec.model_id == "beeble/switchx":
                    continue
                with self.subTest(model=spec.model_id, field=field["name"]):
                    url = {"image": "https://example.com/input.png",
                           "video": VIDEO, "audio": AUDIO}[field["kind"]]
                    media = dict(base_media)
                    media[field["name"]] = [url] if field["array"] else url
                    body, _ = build_payload(spec, sample_values(spec), [], [], [], media_values=media)
                    entry = SCHEMAS[spec.model_id]
                    schema = {"components": {"schemas": entry["components"]}, **entry["schema"]}
                    self.assertEqual([], list(Draft7Validator(schema).iter_errors(body)))

    def test_dual_image_video_models_keep_one_model_choice(self):
        by_id = {spec.model_id: spec for spec in MODELS}
        self.assertEqual(len(MODELS), len(by_id))
        beeble = by_id["beeble/switchx"]
        values = sample_values(beeble)
        values["generation_type"] = "video"
        body, _ = build_payload(beeble, values, [], [], [],
                                media_values={"source_video": VIDEO})
        self.assertEqual("video", body["generation_type"])
        self.assertEqual(VIDEO, body["source_uri"])
        self.assertEqual(VIDEO, media_reference({"output": {"render": VIDEO}}, "VIDEO")[0])
        for model_id in ("luma_2/uni-1", "luma_2/uni-1-max"):
            spec = by_id[model_id]
            values = sample_values(spec)
            values["type"] = "video"
            body, _ = build_payload(spec, values, [], [], [], media_values={})
            self.assertEqual("video", body["type"])
            self.assertEqual({"duration": "5s", "resolution": "720p"}, body["video"])
            entry = SCHEMAS[model_id]
            schema = {"components": {"schemas": entry["components"]}, **entry["schema"]}
            self.assertEqual([], list(Draft7Validator(schema).iter_errors(body)))
            self.assertEqual(VIDEO, media_reference(
                {"output": [{"type": "video", "url": VIDEO}]}, "VIDEO")[0])

    def test_wan_media_roles_match_partner_node_contract(self):
        by_id = {spec.model_id: spec for spec in MODELS}
        def body(model_id, images=(), videos=(), audios=(), mode=None):
            spec = by_id[model_id]
            values = sample_values(spec)
            if mode:
                values["mode"] = mode
            return build_payload(spec, values, list(images), list(videos), list(audios))[0]

        wan26 = body("wan/wan2.6-i2v", images=[IMAGE])
        self.assertEqual(IMAGE, wan26["input"]["img_url"])
        self.assertNotIn("media", wan26["input"])
        self.assertNotIn("480P", by_id["wan/wan2.6-i2v"].resolutions)
        wan26_text = body("wan/wan2.6-t2v")
        self.assertEqual("1280*720", wan26_text["parameters"]["size"])
        self.assertNotIn("resolution", wan26_text["parameters"])
        horse = body("wan/happyhorse-1.1-i2v", images=[IMAGE])
        self.assertEqual([{"type": "first_frame", "url": IMAGE}], horse["input"]["media"])
        wan27 = body("wan/wan2.7-i2v", images=[IMAGE, IMAGE])
        self.assertEqual(["first_frame", "last_frame"],
                         [item["type"] for item in wan27["input"]["media"]])
        wan27_ref = body("wan/wan2.7-r2v", images=[IMAGE], videos=[VIDEO])
        self.assertEqual(["reference_image", "reference_video"],
                         [item["type"] for item in wan27_ref["input"]["media"]])
        self.assertNotIn("audio", wan27_ref["parameters"])
        self.assertNotIn("prompt_extend", wan27_ref["parameters"])
        wan27_edit = body("wan/wan2.7-videoedit", images=[IMAGE], videos=[VIDEO])
        self.assertEqual(0, wan27_edit["parameters"]["duration"])
        self.assertEqual("auto", wan27_edit["parameters"]["audio_setting"])
        self.assertEqual(4, by_id["wan/wan2.7-videoedit"].images)
        self.assertEqual(1, by_id["wan/wan2.6-i2v"].images)
        wan30 = body("wan/wan3.0-video", images=[IMAGE], mode="reference")
        self.assertEqual("reference_image", wan30["input"]["media"][0]["type"])

    def test_node_schema_builds_with_searchable_catalog(self):
        schema = SoylabComfyRouter.define_schema()
        self.assertEqual("SoylabComfyRouter", schema.node_id)
        labels = [spec.display_name for spec in MODELS]
        self.assertTrue(any("Wan" in label for label in labels))
        self.assertTrue(any("wan" in label.lower() for label in labels if "wa" in label.lower()))


if __name__ == "__main__":
    unittest.main()
