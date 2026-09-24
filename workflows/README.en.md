# GPT Image 2 image-editing example

[GitHub](https://github.com/soylab-edu/soylab_comfy_router) · [SOYLAB YouTube](https://www.youtube.com/@soy_lab) · [SOYLAB website](https://soylab.ai/)

1. **Get an API key:** Sign in to the [Comfy developer API keys page](https://platform.comfy.org/profile/api-keys?onboarding=router) → create a key → add credits to the same workspace.
2. **Enter the key:** Paste it into Router `api_key`, or use **Open API KEY.INI** to save it in your private key file. Do not share a workflow containing a key.
3. **Prepare the image:** Copy `soylab-reference.png` into ComfyUI's `input` folder. The source workflow metadata has been removed.
4. **Open the workflow:** Drag `image_edit_gpt_image_2.json` into ComfyUI. Load Image → Router `image_1` → Save Image are connected.
5. **Run:** GPT Image 2, `Comfy`, 1024×1024, and `low` are selected. Review the prompt and cost before running. The image is saved in ComfyUI's `output` folder.

`Comfy` is Router's default partner-model serving route. The model maker in the name is different from the selected serving provider.
