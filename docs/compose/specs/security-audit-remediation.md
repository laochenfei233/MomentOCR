---
feature: security-audit-remediation
status: designed
updated: 2026-11-25
branch: feat/security-remediation
commits: 2a281d6..(delivery 时回填)
---

# 安全审计修复（run-1 全部 10 条 + 加固包）

## Report

（交付时回填）

## [S1] Problem

安全审计 run-1（`C:\Users\chenfei\security-audit-skill\MomentOCR\run-1\REPORT.md`，基于 dfdeecf，核心代码行号在 2a281d6 未变）产出 10 条 needs_validation 级问题，全部源于"WebView→原生"与"下载→执行"两类边界缺少控制：48 个 IPC 命令无 ACL、窗口插件命令无按目标授权、loopback 推理通道无对端认证、运行时与 CI 两条下载-执行链无完整性校验、OCR 命令可读任意文件并外传、两条任意路径写、更新检查的镜像元数据直达系统浏览器、临时屏幕截图游离在清理范围外。用户要求全部修复，并顺带完成审计列出的全部加固项。

## [S2] Design

总原则（ponytail）：每条用最小改动封住边界；不新增配置项；不破坏既有功能流（截图/贴图/识别/翻译/本地引擎安装全部保持可用）；国内镜像优先的下载策略保留，只加完整性校验。

### S2.1 运行时下载完整性（指纹 runtime-provisioning.download-execute-no-independent-integrity）
- `local_engine.rs::download()` 增加 `expected_sha256: &str` 参数，流式 sha256 校验，不符即删文件并报错（新增依赖 `sha2`）。
- `runtime_urls()` 改为 (url, sha256) 常量表：Windows embeddable（python.org 官方哈希页取值）、mac/linux 4 个 standalone 归档（ astral-sh 发布资产）。
- `fetch_latest_wheel()`：用同一 PEP 691 响应里的 `digests.sha256` 校验下载的 wheel（绑定字节↔索引元数据，封住下载路径替换）。
- `translate_engine.rs`：llama.cpp 4 平台资产、两个 GGUF 档位各 pin sha256 常量，下载后校验（GGUF 现有字节数检查保留为快速失败）。
- 摘要来源独立于下载通道：GitHub API 资产 digest 字段（llama.cpp）、HF/ModelScope API 元数据（GGUF）、python.org 哈希页（embeddable）；直连不通时用两个独立镜像交叉比对，出处写入代码注释。
- 残留（记录不修）：rapidocr/onnxruntime 仍为镜像 index 浮动版本信任（`--require-hashes` 需全依赖树哈希，不可行）；镜像优先顺序保留（国内可达性优先）。

### S2.2 CI 打包校验（指纹 release-ci.llama-runtime.unverified-download）
- `release.yml` Prepare 步为 4 个 llama.cpp 资产加 sha256 常量（与 S2.1 同值，注释互指），curl 后 `sha256sum -c` 式校验，不符 fail-closed。

### S2.3 loopback 对端认证（指纹 loopback-llama-server-no-peer-auth）
- `translate_engine.rs`：每次 ensure_server 生成随机 token（新增依赖 `rand`）；spawn 追加 `--api-key <token>`；healthy() 改为两段探测——GET /health 存活 + GET /v1/models 带 Bearer token 验所有权；存活但鉴权失败 → 不复用，尝试 spawn，端口被占则报可操作错误（"48731 被残留 llama-server 占用，请结束该进程"）；do_chat 全部带 Bearer token。

### S2.4 应用命令 ACL（指纹 app-commands-without-acl-permissions）
- 新增 `src-tauri/permissions/` 应用权限（按命令组分：main 全量、overlay 集、pin 集），能力清单按窗口类别拆成 main / snipaste-overlay-* / pin-* 三份。
- 能力收敛：`core:webview:allow-create-webview-window`（无 JS 使用）全删；`global-shortcut:*` 插件权限全删（前端只用 register_shortcuts 命令，Rust 侧注册不走该 ACL）；`shell:allow-open` 仅 main 保留。
- 命令体内补目标校验：`snipaste_toggle_mouse_through`/`snipaste_set_pin_visible`/`snipaste_close_pin` 增加"调用方窗口 label"规则（main 可管任意 pin；pin-* 只能操作自己；overlay 不可调用）。

### S2.5 窗口插件最小化 + 自目标操作（指纹 window-plugin-permissions-without-label-scope）
- 事实（已核实）：SnipasteOverlay 只用 `outerPosition()`（自读）；PinWindow 只用 setSize/close/startDragging（均为自操作）。
- 新增自目标命令（注入 `window: tauri::Window` 即调用者自身，天然不可指向别窗）：`snipaste_pin_resize(width,height)`、`snipaste_pin_close()`、`snipaste_pin_start_drag()`；PinWindow.tsx 改调这三个命令。
- 能力：pin-* 与 snipaste-overlay-* 移除全部破坏性 core:window 授权（close/hide/set-position/set-size/set-fullscreen/set-always-on-top/start-dragging）；overlay 保留 allow-outer-position（自读坐标）；main 保留全量。

### S2.6 OCR 文件读绑定（指纹 ocr-image-path-arbitrary-read-outbound-exfil）
- AppState 增加规范路径允许表：`select_image_files` 的返回路径、`save_temp_files` 的落盘路径写入；OCR 命令（ocr_paddleocr/ocr_rapidocr/ocr_openai/ocr_ollama/ocr_custom_vision/ocr_claude）入口统一校验：canonicalize 后必须位于受管临时目录（S2.10 的 `%TEMP%\moment_ocr`）或命中允许表，否则报"仅允许识别会话图片或用户选择的文件"。
- 会话捕获路径因 S2.10 全部落入受管目录，天然通过；拖放文件经 save_temp_files 落受管目录；用户从对话框选择的文件走允许表。

### S2.7 save_temp_files 服务端命名（指纹 save-temp-files-path-join-traversal-write）
- 不再用调用方 name 拼路径：服务端生成 `img_<时间戳>_<序号>.<ext>`，ext 从调用方名字取并白名单（png/jpg/jpeg/gif/webp/bmp，缺省 png）；返回路径语义不变。

### S2.8 snipaste_save_screenshot 去 path 参数（指纹 snipaste-save-screenshot-caller-path-write）
- 命令签名删去 `path: Option<String>`，恒走桌面默认名；SnipasteOverlay.tsx 两处调用同步删除该键。

### S2.9 更新检查本地拼 URL（指纹 update-check.gh-proxy-json-into-shell-open）
- `updateCheck.ts`：保留直连 + gh-proxy 回退（国内可达性）；对返回的 `tag_name` 做 `^v?\d+\.\d+\.\d+$` 严格校验，不合法即按"无更新"处理；不再消费响应里的 `html_url`，发布页 URL 一律本地拼 `https://github.com/laochenfei233/MomentOCR/releases/tag/<tag>`；App.tsx / Settings.tsx 改用返回的 url。

### S2.10 临时产物收拢（指纹 src-tauri.temp-artifacts.outside-clear_temp_cache-scope）
- `generate_temp_path()` 改为落入 `%TEMP%\moment_ocr\`（save_to_file 已会建父目录）；`timing_log`/`geom_log` 同样写入该目录。
- `clear_temp_cache` 语义不变（删整个 moment_ocr），从此名实相符；OCR 历史文本同时被前端清空，不存在悬空引用（历史 PNG 本就无删除路径，收拢后随清理一起消失，与 UI 承诺一致）。

### S2.11 加固包（用户选定"全做"）
- CI：所有第三方 action 由 tag 改 pin commit SHA（实现时经两个独立渠道查证 SHA；查不到可靠值的保留 tag 并注释说明）。
- `installer.nsh`：taskkill 由按映像名改为按安装路径（PowerShell `Get-Process llama-server | Where Path -like "$INSTDIR*" | Stop-Process -Force`），不再误杀全机同名进程。
- `.gitignore` 补 `.env`/`.env.*`；`git rm --cached hotkey-log.txt logo_debug.png`。
- 删除本地陈旧未跟踪的 `src-tauri/tauri.local-inference.conf.json`（CI 会重新生成；本机构建走标准变体）。
- `tauri.conf.json`：`csp` 设为 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: ws://localhost:1421 http://localhost:1421`（覆盖 GitHub/gh-proxy fetch、dev HMR；实现时按实际资源引用微调）；删除 `devtools: true`（回到默认：debug 开、release 关）；`withGlobalTauri: false`（已核实 src/index.html 零引用）。

## [S3] Scope
- In scope：上述 S2.1–S2.11；相关前端调用点同步修改；新增/调整单元测试；`npm run build` 与 `cargo test --lib` 通过。
- Out of scope：4 条 rejected 候选（不做改动）；api.rs 错误信息截断、target_lang urlencode、redirect policy、max_tokens 钳制（审计 hardening 中未列入本次选定范围的项）；macOS 代码签名；更新器插件；任何功能变化。

## Tasks
- [ ] T1: download() 摘要校验 + runtime/wheel/llama/GGUF 摘要常量与获取（联网取数并交叉核对） (depends: none) covers: S2.1
- [ ] T2: release.yml llama.cpp 资产 sha256 校验 (depends: T1) covers: S2.2
- [ ] T3: loopback token 认证（spawn/probe/do_chat） (depends: none) covers: S2.3
- [ ] T4: 临时产物收拢（generate_temp_path + 日志入受管目录） (depends: none) covers: S2.10
- [ ] T5: save_temp_files 服务端命名 + OCR 读绑定（允许表 + 受管目录校验） (depends: T4) covers: S2.6, S2.7
- [ ] T6: snipaste_save_screenshot 去 path 参数 + 前端调用点 (depends: none) covers: S2.8
- [ ] T7: 应用权限定义 + 三份能力清单拆分 + 自目标 pin 命令 + 命令内 label 规则 (depends: none) covers: S2.4, S2.5
- [ ] T8: updateCheck tag 校验 + 本地拼 URL + 调用点 (depends: none) covers: S2.9
- [ ] T9: 加固包（CI SHA pin、installer.nsh、.gitignore、调试文件、陈旧 conf、CSP/devtools/withGlobalTauri） (depends: none) covers: S2.11
- [ ] T10: 验证收口：npm ci + npm run build + cargo test --lib（含新增单测）+ 手动冒烟（dev 起一次截图/识别/翻译流） (depends: T1-T9)

## [S4] Acceptance
- [ ] `save_temp_files` 传 `../x` 或绝对路径时，文件仍落在 `%TEMP%\moment_ocr` 内（服务端命名生效）
- [ ] OCR 命令对非会话、非用户选择路径（如 `C:\Users\...\secret.txt`）返回错误且不发起网络请求
- [ ] overlay 窗口 invoke `snipaste_toggle_mouse_through{label:'main'}` 被拒；pin 窗口对其他 pin 同样被拒
- [ ] pin/overlay 能力清单中不含 core:window 的 close/hide/set-position/set-size/set-fullscreen/set-always-on-top/start-dragging，也不含 create-webview-window 与 global-shortcut
- [ ] pin 窗口尺寸调整/拖动/关闭经新命令正常工作（功能不回退）
- [ ] 127.0.0.1:48731 上无 token 的 /health 应答不会被复用为翻译后端；带正确 token 的探测可复用自身 server；翻译功能正常
- [ ] bootstrap wheel 内容与索引 sha256 不符时安装失败并删除文件
- [ ] release.yml 含 4 个 llama.cpp 资产的 sha256 校验步骤；local_engine/translate_engine 含全部下载件的摘要校验
- [ ] 更新检查对 `tag_name: "999.0.0-not-a-semver"` 不导航；合法 tag 打开的 URL 恒为 github.com 本仓 releases 地址
- [ ] 触发一次截图后 `clear_temp_cache` 能删掉全部截图 PNG 与 timing/geom 日志
- [ ] `npm run build`、`cargo test --lib`、`npx tsc --noEmit` 全部通过；dev 模式冒烟：截图→OCR→翻译→贴图 流程可用
- [ ] release tauri.conf.json：csp 非 null、无 devtools: true、withGlobalTauri: false，且 dev 冒烟不受影响
