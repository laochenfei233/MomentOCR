import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import RegionSelector from './RegionSelector';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const handleScreenshot = useCallback(() => {
    setShowRegionSelector(true);
  }, []);

  const handleRegionSelect = useCallback(
    async (region: { x: number; y: number; width: number; height: number }) => {
      setShowRegionSelector(false);
      setCapturing(true);
      setError(null);
      setCaptureSuccess(false);
      try {
        const path = await invoke<string>('take_screenshot_region', {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        });
        setScreenshotPath(path);
        setCaptureSuccess(true);
        setTimeout(() => setCaptureSuccess(false), 1500);
      } catch (err) {
        setError(String(err));
      } finally {
        setCapturing(false);
      }
    },
    [setCapturing, setScreenshotPath]
  );

  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => {
      handleScreenshot();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleScreenshot]);

  if (showRegionSelector) {
    return (
      <RegionSelector
        onSelect={handleRegionSelect}
        onCancel={() => setShowRegionSelector(false)}
      />
    );
  }

  return (
    <div className="p-2">
      <button
        onClick={handleScreenshot}
        disabled={isCapturing}
        className="screenshot-btn"
      >
        {isCapturing ? (
          <span>识别中...</span>
        ) : captureSuccess ? (
          <span className="text-green-500">✓ 完成</span>
        ) : (
          <span>截图</span>
        )}
      </button>

      {error && (
        <div className="error-msg">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
