---
feature: unified-tauri-overlay
status: in-progress
updated: 2026-11-17
branch: feat/unified-tauri-overlay
base: feat/snipaste-screenshot (43870f7，已包含 master 全部提交)
---

# 统一 Tauri 截图覆盖层（多屏 + PyQt helper 退役）

## Report

（交付时填写）

## [S1] Problem

macOS 端截图全黑，且每按一次热键泄漏一个孤儿进程：

1. **TCC 归属错位**：现行「截图识别」链路把抓屏放在 PyInstaller 打包的 PyQt5 helper 子进程 `screenshot_overlay` 里。macOS 只把「屏幕录制」授权给了主 App bundle（com.momentocr.app）；helper 是 ad-hoc 签名的裸可执行（无 Info.plist），TCC 身份对不上且无法单独授权 → `QScreen::grabWindow` 阻塞 ~6 秒后返回黑图，覆盖层整屏纯黑（实测同一二进制复制到 /tmp 立即正常，排除 Gatekeeper）。
2. **生命周期无兜底**：Rust 120s 超时后不 kill（`overlay.rs` 反而 `child.wait()` 阻塞等）、Python 不监听 stdin 断开、无空闲退出、主 App 退出只收 llama-server 不收截图子进程 → mac 实测 4 个孤儿（各 ~100MB、35% CPU），`replayd` 被卡死的 ScreenCaptureKit 会话打爆到 229%。
3. **用户决策**（2026-11-17）：不走"抓屏挪主 App 喂 helper"的止血路线，直接采用 Tauri+Rust 统一覆盖层——在 `feat/snipaste-screenshot` 已交付的单屏版本上扩展多屏跨屏拖选，整体退役 PyQt helper，三平台一套代码。

## [S2] Design

### S2.1 多屏捕获与会话状态（snipaste.rs）

- `capture_all_monitors(app)`：`Screen::all()` 逐屏 capture；scale 用 `app.available_monitors()` 按物理原点+尺寸匹配回填（screens crate `scale_factor` 误报 1.0 的既有对策，见分支 lib.rs:470-473）。
- 会话状态 `SESSION_MONITORS: Vec<SessionMonitor{ x, y, width, height, scale, path }>`，每屏 PNG 落临时文件；按屏取图命令 `snipaste_get_monitor_base64(index)` 供各 overlay 窗口加载自己的背景。
- 长截图维持单屏 `SESSION_MONITOR`（锁光标屏）不动；历史回放沿用环形缓冲，每屏 PNG 各入队一次。

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

- `crop_session_region(rect: 全局物理)`：对每块屏求交集，按统一缩放（取相交屏的最大 scale，低 DPI 部分放大对齐——与 master PyQt 版「最大 ratio 画布」同思路）拼到一张画布 → 临时 PNG。OCR/保存/复制统一走它。
- 带标注导出仅在选区完整落在单屏内可用（标注是窗口局部 CSS 状态）；跨屏选区时标注跳过并 toast 提示。
- 贴图坐标：用选区中心落在哪块屏的 scale/origin 换算（替换现 `get_session_monitor` 单屏假设）。

### S2.5 生命周期与孤儿根除

- overlay 窗口全部活在主 App 进程内：主 App 退出即消失；`RunEvent::Exit` 再兜底关一遍 `snipaste-overlay-*`。
- 热键连按：`close_stale_overlay` 改为关闭所有 `snipaste-overlay-*`。
- 会话空闲超时：Rust 侧 120s 无指针活动自动取消（防"开着 overlay 过夜"），有活动重置。
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
- **窗口层级/Space**：cfg(macos) 经 `ns_window()` 取 NSWindow，`setLevel: 25`（盖菜单栏，对齐 Python 版常量）、`setCollectionBehavior: canJoinAllSpaces | fullScreenAuxiliary`（全屏 App 所在 Space 也能盖住）。新增 macos-only 依赖 objc2/objc2-app-kit。
- **验证移交**：TCC 授权、菜单栏、全屏 App、多屏的真机验证只能由用户在 mac 执行，交付时给出 30 秒自检清单；本机验证 Windows 双屏 + 编译级检查（CI macos build 兜底编译正确性）。

## [S3] Out of Scope

- 贴图/标注/长截图/取色/历史的功能演进（沿用分支已交付行为）
- Linux 专门适配（无平台 shim，helper 退役同样生效）
- OCR 管线本身（识别脚本、引擎装配不动）
- macOS 签名/公证（dmg 维持未签名现状）

## Tasks

- [ ] T1: snipaste.rs 多屏捕获 + SESSION_MONITORS + 按屏取图命令 (covers: S2.1)
- [ ] T2: lib.rs 每屏建窗 / 关闭全部 / 退出兜底 / 空闲超时 (covers: S2.2, S2.5)
- [ ] T3: snipaste_select_event 会话 + snipaste-selection 广播 + instant 收尾 (covers: S2.3)
- [ ] T4: crop_session_region 跨屏裁剪 + 贴图坐标改全局 (covers: S2.4)
- [ ] T5: SnipasteOverlay.tsx 多屏适配（?m=、全局坐标、广播渲染、instant 模式） (covers: S2.3; depends: T1-T3)
- [ ] T6: 入口切换 + helper spawn 链删除 + 事件统一 (covers: S2.6; depends: T3)
- [ ] T7: 仓库/打包/CI 清理（py、binaries、resources、prepare-overlay、死代码） (covers: S2.6; depends: T6)
- [ ] T8: mac 适配 shim（TCC 预检、NSWindow level/Space） (covers: S2.7; depends: T2)
- [ ] T9: 验证 — cargo clippy/test、tsc、vite build、本机双屏冒烟 (covers: S4; depends: T1-T8)

## [S4] Acceptance

- [ ] A1 单屏行为不回归：框选/窗口吸附/标注/贴图/取色/历史与分支已交付行为一致
- [ ] A2 双屏（4K + 1080p@125%）：每屏各出 overlay；跨屏拖选能正确裁剪（黑占比诊断 + CDP 冒烟）
- [ ] A3 热键/托盘/相机三入口都走新链路；全仓库不再 spawn screenshot_overlay
- [ ] A4 安装包不再携带 PyQt 覆盖层（resources 无 binaries/screenshot_overlay）
- [ ] A5 生命周期：热键连按不留旧窗口；主 App 退出无残留；120s 空闲自动取消
- [ ] A6 混合 DPI：125% 副屏上裁剪区域与选区一致（CSS×dpr + 物理落位手法）
- [ ] A7 mac（用户真机）：授权后截图不再黑屏且明显快于 6s；盖住菜单栏；全屏 App 所在 Space 可见；连按无孤儿进程
