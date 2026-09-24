# SOYLAB Comfy Router

A local ComfyUI custom node that calls [Comfy Router](https://comfy.org/platform/router) with your personal Comfy API key. The purple node uses the supplied Soylab mark and purple-to-green header. Service, model family and version use ComfyUI's native `DynamicCombo`; reference sockets use native `Autogrow` with model-specific caps.

This node sends REST requests with Python's standard library. The SDK installations in the Router quickstart (`comfy-sdk`, `@comfyorg/sdk`, or Swift SDK) are alternative examples for other applications and are not required here. The node currently waits for a synchronous Router response; queued delivery and automatic retries are not yet implemented.

## Install

1. Put this repository in `ComfyUI/custom_nodes/soylab_comfy_router` and restart ComfyUI. A current ComfyUI release with V3 `DynamicCombo` and `Autogrow` support is required.
2. Create a key at the [Comfy Developer Platform API keys page](https://platform.comfy.org/profile/api-keys?onboarding=router) and add credits to the workspace if needed.
3. Enter the key in the node's `api_key` field **or** copy `API KEY.INI.example` to `API KEY.INI` and fill in `api_key` there. `API KEY.INI` is ignored by Git. A key typed into a node may be saved in a workflow export, so use the INI file for shared workflows.
4. Add **SOYLAB Comfy Router** from **Soylab / Comfy Router**. Choose a service, model, version, resolution and any references. Connect the active `IMAGE`, `VIDEO` or `AUDIO` output to a save node, then queue the workflow.

The `workflows` folder contains [a GPT Image 2 image-editing example](workflows/image_edit_gpt_image_2.json), with [Korean](workflows/README.ko.md) and [English](workflows/README.en.md) Markdown notes embedded in the graph. Upload any image into `Load Image`; `web/soylab-logo.png` is an included sample. The sample workflow contains no API key.

## Included model families

| Service | Models | Media |
| --- | --- | --- |
| Runway | Gen-4 Turbo Video, Gen-4 Image, Aleph 2 | Image, video |
| Dreamina | Seedance 2.5 / 2.0 / Fast / Mini; Seedream 5 Pro / Lite | Image, video, audio according to model |
| OpenAI | GPT Image 2 / 2.5 Flare / 2.5 Sunburst | Image |
| Google | Nano Banana 2 / 2 Lite / Pro | Image |
| BytePlus Audio | Seed Audio 1.0 / Multilingual | Image or audio reference; audio output |

The maximum reference sockets are taken from the model's [Router schema](https://docs.comfy.org/development/comfy-router/models) or the matching official ComfyUI Partner node implementation. For example, Seedance 2.5 has 30 image, 10 video and 10 audio reference slots; GPT Image 2 has 16 image slots. `Not Support` appears in coral when a route or old selection is incompatible. Unsupported output types remain visible as `Not Support` because ComfyUI output types are fixed in the registered node schema.

## Cost display

The header shows a **direct service price** only where a public pricing rule was verified (currently Runway) and a **Comfy credit estimate** where the installed Partner node's published USD price formula can be mapped to these controls. Comfy's published conversion is **$1 = 211 credits**. For Seedance 2.5 and 2.0, the selected Comfy route also shows estimated credits per second. Click **공급자별 비용 확인** on the node or its header cost badge to open a comparison panel; it updates when the model, route, resolution, duration or ratio changes. Image models with a known Comfy estimate show credits per run.

[Comfy's model gallery](https://comfy.org/models) and [Seedance 2.5 page](https://comfy.org/seedance-2.5) describe the models and Cloud plans but do not publish a Router provider price table. Router's model catalog also does not expose such a table through its API. The comparison panel therefore marks alternate provider prices as unavailable instead of applying their direct service prices to Comfy billing. After a successful call, the header, panel and `COST` output use `X-Comfy-Credits-Used` when Router supplies it; that is the actual charge. Estimates can become stale when prices change. Check the Developer Platform before an expensive run.

The request uses the documented `POST /v2/models/{provider}/{model}` route. Optional alternate providers are shown only for canonical models whose published schema advertises them. `advanced_json` merges additional native request fields; it cannot override the model path. Video references that require an HTTPS URL are uploaded through Comfy's signed `/customers/storage` flow using the same API key.

## Current boundaries

- The dropdown is a curated list of 17 models. New Router catalog entries require an update to this node.
- A provider may reject a reference format or parameter even if the shared Router schema admits it. The API key and credits are needed for a live end-to-end run, which is not included in the repository tests.
- The audio decoder currently returns PCM WAV; `Seed Audio` requests WAV output. Other audio codecs can be added later.
- The generated media is downloaded immediately because some provider URLs expire. `RAW JSON` contains the native provider response for inspection.

## Source references

- [Comfy Router quickstart](https://docs.comfy.org/development/comfy-router/quickstart) and [API reference](https://docs.comfy.org/development/comfy-router/reference)
- [Comfy Router model schemas](https://docs.comfy.org/development/comfy-router/models)
- [Official ComfyUI Partner node source](https://github.com/Comfy-Org/ComfyUI/tree/master/comfy_api_nodes)
- [Runway developer pricing](https://docs.dev.runwayml.com/guides/pricing/)
- [Comfy credit conversion](https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy)

## Verify locally

From this repository directory, use the Python environment that runs ComfyUI and include ComfyUI's source directory on `PYTHONPATH`:

```bash
PYTHONPATH="..:/path/to/ComfyUI" python -m unittest discover -s tests -v
```

For the official ComfyUI-Manager listing, see the [Comfy Registry publication check](REGISTRY.md). This local node has not been published to the Registry.
