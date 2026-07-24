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
      // 1. 截图并获取 base64
      const base64 = await invoke<string>('capture_screen');
      
      // 2. 隐藏主窗口
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const mainWindow = getCurrentWindow();
      await mainWindow.hide();
      
      // 3. 等待窗口隐藏
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 4. 创建全屏覆盖窗口
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      new WebviewWindow('screenshot-overlay', {
        url: '/screenshot-overlay',
        title: '截图',
        fullscreen: true,
        alwaysOnTop: true,
        decorations: false,
        skipTaskbar: true,
        visible: true,
      });

      // 5. 等待窗口完全加载
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 6. 发送截图数据
      const { emit } = await import('@tauri-apps/api/event');
      await emit('screenshot-data', { base64 });

      // 7. 监听截图完成事件
      const { listen } = await import('@tauri-apps/api/event');
      const unlistenDone = await listen<{ path: string }>('screenshot-done', async (event) => {
        setScreenshotPath(event.payload.path);
        setCaptureSuccess(true);
        setTimeout(() => setCaptureSuccess(false), 1500);
        setCapturing(false);
        await mainWindow.show();
        await mainWindow.setFocus();
        unlistenDone();
        unlistenCancel();
      });

      const unlistenCancel = await listen('screenshot-cancel', async () => {
        setCapturing(false);
        await mainWindow.show();
        await mainWindow.setFocus();
        unlistenDone();
        unlistenCancel();
      });

    } catch (err) {
      console.error('Screenshot error:', err);
      setError(String(err));
      setCapturing(false);
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().show();
      } catch {}
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
