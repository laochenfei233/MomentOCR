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

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setShowSettings(false);
  };

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

  // 设置页面全屏显示
  if (showSettings) {
    return (
      <div className="app-container">
        <header className="title-bar" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="win-btn" onClick={() => setShowSettings(false)}>← 返回</button>
          <span className="text-sm font-medium" style={{ color: '#1c1c1e' }}>设置</span>
          <div style={{ width: 32 }} />
        </header>
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Settings />
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 标题栏 */}
      <header className="title-bar">
        <span className="text-sm font-medium" style={{ color: '#1c1c1e' }}>须臾OCR</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <button className="win-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>☰</button>
          {showMenu && (
            <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="menu-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>软件设置</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>同步信息</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>检测更新</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>问题反馈</button>
              <div className="menu-divider" />
              <button className="menu-item" style={{ color: '#FF3B30' }} onClick={handleExit}>退出程序</button>
            </div>
          )}
        </div>
      </header>

      <div className="toolbar">
        <button className="tool-icon" title="复制" onClick={handleCopy}>⧉</button>
        <button className="tool-icon" title="翻译" onClick={handleTranslate}>译</button>
        <div className="flex-1" />
        <button className="tool-icon" title="设置" onClick={() => setShowSettings(true)}>⚙</button>
      </div>

      <main className="main-content">
        <div className="side-panel">
          <div className="tab-bar">
            <button onClick={() => handleTabChange('screenshot')} className={`tab-btn ${tab === 'screenshot' && !showSettings ? 'active' : ''}`}>截图识别</button>
            <button onClick={() => handleTabChange('file')} className={`tab-btn ${tab === 'file' && !showSettings ? 'active' : ''}`}>文件识别</button>
          </div>
          <div className="side-content">
            {tab === 'screenshot' ? <ScreenshotTool /> : <FileUploader />}
          </div>
        </div>
        <div className="result-panel">
          <OcrResult onTextChange={setOcrText} />
        </div>
      </main>

      <footer className="status-bar">
        <span className="text-xs" style={{ color: '#8E8E93' }}>字数：{ocrText.length}</span>
        <div className="flex items-center gap-1">
          <button className="status-icon" onClick={handleCopy}>复制</button>
          <button className="status-icon" onClick={handleTranslate}>翻译</button>
          <button className="status-icon" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
