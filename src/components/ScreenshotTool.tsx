import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, screenshotPath, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);

  const handleFullScreen = async () => {
    setCapturing(true);
    setError(null);
    try {
      const path = await invoke<string>('take_screenshot');
      setScreenshotPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setCapturing(false);
    }
  };

  const handleRegion = async () => {
    setCapturing(true);
    setError(null);
    try {
      const path = await invoke<string>('take_screenshot_region', {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
      setScreenshotPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3">
        <button
          onClick={handleFullScreen}
          disabled={isCapturing}
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCapturing ? '截图中...' : '全屏截图'}
        </button>
        <button
          onClick={handleRegion}
          disabled={isCapturing}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCapturing ? '截图中...' : '区域截图'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm max-w-md">
          {error}
        </div>
      )}

      {screenshotPath && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600 max-w-md break-all">
          截图已保存: {screenshotPath}
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
