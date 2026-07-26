# Global Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customizable global keyboard shortcuts for Screenshot OCR, Copy, and Translate operations.

**Architecture:** Tauri 2.x global-shortcut plugin handles system-wide key capture, emits events to React frontend. Zustand store persists shortcut configuration. Settings page provides UI for customization.

**Tech Stack:** tauri-plugin-global-shortcut 2.x, Tauri 2.x event system, React, Zustand

## Global Constraints

- Tauri 2.x only (not 1.x)
- Use `CmdOrCtrl` prefix for cross-platform modifier key
- Default shortcuts: Screenshot=`CmdOrCtrl+Shift+S`, Copy=`CmdOrCtrl+Shift+C`, Translate=`CmdOrCtrl+Shift+T`
- All shortcuts must work globally (even when app is in background)

---

### Task 1: Rust Backend — Add Global Shortcut Plugin

**Covers:** [S2]

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `register_shortcuts(shortcuts: HashMap<String, String>) -> Result<(), String>`
- Produces: `unregister_all_shortcuts() -> Result<(), String>`
- Emits: `global-shortcut-triggered` event with payload `{ action: string }`

- [ ] **Step 1: Add dependency to Cargo.toml**

Add to `src-tauri/Cargo.toml` dependencies section:

```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2: Register plugin in lib.rs**

In `src-tauri/src/lib.rs`, add plugin initialization in `tauri::Builder::default()` chain:

```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

- [ ] **Step 3: Add register_shortcuts command**

Add to `src-tauri/src/lib.rs`:

```rust
use std::collections::HashMap;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn register_shortcuts(app: tauri::AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let app_handle = app.clone();
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;

    for (action, shortcut_str) in &shortcuts {
        let shortcut: Shortcut = shortcut_str.parse().map_err(|e: String| format!("Invalid shortcut '{}': {}", shortcut_str, e))?;
        let action_clone = action.clone();
        let handle = app_handle.clone();
        app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = handle.emit("global-shortcut-triggered", serde_json::json!({ "action": action_clone }));
            }
        }).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn unregister_all_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Register commands in invoke_handler**

Add to the `tauri::generate_handler![]` macro in `lib.rs`:

```rust
register_shortcuts, unregister_all_shortcuts,
```

- [ ] **Step 5: Add permissions to capabilities**

Add to `src-tauri/capabilities/default.json` permissions array:

```json
"global-shortcut:allow-register",
"global-shortcut:allow-unregister-all",
"global-shortcut:allow-is-registered",
"global-shortcut:allow-unregister"
```

- [ ] **Step 6: Verify Rust compilation**

Run: `cargo build` in `src-tauri/`
Expected: Compiles without errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: add tauri-plugin-global-shortcut with register/unregister commands"
```

---

### Task 2: Frontend Store — Add Shortcuts Configuration

**Covers:** [S2]

**Files:**
- Modify: `src/stores/settingsStore.ts`

**Interfaces:**
- Consumes: none
- Produces: `shortcuts` state with `screenshot`, `copy`, `translate` keys
- Produces: `setShortcuts` action

- [ ] **Step 1: Add shortcuts interface to SettingsState**

In `src/stores/settingsStore.ts`, add after `quickAction` interface:

```typescript
// 快捷键
shortcuts: {
  screenshot: string;
  copy: string;
  translate: string;
};
```

- [ ] **Step 2: Add default shortcuts to initial state**

In the `create` call, add after `quickAction`:

```typescript
shortcuts: {
  screenshot: 'CmdOrCtrl+Shift+S',
  copy: 'CmdOrCtrl+Shift+C',
  translate: 'CmdOrCtrl+Shift+T',
},
```

- [ ] **Step 3: Add setShortcuts action**

In the Actions section, add:

```typescript
setShortcuts: (patch: Partial<SettingsState['shortcuts']>) => void;
```

In the `create` call actions, add:

```typescript
setShortcuts: (patch) =>
  set((state) => ({ shortcuts: { ...state.shortcuts, ...patch } })),
```

- [ ] **Step 4: Verify store persistence**

Run: `npm run build` (or `bun build`)
Expected: TypeScript compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat: add shortcuts configuration to settingsStore"
```

---

### Task 3: App.tsx — Listen to Global Shortcut Events

**Covers:** [S2]

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `global-shortcut-triggered` event from Rust
- Consumes: `shortcuts` from settingsStore
- Consumes: `handleCopy`, `handleTranslate` (existing functions)
- Produces: shortcut event listener, auto-registration on mount

- [ ] **Step 1: Import listen from Tauri**

In `src/App.tsx`, add import:

```typescript
import { listen } from '@tauri-apps/api/event';
```

- [ ] **Step 2: Add useEffect for shortcut event listener**

In `App()` component, add after existing useEffect (line 21-27):

```typescript
// 全局快捷键监听
useEffect(() => {
  const unlisten = listen<{ action: string }>('global-shortcut-triggered', (event) => {
    const { action } = event.payload;
    switch (action) {
      case 'screenshot':
        invoke('start_screenshot_overlay');
        break;
      case 'copy':
        handleCopy();
        break;
      case 'translate':
        handleTranslate();
        break;
    }
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);
```

- [ ] **Step 3: Add useEffect for shortcut registration**

Add another useEffect after the event listener:

```typescript
// 注册全局快捷键
useEffect(() => {
  const registerAll = async () => {
    try {
      await invoke('register_shortcuts', { shortcuts });
    } catch (err) {
      console.error('[shortcuts] register failed:', err);
    }
  };
  registerAll();
}, [shortcuts]);
```

- [ ] **Step 4: Remove old comment**

Remove line 29: `// 快捷键暂未实现（global-shortcut 插件干扰消息循环，待后续修复）`

- [ ] **Step 5: Verify frontend compilation**

Run: `npm run build` (or `bun build`)
Expected: TypeScript compiles without errors

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: listen to global shortcut events and auto-register"
```

---

### Task 4: Settings UI — Add Shortcut Configuration Tab

**Covers:** [S2]

**Files:**
- Modify: `src/components/Settings.tsx`

**Interfaces:**
- Consumes: `shortcuts` and `setShortcuts` from settingsStore
- Produces: Settings tab with shortcut customization UI

- [ ] **Step 1: Add 'shortcuts' to SettingsTab type**

In `src/components/Settings.tsx`, line 7, change:

```typescript
type SettingsTab = 'general' | 'config' | 'screenshot' | 'api' | 'update' | 'about';
```

To:

```typescript
type SettingsTab = 'general' | 'config' | 'screenshot' | 'api' | 'shortcuts' | 'update' | 'about';
```

- [ ] **Step 2: Add tab to SETTINGS_TABS**

In `SETTINGS_TABS` array (line 9-16), add before 'update':

```typescript
{ key: 'shortcuts', label: '快捷键' },
```

- [ ] **Step 3: Add shortcuts state destructuring**

In the `store` destructuring, add `shortcuts` and `setShortcuts`:

```typescript
const {
  // ... existing destructuring ...
  shortcuts,
  setShortcuts,
} = store;
```

- [ ] **Step 4: Create ShortcutEditor component**

Add before the `PluginApiKeyConfig` component:

```tsx
function ShortcutEditor({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key;
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      parts.push(key.toUpperCase());
      onChange(parts.join('+'));
      setEditing(false);
    }
  };

  const formatShortcut = (s: string) => {
    return s.replace('CmdOrCtrl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
             .replace('Shift', '⇧')
             .replace('Alt', navigator.platform.includes('Mac') ? '⌥' : 'Alt')
             .replace(/\+/g, ' ');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <span style={{ fontSize: 13, color: '#1c1c1e' }}>{label}</span>
      <button
        onClick={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onKeyDown={editing ? handleKeyDown : undefined}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          border: `1px solid ${editing ? '#007AFF' : '#D1D1D6'}`,
          borderRadius: 8,
          background: editing ? '#F0F8FF' : '#FFFFFF',
          cursor: 'pointer',
          minWidth: 120,
          textAlign: 'center',
          outline: editing ? '2px solid rgba(0,122,255,0.3)' : 'none',
        }}
      >
        {editing ? '请按下快捷键...' : formatShortcut(value)}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Add shortcuts tab content**

In the Settings component, add the shortcuts tab case after the API tab (after line 393):

```tsx
{/* ===== 快捷键 ===== */}
{activeTab === 'shortcuts' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <SettingsCard title="全局快捷键">
      <p style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
        快捷键在应用后台也能生效。点击右侧按钮后按下新的快捷键组合。
      </p>
      <ShortcutEditor label="截图识别" value={shortcuts.screenshot} onChange={(v) => setShortcuts({ screenshot: v })} />
      <ShortcutEditor label="复制文本" value={shortcuts.copy} onChange={(v) => setShortcuts({ copy: v })} />
      <ShortcutEditor label="翻译" value={shortcuts.translate} onChange={(v) => setShortcuts({ translate: v })} />
    </SettingsCard>
  </div>
)}
```

- [ ] **Step 6: Verify frontend compilation**

Run: `npm run build` (or `bun build`)
Expected: TypeScript compiles without errors

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: add shortcut configuration tab in settings"
```

---

### Task 5: Integration Test — Verify Global Shortcuts

**Covers:** [S2]

**Files:**
- Test: manual verification steps

**Interfaces:**
- Consumes: T1 (backend), T2 (store), T3 (event listener), T4 (settings UI)

- [ ] **Step 1: Start dev server**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify default shortcuts registered**

Check console output for any registration errors. Open Settings → 快捷键 tab, verify default shortcuts display correctly.

- [ ] **Step 3: Test Screenshot shortcut**

1. Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac)
2. Expected: Screenshot overlay appears
3. Select a region, verify OCR runs

- [ ] **Step 4: Test Copy shortcut**

1. Ensure there is OCR text in the result panel
2. Press `Ctrl+Shift+C`
3. Expected: Text copied to clipboard, can paste elsewhere

- [ ] **Step 5: Test Translate shortcut**

1. Ensure there is OCR text in the result panel
2. Press `Ctrl+Shift+T`
3. Expected: Translation runs, result updates

- [ ] **Step 6: Test shortcut customization**

1. Open Settings → 快捷键
2. Click on screenshot shortcut button
3. Press new key combination (e.g., `Ctrl+Alt+S`)
4. Expected: Shortcut updates, new combination works

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "test: verify global shortcuts integration"
```
