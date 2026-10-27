---
feature: hymt-local-translation
status: in-progress
updated: 2026-10-27
branch: feat/hymt-local-translation
commits: 86cb6ca..(head 待填)
worktree: .worktrees/hymt-local-translation
---

# HY-MT1.5-1.8B 本地翻译（应用内一键安装）

## Report

（交付时填写）

## [S1] Problem

翻译功能目前全部依赖云端 API（OpenAI 兼容 / Claude / Google），都要联网且大多要 API Key。
腾讯混元开源的 HY-MT1.5-1.8B 翻译模型（33 语互译，GGUF 量化后约 1.1GB）可以在消费级电脑上
离线跑，用户希望像本地识别引擎（RapidOCR）一样：在应用内一键下载安装，之后翻译不需要联网、
不需要 Key。

## [S2] Design

沿用「本地组件」的既有模式（下载 → 装进应用私有目录 → 自检 → 按清单可卸载），但推理器
不走 Python 运行时：

- **推理器**：llama.cpp 官方预编译 CPU 版，固定 `b11932`（晚于 Hunyuan 架构支持，GGUF 开箱即用）。
  按平台取 release 产物：win-cpu-x64 / win-cpu-arm64 / macos-arm64 / macos-x64 / ubuntu-x64 / ubuntu-arm64，
  约 12–24 MB，唯一官方源 GitHub Releases。
- **模型**：`tencent/HY-MT1.5-1.8B-GGUF` 的 **Q4_K_M**（1,133,080,512 字节，装完校验字节数）。
  下载源 ModelScope（国内直连快）→ HuggingFace（回退）。
- **存储**：`<app_local_data>/local-translate/`：`runtime/`（llama.cpp 解压后，启动时在其中
  查找 llama-server，不依赖归档内部布局）、`models/HY-MT1.5-1.8B-Q4_K_M.gguf`、
  `state/translate.json`（文件清单，供按清单卸载）。
- **服务**：`llama-server --host 127.0.0.1 --port 48731 --ctx-size 4096`。翻译前 `/health`
  探活，没起就 spawn 并轮询 health（上限 60s）；进程句柄放 static，应用退出
  （`RunEvent::Exit`）时统一 kill。localhost 请求的 reqwest 客户端 `.no_proxy()`，
  避免走用户代理。端口固定为常量（ponytail：冲突即报错提示，先不做配置项）。
- **翻译调用**：自带最小 chat 调用，用 HY-MT 官方 prompt
  「把下面的文本翻译成{目标语言}，不要额外解释。\n\n{原文}」，不复用 `call_custom_translate`
  的通用提示词。目标语言直接用设置里的中文名（中文/英文/日文/韩文）。
- **安装自检**：与 OCR 组件同哲学「装了也得能用」——装完真的起一次服务、翻译一句、
  再关掉，出结果才算安装成功。
- **进度与状态**：复用 `local-engine-progress` 事件与 `get_local_components_status` 命令
  （`Status` 增加 `translate` 字段）；`install_local_component` / `remove_local_component`
  在命令层把 `"translate"` 分流到新模块。
- **前端**：插件列表加 `hymt-translate`（翻译类型）；`App.tsx` 在 API Key 检查**之前**分发该
  插件（本地引擎无需 Key）；设置页翻译服务卡片下放安装/移除面板，样式复用现有
  本地组件面板的模式。

## [S3] Scope

In scope:
- 翻译服务新增「腾讯 HY-MT 翻译」本地引擎（应用内下载安装 llama.cpp + Q4_K_M GGUF）
- llama-server 进程生命周期管理（探活复用、退出清理）
- 设置页安装/移除/状态/进度 UI
- 六平台（win/mac/linux × x64/arm64）的产物映射

Out of scope:
- GPU 加速（CUDA / Vulkan / Metal 专用包）——CPU 跑 1.8B 已够快
- 其他量化档位（Q6/Q8/1.25bit）与 HY-MT1.5-7B、HY-MT2 的选择 UI
- 端口/模型路径配置项、经 Ollama 运行的路线
- OCR 侧用 HY-MT

## Tasks

- [ ] T1: `translate_engine.rs`——组件安装（双源下载、解压、清单、字节校验、自检）、状态、按清单移除 (depends: none)
- [ ] T2: 服务管理——ensure_server（health 探活 + spawn + 轮询）、static 句柄、`translate_hymt` 命令、`shutdown()` (depends: T1)
- [ ] T3: `lib.rs` 接线——注册模块与命令、`Status.translate`、`RunEvent::Exit` 清理 (depends: T2)
- [ ] T4: 前端——plugins 入口、App 分发、Settings 安装面板与状态展示 (depends: T3)
- [ ] T5: 验证（cargo test / cargo check / tsc build）+ changelog 片段 + spec 定稿 (depends: T4)

## [S4] Acceptance

- [ ] 未安装时选 HY-MT 翻译并点翻译：得到「先安装」类明确提示，不 panic、不误报翻译成功
- [ ] 安装流程：进度事件推进；装完自检（真实翻译一句）通过；`state/translate.json` 记录清单
- [ ] 安装后翻译：设置目标语言后翻译返回译文，全程无需 API Key
- [ ] GGUF 下载字节数与 1,133,080,512 不符时安装报错而不是静默通过
- [ ] 移除组件后磁盘空间释放、状态回到未安装
- [ ] 应用退出后 llama-server 子进程被结束（代码路径存在并有测试或断言覆盖）
- [ ] `cargo test`、`cargo check`、`npm run build` 全部通过
