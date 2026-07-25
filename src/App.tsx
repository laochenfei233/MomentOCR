import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';
import { invoke } from '@tauri-apps/api/core';

type Tab = 'screenshot' | 'file' | 'settings';
type ExportFormat = 'text' | 'docx' | 'markdown' | 'image';

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('text');
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);
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

  // 置顶功能
  const toggleAlwaysOnTop = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(!alwaysOnTop);
      setAlwaysOnTop(!alwaysOnTop);
    } catch {}
  };

  // 退出程序
  const handleExit = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {}
  };

  // 复制到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ocrText);
    } catch {}
  };

  // 导出功能
  const handleExport = async (format: ExportFormat) => {
    setExportFormat(format);
    try {
      if (format === 'text') {
        await navigator.clipboard.writeText(ocrText);
        alert('已复制到剪贴板');
      } else if (format === 'markdown') {
        const markdown = '```\n' + ocrText + '\n```';
        await navigator.clipboard.writeText(markdown);
        alert('Markdown已复制到剪贴板');
      }
    } catch {}
  };

  // 翻译功能
  const handleTranslate = async () => {
    if (!ocrText) return;
    try {
      const result = await invoke<string>('translate_google', {
        text: ocrText,
        targetLang: 'zh-CN'
      });
      setOcrText(result);
    } catch (err) {
      alert('翻译失败: ' + err);
    }
  };

  return (
    <div className="app-container">
      <header className="title-bar">
        <span className="text-sm font-medium text-gray-700">须臾OCR</span>
        <div className="flex-1"></div>
        <div className="flex items-center gap-0.5">
          <button className={`win-btn ${alwaysOnTop ? 'text-blue-500' : ''}`} title="置顶" onClick={toggleAlwaysOnTop}>📌</button>
          <button className="win-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>☰</button>
          {showMenu && (
            <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="menu-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>软件设置</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>同步信息</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>检测更新</button>
              <button className="menu-item" onClick={() => setShowMenu(false)}>问题反馈</button>
              <div className="menu-divider"></div>
              <button className="menu-item text-red-500" onClick={handleExit}>退出程序</button>
            </div>
          )}
          <button className="win-btn">─</button>
          <button className="win-btn">□</button>
          <button className="win-btn hover:bg-red-500 hover:text-white" onClick={handleExit}>✕</button>
        </div>
      </header>

      <div className="toolbar">
        {/* 文本模式 */}
        <button className={`tool-icon ${exportFormat === 'text' ? 'active' : ''}`} title="文本" onClick={() => handleExport('text')}>T</button>
        
        {/* Markdown模式 */}
        <button className="tool-icon" title="Markdown" onClick={() => handleExport('markdown')}>M</button>
        
        {/* 复制 */}
        <button className="tool-icon" title="复制" onClick={handleCopy}>⧉</button>
        
        {/* 搜索 */}
        <button className={`tool-icon ${showSearch ? 'active' : ''}`} title="搜索" onClick={() => setShowSearch(!showSearch)}>🔍</button>
        
        {/* 编辑 */}
        <button className="tool-icon" title="编辑">✎</button>
        
        {/* 翻译 */}
        <button className="tool-icon" title="翻译" onClick={handleTranslate}>译</button>
        
        <div className="flex-1"></div>
        
        {/* 导出格式 */}
        <button className={`tool-icon ${exportFormat === 'docx' ? 'active' : ''}`} title="导出为docx" onClick={() => handleExport('docx')}>docx</button>
        <button className={`tool-icon ${exportFormat === 'image' ? 'active' : ''}`} title="导出为图片" onClick={() => handleExport('image')}>图</button>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="搜索识别结果..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="search-input"
          />
        </div>
      )}

      <main className="main-content">
        <div className="side-panel">
          <div className="tab-bar">
            <button onClick={() => handleTabChange('screenshot')} className={`tab-btn ${tab === 'screenshot' && !showSettings ? 'active' : ''}`}>截图识别</button>
            <button onClick={() => handleTabChange('file')} className={`tab-btn ${tab === 'file' && !showSettings ? 'active' : ''}`}>文件识别</button>
          </div>
          <div className="side-content">
            {showSettings ? <Settings /> : tab === 'screenshot' ? <ScreenshotTool /> : <FileUploader />}
          </div>
        </div>
        <div className="result-panel">
          <OcrResult onTextChange={setOcrText} searchText={searchText} />
        </div>
      </main>

      <footer className="status-bar">
        <span className="text-xs text-gray-400">字数：{ocrText.length}</span>
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