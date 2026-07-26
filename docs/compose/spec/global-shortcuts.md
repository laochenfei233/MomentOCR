---
feature: global-shortcuts
status: delivered
updated: 2026-07-26
branch: feat/global-shortcuts
commits: fcd17500fc489e9c21192a4f35c7c7608d773419..1800acc
---

# Global Shortcuts

## [S1] Problem

应用目前没有实现快捷键功能。App.tsx:29 注释说明 "快捷键暂未实现（global-shortcut 插件干扰消息循环，待后续修复）"。用户无法通过键盘快速触发核心操作（截图、复制、翻译），必须手动点击按钮，影响使用效率。

## [S2] Design

### 架构

- **Rust 端**: 使用 `tauri-plugin-global-shortcut` 注册/注销全局快捷键，通过 Tauri 事件系统通知前端
- **前端**: Zustand store 持久化快捷键配置，React 组件监听事件并执行操作
- **设置页面**: 新增"快捷键"配置 Tab，支持用户自定义

### 快捷键映射

| 操作 | 默认快捷键 | Tauri Event | 对应函数 |
|------|-----------|-------------|----------|
| 截图识别 | `CmdOrCtrl+Shift+S` | `global-shortcut-triggered` (action: screenshot) | `start_screenshot_overlay` |
| 复制文本 | `CmdOrCtrl+Shift+C` | `global-shortcut-triggered` (action: copy) | `navigator.clipboard.writeText` |
| 翻译 | `CmdOrCtrl+Shift+T` | `global-shortcut-triggered` (action: translate) | `handleTranslate` |

### Tauri Commands

```rust
#[tauri::command]
fn register_shortcuts(app: AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String>
// 注册所有快捷键，key 是 action 名，value 是快捷键组合

#[tauri::command]
fn unregister_all_shortcuts(app: AppHandle) -> Result<(), String>
// 注销所有已注册的快捷键
```

### 前端 Store 扩展

```typescript
// settingsStore.ts 新增
shortcuts: {
  screenshot: string;  // 默认 'CmdOrCtrl+Shift+S'
  copy: string;        // 默认 'CmdOrCtrl+Shift+C'
  translate: string;   // 默认 'CmdOrCtrl+Shift+T'
}
```

### 事件流

1. 应用启动时，前端从 store 读取快捷键配置
2. 调用 `register_shortcuts` 命令注册
3. 用户按下快捷键 → Rust 捕获 → emit `global-shortcut-triggered` 事件 (payload: { action: string })
4. App.tsx 监听事件，根据 action 执行对应操作
5. 用户在设置页面修改快捷键 → 调用 `unregister_all_shortcuts` → 重新 `register_shortcuts`

### 设置页面 UI

在 Settings.tsx 新增"快捷键" Tab，每个快捷键显示为：
- 功能名称 + 当前快捷键
- 点击可修改（监听键盘输入，显示实际按键组合）
- "恢复默认"按钮

## [S3] Out of Scope

- 不实现快捷键冲突检测（系统层面的冲突由用户自行解决）
- 不实现按住修饰键的组合（只支持简单按键组合）
- 不修改截图覆盖层的内部快捷键

## Report

**What was built** — 全局快捷键系统，允许用户通过键盘组合触发核心操作（截图、复制、翻译），即使应用在后台也能生效。Rust 端使用 tauri-plugin-global-shortcut 注册系统级快捷键，通过 Tauri 事件系统通知 React 前端执行对应操作。设置页面新增快捷键配置 Tab，支持用户自定义快捷键组合。

**Verification** — TypeScript 编译通过（零错误），Rust 编译通过（仅预存警告），所有 6 个文件到位，端到端集成验证通过。5 个 commit 对应 5 个实现任务。

**Journey log**:
- Code review 发现 partial registration bug（一个快捷键注册失败会导致之前注册的快捷键保持注册状态），通过 parse-all-then-commit + rollback 模式修复
- `Shortcut::parse()` 的错误类型是 `HotKeyParseError` 而非 `String`，需用 `.map_err(|e| ...)` 不加类型注解
- `Code` 和 `Modifiers` 导入在从字符串解析快捷键时未使用，已移除
- HashMap 迭代顺序不确定，但快捷键相互独立，不影响功能

## Tasks

- [x] T1: Rust 端 — 添加 tauri-plugin-global-shortcut 依赖，实现 register_shortcuts / unregister_all_shortcuts 命令，注册快捷键并 emit 事件 — acceptance: cargo build 通过，命令可调用 (covers: S2)
- [x] T2: 前端 Store — settingsStore 添加 shortcuts 配置及 setter — acceptance: shortcuts 配置持久化，get/set 正常工作 (covers: S2)
- [x] T3: App.tsx — 监听 global-shortcut-triggered 事件，分发到对应操作 — acceptance: 按下快捷键触发截图/复制/翻译 (covers: S2; depends: T1, T2)
- [x] T4: 设置页面 — 新增快捷键配置 Tab，支持自定义快捷键 — acceptance: 可修改快捷键，修改后立即生效 (covers: S2; depends: T2)
- [x] T5: 集成测试 — 启动应用，验证全局快捷键在不同窗口状态下都能触发 — acceptance: 截图/复制/翻译快捷键全局可用 (covers: S2; depends: T1, T3)
