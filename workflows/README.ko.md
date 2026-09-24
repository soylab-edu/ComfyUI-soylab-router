# SOYLAB Comfy Router — 이미지 편집 예시

1. [Comfy Developer Platform의 API 키 페이지](https://platform.comfy.org/profile/api-keys?onboarding=router)에 로그인해 개인 API 키를 만듭니다. 같은 워크스페이스의 Billing에서 Comfy 크레딧 잔액을 확인하거나 충전합니다.
2. 이 저장소를 ComfyUI의 `custom_nodes` 폴더에 설치하고 ComfyUI를 다시 시작합니다.
3. 키를 노드의 `api_key` 칸에 입력하거나, `API KEY.INI.example`을 `API KEY.INI`로 복사한 뒤 `[comfy_router]` 아래 `api_key = ...`에 저장합니다. 파일 방식이 워크플로를 공유할 때 더 안전합니다.
4. 이 폴더의 `image_edit_gpt_image_2.json`을 ComfyUI에 드래그해 엽니다. `Load Image` 노드에 원하는 원본 이미지를 업로드합니다. 예시 파일로 `workflows/soylab-sample-image.png`를 사용할 수 있습니다.
5. Router 노드에서 모델 `OpenAI / GPT Image 2`, 실행 공급자 `Comfy`, `1024x1024`, `low`를 선택합니다. `model.reference_images.image_1`에 이미지가 연결되어 있는지 확인하고 프롬프트를 수정합니다.
6. **Queue Prompt**를 누르면 크레딧이 과금됩니다. 결과는 `Save Image`와 Router의 `IMAGE` 출력에서 확인합니다. 상단 표시는 예상 요금이고, 실행 뒤에는 응답 헤더의 실제 Comfy 크레딧 사용량을 표시합니다.

**모델**에서 `OpenAI / GPT Image 2`처럼 제작사와 모델이 합쳐진 항목을 선택하고, 바로 아래 **Router 실행 공급자**를 선택합니다. `Comfy`는 기본 실행 경로이며 모델 제작사 이름이 아닙니다. 공식 제공 경로는 [Comfy Router 문서](https://docs.comfy.org/development/comfy-router/providers)에서 확인할 수 있습니다.
