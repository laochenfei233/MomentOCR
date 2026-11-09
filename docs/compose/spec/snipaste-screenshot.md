---
feature: snipaste-screenshot
status: delivered
updated: 2026-11-09
branch: feat/snipaste-screenshot
commits: 4da549d..5152dac
---

# Snipaste Screenshot

## Report

**What was built** — 本轮对齐 Snipaste 2.11.3 补齐两处缺陷与四组能力。缺陷修复：①贴图创建链路（原来前端只 emit 无人监听，贴图功能整体不可用），改为 Rust 侧 `snipaste_create_pin` 创建 `pin-{id}` 窗口 + `PIN_IMAGES` 状态表按 label 取回数据；②DPI 坐标链（物理像素截图 vs CSS 选区），捕获改为光标所在显示器、overlay/贴图窗口全部物理坐标落位、前端统一 CSS×devicePixelRatio 换算，附带修好失效的"复制到剪贴板"（arboard）。新能力：贴图体验包（1/2 旋转、3/4 镜像、Ctrl+滚轮透明度、鼠标穿透 + Alt+P 全局恢复、双击隐藏 + 主窗口贴图面板恢复、Alt 取色）、截图取色器（C 键放大镜，HEX+RGB 单击复制）、窗口自动检测（EnumWindows + DWM 扩展边界，悬停高亮、单击吸附）、贴图上标注（空格进入，共享绘制引擎）与历史回放（`,`/`.` 最近 10 帧环形缓冲）。期间将 master（PyQt5 覆盖层架构、tauri 2.12.5、托盘）并入分支并重新挂接 snipaste 模块，消除分支与 master 的 20 个提交分叉。

**Verification** — cargo check / cargo clippy --all-targets / cargo build：PASS（0 error，3 个 warning 为 master 预存于 local_engine/translate_engine）；cargo test：PASS（21 passed，含新增历史环形缓冲单测）；npx tsc --noEmit：PASS（0 error，合并 master 后分支原有预存错误一并消失）；npx vite build：PASS。评审子代理两轮发现的问题（退出路径主窗口不恢复、截图入口不可达、双击隐藏死代码、混合 DPI overlay 落错屏、取色缓存读旧帧、Alt+P 注册失败静默、标注与变换错位）均已修复并复验。

**第三轮（2026-11-09，S2.13）** — 用户测试包反馈后落地：相机「截图识别」恒为框选松开即识别（删除「截图后自动识别」「框选后松开鼠标直接识别」两个设置项，set_screenshot_mode 恒 instant）；「截图贴图」保持工具栏流程。OCR 结果归位：snipaste-ocr/stitched/screenshot-cropped 三事件触发自动切到「截图识别」标签页，贴图标签页只留贴图面板。CDP 冒烟自抓一个 bug：setTab 误放在监听器注册处（只跑一次），移入事件回调后验证 activeTab 正确切为「截图识别」。测试包已重打（MomentOCR_0.3.2-snipaste-test_x64-setup.exe）。

**T8 真机冒烟（2026-11-07，CDP 驱动 4K@150% 真机）** — 暴露并修复 6 个静态评审不可能发现的缺陷：①`snipaste_create_pin` 同步命令在主线程建窗 → Tauri 派发回主线程自锁死锁（用户侧表现为"一点贴图全应用冻结"，即最初"按钮不能操作"的根因），改 async；②`screens` crate 的 `scale_factor` 在该机误报 1.0，改用 Tauri `monitor_from_point` 的 DPI 感知值；③capability `windows` 漏了 `snipaste-overlay`/`pin-*`，ACL 拒绝 outer_position/set_size/start_dragging；④PinWindow 容器 `height:100%` 因 #root 无高度塌陷，改 fixed；⑤`resizable(false)` 与无装饰组合下 setSize 原生崩溃（进程静默重启），移除该约束；⑥startDragging 原生循环吞掉第二次点击，双击隐藏改自计时 400ms。修复后实测通过：贴图创建/1:1 落位（CSS(400,300,600,350)×1.5=(600,450,900,525) 物理，页面渲染与屏幕像素一致）、旋转往返（900×525↔525×900）、双击隐藏+面板恢复、窗口检测命令（EnumWindows+DWM 返回合理矩形）、历史回放（前后帧 base64 往返）、ESC 恢复主窗口（用户实际操作中多次触发）、剪贴板写入。未逐键实测（代码路径同已验证项）：透明度 Ctrl+滚轮、翻转 3/4、Alt 取色完整链路、贴图上标注绘制。

**Journey log**:
- 第一轮 spec 标记 delivered 但贴图链路从未打通（emit 无监听者）——"集成测试"任务一直没勾就是这个原因；本轮以 T8 真机冒烟为唯一遗留。
- master 已把 OCR 截图重构为 PyQt5 独立覆盖层子进程，snipaste 分支仍走 WebView overlay——两套架构并存，后续如要统一，snipaste 的选区/标注需迁到 PyQt5 覆盖层或保持双轨。
- tao 对 builder 逻辑 position 的逐屏试探换算在混合 DPI 下会落错显示器，任何跨屏窗口都必须 build 后 `set_position(Physical)` 精确落位（overlay 与贴图窗口都踩过）。
- Qt .qm 语言文件被 Snipaste 作者加密（非标准 magic、无 zlib 流），字符串级能力枚举不可行，改用官方特性页 + 安装目录侦察。
- 分支落后 master 20 个提交导致 Logo 缺失等预存错误，先合并 master 再做能力开发，冲突集中在 lib.rs 的双架构交界处。
- T8 用 CDP（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223）驱动真机：页面级事件坐标即 CSS 视口坐标，绕开了跨 DPI 合成输入的换算泥潭；屏幕像素证据（CopyFromScreen）与页面渲染证据（Page.captureScreenshot）对照才能区分"页面没画"和"窗口没画"。另：Tauri v2 自定义命令不走 ACL，但 core:window 系列走——新窗口 label 必须进 capability，否则 window API 全被拒且只在控制台报错。

## [S1] Problem

当前应用的截图功能仅服务于 OCR 识别，缺乏独立的截图工具。用户需要：
1. **长截图**：自动滚动页面并拼接多张截图，用于捕获超出屏幕的内容
2. **贴图**：将截图钉在屏幕上作为参考，支持拖拽、缩放、关闭
3. **标注**：在截图上添加箭头、矩形、文字等标注
4. **保存/复制**：将截图保存到文件或复制到剪贴板

这些功能参考 Snipaste，但需要与现有 OCR 功能分离，作为独立入口。

## [S2] Design

### 第二轮：对齐 Snipaste 能力（2026-11-07 修订）

对照 Snipaste 2.11.3（官方特性页 + 本机安装侦察）发现两处缺陷与四组缺失能力，本轮补齐。用户已确认全部四组范围。

### S2.6 缺陷修复：贴图创建链路

现状：`handlePin` 仅 `emit('snipaste-create-pin')`，全仓库无监听者，`pin-*` 窗口永远不会创建；`snipaste_create_pin` 命令只存临时文件即返回。另：overlay 用 `convertFileSrc`（asset 协议）加载背景，但 `tauri.conf.json` 未启用 `assetProtocol`，图片加载也会失败。

设计：
- `snipaste_create_pin(image_data, x, y, width, height)` 在 Rust 侧完成全部工作：base64 解码 → 存临时 PNG → 以 `pin-{id}` 为 label 用 `WebviewWindowBuilder` 创建窗口（`always_on_top`、无装饰、skip_taskbar、位置=overlay 传来的 CSS 坐标、尺寸=选区 CSS 尺寸）。
- 图片数据不走 URL 参数/asset 协议：Rust 侧 `PIN_IMAGES` 状态表保存 `id → {base64, x, y, w, h}`；`PinWindow` 启动后按自身 label `invoke('snipaste_get_pin_image')` 取数据（data URL 显示）。
- PinWindow 拖拽改用 `getCurrentWindow().startDragging()`（原生拖拽，替换手写 mousemove）。

### S2.7 缺陷修复：DPI 坐标映射

现状：截图为物理像素，overlay 选区/裁剪用 CSS 像素且无换算，在 125% 缩放混合 DPI 屏上选区偏移；多屏并排拼接的坐标系也是错的。

设计：
- 捕获范围改为**光标所在显示器**（`screens` crate 的 DisplayInfo 含物理 bounds；用 Tauri `cursor_position` 匹配），废弃多屏横向拼接路径。
- overlay 窗口定位到该显示器（物理原点/scale → 逻辑 position + size），不用 `fullscreen(true)`，用无装饰置顶窗口精确覆盖。
- overlay 背景 `img` 以 100vw×100vh 显示物理像素图（与显示器逻辑尺寸一一对应）；选区 CSS 坐标 × `window.devicePixelRatio` = 物理坐标，在**前端**统一换算后再调用 `snipaste_crop_region` 等命令。
- 背景加载改走 `snipaste_get_screenshot_base64`（data URL），彻底移除 asset 协议依赖。

### S2.8 贴图体验包

对齐 Snipaste Paster 的窗口操作（GIF 相关除外）：
- `1` 逆时针 / `2` 顺时针旋转 90°，`3`/`4` 水平/垂直镜像 —— 纯 CSS transform 状态机。
- `Ctrl+滚轮` 调透明度 10%–100%；普通滚轮缩放（保持现有）。
- 鼠标穿透：hover 工具栏开关，`window.set_ignore_cursor_events(true)`；全局快捷键 `Alt+P` 为所有贴图关闭穿透（唯一恢复入口，避免窗口失联）。
- **双击改为隐藏**（对齐 Snipaste），`×`/Esc 仍关闭。隐藏的贴图在主窗口 snipaste 标签页的"贴图"面板列出（`snipaste_list_pins`），可显示或关闭——这是可恢复性要求，不算贴图管理器。
- `Alt` 在贴图上取色：复用取色器组件（S2.9），数据源为贴图自身图像。

### S2.9 截图取色器

- overlay 内按 `C` 进入取色模式：光标处放大镜（canvas `drawImage` 关闭平滑，约 15×15 像素网格，10× 放大），中央像素实时显示 HEX 与 RGB。
- 单击复制 HEX 到剪贴板并提示；`C`/Esc 退出回选区模式。数据源为已加载的物理像素背景图（无需重复截屏）。
- 实现为独立模块 `src/lib/colorPicker.ts`，贴图取色（S2.8）复用。

### S2.10 窗口自动检测

对齐 Snipaste"自动检测界面元素区域"，只做窗口级（控件级 UIA 不做）：
- 新增依赖 `windows` crate（`Win32_UI_WindowsAndMessaging`、`Win32_Graphics_Dwm`）。
- 命令 `snipaste_detect_window(x, y)`（物理坐标入参）：`EnumWindows` 枚举可见窗口，过滤 cloaked（`DWMWA_CLOAKED`）、toolwindow、自身进程窗口；取 `DWMWA_EXTENDED_FRAME_BOUNDS` 矩形，返回包含光标点的最上/最小窗口矩形。
- overlay 交互：未开始拖拽时 mousemove 高亮候选窗口（物理矩形/scale → CSS 显示）；单击直接采纳该窗口为选区，按下拖拽则自由选区（Snipaste 同款行为）。

### S2.11 贴图上标注

- 提取 overlay 绘制引擎为共享模块 `src/lib/annotations.ts`（drawAnnotation 及各工具绘制函数），overlay 与 PinWindow 共用。
- PinWindow 内 `空格` 进入/退出标注模式：支持 画笔/箭头/矩形/文字/荧光笔（不含马赛克/模糊），标注为视觉层（随贴图关闭丢弃，不导出）。
- 进入标注/取色模式时先把贴图视图归位（缩放/旋转/镜像复位、窗口尺寸还原），画布与取样始终在图像原始坐标系上进行；模式期间滚轮与旋转快捷键屏蔽。

### S2.12 历史回放

- `SnipasteManager` 维护最近 10 张截图路径环形缓冲（每轮捕获入队）。
- overlay 内 `,`/`.` 在历史帧间切换背景（切换时清空选区与标注），支持从更早的截图重新选区；长截图续拍的帧同样入队。
- 已知限制：历史帧可能来自另一台显示器，切到尺寸/缩放不同的帧后，CSS×dpr 映射不再精确（B8，真机冒烟关注项）。

### S2.13 快速识别与结果归位（2026-11-09 第三轮）

用户安装测试包后反馈两点，已确认方案：

1. **两个入口分工**：相机「截图识别」恒为框选松开即识别（不弹工具栏，原 `instantRecognize` 行为变成唯一行为）；「截图贴图」保持工具栏流程（标注/贴图/保存/复制）。设置页删除「截图后自动识别」与「框选后松开鼠标直接识别」两个选项（行为唯一化，无开关必要）。
2. **OCR 结果归位**：识别完成（snipaste-ocr / snipaste-stitched / screenshot-cropped）自动切到「截图识别」标签页显示结果；「截图贴图」标签页只放贴图面板，不再堆 OCR 结果。

### S2.6 缺陷修复：贴图创建链路

### 架构
```
┌─────────────────────────────────────────────────────────┐
│                    主窗口 (main)                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ┌──────┐  ┌──────┐  ┌──────────┐  ┌──────┐   │   │
│  │  │ 截图 │  │ 文件 │  │ 长截图   │  │ 贴图 │   │   │
│  │  └──────┘  └──────┘  └──────────┘  └──────┘   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ invoke('start_snipaste')
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Rust 后端                                   │
│  1. 全屏截图 (screenshots crate)                        │
│  2. 隐藏主窗口                                          │
│  3. 创建覆盖窗口 (fullscreen + transparent)             │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│           覆盖窗口 (snipaste-overlay)                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │     全屏截图 (1:1 显示)                          │   │
│  │  ┌──────────┐                                    │   │
│  │  │ 选区框   │ ← 用户拖拽选择                     │   │
│  │  └──────────┘                                    │   │
│  │  [标注] [保存] [复制] [贴图] [OCR] [取消]        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 窗口管理

| 窗口 | Label | 用途 | 生命周期 |
|------|-------|------|----------|
| 主窗口 | `main` | 应用主界面 | 常驻 |
| 截图覆盖窗口 | `snipaste-overlay` | 截图选区 + 标注 | 临时 |
| 贴图窗口 | `pin-{id}` | 钉在屏幕上的截图 | 直到关闭 |

### 长截图实现

**自动滚动拼接流程：**

1. 用户触发长截图 → 全屏截图当前视图
2. 创建覆盖窗口，显示当前截图
3. 覆盖窗口底部显示"滚动页面后点击继续"
4. 用户滚动页面 → 再次全屏截图
5. 对比新旧截图，找到重叠区域（通过图像特征匹配）
6. 裁剪重叠部分，拼接新截图到底部
7. 重复步骤 3-6 直到用户点击完成
8. 将拼接后的长图发送到标注/保存流程

**重叠检测算法：**
- 使用 Rust `image` crate 的像素比较
- 从新截图顶部向下扫描，找到与旧截图底部匹配的行
- 匹配阈值：95% 像素相似度（容差 ±5）

### 标注工具

| 工具 | 功能 | 快捷键 |
|------|------|--------|
| 箭头 | 绘制带箭头的线段 | A |
| 矩形 | 绘制矩形框 | R |
| 文字 | 在指定位置添加文字 | T |
| 马赛克 | 对区域添加马赛克效果 | M |
| 撤销 | 撤销上一步标注 | Ctrl+Z |

### 贴图功能

**贴图窗口属性：**
- `always_on_top: true`
- `decorations: false`（无边框）
- `transparent: true`
- 可拖拽（通过鼠标事件实现）
- 可缩放（鼠标滚轮）
- 可关闭（双击或 ESC）

**贴图状态管理：**
```typescript
interface PinState {
  id: string;
  imageData: string;  // base64 编码的截图
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
```

### Tauri Commands

```rust
#[tauri::command]
async fn start_snipaste(app: tauri::AppHandle) -> Result<(), String>
// 启动截图流程

#[tauri::command]
async fn start_long_screenshot(app: tauri::AppHandle) -> Result<(), String>
// 启动长截图流程

#[tauri::command]
fn crop_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String>
// 裁剪选区

#[tauri::command]
fn stitch_screenshots(paths: Vec<String>) -> Result<String, String>
// 拼接多张截图

#[tauri::command]
fn create_pin_window(image_data: String, x: f64, y: f64) -> Result<(), String>
// 创建贴图窗口

#[tauri::command]
fn save_screenshot(data: Vec<u8>, path: Option<String>) -> Result<String, String>
// 保存截图到文件

#[tauri::command]
fn copy_image_to_clipboard(path: String) -> Result<(), String>
// 复制图片到剪贴板

#[tauri::command]
fn ocr_screenshot(path: String) -> Result<String, String>
// OCR 识别截图
```

### 前端 Store

```typescript
// snipasteStore.ts
interface SnipasteState {
  // 截图状态
  isCapturing: boolean;
  screenshotPath: string | null;
  
  // 长截图状态
  isLongScreenshot: boolean;
  longScreenshotPaths: string[];
  currentStitchedPath: string | null;
  
  // 标注状态
  activeTool: 'arrow' | 'rectangle' | 'text' | 'mosaic' | null;
  annotations: Annotation[];
  
  // 贴图管理
  pins: PinState[];
  
  // Actions
  startCapture: () => void;
  addAnnotation: (annotation: Annotation) => void;
  undoAnnotation: () => void;
  createPin: (imageData: string, x: number, y: number) => void;
  removePin: (id: string) => void;
}
```

### 快捷键映射

| 操作 | 默认快捷键 | Tauri Event |
|------|-----------|-------------|
| 截图 | `CmdOrCtrl+Shift+S` | `snipaste-triggered` (action: screenshot) |
| 长截图 | `CmdOrCtrl+Shift+L` | `snipaste-triggered` (action: long-screenshot) |

### UI 设计

**截图覆盖窗口工具栏：**
- 位置：选区下方居中
- 样式：跟随现有应用风格（浅色背景，圆角，阴影）
- 布局：工具图标 + 分隔线 + 操作按钮

**贴图窗口：**
- 无边框，可拖拽
- 右上角关闭按钮（hover 显示）
- 底部缩放滑块（hover 显示）

## [S3] Out of Scope

- 不实现贴图持久化（重启后贴图消失）
- 不实现贴图管理器
- 不实现翻译功能（已有独立翻译入口）
- 不实现视频录制
- 不实现 OCR 结果的二次编辑

## Tasks

- [x] T1: Rust 后端 — 实现截图裁剪、拼接、保存、剪贴板复制命令 — acceptance: cargo build 通过，命令可调用 (covers: S2)
- [x] T2: Rust 后端 — 实现贴图窗口创建和管理 — acceptance: 可创建贴图窗口，支持拖拽和关闭 (covers: S2; depends: T1)
- [x] T3: 前端 Store — 创建 snipasteStore，管理截图、长截图、标注、贴图状态 — acceptance: 状态管理正常，get/set 工作 (covers: S2)
- [x] T4: 前端 — 实现截图覆盖窗口 (SnipasteOverlay)，支持选区、标注工具栏 — acceptance: 可拖拽选区，工具栏显示正确 (covers: S2; depends: T3)
- [x] T5: 前端 — 实现长截图流程，支持自动滚动拼接 — acceptance: 可连续截图并自动拼接 (covers: S2; depends: T4)
- [x] T6: 前端 — 实现贴图窗口组件 (PinWindow)，支持拖拽、缩放、关闭 — acceptance: 贴图可拖拽，滚轮缩放，双击关闭 (covers: S2; depends: T2, T3)
- [x] T7: 前端 — 主应用添加入口按钮，更新路由和权限配置 — acceptance: 点击入口可启动截图流程 (covers: S2; depends: T4)
- [x] T8: 集成测试（CDP 驱动的真机冒烟，2026-11-07 由 agent 执行并修复暴露缺陷） — 启动应用，验证截图、标注、贴图、长截图功能 — acceptance: 所有功能端到端可用 (covers: S2; depends: T1-T7)
- [x] T9: 修复贴图创建链路 — Rust 侧创建 `pin-{id}` 窗口，PIN_IMAGES 状态表 + `snipaste_get_pin_image`，前端移除 asset 协议依赖 — acceptance: 截图后点"贴图"出现置顶贴图窗口并显示所选内容 (covers: S2.6; depends: none)
- [x] T10: DPI 坐标修正 — 光标屏捕获、overlay 定位到对应显示器、CSS↔物理坐标换算、背景改 data URL — acceptance: 125% 缩放屏上裁剪区域与选区一致 (covers: S2.7; depends: T9)
- [x] T11: 贴图体验包 — 旋转/镜像/透明度/鼠标穿透/双击隐藏/Alt 取色 + 主窗口贴图恢复面板 — acceptance: 快捷键与面板操作均生效，隐藏贴图可恢复 (covers: S2.8; depends: T9)
- [x] T12: 截图取色器 — `C` 进入放大镜取色，单击复制 HEX — acceptance: 放大镜实时跟随光标，复制的颜色与像素一致 (covers: S2.9; depends: T10)
- [x] T13: 窗口自动检测 — `windows` crate 枚举 + DWM 扩展边界，hover 高亮、单击吸附 — acceptance: 悬停时高亮光标下窗口，单击选中该窗口区域 (covers: S2.10; depends: T10)
- [x] T14: 贴图上标注 — 提取共享绘制引擎，空格在贴图内切换标注模式（画笔/箭头/矩形/文字/荧光笔）— acceptance: 贴图内可绘制标注且随窗口缩放一致 (covers: S2.11; depends: T9)
- [x] T15: 历史回放 — 截图环形缓冲，`,`/`.` 切换历史帧 — acceptance: 按键后背景切换为上一张截图且可重新选区 (covers: S2.12; depends: T10)
- [x] T17: 设置项删除 + 截图识别恒为快速识别 — settingsStore/Settings.tsx 删两个选项，set_screenshot_mode 常开 instant，ScreenshotTool 移除 autoRecognize 门 (covers: S2.13; depends: none)
- [x] T18: OCR 结果自动切回截图标签页 — snipaste-ocr/stitched/screenshot-cropped 三个事件触发 setTab('screenshot') (covers: S2.13; depends: none)
- [x] T16: 验证 — cargo clippy/test、tsc、cargo build 全部通过 — acceptance: 全绿 (covers: S2.6-S2.12; depends: T9-T15)

## [S4] Acceptance（第二轮新增）

- [ ] A1: 点"贴图"后屏幕出现置顶贴图窗口，内容与选区一致（S2.6/T9）
- [ ] A2: 125% DPI 下裁剪/保存/贴图/OCR 内容与所选区域一致（S2.7/T10）
- [ ] A3: 贴图支持 1/2/3/4 旋转镜像、Ctrl+滚轮透明度、Alt 取色（S2.8/T11）
- [ ] A4: 贴图可开启鼠标穿透且 `Alt+P` 可整体恢复交互；双击隐藏后可在主窗口面板恢复显示（S2.8/T11）
- [ ] A5: 截图 overlay 按 C 出现放大镜，单击复制正确 HEX（S2.9/T12）
- [ ] A6: overlay 悬停高亮窗口、单击吸附窗口矩形，拖拽仍可自由选区（S2.10/T13）
- [ ] A7: 贴图按空格进入标注模式，五种工具可用，再按空格退出（S2.11/T14）
- [ ] A8: overlay 按 `,`/`.` 切换历史截图帧（S2.12/T15）
- [x] A9: 相机「截图识别」框选松开即出结果、无工具栏；设置页无「截图后自动识别」「框选后松开鼠标直接识别」两项（S2.13/T17）
- [x] A10: 任意入口识别完成后主窗口自动停在「截图识别」标签页；贴图标签页只有贴图面板（S2.13/T18）
