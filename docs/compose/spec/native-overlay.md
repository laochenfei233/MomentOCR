---
feature: native-overlay
status: designed
updated: 2026-11-18
branch: (未创建，实施时用 feat/native-overlay)
---

# Native Overlay（三平台原生绘制覆盖层）

## Report

（设计阶段，待实施后填写）

## [S1] Problem

截图出罩延迟在 WebView 方案下卡住：4K@150% + 1080p@125% 双屏实测 **出罩 150ms / 画面 220ms**。
拆解（`%TEMP%/momentocr-timing.log` 实测，热态）：

| 阶段 | 耗时 | 说明 |
|---|---|---|
| 抓屏（DXGI） | 42ms | 已接近硬件极限（4K 16ms + 1080p 5ms + 枚举/调度） |
| 覆盖层 show | **55ms × 2 屏** | WebView2 实例显示时的合成成本 |
| JPEG 编码（后台） | 60–80ms | 与 show 并行，不挡出罩 |

55ms/窗 是 WebView 渲染层的固定成本，已实测排除的规避手段：
- `WDA_EXCLUDEFROMCAPTURE` + 先 show 后抓屏：BitBlt 会把被遮区域挖黑，overlay 铺满全屏 = 抓黑图；
- 预热 show/hide：无效（不是首次成本，每次 show 都 55ms）；
- Tauri 无 `set_opacity`，无法做透明预热；
- 把 focus 延后 30ms：只省了 ~10ms。

mac（WKWebView）与 Linux（WebKitGTK）同样有渲染层显示成本，量级待真机确认；平台无关的优化（预创建复用、后台编码、JPEG、同步出罩、事件驱动取图）已经全部生效，三平台共享。

目标：**三平台「按键 → 出罩」≤ 80ms**（原生窗口 show 约 10–20ms）。

## [S2] Design

### S2.1 分层：只把热路径改原生

覆盖层上有两类东西，延迟敏感度完全不同：

- **热路径（按键瞬间就要看到、随鼠标实时变化）**：冻结帧背景、选区外暗罩、选区边框、尺寸标签、提示文字。
- **冷路径（用户松手之后才出现）**：工具栏（标注工具/颜色/线宽/保存/复制/贴图/识别/取消）、取色放大镜、历史回放提示、长截图按钮。

设计结论：
- **instant 模式**（框选松开即识别，无工具栏）全程原生 → 达成 80ms；
- **toolbar 模式**：松手后由 native 层隐藏、再弹一个**小号 WebView 工具栏窗口**（只包住工具栏 + 已裁剪的选区图），标注/导出逻辑完全复用现有 React 代码；
- 取色器、历史回放留在 WebView 工具栏窗口里（这些都需要指示性 UI，且不参与出罩时延）。

这样避免重画标注/工具栏（工作量最大的部分），把原生化限制在"画背景 + 画框 + 收鼠标/键盘"。

### S2.2 架构：平台无关的 overlay 抽象

`src-tauri/src/overlay_native/mod.rs` 定义统一接口：

```rust
pub struct OverlayRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }  // 全局物理坐标

pub enum OverlayEvent {
    Down { x: f64, y: f64 },   // 全局物理坐标
    Move { x: f64, y: f64 },
    Up { x: f64, y: f64 },
    Cancel,                    // ESC / 右键
}

pub trait OverlaySurface: Send {
    /// 建窗（不显示）。初始化成本必须能在预热阶段付掉。
    fn create(monitor: &MonitorInfo) -> anyhow::Result<Self> where Self: Sized;
    /// 显示冻结帧 + 暗罩（<= 20ms 目标）
    fn show_with_frame(&mut self, frame: &Frame) -> anyhow::Result<()>;
    /// 更新选区（每帧鼠标移动调用，必须廉价：只重绘受影响区域或整窗）
    fn update_selection(&mut self, selection: Option<OverlayRect>);
    fn hide(&mut self);
    /// 阻塞取事件（平台事件循环），超时返回 None
    fn next_event(&mut self, timeout: Duration) -> Option<OverlayEvent>;
}
```

会话接线沿用现有 Rust 事实源：原生层把 Down/Move/Up 直接喂给
`snipaste::selection_down/move/up`（替代 WebView 的 `snipaste_select_event` 命令），
选区矩形仍由现有多屏会话逻辑统一计算与跨屏裁剪，不动。

### S2.3 Windows：Direct2D + 原生 HWND

- 窗口：`WS_POPUP`，扩展样式 `WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`（toolwindow 保证不进任务栏；noactivate 避免抢焦点 —— 但仍需接收键盘 ESC，见风险 R3）。
- 每块屏一个窗口，物理坐标落位（沿用 `PhysicalPosition/PhysicalSize` 的既有教训）。
- 绘制：`ID2D1HwndRenderTarget`；背景帧由 BGRA 数据创建 `ID2D1Bitmap`（`D2D1_BITMAP_PROPERTIES` + `DXGI_FORMAT_B8G8R8A8_UNORM`，零通道转换）。
- 暗罩：选区外四块矩形，`#000` 80% alpha；选区框：2px `#007AFF`；尺寸标签：DWrite 文本 + 圆角矩形底。
- 事件：`WM_LBUTTONDOWN/MOUSEMOVE/LBUTTONUP`、`WM_KEYDOWN(VK_ESCAPE)`、`WM_RBUTTONUP`。
- 预期：`CreateWindowEx + ShowWindow` 5–15ms；D2D/DWrite 首次初始化 ~30ms（预热阶段做）。
- 依赖：现有 `windows` crate 增加 feature `Win32_Graphics_Direct2D`、`Win32_Graphics_DirectWrite`（`Direct2D_Common` 视需要）。

### S2.4 macOS：NSWindow + CALayer

- 窗口：`NSWindow`（borderless、`setLevel: 25`、`canJoinAllSpaces | fullScreenAuxiliary`）—— 直接复用现有 `mac_overlay_chrome` 的层级/Space 处理。
- 绘制：`CALayer.contents = CGImage`（冻结帧）；暗罩用 `CAShapeLayer`（even-odd 路径挖洞）；选区框 `CAShapeLayer`；尺寸标签 `CATextLayer`。
- 事件：自定义 `NSView` 子类覆写 `mouseDown:/mouseDragged:/mouseUp:/keyDown:`；窗口 `acceptsFirstResponder = YES`。
- 依赖：`objc2` + `objc2-app-kit` + `objc2-foundation` + `objc2-core-graphics`（当前只引了裸 `objc2`）。
- 预期：`orderFront:` + 首帧 layer 提交约 10–20ms。

### S2.5 Linux：X11 + cairo

- 窗口：override-redirect 的顶层窗口（`override_redirect = True`，`_NET_WM_STATE_ABOVE`），每屏一个，物理坐标。
- 绘制：`cairo_xlib_surface`；背景帧用 `cairo_image_surface_create_for_data`（BGRA 直接 wrap，注意 stride/ARGB 预乘）。
- 暗罩/边框：cairo path + `CAIRO_FILL_RULE_EVEN_ODD`；文字用 cairo toy API（避免额外依赖 pango）。
- 事件：X11 事件循环（`XNextEvent` 阻塞 + 超时用 `select`）。
- **Wayland：不做**（需要 layer-shell 协议或 portal 授权，且当前 Wayland 支持未验证）；检测到 Wayland 直接回退 WebView overlay。
- 依赖：`x11-dl`（或 `x11rb`）+ `cairo-rs`。
- 预期：map + 首次 expose 约 15–25ms。

### S2.6 后端选择与降级

- 启动预热时探测：尝试创建原生后端；成功 → `native`，失败 → `webview`（现有实现原样保留）。
- 配置覆盖：设置里加隐藏项 `MOMENTOCR_OVERLAY_ENGINE=native|webview`（环境变量，不暴露 UI 开关），便于出问题时一键回退。
- 两条路径共用：抓屏（DXGI / CGDisplayCreateImage / XShm）、会话状态、跨屏裁剪、编码、OCR 管线、历史回放缓冲。

### S2.7 toolbar 模式的工具栏窗口

- 松手（Up）后：原生层隐藏 → Rust 创建/复用一个**小号 WebView 窗口**（label `snipaste-toolbar`），尺寸包住工具栏（约 720×48 逻辑像素），定位在选区下方（沿用现有 `availableGeometry` 夹取逻辑）。
- 该窗口显示：裁剪后的选区图（标注画布）+ 现有 React 工具栏（`SnipasteOverlay` 的工具条部分抽成组件复用）。
- 标注导出、保存、复制、贴图、OCR 全部走现有命令，行为不变。
- 这个窗口同样预创建 + 复用（它不在热路径上，150ms 也够用，但预创建顺手）。

## [S3] Scope

- **In scope**：三平台原生覆盖层的背景/暗罩/选区/尺寸标签；instant 模式接线；toolbar 模式「原生选区 + WebView 工具栏」分层；后端探测与回退；出罩计时埋点
- **Out of scope**：Wayland 原生覆盖层（回退 WebView）；标注/取色/历史的原生化（留在工具栏窗口）；贴图窗口与长截图的 UI；OCR 管线；mac 签名/公证

## Tasks

- [ ] T1: 抽象层与接线 — `overlay_native` trait、事件桥接到现有选区会话、引擎探测与 `MOMENTOCR_OVERLAY_ENGINE` 回退 (covers: S2.2, S2.6)
- [ ] T2: Windows Direct2D 实现 — 建窗/绘制/事件/预热，4K+1080p 混合 DPI 真机验证 (covers: S2.3; depends: T1)
- [ ] T3: macOS NSWindow+CALayer 实现 — 层级/Space 复用、CGImage 背景、事件覆写，真机验证 (covers: S2.4; depends: T1)
- [ ] T4: Linux X11+cairo 实现 — override-redirect 窗口、BGRA wrap、事件循环；Wayland 回退 (covers: S2.5; depends: T1)
- [ ] T5: toolbar 模式分层 — 小号 WebView 工具栏窗口（预创建复用）、工具栏组件抽取、定位夹取 (covers: S2.1, S2.7; depends: T1)
- [ ] T6: 验证 — 三平台出罩计时（≤80ms）、功能回归（跨屏拖选/窗口吸附/ESC/取消/标注/贴图/OCR） (covers: S4; depends: T2-T5)

## [S4] Acceptance

- [ ] A1 Windows 双屏（4K+1080p）instant 出罩 ≤80ms（`%TEMP%/momentocr-timing.log` 的 `windows shown` 行）
- [ ] A2 跨屏拖选、窗口吸附、尺寸标签实时跟随、ESC 取消，行为与当前 WebView 版一致
- [ ] A3 mac / Linux 出罩显著低于当前值（具体阈值真机测一轮后写回本节）
- [ ] A4 原生后端初始化失败时自动回退 WebView overlay，功能与现在完全一致
- [ ] A5 toolbar 模式：松手后工具栏正常弹出，标注/保存/复制/贴图/OCR 全通，标注导出不受原生层影响
- [ ] A6 预创建的覆盖窗口不出现在桌面/任务栏（Windows 已验证过一次的坑，mac/Linux 同项检查）

## 风险与工作量

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 三套渲染代码维护 | 原生绘制无法共享 WebView 的 UI 代码 | 只做热路径（S2.1），工具栏仍是 React；三平台实现各约 300–500 行 |
| R2 交互细节回归 | 选区吸附/拖拽手感、光标样式、尺寸标签在原生层的表现 | T6 逐项回归；保留 WebView 引擎作 A/B 对照 |
| R3 Windows 键盘焦点 | `WS_EX_NOACTIVATE` 窗口拿不到 `WM_KEYDOWN`（ESC 需要） | 二选一：不设 NOACTIVATE（可能抢焦点）或注册全局热键转发 ESC；T2 实测后定 |
| R4 mac 权限与 Space | 原生窗口同样受 TCC/菜单栏层级约束 | 复用已验证的 level 25 + collectionBehavior，T3 真机确认 |
| R5 Linux 发行版差异 | X11 路径在 GNOME/KDE 下 override-redirect 行为差异；Wayland 不可用 | 明确 Wayland 回退；X11 只承诺主流 WM |
| R6 构建依赖增加 | cairo / x11 / Direct2D feature、mac 的 objc2 子 crate | 依赖都走已有生态，CI 需三平台编译验证 |

**工作量估算**：T1 0.5 天；T2 1 天；T3 1 天；T4 0.5 天；T5 0.5 天；T6 0.5 天 → **约 3–4 个工作日**（含真机回归）。

**推荐实施顺序**：T1 → T2（先把 Windows 打到 80ms 并拿到 A1 证据）→ T5（让 toolbar 模式也能用）
→ T3 / T4（按用户实际使用平台排优先级）。
