# Seedance 2.5 example guide

[GitHub](https://github.com/soylab-edu/ComfyUI-soylab-router) · [SOYLAB YouTube](https://www.youtube.com/@soy_lab) · [SOYLAB website](https://soylab.ai/)

1. **Get an API key:** Sign in to the [Comfy developer API keys page](https://platform.comfy.org/profile/api-keys?onboarding=router) → create a key → add credits to the same workspace.
2. **Enter the key:** Paste it into the Router node's `api_key` field, or use **Open API KEY.INI** to save it in your private key file. Do not share a workflow containing a key.
3. **Prepare the image:** Copy `soylab-reference.png` into ComfyUI's `input` folder and select it in Load Image. The source workflow metadata has been removed.
4. **Open the workflow:** Drag `seedance_2_5_image_to_video.json` into ComfyUI. Load Image → Router `image_1` (first frame) → Save Video are connected. Connect the last frame to `image_2`.
5. **Run:** Defaults are Seedance 2.5, `higgsfield`, `image`, 480p, 9:16, and 4 seconds. Review the prompt and cost before running. The video is saved in ComfyUI `output/SOYLAB_Router`.

`Comfy` is Router's default partner-model serving route. `Runway` appears in model names but is not currently a separate Router serving-provider option.
