---
feature: screenshot-selection-modes
status: designed
updated: 2026-07-26
branch: feat/screenshot-selection-modes
commits:
---

# 截图选区模式（松手即识别 / 可调整选区）

## Report

## [S1] Problem

现在截图只有一种交互：框选 → 松开鼠标 → 弹出「识别 / 取消」工具栏 → 必须点一下「识别」。
两个具体痛点：

1. **多一次点击**。OCR 本来就是「选中即想要结果」，`screenshot.autoRecognize` 默认已经是开，
   但工具栏那一下点击省不掉。对外想做到「松开鼠标直接出结果」。
2. **框选不能改**。松开之后选区就锁死了，只差几个像素也得整个重来，没有把手可以拉大拉小。

另外，「缩到托盘后再截图，结果出来时窗口不一定回到前台」——`ScreenshotTool` 只调了
`show()`，没有取消最小化、也没有抢焦点，用户可能看不到这次识别的结果。

## [S2] Design

### 真实调用链（先纠正一处误解）

截图覆盖层**不是** `src/screens/ScreenshotOverlay.tsx`。那个 React 组件是死代码：它调的
`crop_screenshot` / `get_screenshot_path` 都已经不在 `lib.rs` 的 `invoke_handler` 里，也没有
任何地方创建 label 为 `screenshot-overlay` 的窗口。真正在跑的是：

```
前端按钮 / 全局快捷键 / 托盘菜单
        │  (三条入口)
        ▼
run_screenshot_overlay(app)              src-tauri/src/lib.rs
        ▼
OverlayManager::start_overlay()          src-tauri/src/overlay.rs
        ▼  子进程
screenshot_overlay.py (PyQt5)            src-tauri/scripts/screenshot_overlay.py
        ▼  stdout 一行 JSON: {"action":"ocr","path":...} | {"action":"cancel"}
Rust 解析 → emit("screenshot-cropped"|"screenshot-cancel"|"screenshot-error")
        ▼
ScreenshotTool.tsx 监听 → 恢复主窗口 → runOcr()
```

三条入口**都**经过 `run_screenshot_overlay(app)`，所以「模式」这个设置镜像到 Rust 的
`AppState` 里最省事——和 `close_to_tray` / `show_on_tray_click` 已有的做法完全一致
（`lib.rs:19-37`、`set_tray_behavior`），不需要给每条入口单独传参。

### 模式定义（二选一，同一个设置项）

| 模式 | 设置值 | 行为 |
| --- | --- | --- |
| 现在的模式（默认） | `instantRecognize: false` | 松开鼠标 → 显示「识别/取消」工具栏 → **选区可继续调整**（拉边角放大缩小、拖内部平移）→ 点「识别」 |
| 松手即识别 | `instantRecognize: true` | 松开鼠标（选区 >10×10）→ 不显示工具栏，直接裁切并识别 |

- 默认值是 `false`：不动现有用户的手感。
- 两种模式下，结果产生时主窗口都被**显示 + 取消最小化 + 置顶夺焦点**。

### 设置项

`settingsStore.ts` 的 `screenshot` 块加一个布尔：

```ts
screenshot: {
  hideMainWindow: boolean;
  autoRecognize: boolean;
  instantRecognize: boolean;   // 新增，默认 false
}
```

**迁移注意**：zustand 的 `persist` 默认按顶层 key 浅合并，老用户 localStorage 里的
`screenshot` 对象没有这个新键，rehydrate 后该字段会是 `undefined`。`undefined` 传给 Rust 的
`bool` 参数会被 serde 拒绝，所以两处读值都要兜一下（`!!` / `?? false`），沿用本仓库既有的
读点兜底写法（如 App.tsx 里 `language.translateLayout || '下方'`）。

UI 加在「设置 → 截图 → 截图设置」卡片里，复用现成的 `CheckboxItem`：

```
[ ] 截图时隐藏主窗口
[ ] 截图后自动识别
[ ] 框选后松开鼠标直接识别（不显示工具栏）
```

### Rust 侧改动

`AppState` 加一个镜像（默认值与前端默认对齐）：

```rust
struct AppState {
    close_to_tray: AtomicBool,
    show_on_tray_click: AtomicBool,
    instant_recognize: AtomicBool,   // 新增，false
    quitting: AtomicBool,
}
```

新增两个命令：

```rust
#[tauri::command]
fn set_screenshot_mode(app: tauri::AppHandle, instant: bool);   // 前端把设置推过来

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle);                    // 复用已有的 show_main_window()
```

`focus_main_window` 只是 `show_main_window(&app)` 的薄封装。**为什么不直接在前端调
`getCurrentWindow().unminimize()`**：`core:window:allow-unminimize` 不在
`capabilities/default.json` 里，加权限要动 capabilities；而 Rust 侧的 `show_main_window()`
（`lib.rs:39-45`）早就做齐了 `show + unminimize + set_focus`，且 Rust 调用不受 JS ACL 约束。
复用它比加权限 + 在 3 个调用点重复三次 JS 调用都更短。

`run_screenshot_overlay` 读镜像后透传：

```rust
let instant = app.state::<AppState>().instant_recognize.load(Ordering::SeqCst);
let manager = OverlayManager::new(&app_handle, instant);
```

`OverlayManager` 加字段 `instant: bool`，在 `configure()` 里置位时追加 `--instant`。
`--instant` 作为命令行参数传给子进程——子进程读不到 webview 的 localStorage，这是最短的通路。

### Python 侧改动（`src-tauri/scripts/screenshot_overlay.py`）

1. `ScreenshotOverlay.__init__(self, instant=False)`，`main()` 里
   `ScreenshotOverlay('--instant' in sys.argv)`。
2. `mouseReleaseEvent`：选区合法（`>10×10`）时，`instant` 为真就直接 `self.do_ocr()`，
   否则维持现在的 `self.show_toolbar(rect)`。
3. **选区可调整**（只在工具栏模式，因为即时模式松开就结束了）：
   - `hit_test(pos)` 按归一化矩形（left/top/right/bottom）判定落在哪个把手或内部，
     容差 `HANDLE = 6` px：近左/右/上/下的组合天然给出四个角 + 四条边，内部返回移动。
   - `mousePressEvent`：命中把手/内部则进入调整态（记下 `drag_handle`、`drag_rect`），
     **不再**开始新选区；否则维持现有「重新框选」。
   - `mouseMoveEvent`：调整态下修改对应边（对应地把归一化矩形写回
     `selection_start` / `selection_end`），并把工具栏挪到新的位置。
   - `mouseReleaseEvent`：结束调整态，选区与工具栏都留着。
   - `paintEvent`：工具栏已显示时，在四个角画小方块把手，让「能拉」这件事看得见。
   - `mouseMoveEvent` 空闲时按命中结果显示缩放/移动光标。
4. **顺手修掉一个真 bug**：`show_toolbar` 里 `ocr_btn.clicked.connect(lambda: self.do_ocr(rect))`
   把当时的 rect 闭包捕获了。选区一旦能调整，这个 rect 就是过期值，点「识别」会裁到旧区域。
   改成 `self.do_ocr()` 内部用 `self.get_selection_rect()` 现取——单一事实来源，顺带少一个参数。

### 不做的事

- 不加 `core:window:allow-unminimize` 权限（复用 Rust 命令绕开）。
- 不新增结果小浮窗（用户选择复用主窗口）。
- 不删 React 里的死代码 `src/screens/ScreenshotOverlay.tsx`：与本次目标无关，属于独立清理。

## [S3] Scope

- In scope:
  - `screenshot.instantRecognize` 设置项（store + 设置页开关），默认关
  - Rust：`AppState` 镜像、`set_screenshot_mode`、`focus_main_window`、`--instant` 透传
  - Python：`--instant` 松手即识别；工具栏模式下选区可放大缩小 / 平移，工具栏跟随
  - 前端：三条入口统一遵循模式；结果产生时主窗口显示+取消最小化+置顶
  - 离屏自测脚本 `scripts/test-screenshot-overlay.py`（顶层 dev 工具目录，不进安装包）
- Out of scope:
  - 结果小浮窗、贴图、长截图、标注（属 `snipaste-screenshot` 未完成 feature 的范围）
  - 删除 React 死代码 `src/screens/ScreenshotOverlay.tsx`
  - 选区的吸附/撤销/多选，最小尺寸之外的额外约束

## Tasks

- [ ] T1: 前端设置项 — `settingsStore` 加 `screenshot.instantRecognize`（默认 false），设置页加开关 — acceptance: 开关可切换并持久化，老用户 localStorage 缺键时不出现 `undefined` — (covers: S2)
- [ ] T2: Rust 后端 — `AppState` 加 `instant_recognize` 镜像、新增 `set_screenshot_mode` 与 `focus_main_window` 两个命令、`OverlayManager` 透传 `--instant` — acceptance: `cargo check` 通过，两条命令已注册 — (covers: S2)
- [ ] T3: 前端触发与回窗 — `ScreenshotTool` 同步模式给 Rust，三个恢复窗口的地方改用 `focus_main_window` — acceptance: 结果产生时主窗口显示+取消最小化+置顶 — (covers: S2; depends: T2)
- [ ] T4: Python 覆盖层 — `--instant` 松手即识别；工具栏模式下选区可调整/扩大；`do_ocr` 改取实时选区 — acceptance: 即时模式不弹工具栏；调整后裁切的是新选区 — (covers: S2; depends: T2)
- [ ] T5: 离屏自测 — `scripts/test-screenshot-overlay.py`，QT_QPA_PLATFORM=offscreen 下覆盖模式分支、扩大选区后的裁切区域、工具栏跟随 — acceptance: 脚本退出码 0 且逐项打印 PASS — (covers: S2; depends: T4)
- [ ] T6: 全量验证 — 跑自测、`cargo check`、`npm run build` — acceptance: 三条命令均通过，输出留档 — (covers: S2; depends: T1-T5)

## [S4] Acceptance

- [ ] A1 设置 → 截图 出现「框选后松开鼠标直接识别（不显示工具栏）」，默认未勾选；切换后立即生效（无需重启）
- [ ] A2 默认模式：框选松开 → 显示工具栏；拖动边/角把手可扩大或缩小选区，拖动内部可平移；工具栏跟随选区移动
- [ ] A3 默认模式：调整选区后点「识别」，裁切的区域等于调整后的最终选区（不是松手时那个）
- [ ] A4 即时模式：松开鼠标且选区 >10×10 → 不显示工具栏，直接裁切识别；ESC 仍可取消
- [ ] A5 两种模式：识别结果产生时主窗口被显示、取消最小化、置顶到前台
- [ ] A6 界面按钮 / 全局快捷键 / 托盘「截图识别」三条入口行为一致，都遵循当前模式
- [ ] A7 `python scripts/test-screenshot-overlay.py` 退出码 0，逐项 PASS
- [ ] A8 `cargo check` 通过；`npm run build`（tsc + vite build）通过
