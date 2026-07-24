import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
      // 先全屏截图
      const path = await invoke<string>('take_screenshot');
      setFullScreenImage(convertFileSrc(path));
      setShowOverlay(true);
    } catch (err) {
      setError(String(err));
      setCapturing(false);
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

    if (width < 10 || height < 10) {
      setShowOverlay(false);
      setSelection(null);
      setCapturing(false);
      return;
    }

    try {
      const path = await invoke<string>('take_screenshot_region', {
        x, y, width, height
      });
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setShowOverlay(false);
      setSelection(null);
      setCapturing(false);
    }
  }, [selection, isDragging, setCapturing, setScreenshotPath]);

  const handleCancel = useCallback(() => {
    setShowOverlay(false);
    setSelection(null);
    setCapturing(false);
  }, [setCapturing]);

  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => {
      handleScreenshot();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleScreenshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showOverlay) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOverlay, handleCancel]);

  // 截图覆盖层
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
          拖拽选择区域 · ESC 取消
        </div>
      </div>
    );
  }

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
