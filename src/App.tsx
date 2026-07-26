import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useOcrStore } from './stores/ocrStore';
import { useSettingsStore } from './stores/settingsStore';

type Tab = 'screenshot' | 'file' | 'settings' | 'snipaste';

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const { history, restoreFromHistory, clearHistory } = useOcrStore();
  const { shortcuts, quickAction, config, activeTranslationPlugin, pluginSettings } = useSettingsStore();

  useEffect(() => {
    const handleClick = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showMenu]);

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
        case 'snipaste':
          handleSnipaste();
          break;
        case 'long-screenshot':
          handleLongScreenshot();
          break;
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

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

  const handleCopy = async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = ocrText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const handleTranslate = async () => {
    if (!ocrText) { alert('请先识别文字'); return; }
    try {
      let result = '';
      const customTranslatePlugins = ['openai-translate', 'qwen-translate', 'zhipu-translate', 'doubao-translate', 'gemini-translate'];
      if (activeTranslationPlugin === 'google-translate') {
        result = await invoke<string>('translate_google', { text: ocrText, targetLang: 'zh-CN' });
      } else if (activeTranslationPlugin === 'ai-translate') {
        // 兼容旧的 AI 大模型翻译（走 translate_ai，provider=openai）
        const cfg = pluginSettings['ai-translate'] || {};
        const apiKey = (cfg.apiKey as string) || '';
        const model = (cfg.model as string) || 'gpt-4o';
        if (!apiKey) { result = '错误：未配置翻译 API Key'; }
        else {
          result = await invoke<string>('translate_ai', {
            apiKey, text: ocrText, targetLang: 'zh', model, provider: 'openai',
          });
        }
      } else if (customTranslatePlugins.includes(activeTranslationPlugin)) {
        const cfg = pluginSettings[activeTranslationPlugin] || {};
        const apiKey = (cfg.apiKey as string) || '';
        const model = (cfg.model as string) || '';
        const baseUrl = (cfg.baseUrl as string) || '';
        const defaultBaseUrls: Record<string, string> = {
          'openai-translate': 'https://api.openai.com/v1',
          'qwen-translate': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          'zhipu-translate': 'https://open.bigmodel.cn/api/paas/v4',
          'doubao-translate': 'https://ark.cn-beijing.volces.com/api/v3',
          'gemini-translate': 'https://generativelanguage.googleapis.com/v1beta/openai',
        };
        const defaultModels: Record<string, string> = {
          'openai-translate': 'gpt-4o',
          'qwen-translate': 'qwen-turbo',
          'zhipu-translate': 'glm-4-flash',
          'doubao-translate': 'doubao-pro-32k',
          'gemini-translate': 'gemini-1.5-flash',
        };
        const finalBaseUrl = baseUrl || defaultBaseUrls[activeTranslationPlugin] || '';
        const finalModel = model || defaultModels[activeTranslationPlugin] || '';
        console.log('[translate]', activeTranslationPlugin, 'baseUrl=', finalBaseUrl, 'model=', finalModel);
        if (!apiKey) { result = '错误：未配置翻译 API Key'; }
        else if (!finalBaseUrl) { result = `错误：缺少 baseUrl (${activeTranslationPlugin})`; }
        else {
          result = await invoke<string>('translate_custom', {
            baseUrl: finalBaseUrl, apiKey, model: finalModel,
            text: ocrText, targetLang: 'zh',
          });
        }
      } else {
        result = `未知翻译服务: ${activeTranslationPlugin}`;
      }
      if (!result.startsWith('错误')) setOcrText(result);
      else console.warn('[translate] error result:', result);
    } catch (err) {
      console.error('translate error:', err);
    }
  };

  const handleSnipaste = async () => {
    try {
      await invoke('start_snipaste');
    } catch (err) {
      console.error('Snipaste failed:', err);
    }
  };

  const handleLongScreenshot = async () => {
    try {
      await invoke('start_long_screenshot');
    } catch (err) {
      console.error('Long screenshot failed:', err);
    }
  };

  const handleExit = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (quickAction.closeAction === '最小化到托盘') {
        await getCurrentWindow().hide();
      } else {
        await getCurrentWindow().close();
      }
    } catch {}
  };

  const handleCheckUpdate = async () => {
    setShowMenu(false);
    try {
      const resp = await fetch('https://api.github.com/repos/chenfei-xy/MomentOCR/releases/latest');
      if (!resp.ok) throw new Error('无可用更新');
      const data = await resp.json();
      const latestVersion = (data.tag_name || '').replace(/^v/, '');
      const currentVersion = '0.1.0';
      if (latestVersion && latestVersion !== currentVersion) {
        await invoke<string>('plugin:shell|open', { url: data.html_url });
      } else {
        alert('已是最新版本');
      }
    } catch (err: any) {
      alert(err?.message || '检查更新失败');
    }
  };

  const handleRestoreHistory = (id: string) => {
    restoreFromHistory(id);
    setShowHistory(false);
  };

  // 设置页面
  if (showSettings) {
    return (
      <div className="app-container">
        <header className="title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setShowSettings(false)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', color: '#007AFF', padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>← 返回</button>
          <span className="text-sm font-medium" style={{ color: '#1c1c1e' }}>设置</span>
          <div style={{ width: 60 }} />
        </header>
        <main style={{ flex: 1, overflow: 'hidden' }}><Settings /></main>
      </div>
    );
  }

  const showSidebar = tab === 'file';

  return (
    <div className="app-container">
      <header className="title-bar">
        <button className={`tool-btn ${tab === 'screenshot' && !showSettings ? 'active' : ''}`} title="截图识别" onClick={() => { setTab('screenshot'); setShowSettings(false); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <button className={`tool-btn ${tab === 'file' && !showSettings ? 'active' : ''}`} title="文件识别" onClick={() => { setTab('file'); setShowSettings(false); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </button>
        <button className={`tool-btn ${tab === 'snipaste' && !showSettings ? 'active' : ''}`} title="截图贴图" onClick={() => { setTab('snipaste'); setShowSettings(false); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
        <button className={`tool-btn ${tab === 'snipaste' && !showSettings ? 'active' : ''}`} title="长截图" onClick={handleLongScreenshot}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </button>
        <div className="flex-1" />
        <button className="tool-btn" title="翻译" onClick={handleTranslate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2v3"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
        </button>
        <button className="win-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>☰</button>
        {showMenu && (
          <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
            <button className="menu-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>设置</button>
            <button className="menu-item" onClick={() => { setShowHistory(true); setShowMenu(false); }}>历史记录 ({history.length})</button>
            <button className="menu-item" onClick={handleCheckUpdate}>检查更新</button>
            <div className="menu-divider" />
            <button className="menu-item" style={{ color: '#FF3B30' }} onClick={handleExit}>退出</button>
          </div>
        )}
      </header>

      <main className="main-content">
        {showSidebar && (
          <div className="side-panel">
            <div className="side-content">
              <FileUploader />
            </div>
          </div>
        )}
        <div className="result-panel">
          {tab === 'screenshot' && (
            <div style={{ borderBottom: '0.5px solid var(--system-gray5)', background: 'var(--system-bg)' }}>
              <ScreenshotTool />
            </div>
          )}
          <OcrResult onTextChange={setOcrText} />
        </div>
      </main>

      <footer className="status-bar">
        <span className="text-xs" style={{ color: '#8E8E93' }}>字数：{config.wordCountMode === '字符模式' ? ocrText.length : ocrText.trim() ? ocrText.trim().split(/\s+/).length : 0}</span>
        <div className="flex items-center gap-1">
          <button className="status-icon" onClick={handleCopy}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button className="status-icon" onClick={() => setShowSettings(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </footer>

      {/* 历史记录弹窗 */}
      {showHistory && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowHistory(false)}>
          <div className="history-modal-card" style={{ background: 'white', borderRadius: 12, width: 400, maxHeight: 500, overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #E5E5EA', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e' }}>历史记录</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { clearHistory(); }} style={{ fontSize: 12, color: '#FF3B30', background: 'none', border: 'none', cursor: 'pointer' }}>清空</button>
                <button onClick={() => setShowHistory(false)} style={{ fontSize: 12, color: '#8E8E93', background: 'none', border: 'none', cursor: 'pointer' }}>关闭</button>
              </div>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#AEAEB2', fontSize: 13 }}>暂无历史记录</div>
              ) : (
                history.map((entry) => (
                  <button key={entry.id} onClick={() => handleRestoreHistory(entry.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', borderBottom: '0.5px solid #F2F2F7', cursor: 'pointer', display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#AEAEB2' }}>{new Date(entry.timestamp).toLocaleString()}</span>
                      <span style={{ fontSize: 10, color: '#007AFF' }}>点击恢复</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#1c1c1e', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.data.substring(0, 100)}...
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
