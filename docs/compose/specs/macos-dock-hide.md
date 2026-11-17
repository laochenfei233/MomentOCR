---
feature: macos-dock-hide
status: designed
updated: 2026-11-17
branch: feat/macos-dock-hide
commits: 57d1ad8..（delivery 时填写）
worktree: .worktrees/macos-dock-hide
---

# macOS 可选不驻留 Dock（后台驻留）

## Report

（delivery 时填写）

## [S1] Problem

macOS 上应用默认以 Regular 策略运行：即使关闭主窗口、只在菜单栏托盘驻留，Dock 栏仍一直显示应用图标。希望提供选项：不在 Dock 栏显示，关闭窗口后软件只在后台（托盘）驻留。

## [S2] Design

### S2.1 原生：运行时切换 Dock 可见性

- 用 tauri 2.12.5 自带的 `AppHandle::set_dock_visibility(visible)`（macOS；tao 经 `TransformProcessType` 把进程切到 UIElement，Dock 与 Cmd+Tab 都不再出现，菜单栏托盘不受影响，内部带 1s 防抖）。运行时经事件循环代理投递主线程执行，命令里可直接调用。不加新依赖、不改 Info.plist。
- 新命令 `set_dock_hidden(hidden: bool)`：macOS 上 `set_dock_visibility(!hidden)`；其他平台空操作（前端可无条件调用）。注册进 `invoke_handler`。
- 不镜像到 AppState：Dock 状态只由前端显式推送，托盘菜单（截图/显示主窗口/退出）、快捷键、单实例激活等原生入口都不需要读它。

### S2.2 设置项与同步

- `settingsStore.quickAction` 增加 `dockIcon: '驻留' | '隐藏'`，默认 `'驻留'`（保持现状）。老用户 localStorage 浅合并缺键，读取处用 `|| '驻留'` 兜底（与 `translateLayout` 同模式）。
- `Settings.tsx`「快捷操作」卡片增加一行 `SelectItem`「Dock 栏」选项 `['驻留','隐藏']`，仅 macOS 显示（复用 `isMacPlatform()`，src/utils/shortcut.ts:26）。
- `App.tsx` 现有 `set_tray_behavior` 同步 effect（依赖 `[quickAction]`）内追加 `invoke('set_dock_hidden', { hidden: quickAction.dockIcon === '隐藏' })`——启动设置首载即生效，改动即时生效。

### S2.3 已知限制

- shortcut: 启动时先以 Regular 出现约 1~2s 再隐藏——设置存在 localStorage，原生侧启动时读不到；要消除需把该设置落原生持久化，现阶段不做。
- UIElement 进程下主窗口不再有 Dock/应用菜单，托盘点「显示主窗口」的置前效果与键盘输入需真机（macOS）冒烟确认；Windows 侧行为零变化（命令空操作）。

## [S3] Scope

- In scope:
  - `set_dock_hidden` 原生命令（macOS 生效、其他平台空操作）+ 设置项 + 设置界面 mac-only 开关 + 启动/改动同步 + changelog 片段
- Out of scope:
  - Info.plist LSUIElement 静态隐藏；消除启动闪现的原生持久化
  - 隐藏 Dock 时强制「关闭到托盘」（沿用用户现有「关闭软件」设置，两开关独立）
  - Windows/Linux 对应改动

## Tasks

- [ ] T1: lib.rs 增加 `set_dock_hidden` 并注册（depends: none）
- [ ] T2: settingsStore.quickAction.dockIcon + Settings.tsx mac-only「Dock 栏」行（depends: none）
- [ ] T3: App.tsx 同步 effect 追加 `set_dock_hidden` 推送（depends: T1、T2）
- [ ] T4: changelog 片段（depends: T1-T3）
- [ ] T5: 验证——cargo check/test（Windows）+ cargo check --target x86_64-apple-darwin（mac 分支类型检查）+ npm build（depends: T1-T3）

## [S4] Acceptance

- [ ] macOS：开关切到「隐藏」后 Dock 图标立即消失（Cmd+Tab 也不出现）；关闭主窗口后应用仅在菜单栏托盘可见；切回「驻留」恢复（真机冒烟由用户执行）
- [ ] Windows：cargo test 通过、npm build 通过、行为无任何变化（命令空操作）
- [ ] cargo check --target x86_64-apple-darwin 通过（mac 分支编译验证）
