import asyncio
import json
import pathlib
import tempfile
from types import SimpleNamespace
import unittest
import urllib.error
from unittest.mock import Mock, patch

from soylab_comfy_router import SoylabComfyRouter, _prepare_provider_images, _register_routes, _report_progress, _selection
from soylab_comfy_router.catalog import ALT_PROVIDERS, BY_ID, BY_LABEL, MODELS, SEED_AUDIO_VOICES, find_model
from soylab_comfy_router.key_editor import open_key_file
from soylab_comfy_router.payload import build_payload
from soylab_comfy_router.result import media_reference
from soylab_comfy_router.router import run_model


class CatalogTests(unittest.TestCase):
    def test_comfy_locale_files_cover_the_node_and_visible_price_copy(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        required_inputs = {"api_key", "model", "model_execution_provider", "model_mode", "model_prompt", "model_resolution", "model_ratio", "model_duration", "model_first_frame", "model_last_frame", "advanced_json"}
        for language in ("ko", "en", "ja", "zh"):
            with self.subTest(language=language):
                node = json.loads((root / "locales" / language / "nodeDefs.json").read_text(encoding="utf-8"))["SoylabComfyRouter"]
                self.assertTrue(node["description"])
                self.assertTrue(required_inputs.issubset(node["inputs"]))
                self.assertTrue(all(node["inputs"][name]["tooltip"] for name in required_inputs))
                self.assertEqual(set(node["outputs"]), {"0", "1", "2", "3", "4"})

        catalog = json.loads((root / "web/router-data.json").read_text(encoding="utf-8"))
        for model in catalog["models"]:
            for route in model.get("providers", []):
                for note in route.get("resolution_notes", {}).values():
                    self.assertEqual(set(note.get("text_i18n", {})), {"en", "ja", "zh"})
            for entry in model.get("pricing", {}).get("alternates", {}).values():
                if "range_scope" in entry:
                    self.assertEqual(set(entry.get("range_scope_i18n", {})), {"en", "ja", "zh"})
                if "public_reference" in entry:
                    self.assertEqual(set(entry["public_reference"].get("label_i18n", {})), {"en", "ja", "zh"})

    def test_ids_and_selections_are_unique(self):
        self.assertEqual(len(MODELS), len({item.model_id for item in MODELS}))
        self.assertEqual(len(MODELS), len({(item.service, item.family, item.version) for item in MODELS}))
        self.assertEqual(len(MODELS), len(BY_LABEL))

    def test_combined_model_has_provider_below_it(self):
        schema = SoylabComfyRouter.define_schema()
        model = schema.inputs[1]
        self.assertEqual(model.id, "model")
        self.assertEqual(model.options[0].key, "BytePlus Seedance 2.5")
        provider = model.options[0].inputs[0]
        self.assertEqual(provider.display_name, "공급자 선택")
        self.assertEqual(provider.options, ["Comfy", "fal", "higgsfield", "runware", "wavespeed"])
        self.assertEqual(provider.default, "higgsfield")
        self.assertEqual(model.options[0].inputs[1].display_name, "작업 모드")
        self.assertEqual(model.options[0].inputs[1].options, ["auto", "text", "image", "reference", "edit", "extend"])
        spec, values = _selection({"model": model.options[0].key, "execution_provider": "higgsfield"})
        self.assertEqual(spec.model_id, "byteplus/dreamina-seedance-2-5-260628")
        self.assertEqual(values["execution_provider"], "higgsfield")
        runway = next(option for option in model.options if option.key == "Runway Gen-4 Turbo Video")
        self.assertEqual(runway.inputs[0].default, "Comfy")
        self.assertEqual(runway.inputs[0].options, ["Comfy"])
        legacy, _ = _selection({"model": "Dreamina / Seedance 2.5", "execution_provider": "higgsfield"})
        self.assertEqual(legacy.model_id, spec.model_id)

    def test_reference_limit_is_enforced(self):
        spec = BY_ID["byteplus/dreamina-seedance-2-5-260628"]
        with self.assertRaisesRegex(ValueError, "최대 30"):
            build_payload(spec, {"prompt": "test"}, ["data:image/png;base64,AQ=="] * 31, [], [])

    def test_committed_price_references_have_sources_and_supported_routes(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        data = json.loads((root / "web/router-data.json").read_text(encoding="utf-8"))
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(len(data["models"]), len(MODELS))
        for model in data["models"]:
            model_id = model["model_id"]
            self.assertIn(model_id, BY_ID)
            self.assertEqual(model["display_name"], next(label for label, spec in BY_LABEL.items() if spec.model_id == model_id))
            self.assertEqual(model["providers"][0]["name"], "Comfy")
            for route in model["providers"]:
                self.assertTrue(set(route.get("resolutions", ())).issubset(BY_ID[model_id].resolutions))
            for name, entry in model["pricing"]["alternates"].items():
                self.assertIn(name, ALT_PROVIDERS.get(model_id, ()))
                if "public_reference" in entry:
                    reference = entry["public_reference"]
                    self.assertTrue(reference["label"])
                    self.assertTrue(reference["source"].startswith("https://"))
                    self.assertLessEqual(reference["checked_at"], data["updated_at"])
                    continue
                self.assertTrue(entry["source"].startswith("https://"))
                self.assertLessEqual(entry["checked_at"], data["updated_at"])
                references = entry["reference_inputs"]
                if references is not False:
                    self.assertLessEqual(references["images"], BY_ID[model_id].images)
                    self.assertLessEqual(references["videos"], BY_ID[model_id].videos)
                    self.assertLessEqual(references["audios"], BY_ID[model_id].audios)
                    self.assertIsInstance(references["last_frame"], bool)
                self.assertTrue(set(entry.get("priced_resolutions", ())).issubset(BY_ID[model_id].resolutions))
                if "range_scope" in entry:
                    self.assertIn("range", entry)
                rates = entry.get("rates") or entry.get("range")
                self.assertTrue(rates)
                self.assertTrue(all(float(rate) > 0 for rate in (rates.values() if isinstance(rates, dict) else rates)))


class PayloadTests(unittest.TestCase):
    def test_partner_modes_for_seedream_and_seed_audio(self):
        pro = find_model("Dreamina", "Seedream", "5.0 Pro")
        payload, _ = build_payload(pro, {"prompt": "edit", "mode": "fast"}, ["data:image/png;base64,AQ=="], [], [])
        self.assertEqual(payload["optimize_prompt_options"], {"mode": "fast"})
        with self.assertRaisesRegex(ValueError, "참조 이미지"):
            build_payload(pro, {"prompt": "make", "mode": "fast"}, [], [], [])
        audio = find_model("BytePlus Audio", "Seed Audio", "1.0")
        voice = next(iter(SEED_AUDIO_VOICES))
        payload, _ = build_payload(audio, {"prompt": "Hello", "mode": "preset_voice", "preset_voice": voice}, [], [], [])
        self.assertEqual(payload["references"], [{"speaker": SEED_AUDIO_VOICES[voice]}])
        payload, _ = build_payload(audio, {"prompt": "Hello", "mode": "audio"}, [], [], ["data:audio/wav;base64,AQ=="])
        self.assertEqual(payload["references"], [{"audio_data": "AQ=="}])
        with self.assertRaisesRegex(ValueError, "오디오만"):
            build_payload(audio, {"prompt": "Hello", "mode": "audio"}, ["data:image/png;base64,AQ=="], [], [])

    def test_higgsfield_seedance_images_use_uploaded_urls(self):
        spec = find_model("Dreamina", "Seedance", "2.5")
        uri = "data:image/png;base64,AQ=="
        payload, provider = build_payload(spec, {"prompt": "move", "execution_provider": "higgsfield", "resolution": "480p"}, [uri], [], [], first_frame=uri)
        with patch("soylab_comfy_router.upload_asset", return_value="https://example.org/signed.png") as upload:
            stages = []
            asyncio.run(_prepare_provider_images(spec, provider, payload, "private-key", lambda stage: stages.append(stage)))
        self.assertEqual(upload.call_count, 1)
        self.assertEqual(stages, ["uploading"])
        self.assertEqual([part["image_url"]["url"] for part in payload["content"] if part["type"] == "image_url"], ["https://example.org/signed.png"] * 2)
        comfy_payload, _ = build_payload(spec, {"prompt": "move", "resolution": "480p"}, [uri], [], [])
        asyncio.run(_prepare_provider_images(spec, "Comfy", comfy_payload, "private-key", lambda _: None))
        self.assertEqual(comfy_payload["content"][1]["image_url"]["url"], uri)

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

    def test_seedance_partner_modes(self):
        spec = find_model("Dreamina", "Seedance", "2.5")
        first = "data:image/png;base64,AQ=="
        payload, _ = build_payload(spec, {"prompt": "A city", "mode": "image"}, [], [], [], first_frame=first)
        self.assertEqual(payload["content"][1]["role"], "first_frame")
        with self.assertRaisesRegex(ValueError, "비디오"):
            build_payload(spec, {"prompt": "A city", "mode": "edit"}, [], [], [])
        edited, _ = build_payload(spec, {"prompt": "Change the sky", "mode": "edit"}, [], ["https://example.org/v.mp4"], [])
        self.assertEqual(edited["omni_reference_task_type"], "edit")
        self.assertEqual((edited["ratio"], edited["duration"]), ("adaptive", -1))
        with self.assertRaisesRegex(ValueError, "변환은 확인되지"):
            build_payload(spec, {"prompt": "Change the sky", "mode": "edit", "execution_provider": "runware"}, [], ["https://example.org/v.mp4"], [])
        with self.assertRaisesRegex(ValueError, "Not Support"):
            build_payload(find_model("Dreamina", "Seedance", "2.0"), {"prompt": "test", "mode": "edit"}, [], [], [])

    def test_unsupported_provider_rejected(self):
        spec = find_model("Runway", "Gen-4", "Turbo Video")
        with self.assertRaisesRegex(ValueError, "Not Support"):
            build_payload(spec, {"prompt": "move", "execution_provider": "fal"}, ["data:image/png;base64,AQ=="], [], [])

    def test_seedance_alternate_resolution_limit(self):
        spec = BY_ID["byteplus/dreamina-seedance-2-5-260628"]
        payload, provider = build_payload(spec, {"prompt": "move", "execution_provider": "higgsfield", "resolution": "1080p"}, [], [], [])
        self.assertEqual((payload["resolution"], provider), ("1080p", "higgsfield"))
        with self.assertRaisesRegex(ValueError, "fal.*1080p.*Not Support"):
            build_payload(spec, {"prompt": "move", "execution_provider": "fal", "resolution": "1080p"}, [], [], [])
        payload, provider = build_payload(spec, {"prompt": "move", "execution_provider": "higgsfield", "resolution": "720p"}, [], [], [])
        self.assertEqual((payload["resolution"], provider), ("720p", "higgsfield"))
        with self.assertRaisesRegex(ValueError, "fal.*1080p.*Not Support"):
            build_payload(spec, {"prompt": "move", "execution_provider": "fal", "resolution": "720p"}, [], [], [], '{"resolution":"1080p"}')

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
    def test_invalid_request_exposes_safe_router_error_type_and_request_id(self):
        error = urllib.error.HTTPError("https://api.comfy.org", 400, "invalid", {"X-Comfy-Error-Type": "invalid_input", "X-Comfy-Request-Id": "req-123"}, None)
        error.read = lambda _: b'{"detail":"The request was rejected as invalid for this model."}'
        with patch("soylab_comfy_router.router.urllib.request.urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, r"HTTP 400 \[invalid_input\].*request_id: req-123"):
                run_model("byteplus/dreamina-seedance-2-5-260628", {"content": []}, "private-key", "higgsfield")

    def test_queued_route_reports_progress_and_actual_cost(self):
        class Response:
            def __init__(self, body, headers=None):
                self.body = body
                self.headers = headers or {}
                self.status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return self.body

        responses = [Response(b'{"request_id":"run-1","status":"IN_QUEUE","queue_position":1}'),
                     Response(b'{"status":"IN_PROGRESS","queue_position":0}', {"Retry-After": "1"}),
                     Response(b'{"status":"COMPLETED"}'),
                     Response(b'{"data":[]}', {"X-Comfy-Credits-Used": "12.5"})]
        stages = []
        with patch("soylab_comfy_router.router.urllib.request.urlopen", side_effect=responses) as call, patch("soylab_comfy_router.router.time.sleep"):
            result, credits = run_model("openai/gpt-image-2", {"prompt": "test"}, "private-key", "fal", lambda stage, **_: stages.append(stage))
        request = call.call_args_list[0].args[0]
        self.assertEqual(credits, 12.5)
        self.assertEqual(result, {"data": []})
        self.assertIn("/v2/models/openai/gpt-image-2/requests", request.full_url)
        self.assertIn("model_provider=fal", request.full_url)
        self.assertEqual(request.get_header("X-api-key"), "private-key")
        self.assertNotIn("private-key", request.data.decode())
        self.assertEqual(stages, ["submitting", "queued", "generating", "collecting"])
        self.assertIn("/requests/run-1/status", call.call_args_list[1].args[0].full_url)

    def test_queue_unavailable_falls_back_to_sync(self):
        class Response:
            headers = {"X-Comfy-Credits-Used": "3"}
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return b'{"result":"ok"}'
        error = urllib.error.HTTPError("https://api.comfy.org", 403, "not_enabled", {"X-Comfy-Error-Type": "not_enabled"}, None)
        error.read = lambda _: b'{"error_type":"not_enabled"}'
        with patch("soylab_comfy_router.router.urllib.request.urlopen", side_effect=[error, Response()]) as call:
            result, credits = run_model("openai/gpt-image-2", {"prompt": "test"}, "private-key")
        self.assertEqual((result, credits), ({"result": "ok"}, 3))
        self.assertEqual(call.call_args_list[0].args[0].get_header("Idempotency-key"), call.call_args_list[1].args[0].get_header("Idempotency-key"))

    def test_queue_unavailable_stops_long_video_before_sync_deadline(self):
        error = urllib.error.HTTPError("https://api.comfy.org", 403, "not_enabled", {"X-Comfy-Error-Type": "not_enabled"}, None)
        error.read = lambda _: b'{"error_type":"not_enabled"}'
        with patch("soylab_comfy_router.router.urllib.request.urlopen", side_effect=[error]) as call:
            with self.assertRaisesRegex(RuntimeError, "동기식 연결 제한"):
                run_model("byteplus/dreamina-seedance-2-5-260628", {"content": []}, "private-key", "runware", allow_sync_fallback=False)
        self.assertEqual(call.call_count, 1)

    def test_queue_admission_retry_reuses_idempotency_key(self):
        class Response:
            headers = {}
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return self.body
        busy = urllib.error.HTTPError("https://api.comfy.org", 409, "busy", {"X-Comfy-Error-Type": "concurrency_limit_exceeded", "Retry-After": "3"}, None)
        busy.read = lambda _: b'{"error_type":"concurrency_limit_exceeded"}'
        responses = [busy, Response(b'{"request_id":"run-2","status":"IN_QUEUE"}'), Response(b'{"status":"COMPLETED"}'), Response(b'{"result":"ok"}')]
        with patch("soylab_comfy_router.router.urllib.request.urlopen", side_effect=responses) as call, patch("soylab_comfy_router.router.time.sleep") as pause:
            result, _ = run_model("openai/gpt-image-2", {"prompt": "test"}, "private-key")
        self.assertEqual(result, {"result": "ok"})
        self.assertEqual(call.call_args_list[0].args[0].get_header("Idempotency-key"), call.call_args_list[1].args[0].get_header("Idempotency-key"))
        pause.assert_called_with(3)


class WorkflowTests(unittest.TestCase):
    def test_bilingual_markdown_notes_and_image_edit_chain(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        workflow = json.loads((root / "workflows/image_edit_gpt_image_2.json").read_text(encoding="utf-8"))
        nodes = {node["id"]: node for node in workflow["nodes"]}
        self.assertEqual([nodes[n]["type"] for n in (1, 2, 3)], ["LoadImage", "SoylabComfyRouter", "SaveImage"])
        self.assertEqual(len([node for node in nodes.values() if node["type"] == "MarkdownNote"]), 2)
        self.assertEqual(nodes[2]["widgets_values_named"]["api_key"], "")
        self.assertEqual(nodes[2]["widgets_values_named"]["model"], "OpenAI GPT Image 2")
        self.assertEqual(len(workflow["links"]), 2)
        self.assertIn("platform.comfy.org/profile/api-keys", nodes[4]["widgets_values"][0])
        self.assertIn("platform.comfy.org/profile/api-keys", nodes[5]["widgets_values"][0])


class KeyEditorTests(unittest.TestCase):
    def test_progress_uses_native_partner_node_message_channel(self):
        server = SimpleNamespace(send_sync=Mock(), send_progress_text=Mock())
        _report_progress(server, "14", "submitting")
        server.send_progress_text.assert_called_with("SOYLAB Router (2/5) · Router 서버에 요청 전송 중 · 0초 경과", "14")
        _report_progress(server, "14", "queued", elapsed_seconds=9, request_id="request-1", queue_position=2)
        server.send_progress_text.assert_called_with("SOYLAB Router (3/5) · Router에 전달 완료 · 대기 중 · 앞에 2건 · 9초 경과", "14")
        server.send_sync.assert_called_with("soylab_router_status", {"node_id": "14", "stage": "queued", "request_id": "request-1", "queue_position": 2})

    def test_creates_private_blank_ini_without_overwriting_existing_key(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "API KEY.INI"
            with patch("soylab_comfy_router.key_editor.subprocess.Popen") as launch:
                open_key_file(path)
                self.assertEqual(path.read_text(encoding="utf-8"), "[comfy_router]\napi_key = \n")
                path.write_text("[comfy_router]\napi_key = existing\n", encoding="utf-8")
                open_key_file(path)
            self.assertEqual(path.read_text(encoding="utf-8"), "[comfy_router]\napi_key = existing\n")
            self.assertEqual(launch.call_count, 2)
            self.assertIn(str(path), launch.call_args.args[0])

    def test_editor_endpoint_requires_local_same_origin_request(self):
        import server

        handlers = {}
        class Routes:
            def register(self, path):
                def register(handler):
                    handlers[path] = handler
                    return handler
                return register
            get = register
            post = register
        fake_server = SimpleNamespace(routes=Routes())
        with patch.object(server.PromptServer, "instance", fake_server, create=True), patch("soylab_comfy_router._ROUTES_REGISTERED", False):
            _register_routes()
        handler = handlers["/soylab_router/open_api_key"]
        foreign = SimpleNamespace(remote="127.0.0.1", host="127.0.0.1:8000", headers={"Origin": "https://another.example"})
        remote = SimpleNamespace(remote="192.0.2.1", host="127.0.0.1:8000", headers={"Origin": "http://127.0.0.1:8000"})
        local = SimpleNamespace(remote="127.0.0.1", host="127.0.0.1:8000", headers={"Origin": "http://127.0.0.1:8000"})
        status = handlers["/soylab_router/api_key_file_status"]
        with tempfile.TemporaryDirectory() as temp, patch("soylab_comfy_router.ROOT", pathlib.Path(temp)), patch("soylab_comfy_router.open_key_file") as open_file:
            self.assertEqual(asyncio.run(handler(foreign)).status, 403)
            self.assertEqual(asyncio.run(handler(remote)).status, 403)
            self.assertEqual(asyncio.run(status(foreign)).status, 403)
            self.assertEqual(json.loads(asyncio.run(status(local)).text), {"exists": False})
            (pathlib.Path(temp) / "API KEY.INI").write_text("[comfy_router]\napi_key = private-key\n", encoding="utf-8")
            self.assertEqual(json.loads(asyncio.run(status(local)).text), {"exists": True})
            self.assertEqual(asyncio.run(handler(local)).status, 200)
        open_file.assert_called_once()


if __name__ == "__main__":
    unittest.main()
