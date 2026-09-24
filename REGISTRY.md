# Comfy Registry 발행 상태와 업데이트

**2026-09-24:** [SOYLAB Comfy Router 1.0.1](https://registry.comfy.org/ko/nodes/soylab-comfy-router)을 `soylab-edu` Publisher로 발행했습니다. 탭 전환 후 이미지 연결과 프롬프트를 복원하고, 이미지 입력 슬롯 확장을 유지하는 버그 패치입니다. Registry 다운로드 파일의 체크섬이 로컬 검증본과 일치합니다. 확인 시점의 버전 API 상태는 `Pending`이므로 ComfyUI-Manager 검색 반영은 처리 완료 후 다시 확인해야 합니다. 이전 1.0.0의 현재 API 상태는 `Flagged`이며 원인은 확인되지 않았습니다.

다음 버전을 발행할 때:

1. [`pyproject.toml`](pyproject.toml)의 `project.version`을 올리고, `PublisherId = "soylab-edu"`와 노드 ID `soylab-comfy-router`는 유지합니다.
2. 노드 로드와 테스트를 확인한 뒤 `comfy node validate`와 `comfy node pack`을 실행합니다. [`.comfyignore`](.comfyignore)는 개발용 파일과 로컬 키 파일을 패키지에서 제외합니다. 실제 압축 파일에도 `API KEY.INI`가 없는지 확인합니다.
3. Publisher 소유자가 [Registry 발행용 API 키](https://registry.comfy.org/ko/publishers/soylab-edu)를 사용해 `comfy node publish`를 실행합니다. 발행용 키와 노드 실행용 **Comfy Router API 키**는 서로 다르며, 둘 다 Git에 올리지 않습니다.
4. [Registry 노드 페이지](https://registry.comfy.org/ko/nodes/soylab-comfy-router)와 ComfyUI-Manager 검색에서 새 버전을 확인합니다.

[공식 발행 가이드](https://docs.comfy.org/registry/publishing) · [메타데이터 규격](https://docs.comfy.org/registry/specifications) · [보안 기준](https://docs.comfy.org/registry/standards)

라이선스 필드는 소유자가 아직 지정하지 않아 비워 두었습니다. 현재 Comfy CLI는 경고를 출력하지만 검증은 통과합니다. 공개 사용 조건을 명확히 하려면 소유자가 라이선스를 결정해야 합니다.

## English

**Published on 2026-09-24:** [SOYLAB Comfy Router 1.0.1](https://registry.comfy.org/nodes/soylab-comfy-router) under publisher `soylab-edu`. This bug patch restores image links and prompt values after switching workflow tabs and preserves the next image input slot. The Registry download checksum matches the validated local package. The version API reported `Pending` at verification time, so check ComfyUI-Manager search after Registry processing. The previous 1.0.0 currently reports `Flagged`; the reason has not been established.

For later releases, increase `project.version` in `pyproject.toml`, validate and inspect the package, then publish with the publisher's Registry key. Keep that key and the separate Comfy Router runtime key out of Git and packages. A license remains unset until the owner chooses one; validation passes with an advisory warning.
