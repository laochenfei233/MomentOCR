import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function ScreenshotOverlay() {
  const [imageBase64, setImageBase64] = useState<string>('');
  const [selection, setSelection] = useState<{
    startX: number; startY: number;
    endX: number; endY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  useEffect(() => {
    const loadScreenshot = async () => {
      try {
        const base64 = await invoke<string>('get_screenshot_base64');
        setImageBase64(base64);
      } catch (err) {
        console.error('Failed to load screenshot:', err);
      }
    };
    loadScreenshot();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (showToolbar) return;
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({
      startX: e.clientX, startY: e.clientY,
      endX: e.clientX, endY: e.clientY
    });
  }, [showToolbar]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection(prev => prev ? {
      ...prev, endX: e.clientX, endY: e.clientY
    } : null);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !selection) return;
    setIsDragging(false);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    if (width > 10 && height > 10) {
      setShowToolbar(true);
    } else {
      setSelection(null);
    }
  }, [isDragging, selection]);

  const handleConfirm = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('crop_screenshot_base64', { x, y, width, height });
      const { emit } = await import('@tauri-apps/api/event');
      await emit('screenshot-cropped', { path: cropPath });
      await invoke('finish_screenshot');
    } catch (err) {
      console.error('Crop failed:', err);
      await invoke('finish_screenshot');
    }
  }, [selection]);

  const handleCancel = useCallback(async () => {
    try {
      await invoke('finish_screenshot');
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancel]);

  const rect = selection ? {
    left: Math.min(selection.startX, selection.endX),
    top: Math.min(selection.startY, selection.endY),
    width: Math.abs(selection.endX - selection.startX),
    height: Math.abs(selection.endY - selection.startY),
  } : null;

  return (
    <div
      className="fixed inset-0 cursor-crosshair bg-black"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {imageBase64 && (
        <img
          src={`data:image/png;base64,${imageBase64}`}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      )}

      {rect && (
        <div
          className="absolute inset-0 bg-black/30 pointer-events-none"
          style={{
            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
          }}
        />
      )}

      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div className="absolute border-2 border-blue-500 pointer-events-none" style={rect} />
          <div
            className="absolute bg-black/80 text-white text-xs px-2 py-0.5 rounded pointer-events-none whitespace-nowrap"
            style={{ left: rect.left + rect.width / 2, top: rect.top - 24, transform: 'translateX(-50%)' }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}

      {!isDragging && !showToolbar && !selection && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-sm bg-black/60 px-4 py-2 rounded pointer-events-none">
          拖拽选择要识别的区域 · ESC 取消
        </div>
      )}

      {showToolbar && rect && (
        <div
          className="absolute flex gap-1 bg-white rounded shadow-lg p-1"
          style={{ left: rect.left + rect.width / 2, top: rect.top + rect.height + 8, transform: 'translateX(-50%)' }}
        >
          <button onClick={handleConfirm} className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">识别</button>
          <button onClick={handleCancel} className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300">取消</button>
        </div>
      )}
    </div>
  );
}
