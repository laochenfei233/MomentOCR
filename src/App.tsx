import { useState, useEffect } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';

type Tab = 'screenshot' | 'file' | 'settings';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'screenshot', label: '截图', icon: '⌘' },
  { key: 'file', label: '文件', icon: '📁' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');
  const [isVisible, setIsVisible] = useState(false);

  // Apple Design: Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  return (
    <div
      className={`flex h-screen flex-col transition-all duration-500 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      style={{
        background: 'linear-gradient(135deg, rgba(245, 245, 247, 0.95) 0%, rgba(255, 255, 255, 0.9) 100%)',
        backdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      {/* Apple Design: Compact title bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <div className="w-2 h-2 rounded-full bg-yellow-400" />
          <div className="w-2 h-2 rounded-full bg-green-400" />
        </div>
        <h1 className="text-sm font-semibold text-gray-700 tracking-tight">须臾OCR</h1>
        <div className="w-16" /> {/* Spacer for centering */}
      </header>

      {/* Apple Design: Tab navigation - segmented control style */}
      <nav className="flex justify-center px-4 py-2">
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-gray-200/60">
          {TABS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn-fluid flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                tab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="text-[10px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col items-center overflow-y-auto px-4 py-4">
          {tab === 'screenshot' && <ScreenshotTool />}
          {tab === 'file' && <FileUploader />}
          {tab === 'settings' && (
            <div className="w-full max-w-sm">
              <Settings />
            </div>
          )}
        </div>

        {/* OCR Result panel - shown only when not in settings */}
        {tab !== 'settings' && (
          <div className="border-t border-gray-200/50 bg-white/50 backdrop-blur-sm">
            <OcrResult />
          </div>
        )}
      </main>

      {/* Apple Design: Bottom status bar */}
      <footer className="flex items-center justify-between px-4 py-1.5 border-t border-gray-200/50 text-[10px] text-gray-400">
        <span>快捷键: Ctrl+Shift+Q</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  );
}

export default App;
