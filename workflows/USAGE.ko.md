# Seedance 2.5 예제 사용법

[GitHub](https://github.com/soylab-edu/ComfyUI-soylab-router) · [소이랩 유튜브](https://www.youtube.com/@soy_lab) · [소이랩 홈페이지](https://soylab.ai/)

1. **API 키 받기:** [Comfy 개발자 플랫폼의 API 키 페이지](https://platform.comfy.org/profile/api-keys?onboarding=router)에 로그인 → API 키 생성 → 같은 워크스페이스에 크레딧 충전.
2. **키 넣기:** Router 노드의 `api_key`에 입력하거나 **API KEY.INI 열기** 버튼으로 개인 키 파일에 저장. 키를 넣은 워크플로는 공유하지 마세요.
3. **이미지 준비:** 이 폴더의 `soylab-reference.png`를 ComfyUI `input` 폴더에 복사. 이미지 로드 노드에서 해당 파일을 선택하세요. 이미지의 원래 워크플로 메타데이터는 제거했습니다.
4. **워크플로 열기:** `seedance_2_5_image_to_video.json`을 ComfyUI에 드래그. 이미지 로드 → Router의 `image_1`(첫 프레임) → 비디오 저장이 연결되어 있습니다. 마지막 프레임은 `image_2`에 연결하세요.
5. **실행:** 기본값은 Seedance 2.5, `higgsfield`, `image`, 480p, 9:16, 4초입니다. 프롬프트와 비용을 확인하고 실행하세요. 결과는 ComfyUI `output/SOYLAB_Router`에 저장됩니다.

`Comfy`는 Router의 파트너 모델 기본 실행 경로입니다. `Runway`는 모델 이름에 들어가지만 현재 Router의 별도 실행 공급자 선택지에는 없습니다.
