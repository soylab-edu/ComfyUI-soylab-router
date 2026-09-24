# GPT Image 2 이미지 편집 예제

[GitHub](https://github.com/soylab-edu/ComfyUI-soylab-router) · [소이랩 유튜브](https://www.youtube.com/@soy_lab) · [소이랩 홈페이지](https://soylab.ai/)

1. **API 키 받기:** [Comfy 개발자 플랫폼의 API 키 페이지](https://platform.comfy.org/profile/api-keys?onboarding=router)에 로그인 → 키 생성 → 같은 워크스페이스에 크레딧 충전.
2. **키 넣기:** Router 노드 `api_key`에 입력하거나 **API KEY.INI 열기** 버튼으로 개인 키 파일에 저장. 키를 넣은 워크플로는 공유하지 마세요.
3. **이미지 준비:** `soylab-reference.png`를 ComfyUI `input` 폴더에 복사. 원본 워크플로 메타데이터는 제거했습니다.
4. **워크플로 열기:** `image_edit_gpt_image_2.json`을 ComfyUI에 드래그. 이미지 로드 → Router `image_1` → 이미지 저장이 연결되어 있습니다.
5. **실행:** GPT Image 2, `Comfy`, 1024×1024, `low`가 기본값입니다. 프롬프트와 비용을 확인하고 실행하세요. 결과는 ComfyUI `output` 폴더에 저장됩니다.

`Comfy`는 Router의 파트너 모델 기본 실행 경로입니다. 모델 이름의 제작사와 공급자 선택은 다른 개념입니다.
