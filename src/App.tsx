import { useState } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';
import Settings from './components/Settings';

type Tab = 'screenshot' | 'file' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'screenshot', label: '截图识别' },
  { key: 'file', label: '文件识别' },
  { key: 'settings', label: '设置' },
];

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">须臾OCR</h1>
          <p className="text-xs text-gray-400">Moments captured, text revealed</p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left panel: tab content */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto p-8">
          {tab === 'screenshot' && <ScreenshotTool />}
          {tab === 'file' && <FileUploader />}
          {tab === 'settings' && <div className="w-full max-w-xl"><Settings /></div>}
        </div>

        {/* Right panel: OCR result (hidden for settings tab) */}
        {tab !== 'settings' && (
          <aside className="w-[420px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
            <OcrResult />
          </aside>
        )}
      </main>
    </div>
  );
}

export default App;
