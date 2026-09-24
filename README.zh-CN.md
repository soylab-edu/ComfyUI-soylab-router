# SOYLAB Comfy Router

[GitHub](https://github.com/soylab-edu/soylab_comfy_router) · [SOYLAB YouTube](https://www.youtube.com/@soy_lab) · [SOYLAB 官网](https://soylab.ai/)

**语言：** [한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

这是一个使用个人 Comfy API 密钥调用 [Comfy Router](https://comfy.org/platform/router) 的**本地 ComfyUI 自定义节点**。模型与 Router 的实际执行服务商分别选择，并可根据模型连接图像、视频和音频。新节点默认选择 `BytePlus Seedance 2.5` 和 `higgsfield`。参考输入接口通过 ComfyUI 的 Autogrow 增加，数量不超过对应模型的上限。

节点说明、输入提示和费用窗口会跟随 ComfyUI 的 **设置 → 语言**（`Comfy.Locale`）在韩语、英语、日语和简体中文之间切换。未设置语言时默认使用韩语。安装翻译文件后请重启 ComfyUI 并刷新浏览器。模型名称和供应商 ID 保留 API 原始拼写。

节点使用 Python 标准库直接请求 Router REST API，因此无需安装快速入门文档中的额外 SDK。它会提交排队任务、查询实际状态并下载生成结果。仅在图像模型不支持队列时改用同步请求；耗时的视频和音频任务则在提交前停止，避免同步请求超时后丢失结果。

## 安装与 API 密钥

1. 将本仓库放入 `ComfyUI/custom_nodes/soylab_comfy_router`，然后重启 ComfyUI。需要支持 V3 `DynamicCombo` 和 `Autogrow` 的较新版本。
2. 在 [Comfy 开发者平台](https://platform.comfy.org/profile/api-keys?onboarding=router)创建工作区 API 密钥，并按需充值。
3. 可在节点的 `api_key` 输入密钥，也可点击 INI 按钮，在操作系统的文本编辑器中填写 `API KEY.INI`。文件不存在时，按钮显示 **创建 INI 文件并输入密钥**；已存在时显示 **打开 API KEY.INI**。按钮只创建或打开文件，不会把文件内容返回浏览器。该文件已被 Git 忽略。共享工作流时，建议使用 INI 文件，因为节点输入中的密钥可能保存在工作流导出文件中。
4. 从 **Soylab / Comfy Router → SOYLAB Comfy Router** 添加节点，选择模型、服务商、任务模式及输出设置。将启用的图像、视频或音频输出连接到保存节点，然后运行工作流。

`workflows` 文件夹包含 [Seedance 2.5 图像转视频示例](workflows/seedance_2_5_image_to_video.json)和 [GPT Image 2 图像编辑示例](workflows/image_edit_gpt_image_2.json)。请将[已删除工作流元数据的参考图像](workflows/soylab-reference.png)复制到 ComfyUI 的 `input` 文件夹。视频示例连接了加载图像→Router→保存视频，并包含[韩语](workflows/USAGE.ko.md)和[英语](workflows/USAGE.en.md)使用说明。示例不含 API 密钥。

## 模型与任务模式

| 模型系列 | 已收录模型 | 主要输出 |
| --- | --- | --- |
| Runway | Gen-4 Turbo Video、Gen-4 Image、Aleph 2 | 视频、图像 |
| BytePlus / Dreamina | Seedance 2.5、2.0、Fast、Mini；Seedream 5 Pro、Lite | 视频、图像 |
| OpenAI | GPT Image 2、2.5 Flare、Sunburst | 图像 |
| Google | Nano Banana 2、2 Lite、Pro | 图像 |
| BytePlus Audio | Seed Audio 1.0、Multilingual | 音频 |

Seedance 提供 `auto`、`text`、`image`、`reference` 任务模式；2.5 还提供官方合作伙伴节点中的 `edit` 和 `extend`。`image` 模式需要 `first_frame`，也可以连接 `last_frame`。`image_1` 是**参考图像**，不是首帧。`reference` 需要参考媒体，`edit` 与 `extend` 需要视频。编辑时采用源视频的时长和宽高比。由于尚未验证其他服务商对此类请求的转换，`edit` 和 `extend` 仅允许使用 Comfy 路径。

Seedream 5 Pro 在连接参考图像后，可选择 `standard`（质量优先）或 `fast`（速度优先）提示词优化模式。Seed Audio 提供 `auto`、`text`、`audio`、`image`、`preset_voice` 参考模式；预设音色列表来自已安装的官方合作伙伴节点。节点会在付费请求前拦截与模式不匹配的输入。模型、服务商、模式与接口数量由 [`web/router-data.json`](web/router-data.json) 管理。

Higgsfield 路径的 Seedance 图像转视频 API 要求可访问的图像 URL，因此节点会先上传图像到 Comfy 签名存储，再交给 Router。其他路径使用模型架构允许的数据 URI。[Router 的 Seedance 架构](https://docs.comfy.org/development/comfy-router/models/byteplus/dreamina-seedance-2-5-260628/code)区分首帧与参考图像。

**如果要把照片固定为首帧，**请选择 `image` 任务模式，并把照片连接到 `first_frame`。即使提示词写了“10 秒、1080p”，实际请求仍采用节点中的 `duration` 和 `resolution`。最近错误报告中的实际设置是 **4 秒、480p**，与提示词不同。

## 服务商与费用

模型名中的 `Runway` 或 `BytePlus` 表示模型的制作方或注册系列。**服务商选择**表示 Router 实际执行请求的路径。例如，Seedance 2.5 可选择 `Comfy`、`fal`、`higgsfield`、`runware`、`wavespeed`。不会把[官方服务商列表](https://docs.comfy.org/development/comfy-router/providers)中不存在的 `Dreamina` 或 `Runway` 虚构成独立执行路径。

顶部费用标签和 **Router 공급자별 비용 확인**（按服务商查看费用）面板会根据模型、服务商、分辨率、时长等设置更新。`Comfy` 路径的估算采用[官方合作伙伴节点价格表](https://docs.comfy.org/tutorials/partner-nodes/pricing)。其他服务商的**直连 API 价格**只作为带日期和出处的对比资料，并不保证等于 Router 的实际收费。美元到点数的参考换算采用 Comfy 公布的 **1 美元 = 211 C**。只有 Router 返回 `X-Comfy-Credits-Used` 时才显示实际**使用点数**；没有该值时不会显示为 `0 C`，应到 Comfy Credit History 核对。

更新价格、模型、服务商或支持的设置时，编辑 [`web/router-data.json`](web/router-data.json)。Python 节点和浏览器界面均读取这个文件。请同时记录价格出处 URL 和核对日期。若新模型的请求或响应格式不同，还需要检查其架构并编写适配代码。修改数据后，重启 ComfyUI 并刷新浏览器。

## 进度与错误

节点底部通过与官方合作伙伴节点相同的 ComfyUI 消息通道，显示**准备输入 → 上传 → 提交 Router／排队 → 生成 → 接收结果 → 下载 → 完成**。Nodes 1.0 和 2.0 使用相同的服务端消息。只显示 Router 提供的真实状态，不编造完成百分比。

如果 Router 返回 `400`，请检查模型、服务商、任务模式、图像接口的用途以及实际时长和分辨率。新版错误信息会在可获取时附上 Router 错误类型与请求 ID。此前同步视频请求即使返回 `504 deadline_exceeded`，也可能已经发送至服务商并计费，不宜直接重复提交。结果文件会在 URL 过期前立即下载，服务商原始响应则从 `RAW JSON` 输出。

目前精选实现了 17 个模型；[Router 完整模型列表](https://docs.comfy.org/development/comfy-router/models)还有更多模型。个别服务商可能拒绝符合通用架构的输入；在不进行付费生成的情况下，无法保证所有组合都能成功。
