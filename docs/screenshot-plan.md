# 须臾OCR 截图功能完整实施计划

> **目标：** 实现 Snipaste/天若OCR 风格的截图体验 — 点击截图 → 屏幕冻结 → 拖拽选区 → 自动OCR

---

## 一、当前问题

| 问题 | 原因 |
|------|------|
| 截图只能截到应用内部 | 应用窗口没有隐藏，截图包含了应用本身 |
| 截图画质下降 | base64 编解码 + 图片缩放导致质量损失 |
| 体验不像 Snipaste | 没有全屏覆盖窗口让用户直接在屏幕上选区 |
| 权限报错 | capabilities 配置不完整 |

## 二、技术方案

### 核心架构

```
┌─────────────────────────────────────────────┐
│                  主窗口 (main)               │
│  ┌─────────────┐  ┌─────────────────────┐   │
│  │  截图按钮    │  │    识别结果显示     │   │
│  └──────┬──────┘  └─────────────────────┘   │
│         │                                   │
└─────────┼───────────────────────────────────┘
          │ 1. invoke('start_screenshot')
          ▼
┌─────────────────────────────────────────────┐
│              Rust 后端                       │
│  1. 隐藏主窗口                              │
│  2. 全屏截图 (screenshots crate)            │
│  3. 保存截图到临时文件                       │
│  4. 创建覆盖窗口 (fullscreen + transparent) │
└─────────┬───────────────────────────────────┘
          │ 5. 显示截图
          ▼
┌─────────────────────────────────────────────┐
│           覆盖窗口 (overlay)                 │
│  ┌─────────────────────────────────────┐    │
│  │     全屏截图 (1:1 显示)              │    │
│  │  ┌──────────┐                       │    │
│  │  │ 选区框    │ ← 用户拖拽选择        │    │
│  │  └──────────┘                       │    │
│  │  [识别] [取消]  ← 工具栏             │    │
│  └─────────────────────────────────────┘    │
└─────────┬───────────────────────────────────┘
          │ 6. 用户选区完成
          ▼
┌─────────────────────────────────────────────┐
│              Rust 后端                       │
│  1. 从全屏截图中裁剪选区 (image crate)      │
│  2. 保存裁剪结果                             │
│  3. 关闭覆盖窗口                             │
│  4. 显示主窗口                               │
│  5. 发送截图路径给前端                        │
└─────────┬───────────────────────────────────┘
          │ 7. OCR 识别
          ▼
┌─────────────────────────────────────────────┐
│                  主窗口 (main)               │
│  ┌─────────────────────────────────────┐    │
│  │     识别结果显示                     │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 需要的库

#### Rust 端 (Cargo.toml)
```toml
[dependencies]
# 截图 - 捕获屏幕内容
screenshots = "0.8"

# 图像处理 - 裁剪、格式转换
image = "0.24"

# Base64 编码（备用方案）
base64 = "0.22"

# Tauri 核心
tauri = { version = "2", features = [] }

# 窗口管理插件
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"

# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# 错误处理
anyhow = "1"

# 时间戳
chrono = "0.4"
```

#### 前端 (package.json)
```json
{
  "@tauri-apps/api": "^2.0.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.20.0"
}
```

### 关键技术点

1. **多窗口管理** - Tauri 2.0 的 WebviewWindowBuilder
2. **窗口间通信** - Tauri 的事件系统 (emit/listen)
3. **全屏透明窗口** - decorations:false + transparent:true + fullscreen:true
4. **高质量截图** - PNG 无损格式，不经过 base64
5. **图像裁剪** - image crate 的 crop_imm 方法

---

## 三、实施步骤

### Phase 1: Rust 后端 - 截图与窗口管理

#### Task 1: 重写截图模块
**文件:** `src-tauri/src/screenshot.rs`

```rust
use anyhow::Result;
use screenshots::Screen;
use std::io::Cursor;
use std::path::PathBuf;
use chrono::Local;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// 全局存储最近一次截图路径
static LAST_SCREENSHOT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub struct ScreenshotManager;

impl ScreenshotManager {
    /// 全屏截图 - 高质量PNG
    pub fn capture_full_screen() -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        let screen = screens.first()
            .ok_or_else(|| anyhow::anyhow!("No screen found"))?;
        let image = screen.capture()?;
        let mut buf = Cursor::new(Vec::new());
        image.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 从全屏截图中裁剪区域 - 无损
    pub fn crop_region(
        full_screen_data: &[u8],
        x: u32, y: u32,
        width: u32, height: u32
    ) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;
        
        let img = Reader::new(Cursor::new(full_screen_data))
            .with_guessed_format()?
            .decode()?;
        
        let cropped = img.crop_imm(x, y, width, height);
        let mut buf = Cursor::new(Vec::new());
        cropped.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 保存到文件
    pub fn save_to_file(data: &[u8], path: &PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, data)?;
        Ok(())
    }

    /// 生成临时文件路径
    pub fn generate_temp_path(prefix: &str) -> PathBuf {
        let timestamp = Local::now().format("%Y%m%d_%H%M%S%3f");
        let filename = format!("{}_{}.png", prefix, timestamp);
        std::env::temp_dir().join(filename)
    }

    /// 保存截图路径供覆盖窗口使用
    pub fn set_last_screenshot(path: String) {
        *LAST_SCREENSHOT.lock().unwrap() = Some(path);
    }

    /// 获取截图路径
    pub fn get_last_screenshot() -> Option<String> {
        LAST_SCREENSHOT.lock().unwrap().clone()
    }
}
```

#### Task 2: 创建截图命令
**文件:** `src-tauri/src/lib.rs`

```rust
mod api;
mod screenshot;

use screenshot::ScreenshotManager;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Emitter};

/// 启动截图流程
#[tauri::command]
async fn start_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // 1. 全屏截图
    let data = ScreenshotManager::capture_full_screen()
        .map_err(|e| e.to_string())?;
    
    // 2. 保存到临时文件
    let path = ScreenshotManager::generate_temp_path("screenshot");
    ScreenshotManager::save_to_file(&data, &path)
        .map_err(|e| e.to_string())?;
    
    let path_str = path.to_string_lossy().to_string();
    ScreenshotManager::set_last_screenshot(path_str.clone());
    
    // 3. 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e| e.to_string())?;
    }
    
    // 4. 创建覆盖窗口
    let overlay = WebviewWindowBuilder::new(
        &app,
        "screenshot-overlay",
        WebviewUrl::App("/screenshot-overlay".into())
    )
    .title("截图")
    .fullscreen(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 裁剪选区并返回路径
#[tauri::command]
fn crop_screenshot(
    x: u32, y: u32,
    width: u32, height: u32
) -> Result<String, String> {
    // 1. 获取截图路径
    let screenshot_path = ScreenshotManager::get_last_screenshot()
        .ok_or("No screenshot available")?;
    
    // 2. 读取原始截图
    let data = std::fs::read(&screenshot_path)
        .map_err(|e| e.to_string())?;
    
    // 3. 裁剪选区
    let cropped = ScreenshotManager::crop_region(&data, x, y, width, height)
        .map_err(|e| e.to_string())?;
    
    // 4. 保存裁剪结果
    let crop_path = ScreenshotManager::generate_temp_path("crop");
    ScreenshotManager::save_to_file(&cropped, &crop_path)
        .map_err(|e| e.to_string())?;
    
    Ok(crop_path.to_string_lossy().to_string())
}

/// 关闭覆盖窗口，恢复主窗口
#[tauri::command]
async fn finish_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // 关闭覆盖窗口
    if let Some(overlay) = app.get_webview_window("screenshot-overlay") {
        overlay.close().map_err(|e| e.to_string())?;
    }
    
    // 显示主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e| e.to_string())?;
        main_window.set_focus().map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// 获取截图路径（供覆盖窗口使用）
#[tauri::command]
fn get_screenshot_path() -> Result<String, String> {
    ScreenshotManager::get_last_screenshot()
        .ok_or("No screenshot available".to_string())
}

// ... 其他 OCR/翻译命令保持不变 ...

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_screenshot,
            crop_screenshot,
            finish_screenshot,
            get_screenshot_path,
            // ... 其他命令
        ])
        .setup(|app| {
            // 全局快捷键
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::KeyQ
            );
            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                shortcut,
                move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app_handle.emit("screenshot-triggered", ());
                    }
                }
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### Task 3: 更新 Cargo.toml
```toml
[dependencies]
# 新增
once_cell = "1"
# 已有
screenshots = "0.8"
image = "0.24"
tauri = { version = "2", features = [] }
```

### Phase 2: 前端 - 截图覆盖层

#### Task 4: 创建覆盖层路由组件
**文件:** `src/screens/ScreenshotOverlay.tsx`

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';

export default function ScreenshotOverlay() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [selection, setSelection] = useState<{
    startX: number; startY: number;
    endX: number; endY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // 加载截图
    const loadScreenshot = async () => {
      const path = await invoke<string>('get_screenshot_path');
      setImageSrc(convertFileSrc(path));
    };
    loadScreenshot();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (showToolbar) return;
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    });
  }, [showToolbar]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection(prev => prev ? {
      ...prev,
      endX: e.clientX,
      endY: e.clientY
    } : null);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !selection) return;
    setIsDragging(false);
    
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    if (width > 10 && height > 10) {
      setShowToolbar(true);
    } else {
      setSelection(null);
    }
  }, [isDragging, selection]);

  const handleConfirm = useCallback(async () => {
    if (!selection) return;
    
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    // 裁剪选区
    const cropPath = await invoke<string>('crop_screenshot', { x, y, width, height });
    
    // 发送路径给主窗口
    const { emit } = await import('@tauri-apps/api/event');
    await emit('screenshot-cropped', { path: cropPath });
    
    // 关闭覆盖窗口
    await invoke('finish_screenshot');
  }, [selection]);

  const handleCancel = useCallback(async () => {
    await invoke('finish_screenshot');
  }, []);

  // ESC 取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancel]);

  const rect = selection ? {
    left: Math.min(selection.startX, selection.endX),
    top: Math.min(selection.startY, selection.endY),
    width: Math.abs(selection.endX - selection.startX),
    height: Math.abs(selection.endY - selection.startY),
  } : null;

  return (
    <div
      className="fixed inset-0 cursor-crosshair bg-black"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 截图背景 */}
      {imageSrc && (
        <img
          ref={imgRef}
          src={imageSrc}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      )}

      {/* 选区外的暗色遮罩 */}
      {rect && (
        <div
          className="absolute inset-0 bg-black/30 pointer-events-none"
          style={{
            clipPath: `polygon(
              0 0, 100% 0, 100% 100%, 0 100%, 0 0,
              ${rect.left}px ${rect.top}px,
              ${rect.left}px ${rect.top + rect.height}px,
              ${rect.left + rect.width}px ${rect.top + rect.height}px,
              ${rect.left + rect.width}px ${rect.top}px,
              ${rect.left}px ${rect.top}px
            )`
          }}
        />
      )}

      {/* 选区边框 */}
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div
            className="absolute border-2 border-blue-500 pointer-events-none"
            style={rect}
          />
          
          {/* 尺寸标签 */}
          <div
            className="absolute bg-black/80 text-white text-xs px-2 py-0.5 rounded pointer-events-none whitespace-nowrap"
            style={{
              left: rect.left + rect.width / 2,
              top: rect.top - 24,
              transform: 'translateX(-50%)'
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}

      {/* 提示文字 */}
      {!isDragging && !showToolbar && !selection && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-sm bg-black/60 px-4 py-2 rounded pointer-events-none">
          拖拽选择要识别的区域 · ESC 取消
        </div>
      )}

      {/* 工具栏 */}
      {showToolbar && rect && (
        <div
          className="absolute flex gap-1 bg-white rounded shadow-lg p-1"
          style={{
            left: rect.left + rect.width / 2,
            top: rect.top + rect.height + 8,
            transform: 'translateX(-50%)'
          }}
        >
          <button
            onClick={handleConfirm}
            className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
          >
            识别
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
```

#### Task 5: 更新主应用路由
**文件:** `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ScreenshotOverlay from './screens/ScreenshotOverlay';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/screenshot-overlay" element={<ScreenshotOverlay />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
```

### Phase 3: 前端 - 主界面集成

#### Task 6: 更新截图按钮组件
**文件:** `src/components/ScreenshotTool.tsx`

```tsx
import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      // 调用 Rust 启动截图流程
      await invoke('start_screenshot');
    } catch (err) {
      setError(String(err));
      setCapturing(false);
    }
  }, [setCapturing]);

  // 监听截图完成事件
  useEffect(() => {
    const unlisten = listen<{ path: string }>('screenshot-cropped', (event) => {
      setScreenshotPath(event.payload.path);
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
    });

    // 监听截图取消事件
    const unlistenCancel = listen('screenshot-cancelled', () => {
      setCapturing(false);
    });

    // 监听全局快捷键
    const unlistenShortcut = listen('screenshot-triggered', () => {
      handleScreenshot();
    });

    return () => {
      unlisten.then(fn => fn());
      unlistenCancel.then(fn => fn());
      unlistenShortcut.then(fn => fn());
    };
  }, [handleScreenshot, setCapturing, setScreenshotPath]);

  return (
    <div className="p-3">
      <button
        onClick={handleScreenshot}
        disabled={isCapturing}
        className="screenshot-btn"
      >
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
      </button>
      {error && (
        <div className="error-msg">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
```

### Phase 4: 配置更新

#### Task 7: 更新 Tauri 配置
**文件:** `src-tauri/tauri.conf.json`

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "须臾OCR",
        "width": 670,
        "height": 550,
        "url": "/"
      }
    ]
  }
}
```

#### Task 8: 更新权限配置
**文件:** `src-tauri/capabilities/default.json`

```json
{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main", "screenshot-overlay"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-create",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-close",
    "core:window:allow-set-fullscreen",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-decorations",
    "core:window:allow-set-skip-taskbar",
    "core:window:allow-set-focus",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
    "core:window:allow-center",
    "core:window:allow-start-dragging",
    "core:event:default",
    "core:event:allow-emit",
    "core:event:allow-listen",
    "core:webview:default",
    "core:webview:allow-create-webview-window",
    "shell:allow-open"
  ]
}
```

#### Task 9: 安装前端依赖
```bash
npm install react-router-dom
```

---

## 四、完整流程图

```
用户点击"截图" (或 Ctrl+Shift+Q)
         │
         ▼
  invoke('start_screenshot')
         │
         ├── 1. 全屏截图 (screenshots crate, PNG 无损)
         ├── 2. 保存到临时目录
         ├── 3. 隐藏主窗口
         └── 4. 创建覆盖窗口 (全屏/透明/置顶)
                    │
                    ▼
         覆盖窗口加载截图图片
                    │
                    ▼
         用户拖拽选择区域
                    │
                    ├── ESC → 取消，关闭覆盖窗口，恢复主窗口
                    │
                    ▼
         用户点击"识别"按钮
                    │
                    ▼
  invoke('crop_screenshot', { x, y, width, height })
         │
         ├── 1. 读取原始截图
         ├── 2. 裁剪选区 (image crate, PNG 无损)
         └── 3. 保存裁剪结果
                    │
                    ▼
  emit('screenshot-cropped', { path })
         │
         ├── 关闭覆盖窗口
         └── 恢复主窗口
                    │
                    ▼
         主窗口接收截图路径
                    │
                    ├── 显示截图预览
                    └── 调用 OCR 识别
                    │
                    ▼
         显示识别结果
```

---

## 五、参考项目与文档

| 项目 | 说明 | 链接 |
|------|------|------|
| 天若OCR | 截图OCR参考 | https://github.com/Topkill/tianruoocr |
| ShareX | 截图功能参考 | https://github.com/ShareX/ShareX |
| Tauri 多窗口 | 官方文档 | https://tauri.app/v2/guide/multiwindow/ |
| screenshots crate | Rust 截图库 | https://crates.io/crates/screenshots |
| image crate | 图像处理库 | https://crates.io/crates/image |
| Tauri 窗口 API | 窗口管理 | https://tauri.app/v2/reference/javascript/api/namespacewindow/ |

---

## 六、注意事项

1. **多显示器** - 需要处理多显示器坐标问题
2. **DPI 缩放** - 高DPI屏幕需要正确处理坐标
3. **性能** - 截图文件可能较大，使用文件路径而非 base64 传输
4. **清理** - 定期清理临时目录中的截图文件
5. **错误处理** - 截图失败、窗口创建失败等需要恢复主窗口
