import json
import pathlib
import unittest
from unittest.mock import patch

from soylab_comfy_router.catalog import BY_ID, MODELS, find_model
from soylab_comfy_router.payload import build_payload
from soylab_comfy_router.result import media_reference
from soylab_comfy_router.router import run_model


class CatalogTests(unittest.TestCase):
    def test_ids_and_selections_are_unique(self):
        self.assertEqual(len(MODELS), len({item.model_id for item in MODELS}))
        self.assertEqual(len(MODELS), len({(item.service, item.family, item.version) for item in MODELS}))

    def test_reference_limit_is_enforced(self):
        spec = BY_ID["byteplus/dreamina-seedance-2-5-260628"]
        with self.assertRaisesRegex(ValueError, "최대 30"):
            build_payload(spec, {"prompt": "test"}, ["data:image/png;base64,AQ=="] * 31, [], [])


class PayloadTests(unittest.TestCase):
    def test_gpt_image_edit_includes_connected_image(self):
        spec = find_model("OpenAI", "GPT Image", "2")
        payload, provider = build_payload(spec, {"prompt": "Edit it", "resolution": "1024x1024", "quality": "low"}, ["data:image/png;base64,AQ=="], [], [])
        self.assertEqual(payload["image"], ["data:image/png;base64,AQ=="])
        self.assertEqual(payload["size"], "1024x1024")
        self.assertEqual(provider, "Comfy")
        self.assertNotIn("model", payload)

    def test_seedance_multimodal_body(self):
        spec = find_model("Dreamina", "Seedance", "2.5")
        payload, _ = build_payload(spec, {"prompt": "A city", "resolution": "720p", "ratio": "16:9", "duration": 5}, ["data:image/png;base64,AQ=="], ["https://example.org/v.mp4"], ["data:audio/wav;base64,AQ=="])
        self.assertEqual([item["type"] for item in payload["content"]], ["text", "image_url", "video_url", "audio_url"])
        self.assertTrue(payload["generate_audio"])

    def test_unsupported_provider_rejected(self):
        spec = find_model("Runway", "Gen-4", "Turbo Video")
        with self.assertRaisesRegex(ValueError, "Not Support"):
            build_payload(spec, {"prompt": "move", "execution_provider": "fal"}, ["data:image/png;base64,AQ=="], [], [])

    def test_advanced_json_cannot_change_path_model(self):
        spec = find_model("OpenAI", "GPT Image", "2")
        with self.assertRaisesRegex(ValueError, "model"):
            build_payload(spec, {"prompt": "test"}, [], [], [], '{"model":"other"}')


class ResultTests(unittest.TestCase):
    def test_provider_specific_outputs(self):
        self.assertEqual(media_reference({"output": ["https://example.org/v.mp4"]}, "VIDEO")[0], "https://example.org/v.mp4")
        self.assertEqual(media_reference({"content": {"video_url": "https://example.org/v.mp4"}}, "VIDEO")[0], "https://example.org/v.mp4")
        self.assertEqual(media_reference({"data": [{"b64_json": "AQ=="}]}, "IMAGE")[0], b"\x01")


class RouterClientTests(unittest.TestCase):
    def test_canonical_route_and_actual_cost_header(self):
        class Response:
            headers = {"X-Comfy-Credits-Used": "12.5"}
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return b'{"data":[]}'

        with patch("soylab_comfy_router.router.urllib.request.urlopen", return_value=Response()) as call:
            result, credits = run_model("openai/gpt-image-2", {"prompt": "test"}, "private-key", "fal")
        request = call.call_args.args[0]
        self.assertEqual(credits, 12.5)
        self.assertEqual(result, {"data": []})
        self.assertIn("/v2/models/openai/gpt-image-2", request.full_url)
        self.assertIn("model_provider=fal", request.full_url)
        self.assertEqual(request.get_header("X-api-key"), "private-key")
        self.assertNotIn("private-key", request.data.decode())


class WorkflowTests(unittest.TestCase):
    def test_bilingual_markdown_notes_and_image_edit_chain(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        workflow = json.loads((root / "workflows/image_edit_gpt_image_2.json").read_text(encoding="utf-8"))
        nodes = {node["id"]: node for node in workflow["nodes"]}
        self.assertEqual([nodes[n]["type"] for n in (1, 2, 3)], ["LoadImage", "SoylabComfyRouter", "SaveImage"])
        self.assertEqual(len([node for node in nodes.values() if node["type"] == "MarkdownNote"]), 2)
        self.assertEqual(nodes[2]["widgets_values_named"]["api_key"], "")
        self.assertEqual(nodes[2]["widgets_values_named"]["service.model.version"], "2")
        self.assertEqual(len(workflow["links"]), 2)
        self.assertIn("platform.comfy.org/profile/api-keys", nodes[4]["widgets_values"][0])
        self.assertIn("platform.comfy.org/profile/api-keys", nodes[5]["widgets_values"][0])


if __name__ == "__main__":
    unittest.main()
