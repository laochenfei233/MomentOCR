import { useState } from 'react';
import ScreenshotTool from './components/ScreenshotTool';
import FileUploader from './components/FileUploader';
import OcrResult from './components/OcrResult';

type Tab = 'screenshot' | 'file';

function App() {
  const [tab, setTab] = useState<Tab>('screenshot');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800">须臾OCR</h1>
        <p className="mt-2 text-lg text-gray-500">Moments captured, text revealed</p>

        <div className="mt-8 flex justify-center gap-1 rounded-lg bg-gray-200 p-1 mx-auto max-w-xs">
          <button
            onClick={() => setTab('screenshot')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'screenshot' ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            截图识别
          </button>
          <button
            onClick={() => setTab('file')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'file' ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            文件识别
          </button>
        </div>

        <div className="mt-8">
          {tab === 'screenshot' ? <ScreenshotTool /> : <FileUploader />}
        </div>
        <OcrResult />
      </div>
    </div>
  );
}

export default App;
