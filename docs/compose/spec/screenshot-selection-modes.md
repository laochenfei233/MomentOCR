---
feature: screenshot-selection-modes
status: delivered
updated: 2026-07-26
branch: feat/screenshot-selection-modes
commits: 38f3edf..ac30832
---

# 截图选区模式（松手即识别 / 可调整选区）

## Report

**What was built** — 截图多了一个二选一的模式设置（设置 → 截图 → 「框选后松开鼠标直接识别」，
默认关）。默认模式保持原有手感：框选松开弹「识别 / 取消」工具栏；在此基础上选区不再锁死，四角
画出手把，拖边/角可放大缩小、拖内部可平移，工具栏跟着选区走。打开开关后则松开鼠标直接裁切识别，
不弹工具栏。

模式由 Rust 经 `--instant` 命令行参数透传给覆盖层子进程。三条入口（界面按钮 / 全局快捷键 /
托盘菜单）都在 `run_screenshot_overlay` 处读同一份 `AppState` 镜像，因此都遵循当前模式 —— 托盘
那条完全不经过前端，这是必须镜像的原因。两种模式下识别结果产生时，主窗口都会被显示、取消最小化
并置顶到前台。

顺带修掉一个真 bug：`show_toolbar` 里「识别」按钮原先闭包捕获了松手那一刻的 `rect`，选区一旦
可以调整，那就是过期值，会裁到旧区域；改为在 `do_ocr` 里现取 `get_selection_rect()`。

**Verification** — 全部在本 worktree 内跑：

| 命令 | 结果 |
| --- | --- |
| `python -B scripts/test-screenshot-overlay.py` | `10/10 通过`，exit 0 |
| `cargo test --lib` | `6 passed; 0 failed; 1 ignored`（ignored 那条是既有的） |
| `cargo check --all-targets` | exit 0 |
| `npm run build`（tsc && vite build） | exit 0 |

自测不是空测：4 次变异实验都如期失败（`self.instant` 改成 `False` → 1 条失败；`apply_drag` 开头
直接 return → 3 条失败；去掉 `sw/sh <= 0` 拦截 → 退化选区那条失败；把工具栏拿掉 → 把手绘制那条的
对照断言失败）。

**Journey log**
- 起初以为覆盖层是 `src/screens/ScreenshotOverlay.tsx`。那是死代码（它调的命令已不在
  `invoke_handler` 里，也没有任何地方创建 `screenshot-overlay` 窗口）；真正在跑的是
  `src-tauri/scripts/screenshot_overlay.py` 这个 PyQt5 子进程。
- 独立评审发现一个我没想到的 bug：`QPixmap.copy` 在宽/高为 0 时返回的是**整张画布**（实测
  800x600 的图 `copy(250,50,0,200)` 仍是 800x600 且 `save()` 成功），于是「把左边把手拖到与
  右边重合」会把整个虚拟桌面当识别结果送出去 —— 在新增的可调整选区里这是可达的。已在 `do_ocr`
  这个唯一的裁剪点拦住。
- 同一轮评审指出三处「把窗口拉回前台」挂在 `hideMainWindow` 上：那个设置只管「截图前要不要
  藏起来」，关掉它时缩到托盘的窗口不会回到前台。已改为无条件（并省掉三个分支）。
- 打包/CI 相关的 `src-tauri/Cargo.lock` 在本分支上会被任何 cargo 调用重写（HEAD 那份本就陈旧，
  已提交的 Cargo.toml 早已不含那些依赖）。属于既有问题，未纳入本分支，构建后已还原。

**Known gaps（先于本次改动就存在，本分支未处理）**
- `ScreenshotTool` 里的 `screenshot-cropped` / `-cancel` / `-error` 监听会随组件在切到「文件」
  标签页或进入设置页时卸载；那两种状态下用托盘或快捷键截图不会走识别流程，也不会回窗。修它需要
  把监听与 `doOcr` 提到 `App.tsx`，是独立改动。
- 全局快捷键那条入口直接调 `start_screenshot_overlay` 而不经过 `handleScreenshot`，所以它从不按
  `hideMainWindow` 隐藏主窗口，与界面按钮那条不一致。本次只统一了「模式」，未动这条既有差异。
- A1/A2/A5/A6 的判定基于代码走查：本环境无法启动 GUI（抓屏需要真实桌面），未做端到端点击验证。

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

- [x] T1: 前端设置项 — `settingsStore` 加 `screenshot.instantRecognize`（默认 false），设置页加开关 — acceptance: 开关可切换并持久化，老用户 localStorage 缺键时不出现 `undefined` — (covers: S2)
- [x] T2: Rust 后端 — `AppState` 加 `instant_recognize` 镜像、新增 `set_screenshot_mode` 与 `focus_main_window` 两个命令、`OverlayManager` 透传 `--instant` — acceptance: `cargo check` 通过，两条命令已注册 — (covers: S2)
- [x] T3: 前端触发与回窗 — `ScreenshotTool` 同步模式给 Rust，三个恢复窗口的地方改用 `focus_main_window` — acceptance: 结果产生时主窗口显示+取消最小化+置顶 — (covers: S2; depends: T2)
- [x] T4: Python 覆盖层 — `--instant` 松手即识别；工具栏模式下选区可调整/扩大；`do_ocr` 改取实时选区 — acceptance: 即时模式不弹工具栏；调整后裁切的是新选区 — (covers: S2; depends: T2)
- [x] T5: 离屏自测 — `scripts/test-screenshot-overlay.py`，QT_QPA_PLATFORM=offscreen 下覆盖模式分支、扩大选区后的裁切区域、工具栏跟随 — acceptance: 脚本退出码 0 且逐项打印 PASS — (covers: S2; depends: T4)
- [x] T6: 全量验证 — 跑自测、`cargo check`、`npm run build` — acceptance: 三条命令均通过，输出留档 — (covers: S2; depends: T1-T5)

## [S4] Acceptance

- [x] A1 设置 → 截图 出现「框选后松开鼠标直接识别（不显示工具栏）」，默认未勾选；切换后立即生效（无需重启）
- [x] A2 默认模式：框选松开 → 显示工具栏；拖动边/角把手可扩大或缩小选区，拖动内部可平移；工具栏跟随选区移动
- [x] A3 默认模式：调整选区后点「识别」，裁切的区域等于调整后的最终选区（不是松手时那个）
- [x] A4 即时模式：松开鼠标且选区 >10×10 → 不显示工具栏，直接裁切识别；ESC 仍可取消
- [x] A5 两种模式下识别结果产生时主窗口被显示、取消最小化、置顶到前台（不再依赖「截图时隐藏主窗口」）
- [x] A6 三条入口（界面按钮 / 全局快捷键 / 托盘「截图识别」）都遵循当前截图模式
- [x] A7 `python scripts/test-screenshot-overlay.py` 退出码 0，逐项 PASS
- [x] A8 `cargo check` 通过；`npm run build`（tsc + vite build）通过
