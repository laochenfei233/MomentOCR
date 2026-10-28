---
feature: hymt-bundled-inference
status: delivered
updated: 2026-10-28
branch: feat/local-inference-variant
commits: 61b5bc4..04ccf08
worktree: .worktrees/local-inference-variant
---

# 内置 llama.cpp 推理器的安装包变体（-local-inference）

## Report

**What was built** — 发布流水线新增 `-local-inference` 安装包变体（四平台各一份，
与标准包同发一个 draft release，靠文件名区分）：CI 在构建前直连 GitHub 下载
llama.cpp b11932 CPU 包解进资源目录（gitignored 构建产物），node 从基础
tauri.conf.json 生成 override（productName 加 `-local-inference` 后缀 + resources
追加），经 `tauri build --config` 生效。运行时侧：Rust 按资源目录 → exe 相对路径 →
CARGO_MANIFEST_DIR 探测内置推理器，装配与启动服务时优先内置、免下载那 23 MB；
设置页按 `translate_runtime_bundled` 调整文案与体积估算（bundled 时只按模型 1081 MB
计）。两个变体共用 bundle identifier（应用数据目录相同，模型只需下一次）。

**Verification** — `cargo test --lib` 14 passed（新增 bundled 探测与优先级对照单测）；
`npm run build` PASS；CI 的 conf 生成片段已在本地演练并断言产物 JSON（productName、
resources 三项齐全）；YAML 解析通过。变体打包的完整链路（8 job 矩阵、NSIS/DMG/
AppImage 体积变化）需在下次 tag 构建时由 CI 实证，本地无法等价演练。

**Journey log**
- **TUNA/conda-forge 路线验证失败，评估结论反转**：conda 包里有 llama-server.exe
  （当时只验证了"存在"），但实际运行报 STATUS_DLL_NOT_FOUND——conda 构建把
  libcurl/mkl/vulkan 全部链到 conda 环境而不随包。补齐要拖整条依赖链，放弃；
  剩余国内源（gh 代理、ModelScope 个人仓库）都不比现状更好，内置打包因此成为
  消除运行时下载风险的正解。
- pefile 静态扫不出动态 LoadLibrary 的依赖（ggml 后端按名动态加载），"能运行"
  必须真跑一次才算数——`llama-server --version` 是最便宜的真跑验证。
- tauri 的 `--config` 数组字段按替换合并，生成的 override 直接携带完整 resources
  列表，规避合并语义的不确定性。

## [S1] Problem

本地翻译（HY-MT）的推理器 llama.cpp 只能在安装时联网下载，而官方 release 资产的
CDN 在国内直连不通，现有 gh 代理源速度不稳（实测几百 B/s ~ 几十 KB/s），用户首次
安装体验差且可能失败。同时评估确认：conda-forge/TUNA 镜像路线不可行（见 Journey log）。
需要一条不依赖运行时下载的获取路径，并让用户能区分两种安装包。

## [S2] Design

- **变体命名**：`productName` 改为 `MomentOCR-local-inference`，安装包文件名随之区分
  （如 `MomentOCR-local-inference_0.2.0_x64-setup.exe`）；bundle identifier 不变，
  两个变体共用同一应用数据目录（模型只需下载一次）。已知取舍：同 identifier 意味着
  两个变体不能同时运行（单实例插件按 identifier 互斥），对测试用途可接受。
- **CI**：release.yml 的 4 平台矩阵扩成 ×2（standard / local-inference 各 4 个 job）。
  local-inference job 在构建前用 runner 直连 GitHub 下载对应平台的 llama.cpp b11932
  CPU 包（runner 上不限速），解压到 `src-tauri/resources/llama-runtime/`（gitignored
  构建产物），并用 node 从基础 tauri.conf.json 生成 override（productName 补丁 +
  resources 追加 `resources/llama-runtime/`），经 `tauri build --config` 生效。
  基础 conf 的 resources 变化时 override 自动跟随，无双份维护。
- **运行时解析**：Rust 侧新增内置推理器探测（资源目录 → exe 相对路径向上 3 级 →
  CARGO_MANIFEST_DIR），`ensure_server` 优先用内置、回落到已下载目录，最后才需要
  下载路径。`Status` 增加 `translate_runtime_bundled` 标记，bundled 时
  `download_mb`/`disk_mb` 只按模型计（约 1081 MB），前端安装面板据此改提示文案。
- **标准变体的下载路径不变**：gh-proxy.com → ghproxy.net → github.com 三级回退。
- **卸载**：清单只覆盖应用数据目录，内置推理器在资源目录里不受卸载影响，天然正确。

## [S3] Scope

In scope:
- Rust：内置推理器探测 + ensure_server 优先级 + Status 标记与体积估算调整
- 前端：安装面板按 `translate_runtime_bundled` 调整文案
- CI：8 job 矩阵、llama.cpp 下载解压、config override 生成与传参、产物命名区分
- 发布说明页脚注明两种变体的区别

Out of scope:
- 标准（非变体）安装包的下载源更换（TUNA 已验证不可行，见 Journey log）
- win-arm64 等无 CI 矩阵的平台的变体打包（其下载路径不受影响）
- identifier 分离带来的双装并存支持

## Tasks

- [x] T1: Rust 内置推理器解析（bundled_runtime + ensure_server 优先级 + status 调整）(depends: none)
- [x] T2: 前端安装面板按 bundled 标记调整提示 (depends: T1)
- [x] T3: CI 变体构建链路（matrix 扩展 + prepare 步骤 + --config 传参）(depends: none)
- [x] T4: 验证（cargo test + tsc）+ changelog 片段 + spec 定稿 (depends: T1-T3)

## [S4] Acceptance

- [x] 无内置、无下载时行为不变（报「请先安装」）
- [x] 有内置推理器（模拟资源目录/exe 相对路径）时，未下载 runtime 也能起服务翻译
- [x] `Status.translate_runtime_bundled` 为 true 时前端面板显示「推理器已内置」，下载估算只含模型
- [x] 标准变体构建产物不受影响（不下载、不打包 llama-runtime，resources 列表不变）
- [x] local-inference 变体的 override conf 由基础 conf 生成，resources 含 llama-runtime 且 productName 带 -local-inference
- [x] `cargo test`、`cargo check`、`npm run build` 全部通过
