import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      await invoke('start_screenshot');
    } catch (err) {
      setError(String(err));
      setCapturing(false);
    }
  }, [setCapturing]);

  useEffect(() => {
    const unlisten = listen<{ path: string }>('screenshot-cropped', (event) => {
      setScreenshotPath(event.payload.path);
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
    });

    const unlistenShortcut = listen('screenshot-triggered', () => {
      handleScreenshot();
    });

    return () => {
      unlisten.then(fn => fn());
      unlistenShortcut.then(fn => fn());
    };
  }, [handleScreenshot, setCapturing, setScreenshotPath]);

  return (
    <div className="p-3">
      <button
        onClick={handleScreenshot}
        disabled={isCapturing}
        className="screenshot-btn"
      >
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
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
