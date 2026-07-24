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

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClick = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showMenu]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* 顶部状态栏 */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-4">
          <span className="ios-text-caption text-gray-500">耗时：</span>
          <span className="ios-text-caption text-gray-700">老晨飞233</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="ios-btn-icon-sm" title="云同步">☁️</button>
          <button className="ios-btn-icon-sm" title="置顶">📌</button>
          
          {/* 菜单按钮 */}
          <div className="relative">
            <button 
              className="ios-btn-icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
            >
              ☰
            </button>
            
            {/* 下拉菜单 */}
            {showMenu && (
              <div className="ios-dropdown" onClick={(e) => e.stopPropagation()}>
                <button className="ios-dropdown-item" onClick={() => { setShowSettings(true); setShowMenu(false); }}>
                  软件设置
                </button>
                <button className="ios-dropdown-item" onClick={() => setShowMenu(false)}>
                  同步信息
                </button>
                <button className="ios-dropdown-item" onClick={() => setShowMenu(false)}>
                  软件目录
                </button>
                <button className="ios-dropdown-item" onClick={() => setShowMenu(false)}>
                  检测更新
                </button>
                <button className="ios-dropdown-item" onClick={() => setShowMenu(false)}>
                  问题反馈
                </button>
                <div className="ios-dropdown-divider"></div>
                <button className="ios-dropdown-item text-red-500" onClick={() => setShowMenu(false)}>
                  退出程序
                </button>
              </div>
            )}
          </div>
          
          <button className="ios-btn-icon-sm">─</button>
          <button className="ios-btn-icon-sm">□</button>
          <button className="ios-btn-icon-sm text-red-500">✕</button>
        </div>
      </header>

      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 bg-white">
        <button className="ios-toolbar-btn" title="文本">T</button>
        <button className="ios-toolbar-btn" title="表格">⊞</button>
        <button className="ios-toolbar-btn" title="竖线">⋮⋮</button>
        <button className="ios-toolbar-btn" title="Markdown">M</button>
        <button className="ios-toolbar-btn" title="剪切">✂️</button>
        <button className="ios-toolbar-btn" title="搜索">🔍</button>
        <button className="ios-toolbar-btn" title="列表">≡</button>
        <button className="ios-toolbar-btn" title="编辑">✏️</button>
        <button className="ios-toolbar-btn" title="符号">；</button>
        <button className="ios-toolbar-btn" title="声音">🔊</button>
        
        <div className="flex-1"></div>
        
        <button className="ios-toolbar-btn active" title="docx">docx</button>
        <button className="ios-toolbar-btn" title="图片">图</button>
        <button className="ios-toolbar-btn" title="Markdown">M</button>
        <button className="ios-toolbar-btn" title="翻译">译</button>
      </div>

      {/* 主内容区 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 左侧 - 功能区 */}
        <div className="w-64 border-r border-gray-200 flex flex-col">
          {/* 标签切换 */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => { setTab('screenshot'); setShowSettings(false); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                tab === 'screenshot' && !showSettings
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              截图识别
            </button>
            <button
              onClick={() => { setTab('file'); setShowSettings(false); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                tab === 'file' && !showSettings
                  ? 'text-blue-600 border-b-2 border-blue-600'
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

        {/* 右侧 - 结果区 */}
        <div className="flex-1 flex flex-col">
          <OcrResult />
        </div>
      </main>

      {/* 底部状态栏 */}
      <footer className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 bg-gray-50">
        <span className="ios-text-caption text-gray-500">字数：0</span>
        <div className="flex items-center gap-2">
          <button className="ios-btn-text text-sm">中英</button>
          <button className="ios-btn-icon-sm" title="添加">➕</button>
          <button className="ios-btn-icon-sm" title="删除">🗑️</button>
          <button className="ios-btn-icon-sm" title="设置" onClick={() => setShowSettings(true)}>⚙️</button>
          <button className="ios-btn-icon-sm" title="复制">📋</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
