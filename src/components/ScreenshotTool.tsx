import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useScreenshotStore } from '../stores/screenshotStore';
import { convertFileSrc } from '@tauri-apps/api/core';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      // 1. 隐藏应用窗口
      const appWindow = getCurrentWindow();
      await appWindow.hide();
      
      // 2. 等待窗口完全隐藏
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3. 全屏截图（此时屏幕上是其他应用/桌面）
      const path = await invoke<string>('take_screenshot');
      setFullScreenImage(convertFileSrc(path));
      setShowOverlay(true);
    } catch (err) {
      console.error('Screenshot error:', err);
      setError(String(err));
      setCapturing(false);
      // 出错时恢复窗口
      try {
        await getCurrentWindow().show();
      } catch {}
    }
  }, [setCapturing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setSelection({ x: e.clientX, y: e.clientY, x2: e.clientX, y2: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !selection) return;
    setSelection({ ...selection, x2: e.clientX, y2: e.clientY });
  }, [isDragging, selection]);

  const handleMouseUp = useCallback(async () => {
    if (!selection || !isDragging) return;
    setIsDragging(false);

    const x = Math.min(selection.x, selection.x2);
    const y = Math.min(selection.y, selection.y2);
    const width = Math.abs(selection.x2 - selection.x);
    const height = Math.abs(selection.y2 - selection.y);

    setShowOverlay(false);
    setSelection(null);

    // 如果选区太小，取消
    if (width < 10 || height < 10) {
      setCapturing(false);
      try {
        await getCurrentWindow().show();
      } catch {}
      return;
    }

    try {
      // 4. 裁剪选区
      const path = await invoke<string>('take_screenshot_region', {
        x, y, width, height
      });
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      console.error('Region capture error:', err);
      setError(String(err));
    } finally {
      setCapturing(false);
      // 5. 恢复应用窗口
      try {
        await getCurrentWindow().show();
      } catch {}
    }
  }, [selection, isDragging, setCapturing, setScreenshotPath]);

  const handleCancel = useCallback(async () => {
    setShowOverlay(false);
    setSelection(null);
    setCapturing(false);
    try {
      await getCurrentWindow().show();
    } catch {}
  }, [setCapturing]);

  // 监听全局快捷键
  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => {
      handleScreenshot();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleScreenshot]);

  // ESC 取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showOverlay) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOverlay, handleCancel]);

  // 全屏截图覆盖层 - 用户在这里选择区域
  if (showOverlay && fullScreenImage) {
    const rect = selection ? {
      left: Math.min(selection.x, selection.x2),
      top: Math.min(selection.y, selection.y2),
      width: Math.abs(selection.x2 - selection.x),
      height: Math.abs(selection.y2 - selection.y),
    } : null;

    return (
      <div
        className="screenshot-overlay"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img src={fullScreenImage} className="screenshot-image" draggable={false} />
        
        {rect && rect.width > 0 && rect.height > 0 && (
          <div className="screenshot-selection" style={rect}>
            <div className="screenshot-size">
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </div>
          </div>
        )}

        <div className="screenshot-hint">
          拖拽选择要识别的区域 · ESC 取消
        </div>
      </div>
    );
  }

  // 主界面按钮
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
