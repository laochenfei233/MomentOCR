import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [fullScreenBase64, setFullScreenBase64] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const enterScreenshotMode = useCallback(async () => {
    const win = getCurrentWindow();
    // 保存当前状态
    await win.setFullscreen(true);
    await win.setAlwaysOnTop(true);
    await win.setFocus();
  }, []);

  const exitScreenshotMode = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setFullscreen(false);
    await win.setAlwaysOnTop(false);
  }, []);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    setShowOverlay(false);
    
    try {
      // 1. 进入截图模式（全屏）
      await enterScreenshotMode();
      
      // 2. 等待窗口稳定
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 3. 全屏截图
      const base64 = await invoke<string>('take_screenshot_base64');
      setFullScreenBase64(base64);
      setShowOverlay(true);
    } catch (err) {
      console.error('Screenshot error:', err);
      setError(String(err));
      setCapturing(false);
      await exitScreenshotMode();
    }
  }, [setCapturing, enterScreenshotMode, exitScreenshotMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setSelection({ x: e.clientX, y: e.clientY, x2: e.clientX, y2: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection(prev => prev ? { ...prev, x2: e.clientX, y2: e.clientY } : null);
  }, [isDragging]);

  const handleMouseUp = useCallback(async () => {
    if (!isDragging || !selection || !fullScreenBase64) return;
    setIsDragging(false);

    const x = Math.min(selection.x, selection.x2);
    const y = Math.min(selection.y, selection.y2);
    const width = Math.abs(selection.x2 - selection.x);
    const height = Math.abs(selection.y2 - selection.y);

    // 退出截图模式
    await exitScreenshotMode();
    setShowOverlay(false);

    if (width < 10 || height < 10) {
      setSelection(null);
      setCapturing(false);
      return;
    }

    try {
      const path = await invoke<string>('crop_screenshot', {
        fullScreenBase64, x, y, width, height
      });
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      setError(String(err));
    }

    setSelection(null);
    setCapturing(false);
  }, [isDragging, selection, fullScreenBase64, setCapturing, setScreenshotPath, exitScreenshotMode]);

  const handleCancel = useCallback(async () => {
    await exitScreenshotMode();
    setShowOverlay(false);
    setSelection(null);
    setCapturing(false);
  }, [setCapturing, exitScreenshotMode]);

  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => handleScreenshot());
    return () => { unlisten.then(fn => fn()); };
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

  // 截图覆盖层 - Snipaste 风格
  if (showOverlay && fullScreenBase64) {
    const rect = selection ? {
      left: Math.min(selection.x, selection.x2),
      top: Math.min(selection.y, selection.y2),
      width: Math.abs(selection.x2 - selection.x),
      height: Math.abs(selection.y2 - selection.y),
    } : null;

    return (
      <div
        className="snipaste-overlay"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img src={`data:image/png;base64,${fullScreenBase64}`} className="snipaste-image" draggable={false} />
        
        {rect && rect.width > 0 && rect.height > 0 && (
          <>
            <div className="snipaste-mask" style={{
              clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
            }} />
            <div className="snipaste-border" style={rect} />
            <div className="snipaste-size" style={{ left: rect.left + rect.width / 2, top: rect.top - 24 }}>
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </div>
          </>
        )}

        <div className="snipaste-hint">
          {isDragging ? '松开鼠标完成选择' : '拖拽选择要识别的区域 · ESC 取消'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <button onClick={handleScreenshot} disabled={isCapturing} className="screenshot-btn">
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
