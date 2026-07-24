import ScreenshotTool from './components/ScreenshotTool';
import OcrResult from './components/OcrResult';

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800">须臾OCR</h1>
        <p className="mt-2 text-lg text-gray-500">Moments captured, text revealed</p>
        <div className="mt-8">
          <ScreenshotTool />
        </div>
        <OcrResult />
      </div>
    </div>
  );
}

export default App;
