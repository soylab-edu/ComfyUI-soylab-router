# SOYLAB Comfy Router

A local ComfyUI custom node that calls [Comfy Router](https://comfy.org/platform/router) with your personal Comfy API key. The purple node uses the supplied Soylab mark and purple-to-green header. Its two selection controls are **Model** and **Provider**. Model entries show names such as `Runway Gen-4 Turbo Video` and `BytePlus Seedance 2.5`; Provider lists only Router execution paths available for the chosen model. New nodes default to `BytePlus Seedance 2.5` with `higgsfield`. Reference sockets use native `Autogrow` with model-specific caps.

This node sends REST requests with Python's standard library. The SDK installations in the Router quickstart (`comfy-sdk`, `@comfyorg/sdk`, or Swift SDK) are alternative examples for other applications and are not required here. The node currently waits for a synchronous Router response; queued delivery and automatic retries are not yet implemented.

## Install

1. Put this repository in `ComfyUI/custom_nodes/soylab_comfy_router` and restart ComfyUI. A current ComfyUI release with V3 `DynamicCombo` and `Autogrow` support is required.
2. Create a key at the [Comfy Developer Platform API keys page](https://platform.comfy.org/profile/api-keys?onboarding=router) and add credits to the workspace if needed.
3. Enter the key in the node's `api_key` field **or** copy `API KEY.INI.example` to `API KEY.INI` and fill in `api_key` there. `API KEY.INI` is ignored by Git. A key typed into a node may be saved in a workflow export, so use the INI file for shared workflows.
4. Add **SOYLAB Comfy Router** from **Soylab / Comfy Router**. Choose a model, an available Router provider, resolution and any references. Connect the active `IMAGE`, `VIDEO` or `AUDIO` output to a save node, then queue the workflow.

The `workflows` folder contains [a GPT Image 2 image-editing example](workflows/image_edit_gpt_image_2.json), with [Korean](workflows/README.ko.md) and [English](workflows/README.en.md) Markdown notes embedded in the graph. Upload any image into `Load Image`; [the full-size sample image](workflows/soylab-sample-image.png) is included. The sample workflow contains no API key.

## Included model families

| Service | Models | Media |
| --- | --- | --- |
| Runway | Gen-4 Turbo Video, Gen-4 Image, Aleph 2 | Image, video |
| Dreamina | Seedance 2.5 / 2.0 / Fast / Mini; Seedream 5 Pro / Lite | Image, video, audio according to model |
| OpenAI | GPT Image 2 / 2.5 Flare / 2.5 Sunburst | Image |
| Google | Nano Banana 2 / 2 Lite / Pro | Image |
| BytePlus Audio | Seed Audio 1.0 / Multilingual | Image or audio reference; audio output |

The maximum reference sockets are taken from the model's [Router schema](https://docs.comfy.org/development/comfy-router/models) or the matching official ComfyUI Partner node implementation. For example, Seedance 2.5 has 30 image, 10 video and 10 audio reference slots; GPT Image 2 has 16 image slots. Unsupported media outputs are hidden in Nodes 2.0; the registered output types stay fixed for graph compatibility.

The [Router models list](https://docs.comfy.org/development/comfy-router/models) groups canonical model IDs by their first path segment: `runway/gen4_turbo` and `byteplus/dreamina-seedance-2-5-260628` are valid model IDs. That segment identifies the model's registered provider. The Provider control selects the **serving provider** used for the request: `Comfy` is the default, while other entries use Router's `model_provider` option. The [serving provider coverage](https://docs.comfy.org/development/comfy-router/providers) lists no `Dreamina` alternate route for Seedance 2.5 and no `Runway` alternate route for Gen-4 Turbo. A Runway direct API price in the header is a separate comparison.

## Cost display

The header shows a **direct maker API price** only where a public pricing rule was verified (currently Runway) and a **Comfy credit estimate** where the installed Partner node's published USD price formula can be mapped to these controls. Comfy's published conversion is **$1 = 211 credits**. For Seedance 2.5 and 2.0, the selected Comfy route also shows estimated credits per second. Click **Router 공급자별 비용 확인** on the node or its header cost badge to open a comparison panel; it updates when the model, route, resolution, duration or ratio changes. Image models with a known Comfy estimate show credits per run.

[Comfy's official Partner Node price list](https://docs.comfy.org/tutorials/partner-nodes/pricing) gives public rates for the default Comfy route. The [Router catalog API](https://docs.comfy.org/development/comfy-router/reference) lists models and billing behavior but explicitly omits prices and usage, so an alternate route has no documented pre-run quote. The comparison panel displays the official Comfy baseline separately from any selected alternate route and never treats one as the other's price. After a successful call, the header, panel and `COST` output use `X-Comfy-Credits-Used` when Router supplies it. The frontend saves up to 40 recent model, route and settings credit totals in this browser so a later run can show a clearly labeled observed cost; no API key or prompt is stored in that history. Prior results are not a guaranteed future price.

Until Router publishes route-specific pre-run prices, [`web/router-data.json`](web/router-data.json) tracks dated, sourced **direct provider API USD reference rates** for comparable settings. For alternate routes, the header converts that direct USD rate using Comfy's published **$1 = 211 credits** rate and labels the result as a reference estimate. It is not a Router quote or a guaranteed charge. The comparison panel shows the reference credits for the selected duration; after a run, an actual Router credit header takes precedence. A provider's previous actual Router credit usage remains local to the browser; add a Git-tracked Router rate only after its exact settings and billed credits have been independently verified. If Comfy later publishes official route prices, use that source in preference to these direct API comparisons.

### Maintain model and price data

[`web/router-data.json`](web/router-data.json) is the single editable catalog for model names and IDs, serving providers, media socket limits, supported resolutions, quality options, and pricing rules. Each `models[]` entry contains its `providers` and `pricing` objects. Edit `pricing.comfy` for the published Comfy baseline, `pricing.maker` for the model maker's own API, or `pricing.alternates.<provider>` for a dated direct-provider comparison. Keep the source URL and `checked_at` next to each alternate price, then update the top-level `updated_at`. The Python node controls and browser price display both read this file, so changing existing model or provider data does not require editing calculation code. Restart ComfyUI after editing to rebuild its model and input controls, then reload the browser to refresh the displayed rates. Adding a new model that needs a different native request or response format still requires an adapter implementation and schema verification; a JSON entry alone cannot make an unsupported API request work.

Resolution is part of every price lookup. The [Higgsfield Seedance 2.5 page](https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/playground) publishes one range covering 480p and 720p, without a reliable price for each resolution; the node labels that range and does not present it as a 1080p quote. Higgsfield and fal currently document only 480p and 720p for this model, so the node rejects 1080p for those alternate routes before sending a paid request. Runware and WaveSpeed references use their published per-resolution rates. Where a model actually offers 4K, such as Seedance 2.0, the [official Partner Node price table](https://docs.comfy.org/tutorials/partner-nodes/pricing) supplies the Comfy 4K token rate; the estimate also uses the selected aspect ratio. The [Runware](https://runware.ai/seedance-2-0) and [WaveSpeed](https://wavespeed.ai/models/bytedance/seedance-2.0/text-to-video) 4K direct API reference rates are recorded separately. Seedance 2.5 does not expose a 4K option in this node.

The request uses the documented `POST /v2/models/{provider}/{model}` route. Optional alternate providers are shown only for canonical models whose published schema advertises them. `advanced_json` merges additional native request fields; it cannot override the model path. Video references that require an HTTPS URL are uploaded through Comfy's signed `/customers/storage` flow using the same API key.

## Current boundaries

- The dropdown is a curated list of 17 models. The [public Router models page](https://docs.comfy.org/development/comfy-router/models) currently lists many more; each added model needs its own request schema and media handling checked.
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
