# SOYLAB Comfy Router

[GitHub](https://github.com/soylab-edu/ComfyUI-soylab-router) · [소이랩 유튜브](https://www.youtube.com/@soy_lab) · [소이랩 홈페이지](https://soylab.ai/)

**언어:** [한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

![SOYLAB Comfy Router: 이미지에서 영상까지 연결한 ComfyUI 워크플로](assets/intro.png)

개인 Comfy API 키로 [Comfy Router](https://comfy.org/platform/router)를 호출하는 **로컬 ComfyUI 커스텀 노드**입니다. 모델과 Router 실행 공급자를 따로 선택하고, 모델에 맞는 이미지·영상·오디오 입력을 연결할 수 있습니다. 새 노드의 기본값은 `BytePlus Seedance 2.5`와 `higgsfield`입니다. 모델별 최대 참조 슬롯은 ComfyUI의 Autogrow로 늘어납니다.

노드 설명·입력 안내·비용 창은 ComfyUI의 **설정 → 언어**(`Comfy.Locale`)에 따라 한국어·영어·일본어·중국어 간체로 표시됩니다. 언어가 설정되지 않았으면 한국어를 사용합니다. 번역 파일을 설치한 뒤에는 ComfyUI를 재시작하고 브라우저를 새로고침하세요. 모델명과 공급자 ID는 API 요청과의 일치를 위해 원래 표기를 유지합니다.

Python 표준 라이브러리로 Router REST API를 직접 호출하므로 빠른 시작 문서에 나오는 별도 SDK 설치는 필요하지 않습니다. 노드는 작업을 대기열에 제출하고 실제 상태를 확인한 뒤 결과 파일을 내려받습니다. 대기열이 지원되지 않는 이미지 모델만 동기 호출로 대체하며, 긴 영상·오디오 작업은 결과가 사라질 위험을 피하기 위해 중단합니다.

## 설치와 API 키

V3 `DynamicCombo`와 `Autogrow`를 지원하는 최신 ComfyUI가 필요합니다. 아직 ComfyUI-Manager에 등록되지 않았습니다.

### ChatGPT 데스크톱 앱에서 설치 요청

ComfyUI가 설치된 컴퓨터에서 로컬 폴더에 접근할 수 있는 ChatGPT 데스크톱 세션을 열고 아래 문장을 입력하세요. 설치 경로를 묻는다면 실제로 사용하는 ComfyUI 폴더를 알려주세요. 설치 후 ComfyUI를 재시작합니다.

```text
Install https://github.com/soylab-edu/ComfyUI-soylab-router in ComfyUI.
```

### 직접 설치 (Git)

1. [Git](https://git-scm.com/downloads)을 설치하고 **실제로 사용하는 ComfyUI 폴더**를 찾습니다. 일반 설치는 `ComfyUI`, Windows 포터블 설치는 `ComfyUI_windows_portable`입니다.
2. 일반 설치에서는 `ComfyUI` 폴더(`main.py`가 있는 곳)에서 터미널을 열고 아래 두 줄을 그대로 복사해 실행합니다.

   ```bash
   cd custom_nodes
   git clone https://github.com/soylab-edu/ComfyUI-soylab-router.git
   ```

   **Windows 포터블**에서는 `ComfyUI_windows_portable` 폴더(`run_nvidia_gpu.bat`가 있는 곳)에서 명령 프롬프트를 열고 아래 두 줄을 실행합니다.

   ```bat
   cd ComfyUI\custom_nodes
   git clone https://github.com/soylab-edu/ComfyUI-soylab-router.git
   ```

   이미 `custom_nodes` 폴더를 연 경우에는 `cd` 없이 `git clone` 줄만 실행하면 됩니다. Windows 파일 탐색기에서는 해당 폴더의 주소창에 `cmd`를 입력해 명령 프롬프트를 열 수 있습니다. 설치가 끝나면 `custom_nodes/ComfyUI-soylab-router` 폴더가 생깁니다.

3. ComfyUI를 **완전히 종료하고 다시 실행**한 다음 브라우저를 새로고침합니다. 시작 로그에 `import failed`가 없는지 확인하세요. 이 노드는 별도 `requirements.txt`나 `pip install` 단계가 없습니다.
4. [Comfy 개발자 플랫폼](https://platform.comfy.org/profile/api-keys?onboarding=router)에서 워크스페이스 API 키를 만들고 필요한 크레딧을 충전합니다.
5. 노드의 `api_key`에 키를 넣거나, 노드의 INI 버튼을 눌러 운영체제 편집기에서 `API KEY.INI`를 작성합니다. 파일이 없으면 버튼이 **INI 파일 생성 및 키 입력하기**, 있으면 **API KEY.INI 열기**로 표시됩니다. 버튼은 파일을 만들거나 열지만 키 내용은 브라우저로 보내지 않습니다. `API KEY.INI`는 Git에서 제외됩니다. 공유할 워크플로에는 키가 저장될 수 있는 노드 입력 대신 INI 파일을 사용하세요.
6. **Soylab / Comfy Router → SOYLAB Comfy Router**를 추가하고 모델·공급자·작업 모드·출력 설정을 고릅니다. 활성화된 이미지·비디오·오디오 출력을 저장 노드에 연결한 뒤 실행합니다.

Git으로 설치한 기존 폴더는 `ComfyUI-soylab-router` 안에서 `git pull`로 업데이트한 뒤 ComfyUI를 재시작하세요. 같은 폴더에 다시 `git clone`하지 마세요.

ComfyUI-Manager 검색 목록에 등록하려는 개발자는 [Comfy Registry 등록 준비 안내](REGISTRY.md)를 참고하세요.

`workflows` 폴더에는 [Seedance 2.5 이미지→비디오 예시](workflows/seedance_2_5_image_to_video.json)와 [GPT Image 2 이미지 편집 예시](workflows/image_edit_gpt_image_2.json)가 있습니다. 두 예시 모두 [메타데이터를 제거한 참조 이미지](workflows/soylab-reference.png)를 사용하며 API 키는 포함하지 않습니다. 이미지를 ComfyUI의 `input` 폴더에 복사한 뒤 예시를 여세요. 영상 예시에는 이미지 로드·Router·비디오 저장 노드와 [한국어](workflows/USAGE.ko.md)·[영어](workflows/USAGE.en.md) 사용 방법 메모가 연결되어 있습니다.

## 모델과 작업 모드

현재 [Router 공식 목록](https://docs.comfy.org/development/comfy-router/models)의 이미지·비디오 모델 **154개**를 등록했습니다. 노드의 **모델 검색**을 누르고 이름이나 ID 일부를 입력하면 목록이 좁혀집니다. 예를 들어 `wa`를 입력하면 Wan 모델이 보입니다. 아래 표는 대표 예시입니다. 일반 모델의 입력란은 [모델별 요청 스키마](model-schemas.json)의 필드 이름을 따르며, Wan·Veo·Qwen 등 중첩 미디어 요청은 파트너 API 노드의 연결 방식에 맞췄습니다. 드문 추가 필드는 `advanced_json`으로 전달할 수 있습니다.

| 제작사/계열 | 포함 모델 | 주요 출력 |
| --- | --- | --- |
| Runway | Gen-4 Turbo Video, Gen-4 Image, Aleph 2 | 영상·이미지 |
| BytePlus / Dreamina | Seedance 2.5·2.0·Fast·Mini, Seedream 5 Pro·Lite | 영상·이미지 |
| OpenAI | GPT Image 2, 2.5 Flare·Sunburst | 이미지 |
| Google | Nano Banana 2·2 Lite·Pro | 이미지 |
| BytePlus Audio | Seed Audio 1.0·Multilingual | 오디오 |

Seedance의 **작업 모드**는 `auto`, `text`, `image`, `reference`입니다. 2.5에는 공식 파트너 노드의 `edit`, `extend`도 있습니다. `image` 모드 또는 이미지 입력만 연결된 `auto` 모드에서는 `image_1`이 첫 프레임, `image_2`가 마지막 프레임입니다. 기존 워크플로의 `first_frame`·`last_frame` 입력도 계속 사용할 수 있지만 같은 프레임에 두 입력을 동시에 연결할 수는 없습니다. `reference` 모드에서는 번호가 붙은 이미지 입력을 참조 이미지로 사용합니다. `edit`와 `extend`는 비디오가 필요합니다. 편집은 공식 노드처럼 원본 길이와 비율을 사용합니다. 아직 확인되지 않은 공급자 변환을 피하려고 `edit`와 `extend`는 Comfy 경로에서만 허용합니다.

Seedream 5 Pro는 참조 이미지가 있을 때 `standard`(품질) / `fast`(속도) 프롬프트 최적화 모드를 선택합니다. Seed Audio는 `auto`, `text`, `audio`, `image`, `preset_voice` 참조 모드를 제공하며, 기본 음성 목록은 설치된 공식 파트너 노드의 선택지를 데이터 파일에 기록했습니다. 모드에 맞지 않는 입력은 유료 요청 전에 오류로 알려줍니다. 모델·공급자·모드·슬롯 개수 등 카탈로그 정보는 [`web/router-data.json`](web/router-data.json)에서 관리합니다.

Higgsfield 경로의 Seedance 이미지 입력은 해당 업체의 이미지→영상 API가 접근 가능한 URL을 요구하므로 Comfy의 서명된 저장소 URL로 업로드한 뒤 Router에 전달합니다. 다른 경로는 모델 스키마가 허용하는 데이터 URI를 사용합니다. [Router의 Seedance 스키마](https://docs.comfy.org/development/comfy-router/models/byteplus/dreamina-seedance-2-5-260628/code)는 첫 프레임과 참조 이미지의 역할을 구분합니다.

**첫 프레임을 고정하고 싶다면** `작업 모드: auto` 또는 `image`를 선택하고 이미지를 `image_1`에 연결하세요. 끝 프레임도 정하려면 `image_2`에 연결하세요. 프롬프트에 “10초·1080p”라고 써도 노드 설정의 `duration`과 `resolution`이 실제 요청 값입니다.

## 공급자와 비용

모델명 앞의 `Runway` 또는 `BytePlus`는 모델 제작사/등록 계열입니다. **공급자 선택**은 Router가 실제 요청을 실행할 경로입니다. `Comfy`는 Router의 기본 실행 경로이며 이 커스텀 노드는 항상 Router API를 호출합니다. Seedance 2.5의 대체 경로에는 `fal`, `higgsfield`, `runware`, `wavespeed`가 있습니다. 현재 `Runway Aleph 2`는 모델 목록에는 있지만 [공식 공급자 목록](https://docs.comfy.org/development/comfy-router/providers)에 Runway 대체 경로가 없어 `Comfy`만 선택할 수 있습니다.

상단 가격 표시와 **Router 공급자별 비용 확인** 창은 모델·공급자·해상도·길이 등에 따라 바뀝니다. 길어서 잘리는 상단 배지에 마우스를 올리면 전체 문구가 표시됩니다. `Comfy`의 공개 단가는 [공식 파트너 노드 가격표](https://docs.comfy.org/tutorials/partner-nodes/pricing)를 기준으로 추정합니다. Higgsfield Seedance 2.5는 공개 토큰 요율에 선택한 해상도·화면비·초수를 적용해 `약 X C/N초`로 표시합니다. 다른 공급자의 **직결 API 가격**도 날짜와 출처를 기록한 비교 자료이며 Router 청구액을 보장하지 않습니다. 달러→크레딧 참고 환산에는 Comfy가 공개한 **$1 = 211 C**를 사용합니다. 실제 **사용 크레딧**은 Router가 `X-Comfy-Credits-Used`를 제공할 때만 표시합니다. 값이 없는 응답을 `0 C`로 처리하지 않으며, 이 경우 Comfy Credit History에서 확인해야 합니다.

가격·모델·공급자·지원 설정은 [`web/router-data.json`](web/router-data.json)에, Router 요청·응답 스키마는 [`model-schemas.json`](model-schemas.json)에 기록합니다. Python 노드와 브라우저 표시가 이 파일들을 읽습니다. [갱신 스크립트](scripts/refresh_media_catalog.py)는 공식 모델·공급자 목록과 인증된 OpenAPI를 다시 읽어 카탈로그를 갱신합니다. 로컬 `API KEY.INI` 또는 `COMFY_API_KEY`를 사용하며 키를 생성 파일에 쓰지 않습니다. 갱신 후 변경 내용을 검토하고 커밋하세요. 가격 출처 URL과 확인 날짜는 직접 검증해 기록해야 합니다. 데이터 변경 후 ComfyUI를 재시작하고 브라우저를 새로고침하세요.

## 실행 상태와 오류

노드 하단에는 공식 파트너 노드와 같은 ComfyUI 메시지 경로로 **입력 준비 → Router 요청 → 대기·생성 → 결과 수신·다운로드 → 완료**의 5단계와 경과 초가 표시됩니다. 예: `(3/5) · 공급자에서 생성 중 · 28초 경과`. Node 1.0과 2.0에서 같은 서버 메시지를 사용합니다. Router가 제공하는 상태만 보여주며 임의의 퍼센트는 만들지 않습니다.

Router가 `400`으로 요청을 거절하면 모델·공급자·작업 모드, 이미지 슬롯의 역할, 실제 길이/해상도를 확인하세요. 최신 오류에는 가능하면 Router 오류 유형과 요청 ID도 표시합니다. `504 deadline_exceeded`였던 과거 동기식 영상 요청은 업체에 도달해 과금됐을 수도 있으므로 무작정 재실행하지 마세요. 생성 결과는 URL 만료 전에 즉시 내려받고, 공급자의 원본 응답은 `RAW JSON`으로 출력합니다.

모델 154개의 기본 요청과 응답 예시를 저장한 스키마로 검사했습니다. 모든 모델·입력 조합을 유료 생성으로 검증한 것은 아니므로, 공급자 자체 제한이나 미리 공개되지 않은 요금은 실행 결과로 확인해야 합니다.
