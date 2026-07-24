import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      // 调用Python覆盖窗口
      const path = await invoke<string>('start_screenshot_overlay');
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      // 用户取消不算错误
      if (err !== 'Cancelled') {
        setError(String(err));
      }
    } finally {
      setCapturing(false);
    }
  }, [setCapturing, setScreenshotPath]);

  useEffect(() => {
    import('@tauri-apps/api/event').then(({ listen }) => {
      const unlisten = listen('screenshot-triggered', () => handleScreenshot());
      return () => { unlisten.then((fn: () => void) => fn()); };
    });
  }, [handleScreenshot]);

  return (
    <div className="p-3">
      <button onClick={handleScreenshot} disabled={isCapturing} className="screenshot-btn">
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
      </button>
      {error && <div className="error-msg"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
    </div>
  );
}

export default ScreenshotTool;
