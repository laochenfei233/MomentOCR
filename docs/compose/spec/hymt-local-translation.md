---
feature: hymt-local-translation
status: delivered
updated: 2026-10-27
branch: feat/hymt-local-translation
commits: 86cb6ca..3e5652d
worktree: .worktrees/hymt-local-translation
---

# HY-MT1.5-1.8B 本地翻译（应用内一键安装）

## Report

**What was built** — 翻译服务列表新增「腾讯 HY-MT 翻译」：在设置页一键下载腾讯混元
HY-MT1.5-1.8B 翻译模型（Q4_K_M GGUF，约 1.1 GB，ModelScope 直连 + HuggingFace 回退，
下载完按精确字节数校验）和 llama.cpp b11932 的 CPU 推理器（各平台官方预编译包，
12–24 MB），装完自动自检（真实起服务译一句才算成功）。之后翻译完全离线、无需 API Key，
模型与推理器都装在应用私有目录，卸载按清单精确删除。llama-server 进程由应用托管：
翻译前探活复用，冷启动轮询就绪并发进度事件，应用退出时统一收掉子进程。

**Verification** — `cargo check --lib` PASS；`cargo test --lib` 12 passed / 2 ignored；
`npm run build`（tsc + vite）PASS。**联网端到端测试真机通过**（`cargo test --lib
installs_translation -- --ignored --nocapture`）：真下 1.1 GB 模型（ModelScope，约 1 分钟）→
下载 llama.cpp → 解压 → 自检（「你好，世界」→「Hello, world.」）→ 冷重启复翻
（「Hello, world!」→「大家好！」）→ 按清单卸载释放 1140 MB，全程无人工干预。

**Journey log**
- **联网端到端测试立了大功**：GitHub release 资产的 CDN 在国内直连不通
  （api.github.com 通、下载必失败），初版只用官方源必然全挂。补了 gh-proxy.com /
  ghproxy.net 双代理 + 官方回退；代理格式是「代理域名 + 完整原始 URL」，少拼
  `https://github.com/` 前缀就是 404——这条已写成单测钉死。
- 选 b11932 前核对过架构支持：模型 GGUF 的 `general.architecture` 是
  `hunyuan-dense`（本地解析 GGUF 头确认），llama.cpp 支持于 PR #14878（2025-07），
  ModelScope 社区镜像里最旧的现成包 b9893（2026-07-07）也已包含，固定 b11932 没问题。
- tar 的 `Entry` 没有 `enclosed_name()`（那是 zip crate 的 API），路径校验改用
  与 local_engine 相同的「拒绝绝对路径与 `..` 组件」手写校验。
- worktree 首次编译缺未跟踪的 `binaries/screenshot_overlay` 构建产物，从主检出拷贝
  解决（tauri 的 resource 检查硬性要求存在）。
- 模型平台映射的测试起初写成了「测试里的复制表」，重构 `llama_asset_for(os, arch)`
  让测试直接打真实现，复制表即测试盲区。
- 评审 subagent 三次因「model concurrency limit exceeded」派发失败，改为按 compose-next
  的评审清单自评审（结论记录于下）；随后以真机端到端测试补上了最有分量的验证。

## Review（自评审结论）

- Spec 合规：七条验收逐条核对 PASS——未安装翻译返回「未找到 llama-server，请先在设置里
  安装本地翻译组件」（translate_engine.rs ensure_server，错误经 App catch 显示「翻译失败：…」，
  不误报成功）；安装全程 `local-engine-progress` 事件推进、自检真译一句、清单先于自检落盘；
  安装后翻译不查 API Key（App.tsx 分发在 Key 检查前）；GGUF 字节数不符删除 `.part` 并报错；
  移除按清单删 + prune + 空壳兜底删除；`RunEvent::Exit` 调 `translate_engine::shutdown()`；
  三项构建/测试命令全绿。
- 正确性：MutexGuard 不跨 await（先取句柄状态、放手探活、spawn 后重新持锁收旧句柄）；
  端口冲突时子进程立即退出被轮询检测并报「端口 48731 未被占用」提示；双源下载失败清
  `.part`/压缩包再试下一源；并发翻译的二次 spawn 失败不影响已健康的首个服务（重试即复用）。
- 一致性：中文注释讲 why，目录布局与组件状态结构与 local_engine 对齐，安装面板样式复用
  现有 LocalComponentPanel 的视觉规范。

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

- [x] T1: `translate_engine.rs`——组件安装（双源下载、解压、清单、字节校验、自检）、状态、按清单移除 (depends: none)
- [x] T2: 服务管理——ensure_server（health 探活 + spawn + 轮询）、static 句柄、`translate_hymt` 命令、`shutdown()` (depends: T1)
- [x] T3: `lib.rs` 接线——注册模块与命令、`Status.translate`、`RunEvent::Exit` 清理 (depends: T2)
- [x] T4: 前端——plugins 入口、App 分发、Settings 安装面板与状态展示 (depends: T3)
- [x] T5: 验证（cargo test / cargo check / tsc build）+ changelog 片段 + spec 定稿 (depends: T4)

## [S4] Acceptance

- [x] 未安装时选 HY-MT 翻译并点翻译：得到「先安装」类明确提示，不 panic、不误报翻译成功
- [x] 安装流程：进度事件推进；装完自检（真实翻译一句）通过；`state/translate.json` 记录清单
- [x] 安装后翻译：设置目标语言后翻译返回译文，全程无需 API Key
- [x] GGUF 下载字节数与 1,133,080,512 不符时安装报错而不是静默通过
- [x] 移除组件后磁盘空间释放、状态回到未安装
- [x] 应用退出后 llama-server 子进程被结束（代码路径存在并有测试或断言覆盖）
- [x] `cargo test`、`cargo check`、`npm run build` 全部通过
