import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
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
      
      // 3. 创建全屏覆盖窗口
      const overlay = new WebviewWindow('screenshot-overlay', {
        url: '/screenshot-overlay',
        title: '截图',
        fullscreen: true,
        alwaysOnTop: true,
        decorations: false,
        skipTaskbar: true,
        visible: true,
      });

      // 4. 等待窗口加载后发送截图数据
      overlay.once('tauri://ready', async () => {
        // 通过事件发送 base64 数据
        const { emit } = await import('@tauri-apps/api/event');
        await emit('screenshot-data', { base64 });
      });

      // 5. 监听截图完成事件
      const { listen } = await import('@tauri-apps/api/event');
      await listen<{ path: string }>('screenshot-done', async (event) => {
        setScreenshotPath(event.payload.path);
        setCaptureSuccess(true);
        setTimeout(() => setCaptureSuccess(false), 1500);
        setCapturing(false);
        // 显示主窗口
        await mainWindow.show();
        await mainWindow.setFocus();
      });

      // 6. 监听截图取消事件
      await listen('screenshot-cancel', async () => {
        setCapturing(false);
        await mainWindow.show();
        await mainWindow.setFocus();
      });

    } catch (err) {
      console.error('Screenshot error:', err);
      setError(String(err));
      setCapturing(false);
      // 出错时恢复主窗口
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
