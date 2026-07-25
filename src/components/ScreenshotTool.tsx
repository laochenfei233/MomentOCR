import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [lastImagePath, setLastImagePath] = useState<string | null>(null);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      await invoke<string>('start_screenshot_overlay');
    } catch (err) {
      setError(String(err));
      setCapturing(false);
    }
  }, [setCapturing]);

  const handleCopyImage = useCallback(async () => {
    if (!lastImagePath) return;
    try {
      await invoke('copy_image_to_clipboard', { path: lastImagePath });
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      setError(String(err));
    }
  }, [lastImagePath]);

  const handleSaveImage = useCallback(async () => {
    if (!lastImagePath) return;
    try {
      const savePath = await invoke<string>('save_screenshot_dialog');
      if (savePath) {
        await invoke('copy_file', { from: lastImagePath, to: savePath });
        setCaptureSuccess(true);
        setTimeout(() => setCaptureSuccess(false), 1500);
      }
    } catch (err) {
      if (err !== 'Cancelled') {
        setError(String(err));
      }
    }
  }, [lastImagePath]);

  useEffect(() => {
    const unlisten1 = listen<string>('screenshot-cropped', (event) => {
      setScreenshotPath(event.payload);
      setLastImagePath(event.payload);
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
    });

    const unlisten2 = listen('screenshot-cancel', () => {
      setCapturing(false);
    });

    const unlisten3 = listen<string>('screenshot-error', (event) => {
      setError(event.payload);
      setCapturing(false);
    });

    const unlisten4 = listen('screenshot-triggered', () => {
      handleScreenshot();
    });

    return () => {
      unlisten1.then(fn => fn());
      unlisten2.then(fn => fn());
      unlisten3.then(fn => fn());
      unlisten4.then(fn => fn());
    };
  }, [handleScreenshot, setCapturing, setScreenshotPath]);

  return (
    <div style={{ padding: 12 }}>
      <button onClick={handleScreenshot} disabled={isCapturing} className="screenshot-btn">
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
      </button>
      
      {lastImagePath && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={handleCopyImage} style={{
            flex: 1, padding: '8px 12px', fontSize: 12, background: '#F2F2F7',
            border: '0.5px solid #D1D1D6', borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            复制
          </button>
          <button onClick={handleSaveImage} style={{
            flex: 1, padding: '8px 12px', fontSize: 12, background: '#F2F2F7',
            border: '0.5px solid #D1D1D6', borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            保存
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,59,48,0.08)', borderRadius: 8, fontSize: 11, color: '#FF3B30' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
