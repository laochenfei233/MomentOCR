import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';

type Tab = 'screenshot' | 'file' | 'settings';

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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

  return (
    <div className="app-container">
      {/* 标题栏 */}
      <header className="title-bar">
        <span className="text-xs text-gray-400">耗时：</span>
        <span className="text-xs text-gray-600 ml-2">须臾OCR</span>
        <div className="flex-1"></div>
        <div className="flex items-center gap-0.5">
          <button className="win-btn" title="置顶">📌</button>
          <button className="win-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>☰</button>
          
          {showMenu && (
            <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="menu-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>软件设置</button>
              <button className="menu-item">同步信息</button>
              <button className="menu-item">检测更新</button>
              <button className="menu-item">问题反馈</button>
              <div className="menu-divider"></div>
              <button className="menu-item text-red-500">退出程序</button>
            </div>
          )}
          
          <button className="win-btn">─</button>
          <button className="win-btn">□</button>
          <button className="win-btn hover:bg-red-500 hover:text-white">✕</button>
        </div>
      </header>

      {/* 工具栏 */}
      <div className="toolbar">
        <button className="tool-icon" title="文本">T</button>
        <button className="tool-icon" title="表格">⊞</button>
        <button className="tool-icon" title="竖线">⋮</button>
        <button className="tool-icon" title="Markdown">M</button>
        <button className="tool-icon" title="剪切">✂</button>
        <button className="tool-icon" title="搜索">🔍</button>
        <button className="tool-icon" title="列表">≡</button>
        <button className="tool-icon" title="编辑">✎</button>
        <button className="tool-icon" title="符号">;</button>
        <button className="tool-icon" title="声音">♪</button>
        <div className="flex-1"></div>
        <button className="tool-icon active">docx</button>
        <button className="tool-icon">图</button>
        <button className="tool-icon">M</button>
        <button className="tool-icon">译</button>
      </div>

      {/* 主内容 */}
      <main className="main-content">
        {/* 左侧功能 */}
        <div className="side-panel">
          <div className="tab-bar">
            <button
              onClick={() => handleTabChange('screenshot')}
              className={`tab-btn ${tab === 'screenshot' && !showSettings ? 'active' : ''}`}
            >
              截图识别
            </button>
            <button
              onClick={() => handleTabChange('file')}
              className={`tab-btn ${tab === 'file' && !showSettings ? 'active' : ''}`}
            >
              文件识别
            </button>
          </div>
          
          <div className="side-content">
            {showSettings ? (
              <Settings />
            ) : tab === 'screenshot' ? (
              <ScreenshotTool />
            ) : (
              <FileUploader />
            )}
          </div>
        </div>

        {/* 右侧结果 */}
        <div className="result-panel">
          <OcrResult />
        </div>
      </main>

      {/* 状态栏 */}
      <footer className="status-bar">
        <span className="text-xs text-gray-400">字数：0</span>
        <div className="flex items-center gap-1">
          <button className="status-icon">中英</button>
          <button className="status-icon">+</button>
          <button className="status-icon">🗑</button>
          <button className="status-icon" onClick={() => setShowSettings(true)}>⚙</button>
          <button className="status-icon">📋</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
