# SOYLAB Comfy Router

[GitHub](https://github.com/soylab-edu/ComfyUI-soylab-router) · [SOYLAB YouTube](https://www.youtube.com/@soy_lab) · [SOYLAB 公式サイト](https://soylab.ai/)

**言語:** [한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

個人の Comfy API キーで [Comfy Router](https://comfy.org/platform/router) を利用する**ローカル ComfyUI カスタムノード**です。モデルと Router の実行プロバイダーを別々に選び、モデルに応じて画像・動画・音声を接続できます。新しいノードの初期値は `BytePlus Seedance 2.5` と `higgsfield` です。参照入力は ComfyUI の Autogrow により、モデルごとの上限まで増やせます。

ノードの説明、入力のヒント、料金ウィンドウは ComfyUI の **設定 → 言語** (`Comfy.Locale`) に従い、韓国語・英語・日本語・簡体字中国語に切り替わります。言語が未設定の場合は韓国語です。翻訳ファイルの導入後は ComfyUI を再起動し、ブラウザーを再読み込みしてください。モデル名とプロバイダー ID は API と同じ表記を維持します。

Python 標準ライブラリから Router REST API を直接呼び出すため、クイックスタートに記載された SDK の追加インストールは不要です。ジョブをキューに送信し、実際の状態を確認してから結果をダウンロードします。キューを利用できない画像モデルのみ同期呼び出しに切り替えます。長時間の動画・音声ジョブは、同期接続の期限によって結果を失わないよう送信前に停止します。

## インストールと API キー

1. このリポジトリを `ComfyUI/custom_nodes/ComfyUI-soylab-router` に実フォルダーとしてクローンまたは展開し、ComfyUI を再起動します。V3 `DynamicCombo` と `Autogrow` に対応する新しい ComfyUI が必要です。
2. [Comfy 開発者プラットフォーム](https://platform.comfy.org/profile/api-keys?onboarding=router)でワークスペースの API キーを作成し、必要に応じてクレジットを追加します。
3. ノードの `api_key` 欄に入力するか、INI ボタンで OS のテキストエディターから `API KEY.INI` を編集します。ファイルがなければボタンは **INI ファイルを作成してキーを入力**、あれば **API KEY.INI を開く** と表示されます。ボタンはファイルを作成・開くだけで、キーの内容をブラウザーに返しません。このファイルは Git から除外されています。共有するワークフローでは、保存され得るノード入力欄より INI ファイルの使用を推奨します。
4. **Soylab / Comfy Router → SOYLAB Comfy Router** を追加し、モデル、プロバイダー、タスクモード、出力設定を選びます。有効な画像・動画・音声出力を保存ノードにつなぎ、実行します。

`workflows` フォルダーには [Seedance 2.5 の画像→動画例](workflows/seedance_2_5_image_to_video.json)と [GPT Image 2 の画像編集例](workflows/image_edit_gpt_image_2.json)があります。[ワークフローメタデータを削除した参照画像](workflows/soylab-reference.png)を ComfyUI の `input` フォルダーにコピーしてください。動画例は画像読み込み→Router→動画保存を接続し、[韓国語](workflows/USAGE.ko.md)・[英語](workflows/USAGE.en.md)の使用方法メモを含みます。API キーは含まれません。

## モデルとモード

| 系列 | 収録モデル | 主な出力 |
| --- | --- | --- |
| Runway | Gen-4 Turbo Video、Gen-4 Image、Aleph 2 | 動画・画像 |
| BytePlus / Dreamina | Seedance 2.5・2.0・Fast・Mini、Seedream 5 Pro・Lite | 動画・画像 |
| OpenAI | GPT Image 2、2.5 Flare・Sunburst | 画像 |
| Google | Nano Banana 2・2 Lite・Pro | 画像 |
| BytePlus Audio | Seed Audio 1.0・Multilingual | 音声 |

Seedance の**タスクモード**は `auto`、`text`、`image`、`reference` です。2.5 には公式パートナーノードと同じ `edit`、`extend` もあります。`image` モードでは `image_1` が最初のフレーム、`image_2` が最後のフレームです。従来の `first_frame` と `last_frame` 入力も使えますが、同じ役割の入力を同時に接続することはできません。`reference` モードでは番号付き画像入力を参照画像として扱います。`edit` と `extend` には動画が必要です。編集時は元動画の長さと縦横比を使います。代替プロバイダーでの変換を確認できていないため、`edit` と `extend` は Comfy 経路のみで許可します。

Seedream 5 Pro は、参照画像がある場合に `standard`（品質優先）/ `fast`（速度優先）のプロンプト最適化を選べます。Seed Audio は `auto`、`text`、`audio`、`image`、`preset_voice` の参照モードを持ち、プリセット音声はインストール済み公式パートナーノードの選択肢を使用します。モードに合わない入力は有料リクエストを送る前に検出します。モデル、プロバイダー、モード、入力数は [`web/router-data.json`](web/router-data.json) で管理します。

Higgsfield 経路の Seedance 画像は、画像から動画への API がアクセス可能な URL を要求するため、Comfy の署名付きストレージにアップロードしてから Router に渡します。他の経路ではモデルのスキーマが許可するデータ URI を使います。[Router の Seedance スキーマ](https://docs.comfy.org/development/comfy-router/models/byteplus/dreamina-seedance-2-5-260628/code)では最初のフレームと参照画像が区別されています。

**写真を厳密に最初のフレームにする場合**、タスクモードで `image` を選び、写真を `image_1` に接続してください。最後のフレームは `image_2` に接続します。プロンプトに「10 秒・1080p」と書いても、実際のリクエストにはノードの `duration` と `resolution` が使われます。

## プロバイダーと料金

モデル名の `Runway` や `BytePlus` はモデルの製作者・登録系列です。**공급자 선택** は Router が実際に実行する経路です。Seedance 2.5 では `Comfy`、`fal`、`higgsfield`、`runware`、`wavespeed` を選べます。[公式プロバイダー一覧](https://docs.comfy.org/development/comfy-router/providers)にない `Dreamina` や `Runway` を独立した実行経路として表示しません。

ヘッダーの料金表示と **Router 공급자별 비용 확인** は、モデル、経路、解像度、長さなどに応じて更新されます。`Comfy` の公開価格は[公式パートナーノード料金表](https://docs.comfy.org/tutorials/partner-nodes/pricing)から推定します。他のプロバイダーの**直接 API 価格**は日付・出典付きの比較資料であり、Router の請求額ではありません。参考換算には Comfy が公開した **$1 = 211 C** を使用します。実際の**使用クレジット**は Router が `X-Comfy-Credits-Used` を返した場合のみ表示します。値がない場合に `0 C` と扱わず、Comfy Credit History での確認を案内します。

料金やモデル、プロバイダー、サポート設定を変更する場合は [`web/router-data.json`](web/router-data.json) を更新します。Python ノードとブラウザー表示の両方がこのファイルを読みます。料金の出典 URL と確認日も更新してください。異なる入出力形式の新モデルには、アダプターの実装とスキーマ確認が必要です。変更後は ComfyUI を再起動してブラウザーを再読み込みします。

## 進捗とエラー

ノードの下部には、公式パートナーノードと同じ ComfyUI のメッセージ経路で、**入力準備 → アップロード → Router 送信・待機 → 生成 → 結果受信 → ダウンロード → 完了**が表示されます。Node 1.0 と 2.0 で同じサーバーメッセージを使用します。表示するのは Router が返す状態のみで、推測したパーセンテージは表示しません。

Router が `400` を返した場合は、モデル、プロバイダー、モード、画像スロットの役割、実際の長さと解像度を確認してください。新しいエラー表示には、利用可能なら Router のエラー種別とリクエスト ID を含めます。過去の同期動画リクエストで `504 deadline_exceeded` が出ても、生成・課金済みの可能性があります。安易に再実行しないでください。結果ファイルは URL の期限前にすぐダウンロードし、元のプロバイダー応答を `RAW JSON` に出力します。

現在は 17 モデルを選定して実装しています。[Router の全モデル一覧](https://docs.comfy.org/development/comfy-router/models)にはさらに多くのモデルがあります。共通スキーマに適合する入力でも、個々のプロバイダーの制限で拒否される場合があります。有料生成を行わずに、すべての組み合わせでの成功を保証することはできません。
