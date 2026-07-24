import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

export default function ScreenshotOverlay() {
  const [imageBase64, setImageBase64] = useState<string>('');
  const [selection, setSelection] = useState<{
    startX: number; startY: number;
    endX: number; endY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  // 监听截图数据
  useEffect(() => {
    const unlisten = listen<{ base64: string }>('screenshot-data', (event) => {
      setImageBase64(event.payload.base64);
    });
    return () => { unlisten.then(fn => fn()); };
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
      const cropPath = await invoke<string>('crop_screenshot', { x, y, width, height });
      // 发送完成事件
      const { emit } = await import('@tauri-apps/api/event');
      await emit('screenshot-done', { path: cropPath });
      // 关闭覆盖窗口
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Crop failed:', err);
      const { emit } = await import('@tauri-apps/api/event');
      await emit('screenshot-cancel');
      await getCurrentWindow().close();
    }
  }, [selection]);

  const handleCancel = useCallback(async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('screenshot-cancel');
      await getCurrentWindow().close();
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
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#000', cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {imageBase64 && (
        <img
          src={`data:image/png;base64,${imageBase64}`}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      )}

      {rect && (
        <div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', pointerEvents: 'none',
            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
          }}
        />
      )}

      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height, border: '2px solid #007AFF', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: rect.left + rect.width / 2, top: rect.top - 24, transform: 'translateX(-50%)', padding: '2px 8px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 11, borderRadius: 3, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}

      {!isDragging && !showToolbar && !selection && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 13, borderRadius: 6, pointerEvents: 'none' }}>
          拖拽选择要识别的区域 · ESC 取消
        </div>
      )}

      {showToolbar && rect && (
        <div style={{ position: 'absolute', left: rect.left + rect.width / 2, top: rect.top + rect.height + 8, transform: 'translateX(-50%)', display: 'flex', gap: 4, padding: 4, background: 'white', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}>
          <button onClick={handleConfirm} style={{ padding: '6px 16px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>识别</button>
          <button onClick={handleCancel} style={{ padding: '6px 16px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>取消</button>
        </div>
      )}
    </div>
  );
}
