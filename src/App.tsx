import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';
import { invoke } from '@tauri-apps/api/core';

type Tab = 'screenshot' | 'file' | 'settings';

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [ocrText, setOcrText] = useState('');

  useEffect(() => {
    const handleClick = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showMenu]);

  const handleCopy = async () => {
    if (!ocrText) return;
    try { await navigator.clipboard.writeText(ocrText); } catch {}
  };

  const handleTranslate = async () => {
    if (!ocrText) return;
    try {
      const result = await invoke<string>('translate_google', { text: ocrText, targetLang: 'zh-CN' });
      setOcrText(result);
    } catch {}
  };

  const handleExit = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {}
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

  const showSidebar = tab === 'file' || tab === 'screenshot';

  return (
    <div className="app-container">
      {/* 标题栏 - 合并为一行 */}
      <header className="title-bar">
        <button className="tool-icon" title="截图识别" onClick={() => { setTab('screenshot'); setShowSettings(false); }}>📷</button>
        <button className="tool-icon" title="文件识别" onClick={() => { setTab('file'); setShowSettings(false); }}>📁</button>
        <div className="flex-1" />
        <button className="tool-icon" title="复制" onClick={handleCopy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
        <button className="tool-icon" title="翻译" onClick={handleTranslate}>译</button>
        <button className="tool-icon" title="设置" onClick={() => setShowSettings(true)}>⚙</button>
        <button className="win-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>☰</button>
        {showMenu && (
          <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
            <button className="menu-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>设置</button>
            <button className="menu-item" onClick={() => setShowMenu(false)}>同步信息</button>
            <button className="menu-item" onClick={() => setShowMenu(false)}>检测更新</button>
            <div className="menu-divider" />
            <button className="menu-item" style={{ color: '#FF3B30' }} onClick={handleExit}>退出</button>
          </div>
        )}
      </header>

      <main className="main-content">
        {/* 左侧面板 */}
        {showSidebar && (
          <div className="side-panel">
            <div className="side-content">
              {tab === 'screenshot' ? <ScreenshotTool /> : <FileUploader />}
            </div>
          </div>
        )}
        {/* 右侧 - 主内容区 */}
        <div className="result-panel">
          {showSettings ? <Settings /> : <OcrResult onTextChange={setOcrText} />}
        </div>
      </main>

      <footer className="status-bar">
        <span className="text-xs" style={{ color: '#8E8E93' }}>字数：{ocrText.length}</span>
        <div className="flex items-center gap-1">
          <button className="status-icon" onClick={handleCopy}>复制</button>
          <button className="status-icon" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
