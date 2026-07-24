import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useScreenshotStore } from '../stores/screenshotStore';
import RegionSelector from './RegionSelector';

function ScreenshotTool() {
  const { isCapturing, setCapturing, screenshotPath, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [showRegionSelector, setShowRegionSelector] = useState(false);

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

  const handleRegionSelect = useCallback(async (region: { x: number; y: number; width: number; height: number }) => {
    setShowRegionSelector(false);
    setCapturing(true);
    setError(null);
    try {
      const path = await invoke<string>('take_screenshot_region', {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      });
      setScreenshotPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setCapturing(false);
    }
  }, [setCapturing, setScreenshotPath]);

  const handleRegionCancel = useCallback(() => {
    setShowRegionSelector(false);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      {showRegionSelector && (
        <RegionSelector onSelect={handleRegionSelect} onCancel={handleRegionCancel} />
      )}

      <div className="flex gap-3">
        <button
          onClick={handleFullScreen}
          disabled={isCapturing || showRegionSelector}
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCapturing ? '截图中...' : '全屏截图'}
        </button>
        <button
          onClick={() => setShowRegionSelector(true)}
          disabled={isCapturing || showRegionSelector}
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
