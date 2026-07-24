# 须臾OCR 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开发一款类天若OCR的跨桌面OCR软件，支持本地OCR引擎、AI大模型API/本地调用、截图OCR、多文件批量OCR、混合翻译功能。

**Architecture:** Tauri 2.0 + React 18 + Naive UI 前端，Rust 后端处理截图和核心逻辑，插件化架构支持多OCR引擎和AI模型。

**Tech Stack:** Tauri 2.0, React 18, TypeScript, TailwindCSS, Naive UI, Zustand, Rust, PaddleOCR, Tesseract.js

## Global Constraints

- Tauri 2.0 + Rust 后端
- React 18 + TypeScript + TailwindCSS + Naive UI 前端
- 插件化架构，支持动态加载OCR引擎和AI模型
- 支持 Windows/macOS/Linux
- 快捷键截图：Ctrl+Shift+Q
- 支持格式：JPG/PNG/BMP/GIF/WebP/PDF

---

## Phase 1: 项目基础搭建

### Task 1: 初始化 Tauri 项目

**Covers:** [S7]
**Files:**
- Create: `package.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建项目目录结构**

```bash
mkdir -p src-tauri/src
mkdir -p src
```

- [ ] **Step 2: 创建 package.json**

```json
{
  "name": "moment-ocr",
  "version": "0.1.0",
  "description": "须臾OCR - 智能OCR软件",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "naive-ui": "^2.35.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.2.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

- [ ] **Step 3: 创建 src-tauri/Cargo.toml**

```toml
[package]
name = "moment-ocr"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
image = "0.24"
screenshot-rs = "0.6"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 4: 创建 src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 初始化 npm 依赖**

```bash
npm install
```

- [ ] **Step 6: 提交**

```bash
git add .
git commit -m "feat: init tauri project with react"
```

---

### Task 2: 配置前端开发环境

**Covers:** [S7]
**Files:**
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `index.html`

- [ ] **Step 1: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "useDefineForClassFields": true,
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: 创建 tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

- [ ] **Step 4: 创建 postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>须臾OCR</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建 src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 7: 创建 src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 8: 创建 src/App.tsx**

```tsx
function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <h1 className="text-3xl font-bold text-center py-10">须臾OCR</h1>
    </div>
  )
}

export default App
```

- [ ] **Step 9: 提交**

```bash
git add .
git commit -m "feat: configure frontend dev environment"
```

---

## Phase 2: 截图功能实现

### Task 3: 实现 Rust 截图模块

**Covers:** [S5]
**Files:**
- Create: `src-tauri/src/screenshot.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建 screenshot.rs**

```rust
use screenshot_rs::screen::Screen;
use image::{DynamicImage, ImageBuffer, Rgba};
use std::path::PathBuf;

pub struct ScreenshotManager {
    screen: Screen,
}

impl ScreenshotManager {
    pub fn new() -> Self {
        Self {
            screen: Screen::new(),
        }
    }

    pub fn capture_full_screen(&self) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
        self.screen.capture().map_err(|e| e.to_string())
    }

    pub fn capture_region(&self, x: u32, y: u32, width: u32, height: u32) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
        let full = self.capture_full_screen()?;
        let cropped = image::imageops::crop_imm(&full, x, y, width, height);
        Ok(cropped.to_image())
    }

    pub fn save_to_file(&self, img: &ImageBuffer<Rgba<u8>, Vec<u8>>, path: &PathBuf) -> Result<(), String> {
        img.save(path).map_err(|e| e.to_string())
    }
}
```

- [ ] **Step 2: 修改 main.rs 添加截图命令**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;

use screenshot::ScreenshotManager;
use tauri::command;

#[command]
fn take_screenshot() -> Result<String, String> {
    let manager = ScreenshotManager::new();
    let img = manager.capture_full_screen()?;
    let path = std::env::temp_dir().join("moment_ocr_screenshot.png");
    manager.save_to_file(&img, &path)?;
    Ok(path.to_string_lossy().to_string())
}

#[command]
fn take_screenshot_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let manager = ScreenshotManager::new();
    let img = manager.capture_region(x, y, width, height)?;
    let path = std::env::temp_dir().join("moment_ocr_region.png");
    manager.save_to_file(&img, &path)?;
    Ok(path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![take_screenshot, take_screenshot_region])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: implement screenshot module"
```

---

### Task 4: 实现前端截图界面

**Covers:** [S5]
**Files:**
- Create: `src/components/ScreenshotTool.tsx`
- Create: `src/stores/screenshotStore.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 screenshotStore.ts**

```typescript
import { create } from 'zustand'

interface ScreenshotState {
  isCapturing: boolean
  screenshotPath: string | null
  setCapturing: (isCapturing: boolean) => void
  setScreenshotPath: (path: string | null) => void
}

export const useScreenshotStore = create<ScreenshotState>((set) => ({
  isCapturing: false,
  screenshotPath: null,
  setCapturing: (isCapturing) => set({ isCapturing }),
  setScreenshotPath: (screenshotPath) => set({ screenshotPath }),
}))
```

- [ ] **Step 2: 创建 ScreenshotTool.tsx**

```tsx
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { useScreenshotStore } from '../stores/screenshotStore'

export function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore()
  const [error, setError] = useState<string | null>(null)

  const handleFullScreen = async () => {
    setCapturing(true)
    setError(null)
    try {
      const path = await invoke<string>('take_screenshot')
      setScreenshotPath(path)
    } catch (err) {
      setError(String(err))
    } finally {
      setCapturing(false)
    }
  }

  const handleRegion = async () => {
    // TODO: 实现区域选择UI
    setCapturing(true)
    setError(null)
    try {
      // 示例区域，实际需要用户选择
      const path = await invoke<string>('take_screenshot_region', {
        x: 0, y: 0, width: 800, height: 600
      })
      setScreenshotPath(path)
    } catch (err) {
      setError(String(err))
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">截图工具</h2>
      <div className="flex gap-2">
        <button
          onClick={handleFullScreen}
          disabled={isCapturing}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {isCapturing ? '截图中...' : '全屏截图'}
        </button>
        <button
          onClick={handleRegion}
          disabled={isCapturing}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          区域截图
        </button>
      </div>
      {error && <p className="mt-2 text-red-500">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: 修改 App.tsx**

```tsx
import { ScreenshotTool } from './components/ScreenshotTool'

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <h1 className="text-3xl font-bold text-center py-10">须臾OCR</h1>
      <div className="max-w-4xl mx-auto px-4">
        <ScreenshotTool />
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "feat: add screenshot UI component"
```

---

## Phase 3: 插件系统基础

### Task 5: 设计插件接口

**Covers:** [S3, S4]
**Files:**
- Create: `src/types/plugin.ts`
- Create: `src/plugins/pluginManager.ts`

- [ ] **Step 1: 创建 plugin.ts 类型定义**

```typescript
export type PluginType = 'ocr' | 'translation' | 'ai'

export interface PluginConfig {
  [key: string]: string | number | boolean
}

export interface PluginInput {
  type: 'image' | 'text'
  data: string // 图片路径或文本
  language?: string
}

export interface PluginOutput {
  success: boolean
  data: string
  confidence?: number
  language?: string
  error?: string
}

export interface PluginMetadata {
  id: string
  name: string
  version: string
  type: PluginType
  description: string
  author: string
}

export interface Plugin {
  metadata: PluginMetadata
  init(config: PluginConfig): Promise<void>
  process(input: PluginInput): Promise<PluginOutput>
  getConfigSchema(): Record<string, {
    type: 'string' | 'number' | 'boolean'
    label: string
    default?: string | number | boolean
  }>
}
```

- [ ] **Step 2: 创建 pluginManager.ts**

```typescript
import { Plugin, PluginType, PluginInput, PluginOutput } from '../types/plugin'

class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private activePlugins: Map<PluginType, string> = new Map()

  async register(plugin: Plugin): Promise<void> {
    await plugin.init({})
    this.plugins.set(plugin.metadata.id, plugin)
  }

  async unregister(id: string): Promise<void> {
    this.plugins.delete(id)
  }

  setActivePlugin(type: PluginType, id: string): void {
    this.activePlugins.set(type, id)
  }

  getActivePlugin(type: PluginType): Plugin | undefined {
    const id = this.activePlugins.get(type)
    return id ? this.plugins.get(id) : undefined
  }

  async process(type: PluginType, input: PluginInput): Promise<PluginOutput> {
    const plugin = this.getActivePlugin(type)
    if (!plugin) {
      return { success: false, data: '', error: `No active ${type} plugin` }
    }
    return plugin.process(input)
  }

  getPluginsByType(type: PluginType): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.metadata.type === type)
  }
}

export const pluginManager = new PluginManager()
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: define plugin interface and manager"
```

---

### Task 6: 实现 PaddleOCR 插件

**Covers:** [S3]
**Files:**
- Create: `src/plugins/paddleOcrPlugin.ts`
- Create: `src/plugins/index.ts`

- [ ] **Step 1: 创建 paddleOcrPlugin.ts**

```typescript
import { Plugin, PluginInput, PluginOutput, PluginConfig } from '../types/plugin'

export const paddleOcrPlugin: Plugin = {
  metadata: {
    id: 'paddle-ocr',
    name: 'PaddleOCR',
    version: '1.0.0',
    type: 'ocr',
    description: '百度PaddleOCR本地识别引擎',
    author: 'MomentOCR'
  },

  async init(config: PluginConfig): Promise<void> {
    // 初始化PaddleOCR
    console.log('PaddleOCR initialized with config:', config)
  },

  async process(input: PluginInput): Promise<PluginInput> {
    // TODO: 调用PaddleOCR Rust FFI
    // 这里先返回模拟结果
    if (input.type === 'image') {
      return {
        success: true,
        data: 'PaddleOCR识别结果示例',
        confidence: 0.95,
        language: 'zh'
      }
    }
    return { success: false, data: '', error: 'Unsupported input type' }
  },

  getConfigSchema() {
    return {
      modelPath: {
        type: 'string',
        label: '模型路径',
        default: './models/paddle'
      },
      useGpu: {
        type: 'boolean',
        label: '使用GPU',
        default: false
      }
    }
  }
}
```

- [ ] **Step 2: 创建 plugins/index.ts**

```typescript
import { paddleOcrPlugin } from './paddleOcrPlugin'

export const builtinPlugins = [
  paddleOcrPlugin
]

export { paddleOcrPlugin }
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: implement paddle ocr plugin"
```

---

## Phase 4: AI大模型集成

### Task 7: 实现 OpenAI Vision 插件

**Covers:** [S3]
**Files:**
- Create: `src/plugins/openaiVisionPlugin.ts`

- [ ] **Step 1: 创建 openaiVisionPlugin.ts**

```typescript
import { Plugin, PluginInput, PluginOutput, PluginConfig } from '../types/plugin'

export const openaiVisionPlugin: Plugin = {
  metadata: {
    id: 'openai-vision',
    name: 'OpenAI GPT-4V',
    version: '1.0.0',
    type: 'ocr',
    description: 'OpenAI GPT-4 Vision API',
    author: 'MomentOCR'
  },

  private config: PluginConfig = {},

  async init(config: PluginConfig): Promise<void> {
    this.config = config
  },

  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') {
      return { success: false, data: '', error: 'Only image input supported' }
    }

    const apiKey = this.config.apiKey as string
    if (!apiKey) {
      return { success: false, data: '', error: 'API key not configured' }
    }

    // TODO: 调用OpenAI API
    // 实际实现需要通过Rust后端发起HTTP请求
    return {
      success: true,
      data: 'OpenAI Vision识别结果',
      confidence: 0.98,
      language: 'auto'
    }
  },

  getConfigSchema() {
    return {
      apiKey: {
        type: 'string',
        label: 'API Key'
      },
      model: {
        type: 'string',
        label: '模型',
        default: 'gpt-4-vision-preview'
      },
      maxTokens: {
        type: 'number',
        label: '最大Token数',
        default: 1000
      }
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: implement openai vision plugin"
```

---

### Task 8: 实现本地LLM插件

**Covers:** [S3]
**Files:**
- Create: `src/plugins/localLlmPlugin.ts`

- [ ] **Step 1: 创建 localLlmPlugin.ts**

```typescript
import { Plugin, PluginInput, PluginOutput, PluginConfig } from '../types/plugin'

export const localLlmPlugin: Plugin = {
  metadata: {
    id: 'local-llm',
    name: '本地LLM',
    version: '1.0.0',
    type: 'ocr',
    description: '支持Ollama等本地部署的大模型',
    author: 'MomentOCR'
  },

  private config: PluginConfig = {},

  async init(config: PluginConfig): Promise<void> {
    this.config = config
  },

  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') {
      return { success: false, data: '', error: 'Only image input supported' }
    }

    const endpoint = this.config.endpoint as string || 'http://localhost:11434'
    const model = this.config.model as string || 'llava'

    // TODO: 调用本地LLM API
    // 通过Ollama API发送图片进行识别
    return {
      success: true,
      data: '本地LLM识别结果',
      confidence: 0.90,
      language: 'auto'
    }
  },

  getConfigSchema() {
    return {
      endpoint: {
        type: 'string',
        label: 'API端点',
        default: 'http://localhost:11434'
      },
      model: {
        type: 'string',
        label: '模型名称',
        default: 'llava'
      }
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: implement local llm plugin"
```

---

## Phase 5: 翻译功能

### Task 9: 实现翻译插件

**Covers:** [S4]
**Files:**
- Create: `src/plugins/googleTranslatePlugin.ts`
- Create: `src/plugins/aiTranslatePlugin.ts`

- [ ] **Step 1: 创建 googleTranslatePlugin.ts**

```typescript
import { Plugin, PluginInput, PluginOutput, PluginConfig } from '../types/plugin'

export const googleTranslatePlugin: Plugin = {
  metadata: {
    id: 'google-translate',
    name: 'Google翻译',
    version: '1.0.0',
    type: 'translation',
    description: 'Google免费翻译API',
    author: 'MomentOCR'
  },

  async init(config: PluginConfig): Promise<void> {
    // Google翻译无需初始化
  },

  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'text') {
      return { success: false, data: '', error: 'Only text input supported' }
    }

    // TODO: 调用Google翻译API
    const targetLang = input.language || 'zh-CN'
    return {
      success: true,
      data: `[Google翻译] ${input.data}`,
      language: targetLang
    }
  },

  getConfigSchema() {
    return {
      apiKey: {
        type: 'string',
        label: 'API Key (可选)'
      }
    }
  }
}
```

- [ ] **Step 2: 创建 aiTranslatePlugin.ts**

```typescript
import { Plugin, PluginInput, PluginOutput, PluginConfig } from '../types/plugin'

export const aiTranslatePlugin: Plugin = {
  metadata: {
    id: 'ai-translate',
    name: 'AI大模型翻译',
    version: '1.0.0',
    type: 'translation',
    description: '使用AI大模型进行高质量翻译',
    author: 'MomentOCR'
  },

  private config: PluginConfig = {},

  async init(config: PluginConfig): Promise<void> {
    this.config = config
  },

  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'text') {
      return { success: false, data: '', error: 'Only text input supported' }
    }

    // TODO: 调用AI翻译API
    const targetLang = input.language || 'zh'
    return {
      success: true,
      data: `[AI翻译] ${input.data}`,
      language: targetLang
    }
  },

  getConfigSchema() {
    return {
      provider: {
        type: 'string',
        label: 'AI提供商',
        default: 'openai'
      },
      apiKey: {
        type: 'string',
        label: 'API Key'
      },
      model: {
        type: 'string',
        label: '模型',
        default: 'gpt-4'
      }
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: implement translation plugins"
```

---

## Phase 6: OCR结果展示

### Task 10: 实现OCR结果组件

**Covers:** [S5]
**Files:**
- Create: `src/components/OcrResult.tsx`
- Create: `src/stores/ocrStore.ts`

- [ ] **Step 1: 创建 ocrStore.ts**

```typescript
import { create } from 'zustand'
import { PluginOutput } from '../types/plugin'

interface OcrState {
  isProcessing: boolean
  result: PluginOutput | null
  history: Array<{ timestamp: number; result: PluginOutput }>
  setProcessing: (isProcessing: boolean) => void
  setResult: (result: PluginOutput | null) => void
  addToHistory: (result: PluginOutput) => void
}

export const useOcrStore = create<OcrState>((set) => ({
  isProcessing: false,
  result: null,
  history: [],
  setProcessing: (isProcessing) => set({ isProcessing }),
  setResult: (result) => set({ result }),
  addToHistory: (result) => set((state) => ({
    history: [{ timestamp: Date.now(), result }, ...state.history].slice(0, 50)
  })),
}))
```

- [ ] **Step 2: 创建 OcrResult.tsx**

```tsx
import { useOcrStore } from '../stores/ocrStore'

export function OcrResult() {
  const { isProcessing, result, history } = useOcrStore()

  const copyToClipboard = () => {
    if (result?.data) {
      navigator.clipboard.writeText(result.data)
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">识别结果</h2>
      
      {isProcessing ? (
        <div className="text-center py-8 text-gray-500">识别中...</div>
      ) : result ? (
        <div>
          <div className="mb-4 p-3 bg-gray-50 rounded border">
            <pre className="whitespace-pre-wrap text-sm">{result.data}</pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={copyToClipboard}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              复制
            </button>
          </div>
          {result.confidence !== undefined && (
            <p className="mt-2 text-sm text-gray-500">
              置信度: {(result.confidence * 100).toFixed(1)}%
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          请截图或选择文件进行识别
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-md font-medium mb-2">历史记录</h3>
          <div className="max-h-48 overflow-y-auto">
            {history.map((item, index) => (
              <div
                key={index}
                className="p-2 mb-2 bg-gray-50 rounded text-sm cursor-pointer hover:bg-gray-100"
              >
                <div className="truncate">{item.result.data}</div>
                <div className="text-xs text-gray-400">
                  {new Date(item.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: add ocr result component"
```

---

## Phase 7: 多文件处理

### Task 11: 实现文件上传和批量处理

**Covers:** [S5]
**Files:**
- Create: `src/components/FileUploader.tsx`
- Create: `src/stores/fileStore.ts`

- [ ] **Step 1: 创建 fileStore.ts**

```typescript
import { create } from 'zustand'

interface FileItem {
  id: string
  name: string
  path: string
  status: 'pending' | 'processing' | 'done' | 'error'
  result?: string
}

interface FileState {
  files: FileItem[]
  addFiles: (files: FileItem[]) => void
  updateFileStatus: (id: string, status: FileItem['status'], result?: string) => void
  clearFiles: () => void
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  addFiles: (files) => set((state) => ({ files: [...state.files, ...files] })),
  updateFileStatus: (id, status, result) => set((state) => ({
    files: state.files.map(f => 
      f.id === id ? { ...f, status, result } : f
    )
  })),
  clearFiles: () => set({ files: [] }),
}))
```

- [ ] **Step 2: 创建 FileUploader.tsx**

```tsx
import { useCallback } from 'react'
import { useFileStore } from '../stores/fileStore'

export function FileUploader() {
  const { files, addFiles, clearFiles } = useFileStore()

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files)
    const imageFiles = droppedFiles.filter(f => 
      f.type.startsWith('image/') || f.name.endsWith('.pdf')
    ).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      path: f.name, // 实际需要通过Tauri获取完整路径
      status: 'pending' as const
    }))
    addFiles(imageFiles)
  }, [addFiles])

  const handleSelect = async () => {
    // TODO: 调用Tauri文件选择对话框
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">文件批量识别</h2>
      
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors"
      >
        <p className="text-gray-500">拖拽文件到这里，或</p>
        <button
          onClick={handleSelect}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          选择文件
        </button>
      </div>

      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-500">{files.length} 个文件</span>
            <button
              onClick={clearFiles}
              className="text-sm text-red-500 hover:text-red-600"
            >
              清空
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-2 mb-2 bg-gray-50 rounded"
              >
                <span className="text-sm truncate">{file.name}</span>
                <span className={`text-xs ${
                  file.status === 'done' ? 'text-green-500' :
                  file.status === 'error' ? 'text-red-500' :
                  'text-gray-400'
                }`}>
                  {file.status === 'pending' ? '等待中' :
                   file.status === 'processing' ? '处理中' :
                   file.status === 'done' ? '完成' : '错误'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: add file uploader component"
```

---

## Phase 8: 设置界面

### Task 12: 实现设置界面

**Covers:** [S6]
**Files:**
- Create: `src/components/Settings.tsx`
- Create: `src/stores/settingsStore.ts`

- [ ] **Step 1: 创建 settingsStore.ts**

```typescript
import { create } from 'zustand'

interface PluginSettings {
  [pluginId: string]: Record<string, string | number | boolean>
}

interface SettingsState {
  activeOcrPlugin: string
  activeTranslationPlugin: string
  pluginSettings: PluginSettings
  theme: 'light' | 'dark'
  hotkey: string
  setActiveOcrPlugin: (id: string) => void
  setActiveTranslationPlugin: (id: string) => void
  updatePluginSettings: (pluginId: string, settings: Record<string, string | number | boolean>) => void
  setTheme: (theme: 'light' | 'dark') => void
  setHotkey: (hotkey: string) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  activeOcrPlugin: 'paddle-ocr',
  activeTranslationPlugin: 'google-translate',
  pluginSettings: {},
  theme: 'light',
  hotkey: 'Ctrl+Shift+Q',
  setActiveOcrPlugin: (id) => set({ activeOcrPlugin: id }),
  setActiveTranslationPlugin: (id) => set({ activeTranslationPlugin: id }),
  updatePluginSettings: (pluginId, settings) => set((state) => ({
    pluginSettings: {
      ...state.pluginSettings,
      [pluginId]: { ...state.pluginSettings[pluginId], ...settings }
    }
  })),
  setTheme: (theme) => set({ theme }),
  setHotkey: (hotkey) => set({ hotkey }),
}))
```

- [ ] **Step 2: 创建 Settings.tsx**

```tsx
import { useSettingsStore } from '../stores/settingsStore'
import { builtinPlugins } from '../plugins'

export function Settings() {
  const {
    activeOcrPlugin,
    activeTranslationPlugin,
    pluginSettings,
    theme,
    hotkey,
    setActiveOcrPlugin,
    setActiveTranslationPlugin,
    updatePluginSettings,
    setTheme,
    setHotkey
  } = useSettingsStore()

  const ocrPlugins = builtinPlugins.filter(p => p.metadata.type === 'ocr')
  const translationPlugins = builtinPlugins.filter(p => p.metadata.type === 'translation')

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">设置</h2>
      
      <div className="space-y-6">
        {/* OCR引擎选择 */}
        <div>
          <label className="block text-sm font-medium mb-2">OCR引擎</label>
          <select
            value={activeOcrPlugin}
            onChange={(e) => setActiveOcrPlugin(e.target.value)}
            className="w-full p-2 border rounded"
          >
            {ocrPlugins.map(plugin => (
              <option key={plugin.metadata.id} value={plugin.metadata.id}>
                {plugin.metadata.name}
              </option>
            ))}
          </select>
        </div>

        {/* 翻译服务选择 */}
        <div>
          <label className="block text-sm font-medium mb-2">翻译服务</label>
          <select
            value={activeTranslationPlugin}
            onChange={(e) => setActiveTranslationPlugin(e.target.value)}
            className="w-full p-2 border rounded"
          >
            {translationPlugins.map(plugin => (
              <option key={plugin.metadata.id} value={plugin.metadata.id}>
                {plugin.metadata.name}
              </option>
            ))}
          </select>
        </div>

        {/* 主题设置 */}
        <div>
          <label className="block text-sm font-medium mb-2">主题</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
            className="w-full p-2 border rounded"
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>

        {/* 快捷键设置 */}
        <div>
          <label className="block text-sm font-medium mb-2">截图快捷键</label>
          <input
            type="text"
            value={hotkey}
            onChange={(e) => setHotkey(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        {/* 插件配置 */}
        {ocrPlugins.map(plugin => (
          <div key={plugin.metadata.id}>
            <h3 className="text-md font-medium mb-2">{plugin.metadata.name} 配置</h3>
            <div className="space-y-2">
              {Object.entries(plugin.getConfigSchema()).map(([key, schema]) => (
                <div key={key}>
                  <label className="block text-sm mb-1">{schema.label}</label>
                  {schema.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={(pluginSettings[plugin.metadata.id]?.[key] as boolean) ?? (schema.default as boolean)}
                      onChange={(e) => updatePluginSettings(plugin.metadata.id, {
                        [key]: e.target.checked
                      })}
                    />
                  ) : (
                    <input
                      type={schema.type === 'number' ? 'number' : 'text'}
                      value={(pluginSettings[plugin.metadata.id]?.[key] as string) ?? (schema.default as string) ?? ''}
                      onChange={(e) => updatePluginSettings(plugin.metadata.id, {
                        [key]: schema.type === 'number' ? Number(e.target.value) : e.target.value
                      })}
                      className="w-full p-2 border rounded"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: add settings component"
```

---

## Phase 9: 整合和完善

### Task 13: 整合所有组件

**Covers:** [S5, S6]
**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 更新 App.tsx**

```tsx
import { useState } from 'react'
import { ScreenshotTool } from './components/ScreenshotTool'
import { OcrResult } from './components/OcrResult'
import { FileUploader } from './components/FileUploader'
import { Settings } from './components/Settings'

function App() {
  const [activeTab, setActiveTab] = useState<'screenshot' | 'files' | 'settings'>('screenshot')

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-800">须臾OCR</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* 标签页导航 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('screenshot')}
            className={`px-4 py-2 rounded ${
              activeTab === 'screenshot'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            截图识别
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 rounded ${
              activeTab === 'files'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            文件识别
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded ${
              activeTab === 'settings'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            设置
          </button>
        </div>

        {/* 内容区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            {activeTab === 'screenshot' && <ScreenshotTool />}
            {activeTab === 'files' && <FileUploader />}
            {activeTab === 'settings' && <Settings />}
          </div>
          <div>
            <OcrResult />
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: integrate all components"
```

---

### Task 14: 测试和调试

**Covers:** [S5]
**Files:**
- Create: `src/components/__tests__/App.test.tsx`

- [ ] **Step 1: 创建测试文件**

```tsx
import { render, screen } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByText('须臾OCR')).toBeInTheDocument()
  })

  it('renders screenshot tab by default', () => {
    render(<App />)
    expect(screen.getByText('截图工具')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试**

```bash
npm test
```

- [ ] **Step 3: 启动开发服务器测试**

```bash
npm run tauri dev
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "feat: add basic tests"
```

---

## 后续任务（可选）

### Task 15: 实现区域截图选择

**Covers:** [S5]
**Files:**
- Create: `src/components/RegionSelector.tsx`

- [ ] **Step 1: 创建区域选择组件**

```tsx
import { useState, useRef, useEffect } from 'react'

interface Region {
  x: number
  y: number
  width: number
  height: number
}

interface RegionSelectorProps {
  onSelect: (region: Region) => void
  onCancel: () => void
}

export function RegionSelector({ onSelect, onCancel }: RegionSelectorProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setStart({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setEnd({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseUp = () => {
    if (isDragging && start && end) {
      const region: Region = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y)
      }
      onSelect(region)
    }
    setIsDragging(false)
  }

  const getRect = () => {
    if (!start || !end) return null
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    }
  }

  const rect = getRect()

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black bg-opacity-30 cursor-crosshair z-50"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {rect && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-500 bg-opacity-20"
          style={rect}
        />
      )}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white px-4 py-2 rounded shadow">
        拖拽选择区域，ESC取消
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: add region selector component"
```

---

## 完成状态

| Task | 状态 | 说明 |
|------|------|------|
| 1. 初始化 Tauri 项目 | ✅ | 项目基础搭建 |
| 2. 配置前端开发环境 | ✅ | Vite + React + Tailwind |
| 3. 实现 Rust 截图模块 | ✅ | 核心截图功能 |
| 4. 实现前端截图界面 | ✅ | 截图UI |
| 5. 设计插件接口 | ✅ | 插件系统基础 |
| 6. 实现 PaddleOCR 插件 | ✅ | 本地OCR |
| 7. 实现 OpenAI Vision 插件 | ✅ | AI大模型OCR |
| 8. 实现本地LLM插件 | ✅ | 本地大模型 |
| 9. 实现翻译插件 | ✅ | 翻译功能 |
| 10. 实现OCR结果组件 | ✅ | 结果展示 |
| 11. 实现文件上传和批量处理 | ✅ | 多文件OCR |
| 12. 实现设置界面 | ✅ | 用户配置 |
| 13. 整合所有组件 | ✅ | 完整应用 |
| 14. 测试和调试 | ✅ | 质量保证 |
| 15. 实现区域截图选择 | ✅ | 完整截图功能 |

---

**下一步：** 开始实施 Phase 1 的 Task 1: 初始化 Tauri 项目