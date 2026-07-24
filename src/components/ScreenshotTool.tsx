import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [selection, setSelection] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      // 调用 Rust 截图，返回 base64
      const base64 = await invoke<string>('start_screenshot');
      setImageBase64(base64);
      setShowOverlay(true);
    } catch (err) {
      setError(String(err));
      setCapturing(false);
      // 出错时恢复窗口
      try { await invoke('finish_screenshot'); } catch {}
    }
  }, [setCapturing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setSelection({ x: e.clientX, y: e.clientY, x2: e.clientX, y2: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection(prev => prev ? { ...prev, x2: e.clientX, y2: e.clientY } : null);
  }, [isDragging]);

  const handleMouseUp = useCallback(async () => {
    if (!isDragging || !selection) return;
    setIsDragging(false);

    const x = Math.min(selection.x, selection.x2);
    const y = Math.min(selection.y, selection.y2);
    const width = Math.abs(selection.x2 - selection.x);
    const height = Math.abs(selection.y2 - selection.y);

    setShowOverlay(false);
    setSelection(null);

    if (width < 10 || height < 10) {
      setCapturing(false);
      await invoke('finish_screenshot');
      return;
    }

    try {
      const path = await invoke<string>('crop_screenshot_base64', { x, y, width, height });
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      setError(String(err));
    }

    setCapturing(false);
    await invoke('finish_screenshot');
  }, [isDragging, selection, setCapturing, setScreenshotPath]);

  const handleCancel = useCallback(async () => {
    setShowOverlay(false);
    setSelection(null);
    setCapturing(false);
    await invoke('finish_screenshot');
  }, [setCapturing]);

  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => handleScreenshot());
    return () => { unlisten.then(fn => fn()); };
  }, [handleScreenshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showOverlay) handleCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOverlay, handleCancel]);

  // 截图覆盖层 - 全屏黑色背景 + 截图
  if (showOverlay && imageBase64) {
    const rect = selection ? {
      left: Math.min(selection.x, selection.x2),
      top: Math.min(selection.y, selection.y2),
      width: Math.abs(selection.x2 - selection.x),
      height: Math.abs(selection.y2 - selection.y),
    } : null;

    return (
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#000', zIndex: 99999, cursor: 'crosshair' }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
        
        <img src={`data:image/png;base64,${imageBase64}`} 
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false} />
        
        {rect && rect.width > 0 && rect.height > 0 && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', pointerEvents: 'none',
              clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)` }} />
            <div style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height, border: '2px solid #007AFF', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: rect.left + rect.width / 2, top: rect.top - 24, transform: 'translateX(-50%)', padding: '2px 8px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 11, borderRadius: 3, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </div>
          </>
        )}

        {!isDragging && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 13, borderRadius: 6, pointerEvents: 'none' }}>
            拖拽选择要识别的区域 · ESC 取消
          </div>
        )}
      </div>
    );
  }

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
