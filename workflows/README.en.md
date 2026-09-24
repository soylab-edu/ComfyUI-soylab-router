# SOYLAB Comfy Router — image editing example

1. Sign in to the [API keys page in Comfy Developer Platform](https://platform.comfy.org/profile/api-keys?onboarding=router) and create a personal API key. Check or add Comfy credits in the same workspace's Billing section.
2. Install this repository in your ComfyUI `custom_nodes` folder and restart ComfyUI.
3. Enter the key in the node's `api_key` field, or copy `API KEY.INI.example` to `API KEY.INI` and set `api_key = ...` under `[comfy_router]`. The file option is safer when sharing workflows.
4. Drag `image_edit_gpt_image_2.json` from this folder into ComfyUI. Upload any source image in `Load Image`. You can use `workflows/soylab-sample-image.png` as the example input.
5. In the Router node choose model `OpenAI / GPT Image 2`, execution provider `Comfy`, `1024x1024`, and `low`. Confirm the image is connected to `model.reference_images.image_1`, then edit the prompt.
6. Click **Queue Prompt** to run the paid request. The result appears at `Save Image` and the Router's `IMAGE` output. The header shows an estimate; after the run it displays actual Comfy credits from the response header.

Choose a combined entry such as `OpenAI / GPT Image 2` under **Model**, then choose the **Router execution provider** immediately below. `Comfy` is the default execution route, not the model maker. See [Comfy Router provider coverage](https://docs.comfy.org/development/comfy-router/providers) for official routes.
