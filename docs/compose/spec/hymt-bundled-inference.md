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
与标准包同发一个 draft release，**只区分安装包文件名，软件本体与标准版完全一致**）：
CI 在构建前直连 GitHub 下载 llama.cpp b11932 CPU 包解进资源目录（gitignored 构建
产物），node 从基础 tauri.conf.json 生成 override（只追加 resources），经
`tauri build --config` 构建；产物文件名仍与标准版相同（productName 未动），在
Collect 步骤统一重命名加 `-local-inference` 后缀，变体产物跳过 tauri-action 上传
（同名会撞 release 资产），改在重命名后 `gh release upload` 补传草稿。运行时侧：
Rust 按资源目录 → exe 相对路径 → CARGO_MANIFEST_DIR 探测内置推理器（每个基目录
下同时找 `resources/llama-runtime` 与裸 `llama-runtime` 两种布局），装配与启动
服务时优先内置、免下载那 23 MB；设置页按 `translate_runtime_bundled` 调整文案与
体积估算（bundled 时只按模型 1081 MB 计）。

**Verification** — `cargo test --lib` 15 passed（bundled 探测、优先级对照、
安装版布局回归测试）；`npm run build` PASS；YAML 解析通过。**真机验证抓出并修复
一个关键 bug**：首版探测只找裸 `llama-runtime`，漏掉 tauri 实际的安装布局
`<资源目录>/resources/llama-runtime`，安装版必走联网下载（用户截图实锤），已修复
并重建。变体打包的完整 CI 链路（8 job 矩阵、重命名与补传）需在下次 tag 构建时由
CI 实证。

**Journey log**
- **「按清单删文件」在半安装状态下是假移除**：用户从装到一半的旧版换装新版后，
  模型文件在而清单从未落盘，status 判定已安装、移除却释放 0 MB 且删不掉任何东西，
  界面卡在「已安装」没有下载按钮。教训：独占目录的组件卸载就用整目录删除，
  清单是为「多组件共享目录」发明的，单组件照抄就是自找状态分叉。
- **productName 是「文件名 + 软件名」的耦合开关**：最初改 productName 区分变体，
  被纠正——用户要的是只区分安装包文件名，装出来的软件必须还是 MomentOCR。
  Tauri 没有单独的安装包文件名开关，最终方案是构建用原名、产物在 Collect 步骤
  重命名；代价是变体产物不能走 tauri-action 的 release 上传（同名撞资产），
  改为手动 `gh release upload`。
- **「资源收集对了」≠「运行时找得到」**：构建时验证过 bundler 把
  `resources/llama-runtime` 收进产物，但运行时探测却按裸 `llama-runtime` 找——
  tauri 安装资源时保留 `src-tauri` 下的相对路径前缀。这类布局契约必须用「模拟
  安装布局」的回归测试钉死，而不是看构建产物目录想当然。
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

- **变体命名**：**只区分安装包文件名，不改软件名**。Tauri 的安装包文件名、安装
  目录、卸载项都由 `productName` 派生且没有单独的文件名开关，因此构建时保持
  `productName = MomentOCR`（软件本体与标准版逐字节同源），变体产物在 CI 的
  Collect 步骤统一重命名（`MomentOCR_*` → `MomentOCR-local-inference_*`，含
  rpm 的连字符命名）。两个变体安装位置、应用数据目录完全一致，互相替换等于
  覆盖升级。
- **CI**：release.yml 的 4 平台矩阵扩成 ×2（standard / local-inference 各 4 个 job）。
  local-inference job 在构建前用 runner 直连 GitHub 下载对应平台的 llama.cpp b11932
  CPU 包（runner 上不限速），解压到 `src-tauri/resources/llama-runtime/`（gitignored
  构建产物），并用 node 从基础 tauri.conf.json 生成 override（只追加
  `resources/llama-runtime/`），经 `tauri build --config` 生效。基础 conf 的
  resources 变化时 override 自动跟随，无双份维护。变体产物跳过 tauri-action 的
  release 上传（与标准版同名会撞资产），重命名后由 `gh release upload` 补传草稿
  （草稿不存在则先建）。
- **运行时解析**：Rust 侧新增内置推理器探测（资源目录 → exe 相对路径向上 3 级 →
  CARGO_MANIFEST_DIR；每个基目录下找 `resources/llama-runtime` 与裸
  `llama-runtime` 两种布局——tauri 安装资源时保留 src-tauri 下的相对路径前缀），
  `ensure_server` 优先用已下载目录、其次内置，最后才走下载。`Status` 增加
  `translate_runtime_bundled` 标记，bundled 时 `download_mb`/`disk_mb` 只按模型计
  （约 1081 MB），前端安装面板据此改提示文案。
- **标准变体的下载路径不变**：gh-proxy.com → ghproxy.net → github.com 三级回退。
- **卸载**：`local-translate/` 目录被本组件独占，移除 = 关服务 + 量体积 + 整目录
  删除。最初按「清单删文件」实现，真机踩坑后废弃：清单只在安装走完时落盘，
  装到一半换装/跨版本共享应用数据时清单缺失，移除会静默变成「释放 0 MB」的假
  移除，状态卡在已安装、无法重新下载（见 Journey log）。

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
