# ComfyUI-Manager 등록 방법

ComfyUI-Manager의 현재 권장 경로는 [Comfy Registry에 노드를 발행](https://docs.comfy.org/registry/publishing)하는 것입니다. 별도 신청서를 제출하는 방식이 아닙니다. 이 저장소는 GitHub에 공개되어 있지만, Registry에는 아직 발행되지 않았습니다.

1. [Comfy Registry](https://registry.comfy.org)에 로그인해 **Publisher ID `soylab-edu`**로 Publisher를 만듭니다. 이 ID는 저장소 소유자가 선택했으며, 생성 후 실제 ID가 일치하는지 확인합니다.
2. 해당 Publisher의 **Registry 발행용 API 키**를 생성합니다. 노드 실행에 쓰는 **Comfy Router API 키**와 별개이며, 두 키 모두 저장소에 올리지 않습니다.
3. 저장소의 [`pyproject.toml`](pyproject.toml)에 노드 ID `soylab-comfy-router`, 버전 `1.0.0`, Publisher ID `soylab-edu`가 준비되어 있습니다. 발행하는 컴퓨터에 [Comfy CLI](https://docs.comfy.org/comfy-cli/getting-started)를 설치한 뒤 실제 계정 ID와 일치하는지 확인합니다.

   ```bash
   pip install comfy-cli
   comfy node validate
   ```

   [메타데이터 규격](https://docs.comfy.org/registry/specifications)에 따라 라이선스는 선택 항목으로 비워 두었습니다. CLI는 이 항목에 경고를 보여주지만 검증은 통과합니다.
4. 발행 전에 실제 ComfyUI에서 노드가 로드되는지 확인하고 `comfy node pack`으로 공개 패키지에 들어갈 파일을 점검합니다. 테스트와 갱신 스크립트는 [`.comfyignore`](.comfyignore)에서 제외합니다. `API KEY.INI`는 Git 추적 및 패키지 대상이 아니어야 합니다.
5. 저장소 루트에서 아래 명령을 실행하고 **Registry 발행용 API 키**를 입력합니다. 또는 공식 문서의 GitHub Actions 방법을 사용합니다. 발행 후 Registry 페이지와 ComfyUI-Manager 검색에서 노드를 확인합니다.

   ```bash
   comfy node publish
   ```

ComfyUI-Manager의 [기존 Git 목록 등록 방법](https://github.com/Comfy-Org/ComfyUI-Manager#how-to-register-your-custom-node-into-comfyui-manager)도 남아 있습니다. 이 경로를 선택한다면 ComfyUI-Manager 저장소의 `custom-node-list.json`에 저장소 정보를 추가하고, `Use local DB`로 목록이 정상 로드되는지 확인한 뒤 해당 저장소로 PR을 보냅니다. Registry 발행과는 별도의 레거시 목록 경로입니다.

## English publication check

Checked against the [official publishing guide](https://docs.comfy.org/registry/publishing), [metadata specification](https://docs.comfy.org/registry/specifications), and [standards](https://docs.comfy.org/registry/standards) on 2026-09-24.

This node **can be submitted to Comfy Registry**, which supplies ComfyUI-Manager listings. It is **not published there yet**. Local installation and GitHub hosting do not automatically register a node.

Before publishing:

1. Create a publisher at [registry.comfy.org](https://registry.comfy.org) with the owner-selected ID `soylab-edu`. Confirm that the assigned ID matches the prepared metadata.
2. Create a **Registry publishing API key** for that publisher. This is separate from the personal **Comfy Router API key** used to run paid models. Neither key belongs in Git.
3. Install [Comfy CLI](https://docs.comfy.org/comfy-cli/getting-started) with `pip install comfy-cli`. The repository already has `pyproject.toml` for `soylab-comfy-router` version `1.0.0`; confirm the publisher account uses `soylab-edu`, then run `comfy node validate`. A license is optional and remains unset until the owner chooses one.
4. Check a live paid image, video and audio run with a user-supplied Router key, and check the ComfyUI frontend after changing services and models. This is a recommended readiness check. The local automated suite passed 31 Python tests and one JavaScript test; it does not cover all paid provider executions. Run `comfy node pack` and inspect the archive before publishing.
5. Publish with `comfy node publish` or the official GitHub Action using the Registry key. The public listing exposes a packaged copy of all tracked files unless excluded with `.comfyignore`. Ensure `API KEY.INI` remains untracked.

No publication command has been run. The GitHub repository is public, but publication to Comfy Registry is a separate step.
