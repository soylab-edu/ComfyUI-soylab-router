# Comfy Registry publication check

Checked against the [official publishing guide](https://docs.comfy.org/registry/publishing), [metadata specification](https://docs.comfy.org/registry/specifications), and [standards](https://docs.comfy.org/registry/standards) on 2026-09-24.

This node **can be submitted to Comfy Registry**, which supplies ComfyUI-Manager listings. It is **not published there yet**. Local installation and GitHub hosting do not automatically register a node.

Before publishing:

1. Create or select a publisher at [registry.comfy.org](https://registry.comfy.org). The publisher ID must be the one actually assigned to that account; it cannot be inferred from the GitHub organization name.
2. Create a **Registry publishing API key** for that publisher. This is separate from the personal **Comfy Router API key** used to run paid models. Neither key belongs in Git.
3. Add `pyproject.toml` with a unique `[project].name`, semantic `version`, repository URL and `[tool.comfy].PublisherId` matching the verified publisher account. Use `DisplayName = "SOYLAB Comfy Router"`. Add a license only after the repository owner chooses one.
4. Check a live paid image, video and audio run with a user-supplied Router key, and check the ComfyUI frontend after changing services and models. Registry standards require functional, documented nodes. The automated tests and local UI import performed so far do not cover paid provider execution.
5. Publish with `comfy node publish` or the official GitHub Action using the Registry key. The public listing exposes a packaged copy of all tracked files unless excluded with `.comfyignore`. Ensure `API KEY.INI` remains untracked.

No publication command has been run. The current repository is private, so do not assume that publishing its package publicly is intended by the owner.
