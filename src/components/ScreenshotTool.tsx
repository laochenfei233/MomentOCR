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
  const [showToolbar, setShowToolbar] = useState(false);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    setShowOverlay(false);
    setShowToolbar(false);
    
    try {
      // 1. 隐藏主窗口
      const appWindow = getCurrentWindow();
      await appWindow.hide();
      
      // 2. 等待窗口隐藏
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 3. 全屏截图
      const base64 = await invoke<string>('take_screenshot_base64');
      setFullScreenBase64(base64);
      
      // 4. 设置窗口为全屏、置顶、透明
      await appWindow.setFullscreen(true);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.show();
      
      // 5. 显示截图覆盖层
      setShowOverlay(true);
    } catch (err) {
      console.error('Screenshot error:', err);
      setError(String(err));
      setCapturing(false);
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setFullscreen(false);
        await appWindow.setAlwaysOnTop(false);
        await appWindow.show();
      } catch {}
    }
  }, [setCapturing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (showToolbar) return;
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({ x: e.clientX, y: e.clientY, x2: e.clientX, y2: e.clientY });
  }, [showToolbar]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !selection) return;
    setSelection({ ...selection, x2: e.clientX, y2: e.clientY });
  }, [isDragging, selection]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !selection) return;
    setIsDragging(false);

    const width = Math.abs(selection.x2 - selection.x);
    const height = Math.abs(selection.y2 - selection.y);

    if (width < 10 || height < 10) {
      setSelection(null);
      return;
    }

    // 显示工具栏
    setShowToolbar(true);
  }, [isDragging, selection]);

  const handleOcr = useCallback(async () => {
    if (!selection || !fullScreenBase64) return;
    
    const x = Math.min(selection.x, selection.x2);
    const y = Math.min(selection.y, selection.y2);
    const width = Math.abs(selection.x2 - selection.x);
    const height = Math.abs(selection.y2 - selection.y);

    try {
      const path = await invoke<string>('crop_screenshot', {
        fullScreenBase64,
        x, y, width, height
      });
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      console.error('OCR error:', err);
      setError(String(err));
    }

    // 恢复窗口
    await restoreWindow();
  }, [selection, fullScreenBase64, setScreenshotPath]);

  const handleCancel = useCallback(async () => {
    setShowOverlay(false);
    setSelection(null);
    setShowToolbar(false);
    setCapturing(false);
    await restoreWindow();
  }, [setCapturing]);

  const restoreWindow = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setFullscreen(false);
      await appWindow.setAlwaysOnTop(false);
      await appWindow.show();
      setShowOverlay(false);
      setSelection(null);
      setShowToolbar(false);
      setCapturing(false);
    } catch {}
  };

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
        {/* 背景截图 */}
        <img 
          src={`data:image/png;base64,${fullScreenBase64}`} 
          className="snipaste-image" 
          draggable={false} 
        />
        
        {/* 选区 */}
        {rect && rect.width > 0 && rect.height > 0 && (
          <>
            {/* 选区外的暗色遮罩 */}
            <div className="snipaste-mask" style={{
              clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
            }} />
            
            {/* 选区边框 */}
            <div className="snipaste-border" style={rect} />
            
            {/* 尺寸标签 */}
            <div className="snipaste-size" style={{
              left: rect.left + rect.width / 2,
              top: rect.top - 24,
            }}>
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </div>

            {/* 工具栏 */}
            {showToolbar && (
              <div className="snipaste-toolbar" style={{
                left: rect.left + rect.width / 2,
                top: rect.top + rect.height + 8,
              }}>
                <button onClick={handleOcr} className="snipaste-btn primary">
                  识别
                </button>
                <button onClick={handleCancel} className="snipaste-btn">
                  取消
                </button>
              </div>
            )}
          </>
        )}

        {/* 提示文字 */}
        {!isDragging && !showToolbar && (
          <div className="snipaste-hint">
            拖拽选择区域
          </div>
        )}
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
