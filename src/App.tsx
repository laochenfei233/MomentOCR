import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';

type Tab = 'screenshot' | 'file' | 'settings';

// 简洁的SVG图标
const Icons = {
  menu: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  minimize: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  maximize: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  cloud: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
    </svg>
  ),
  pin: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  translate: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 8l6 6"/>
      <path d="M4 14l6-6 2-3"/>
      <path d="M2 5h12"/>
      <path d="M7 2v3"/>
      <path d="M22 22l-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  ),
};

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
    <div className="flex flex-col h-screen bg-white text-gray-800">
      {/* 顶部标题栏 - 紧凑 */}
      <header className="flex items-center justify-between px-3 py-1 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400">耗时：</span>
          <span className="text-[11px] text-gray-600">须臾OCR</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="window-btn">{Icons.cloud}</button>
          <button className="window-btn">{Icons.pin}</button>
          <button className="window-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>
            {Icons.menu}
          </button>
          
          {showMenu && (
            <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
              <button className="dropdown-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>
                软件设置
              </button>
              <button className="dropdown-item">同步信息</button>
              <button className="dropdown-item">检测更新</button>
              <button className="dropdown-item">问题反馈</button>
              <div className="dropdown-divider"></div>
              <button className="dropdown-item text-red-500">退出程序</button>
            </div>
          )}
          
          <button className="window-btn">{Icons.minimize}</button>
          <button className="window-btn">{Icons.maximize}</button>
          <button className="window-btn hover:bg-red-500 hover:text-white">{Icons.close}</button>
        </div>
      </header>

      {/* 工具栏 - 图标按钮 */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200">
        <button className="toolbar-btn" title="文本">T</button>
        <button className="toolbar-btn" title="表格">⊞</button>
        <button className="toolbar-btn" title="竖线">⋮</button>
        <button className="toolbar-btn" title="M">M</button>
        <button className="toolbar-btn" title="剪切">✂</button>
        <button className="toolbar-btn" title="搜索">🔍</button>
        <button className="toolbar-btn" title="列表">≡</button>
        <button className="toolbar-btn" title="编辑">✎</button>
        <button className="toolbar-btn" title="符号">;</button>
        <button className="toolbar-btn" title="声音">♪</button>
        <div className="flex-1"></div>
        <button className="toolbar-btn active">docx</button>
        <button className="toolbar-btn">图</button>
        <button className="toolbar-btn">M</button>
        <button className="toolbar-btn">{Icons.translate}</button>
      </div>

      {/* 主内容区 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 左侧 - 功能选择 */}
        <div className="w-48 border-r border-gray-200 flex flex-col">
          {/* 标签 */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => handleTabChange('screenshot')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                tab === 'screenshot' && !showSettings
                  ? 'text-blue-500 border-b border-blue-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              截图识别
            </button>
            <button
              onClick={() => handleTabChange('file')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                tab === 'file' && !showSettings
                  ? 'text-blue-500 border-b border-blue-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              文件识别
            </button>
          </div>

          {/* 功能内容 */}
          <div className="flex-1 overflow-y-auto">
            {showSettings ? (
              <Settings />
            ) : tab === 'screenshot' ? (
              <ScreenshotTool />
            ) : (
              <FileUploader />
            )}
          </div>
        </div>

        {/* 右侧 - 识别结果（重点） */}
        <div className="flex-1 flex flex-col">
          <OcrResult />
        </div>
      </main>

      {/* 底部状态栏 - 紧凑 */}
      <footer className="flex items-center justify-between px-3 py-1 border-t border-gray-200">
        <span className="text-[11px] text-gray-400">字数：0</span>
        <div className="flex items-center gap-1">
          <button className="status-btn">中英</button>
          <button className="status-btn" title="添加">+</button>
          <button className="status-btn" title="删除">🗑</button>
          <button className="status-btn" title="设置" onClick={() => setShowSettings(true)}>
            {Icons.settings}
          </button>
          <button className="status-btn" title="复制">📋</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
