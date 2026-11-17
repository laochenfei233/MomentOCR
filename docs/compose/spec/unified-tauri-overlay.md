---
feature: unified-tauri-overlay
status: delivered
updated: 2026-11-18
branch: feat/unified-tauri-overlay
base: feat/snipaste-screenshot (43870f7，已包含 master 全部提交)
commits: 43870f7..fa1f967
---

# 统一 Tauri 截图覆盖层（多屏 + PyQt helper 退役）

## Report

**What was built** — 截图全链路统一到主 App 进程内的 Tauri 多屏覆盖层：启动会话时主进程用 screenshots crate 抓全部显示器（mac 上直接命中主 bundle 的「屏幕录制」授权），每屏建一个 `snipaste-overlay-{i}` 窗口（物理落位 + macOS setLevel 25/canJoinAllSpaces），选区状态以 Rust 为唯一事实源、经 `snipaste-selection` 广播给各窗口渲染，覆盖层铺满全部屏幕因此跨屏拖选无需全局鼠标钩子。instant 模式（热键/托盘/相机三入口）框选松开即识别；工具栏模式保留标注/贴图/取色/历史/长截图。跨屏裁剪按全局物理坐标无缝重建（各屏交集原样摆放，输出=选区物理尺寸）。PyQt helper 子进程整体退役：源码、构建脚本、随包二进制、CI 打包步骤、设置页「截图组件」（PyQt 运行时）全部移除，事件统一为 snipaste-ocr/cancel/error。生命周期：无截图子进程=无孤儿；会话互斥锁防连按重入；Alt+F4 关层=整会话取消；120s 空闲自动取消；退出兜底关窗。

**Verification** — cargo check / cargo clippy --all-targets / cargo test：PASS（19 passed、2 ignored 为预存联网测试；clippy 仅剩 3 个预存 warning）；npx tsc --noEmit / npx vite build：PASS。评审子代理 12 项发现全部处置：3 个 major（会话重入竞态→SESSION_LOCK compare_exchange；跨屏拼合几何错位→改全局偏移无缝拼接并同步修订 S2.4；历史回放帧 OCR 裁错内容→前端按 sourceIsHistory 路由回 snipaste_crop_region 裁显示中的帧）+ 9 个 minor（托盘异步化、失败路径统一 emit snipaste-error、焦点只给光标屏、mouseup 前广播未达的丢 up、Alt+F4 清理、SESSION_SEQ 注释、.gitignore 注释、跨屏 toast 补齐、snipaste_crop_region 复用）均修毕复验。CDP 双屏真机冒烟（4K@150% + 1080p@125% 混合 DPI）：A instant 单屏裁剪 PASS（crop 375x150 与选区一致）；B 跨屏选区+工具栏归属屏1+无缝拼合 PASS（crop 3515x325 精确等于选区物理尺寸）；C cancel 清窗 PASS；连按两次会话恰为每屏 1 个 overlay、cancel 后 0 残留。冒烟脚本在 %TEMP%\momentocr-smoke\（CDP 驱动，探针镜像广播事件，不进仓库）。

**Journey log**:
- 「拼合按最大 scale 归一」的第一版算法是从 PyQt 覆盖层的 CSS 坐标管线类比来的；在全局物理坐标管线里两屏定格图本就同一坐标系，重采样反而制造拼缝错位——评审抓出后改成全局偏移原样摆放，冒烟「公式自洽」掩盖问题的教训：期望值必须独立于实现推导。
- 跨屏拖选不需要全局鼠标钩子：覆盖层铺满全部屏幕，拖拽期间的 move/up 必然落在某个 overlay 窗口上，每个窗口都以全局坐标上报即可。mac 上全局钩子还需要辅助功能授权，这设计顺带绕开了它。
- CDP 冒烟的合成事件必须以 `#root > div`（React 容器）为目标，发到 `#root` 不冒泡给子元素；target 出现≠页面就绪，必须等 `#root > div` 存在；探针事件要镜像到 console（Runtime.consoleAPICalled），否则窗口随会话关闭后无法取证。
- 真实鼠标会污染合成事件测试（真鼠标的 mousemove 也被当拖拽上报——真实使用中这正是唯一输入源）；断言改为从探针读「实际最终选区」推算期望，实现与测试解耦。
- tauri 2 debug 构建走 devUrl，独立 exe 冒烟要 `npm run tauri dev` 而不是直接跑 target/debug 的 exe。

## [S1] Problem

macOS 端截图全黑，且每按一次热键泄漏一个孤儿进程：

1. **TCC 归属错位**：现行「截图识别」链路把抓屏放在 PyInstaller 打包的 PyQt5 helper 子进程 `screenshot_overlay` 里。macOS 只把「屏幕录制」授权给了主 App bundle（com.momentocr.app）；helper 是 ad-hoc 签名的裸可执行（无 Info.plist），TCC 身份对不上且无法单独授权 → `QScreen::grabWindow` 阻塞 ~6 秒后返回黑图，覆盖层整屏纯黑（实测同一二进制复制到 /tmp 立即正常，排除 Gatekeeper）。
2. **生命周期无兜底**：Rust 120s 超时后不 kill（`overlay.rs` 反而 `child.wait()` 阻塞等）、Python 不监听 stdin 断开、无空闲退出、主 App 退出只收 llama-server 不收截图子进程 → mac 实测 4 个孤儿（各 ~100MB、35% CPU），`replayd` 被卡死的 ScreenCaptureKit 会话打爆到 229%。
3. **用户决策**（2026-11-17）：不走"抓屏挪主 App 喂 helper"的止血路线，直接采用 Tauri+Rust 统一覆盖层——在 `feat/snipaste-screenshot` 已交付的单屏版本上扩展多屏跨屏拖选，整体退役 PyQt helper，三平台一套代码。

## [S2] Design

### S2.1 多屏捕获与会话状态（snipaste.rs）

- `capture_all_monitors(app)`：`Screen::all()` 逐屏 capture；scale 用 `app.available_monitors()` 按物理原点+尺寸匹配回填（screens crate `scale_factor` 误报 1.0 的既有对策，见分支 lib.rs:470-473）。
- 会话状态 `SESSION_MONITORS: Vec<SessionMonitor{ x, y, width, height, scale, path }>`，每屏 PNG 落临时文件；按屏取图命令 `snipaste_get_monitor_base64(index)` 供各 overlay 窗口加载自己的背景。
- 长截图维持单屏 `SESSION_MONITOR`（锁光标屏）不动；历史回放沿用环形缓冲，每会话只入队光标屏一帧（避免多屏帧污染回放序列）。

### S2.2 每屏一个 overlay 窗口（lib.rs）

- label `snipaste-overlay-{i}`（i=显示器下标）；`main.tsx` 改按 `startsWith("snipaste-overlay")` 路由；capabilities `windows` 增加 `snipaste-overlay-*`。
- 创建沿用既有物理落位手法（builder 逻辑 position 在混合 DPI 下被 tao 逐屏试探换算而落错屏的教训，分支 lib.rs:417-419）：`visible(false)` → `set_position/set_size(Physical)` → `show` → `set_focus`。
- 长截图模式维持单窗口（光标屏）。

### S2.3 跨屏选区会话（Rust 为唯一事实源）

- overlay 窗口把本地鼠标事件换算成**全局物理坐标**上报：`snipaste_select_event(kind: down|move|up, x, y)`（本地 CSS × devicePixelRatio + 本屏原点）。
- Rust 会话持 `{dragging, start, current}`，每次变更 emit `snipaste-selection` `{start, current, dragging}` 广播给所有 overlay 窗口；各窗口渲染「全局矩形 ∩ 自身视口」（遮罩/边框/尺寸标签）。覆盖层铺满全部屏幕，因此拖拽期间的 mousemove/mouseup 必然落在某个 overlay 窗口上，**无需全局鼠标钩子**（mac 上全局钩子还需要辅助功能授权，直接绕开）。
- instant 模式（URL `?mode=instant`，对应原 `--instant`）：up 时矩形 ≥10×10 或采纳窗口检测矩形 → 裁剪 + emit `snipaste-ocr` + 收尾；否则取消。工具栏模式：up 后在「选区中心所在屏」的窗口显示工具栏。
- ESC：由持有键盘焦点的 overlay 窗口捕获 → `snipaste_finish`（同一时刻只有一个 key window，与 Snipaste 单窗口行为一致）。

### S2.4 跨屏裁剪与贴图

- `crop_session_region(rect: 全局物理)`：各屏定格图本就处于同一全局物理坐标系，把每块屏与选区的交集按「交集原点 − 选区原点」原样摆放，1:1 无缝重建选区内容，输出尺寸 = 选区全局物理尺寸；不做跨屏密度重采样（密度差异是屏幕真实像素密度，重采样反而失真）。OCR 恒走它；保存/复制/贴图在「跨屏选区且非历史回放态」走它。
- 带标注导出仅在选区完整落在单屏内可用（标注是窗口局部 CSS 状态）；跨屏选区时保存/复制/贴图均 toast 提示「不含标注」。
- 历史回放态（`,/.` 切帧后）一切裁剪都路由回显示中的那帧（`snipaste_crop_region` 裁 `last_screenshot`），会话冻结图与显示内容永不错位。
- 贴图坐标：前端直接传全局物理矩形（替换原 CSS×scale 换算）。

### S2.5 生命周期与孤儿根除

- overlay 窗口全部活在主 App 进程内：主 App 退出即消失；`RunEvent::Exit` 再兜底关一遍 `snipaste-overlay-*`。
- 会话互斥锁（SESSION_LOCK compare_exchange）：抓屏+建窗的几百毫秒内再按热键直接忽略，防并发重入互相关窗。
- 热键连按（上一轮已建窗时）：`close_stale_overlays` 关闭所有 `snipaste-overlay-*` 后重建。
- 会话空闲超时：Rust 侧 120s 无指针活动自动取消（防"开着 overlay 过夜"），有活动重置。
- overlay 被 Alt+F4 等外部关闭且会话仍活着 → 整会话取消（正常收尾先清状态再关窗，不会误触）。
- 键盘焦点只给光标屏的窗口（ESC 可用性不随 Screen::all() 枚举顺序漂移）；托盘入口在异步任务里跑会话，不冻结主线程事件循环。
- 不再有截图子进程 → 孤儿进程/内存泄漏/replayd 打爆在结构上消失。

### S2.6 入口切换与 PyQt helper 退役

- 三条入口全部改走新链路：
  - `App.tsx:71` 热键 action "screenshot" → `invoke('start_snipaste', { mode: 'instant' })`
  - `ScreenshotTool.tsx:53` 相机按钮 → 同上
  - `lib.rs:156` 托盘 → Rust 直调 `start_overlay_session(app, Instant)`
- 删除：`run_screenshot_overlay`/`start_screenshot_overlay`（lib.rs:89-108）、overlay.rs 的 OverlayManager/OverlayResult/spawn 链（**保留** `scripts_dir`/`set_resource_dir`，识别脚本与 local_engine 仍需要）、`set_screenshot_mode`/`instant_recognize` 全链（模式改由 URL 参数表达）。
- 事件统一：`screenshot-cropped/cancel/error` 退役，统一 `snipaste-ocr` / `snipaste-cancel` / `snipaste-error`（App.tsx:122 已有 snipaste-ocr 接收；ScreenshotTool.tsx:65 的监听迁移）。
- 仓库清理：`src-tauri/scripts/screenshot_overlay.py`、`screenshot_selftest.py`、`scripts/test-screenshot-overlay.py`、`scripts/build-overlay.py`、`scripts/prepare-overlay.mjs`、`src-tauri/binaries/screenshot_overlay/`、`src-tauri/scripts/dist/`、tauri.conf.json 的 `bundle.resources` 中 `binaries/screenshot_overlay/` 与 `beforeBuildCommand` 的 prepare-overlay、capabilities 与 main.tsx 里死掉的 `screenshot-overlay` 分支、`src/screens/ScreenshotOverlay.tsx`。
- CI：release.yml 移除各平台 overlay 构建步骤。

### S2.7 macOS 适配

- **TCC 预检**：cfg(macos) 在启动会话时 `CGPreflightScreenCaptureAccess()`（extern "C" 直连 CoreGraphics），未授权 → emit `snipaste-error` 并提示去系统设置，不建 overlay。
- **窗口层级/Space**：cfg(macos) 经 `ns_window()` 取 NSWindow，`setLevel: 25`（盖菜单栏，对齐 Python 版常量）、`setCollectionBehavior: canJoinAllSpaces | fullScreenAuxiliary`（全屏 App 所在 Space 也能盖住）。新增 macos-only 依赖 objc2（raw msg_send，不引 objc2-app-kit）。
- **验证移交**：TCC 授权、菜单栏、全屏 App、多屏（含不同缩放的「全局物理坐标」模型在 mac point 系下的表现）真机验证只能由用户在 mac 执行，交付时给出 30 秒自检清单；本机验证 Windows 双屏 + 编译级检查（CI macos build 兜底编译正确性）。

## [S3] Out of Scope

- 贴图/标注/长截图/取色/历史的功能演进（沿用分支已交付行为）
- Linux 专门适配（无平台 shim，helper 退役同样生效）
- OCR 管线本身（识别脚本、引擎装配不动）
- macOS 签名/公证（dmg 维持未签名现状）

## Tasks

- [x] T1: snipaste.rs 多屏捕获 + SESSION_MONITORS + 按屏取图命令 (covers: S2.1)
- [x] T2: lib.rs 每屏建窗 / 关闭全部 / 退出兜底 / 空闲超时 (covers: S2.2, S2.5)
- [x] T3: snipaste_select_event 会话 + snipaste-selection 广播 + instant 收尾 (covers: S2.3)
- [x] T4: crop_session_region 跨屏裁剪 + 贴图坐标改全局 (covers: S2.4)
- [x] T5: SnipasteOverlay.tsx 多屏适配（?m=、全局坐标、广播渲染、instant 模式） (covers: S2.3; depends: T1-T3)
- [x] T6: 入口切换 + helper spawn 链删除 + 事件统一 (covers: S2.6; depends: T3)
- [x] T7: 仓库/打包/CI 清理（py、binaries、resources、prepare-overlay、死代码） (covers: S2.6; depends: T6)
- [x] T8: mac 适配 shim（TCC 预检、NSWindow level/Space） (covers: S2.7; depends: T2)
- [x] T9: 验证 — cargo clippy/test、tsc、vite build、本机双屏冒烟 (covers: S4; depends: T1-T8)

## [S4] Acceptance

- [x] A1 单屏行为不回归：框选/窗口吸附/标注/贴图/取色/历史与分支已交付行为一致
- [x] A2 双屏（4K + 1080p@125%）：每屏各出 overlay；跨屏拖选能正确裁剪（黑占比诊断 + CDP 冒烟）
- [x] A3 热键/托盘/相机三入口都走新链路；全仓库不再 spawn screenshot_overlay
- [x] A4 安装包不再携带 PyQt 覆盖层（resources 无 binaries/screenshot_overlay）
- [x] A5 生命周期：热键连按不留旧窗口；主 App 退出无残留；120s 空闲自动取消
- [x] A6 混合 DPI：125% 副屏上裁剪区域与选区一致（CSS×dpr + 物理落位手法）
- [ ] A7 mac（用户真机）：授权后截图不再黑屏且明显快于 6s；盖住菜单栏；全屏 App 所在 Space 可见；连按无孤儿进程
