import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSnipasteStore } from '../stores/snipasteStore';

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export default function SnipasteOverlay() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isLongScreenshot, setIsLongScreenshot] = useState(false);
  const [showContinueBtn, setShowContinueBtn] = useState(false);

  const {
    activeTool,
    setActiveTool,
    addAnnotation,
    undoAnnotation,
  } = useSnipasteStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 检查是否为长截图模式
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsLongScreenshot(params.get('mode') === 'long');
  }, []);

  // 加载截图
  useEffect(() => {
    const loadScreenshot = async () => {
      try {
        const path = await invoke<string>('get_screenshot_path');
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const assetUrl = convertFileSrc(path);
        setImageSrc(assetUrl);
      } catch (err) {
        console.error('Failed to load screenshot:', err);
      }
    };
    loadScreenshot();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (showToolbar || activeTool) return;
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    });
  }, [showToolbar, activeTool]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection(prev => prev ? {
      ...prev,
      endX: e.clientX,
      endY: e.clientY
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

  // 标注工具点击处理
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTool) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newAnnotation = {
      id: Date.now().toString(),
      type: activeTool,
      x,
      y,
      color: '#FF3B30',
      ...(activeTool === 'arrow' ? { endX: x + 50, endY: y } : {}),
      ...(activeTool === 'rectangle' ? { width: 100, height: 100 } : {}),
      ...(activeTool === 'text' ? { text: '标注文字' } : {}),
    };
    
    addAnnotation(newAnnotation);
    setActiveTool(null);
  }, [activeTool, addAnnotation, setActiveTool]);

  // ESC 取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        undoAnnotation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoAnnotation]);

  const rect = selection ? {
    left: Math.min(selection.startX, selection.endX),
    top: Math.min(selection.startY, selection.endY),
    width: Math.abs(selection.endX - selection.startX),
    height: Math.abs(selection.endY - selection.startY),
  } : null;

  const handleConfirm = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('snipaste_crop_region', { x, y, width, height });
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-cropped', { path: cropPath });
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Crop failed:', err);
      await getCurrentWindow().close();
    }
  }, [selection]);

  const handleCancel = useCallback(async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-cancel');
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('snipaste_crop_region', { x, y, width, height });
      await invoke('snipaste_save_screenshot', { path: cropPath });
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [selection]);

  const handleCopy = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('snipaste_crop_region', { x, y, width, height });
      await invoke('snipaste_copy_to_clipboard', { path: cropPath });
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, [selection]);

  const handlePin = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('snipaste_crop_region', { x, y, width, height });
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const imageData = convertFileSrc(cropPath);
      
      // 发送事件创建贴图窗口
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-create-pin', {
        imageData,
        x: selection.startX,
        y: selection.startY,
        width,
        height
      });
      
      // 继续截图（不清除选区）
      setShowToolbar(false);
      setSelection(null);
    } catch (err) {
      console.error('Pin failed:', err);
    }
  }, [selection]);

  const handleOCR = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    
    try {
      const cropPath = await invoke<string>('snipaste_crop_region', { x, y, width, height });
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-ocr', { path: cropPath });
      await getCurrentWindow().close();
    } catch (err) {
      console.error('OCR failed:', err);
    }
  }, [selection]);

  // 长截图：继续截图
  const handleContinueLongScreenshot = useCallback(async () => {
    try {
      const newPath = await invoke<string>('snipaste_capture_next');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      setImageSrc(convertFileSrc(newPath));
      setSelection(null);
      setShowToolbar(false);
      setShowContinueBtn(false);
    } catch (err) {
      console.error('Continue long screenshot failed:', err);
    }
  }, []);

  // 长截图：完成拼接
  const handleFinishLongScreenshot = useCallback(async () => {
    try {
      const stitchedPath = await invoke<string>('snipaste_stitch_screenshots');
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-stitched', { path: stitchedPath });
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Finish long screenshot failed:', err);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#000', cursor: activeTool ? 'crosshair' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 截图背景 */}
      {imageSrc && (
        <img
          src={imageSrc}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
          onError={(e) => console.error('Image load error:', e)}
        />
      )}

      {/* 标注画布 */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: activeTool ? 'auto' : 'none' }}
        onClick={handleCanvasClick}
      />

      {/* 选区外的暗色遮罩 */}
      {rect && (
        <div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', pointerEvents: 'none',
            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
          }}
        />
      )}

      {/* 选区边框 */}
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height, border: '2px solid #007AFF', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: rect.left + rect.width / 2, top: rect.top - 24, transform: 'translateX(-50%)', padding: '2px 8px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 11, borderRadius: 3, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}

      {/* 提示文字 */}
      {!isDragging && !showToolbar && !selection && !activeTool && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 13, borderRadius: 6, pointerEvents: 'none' }}>
          {isLongScreenshot ? '拖拽选择区域 · ESC 取消' : '拖拽选择要识别的区域 · ESC 取消'}
        </div>
      )}

      {/* 标注工具提示 */}
      {activeTool && (
        <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 12, borderRadius: 4, pointerEvents: 'none' }}>
          点击添加{activeTool === 'arrow' ? '箭头' : activeTool === 'rectangle' ? '矩形' : activeTool === 'text' ? '文字' : '马赛克'} · ESC 取消
        </div>
      )}

      {/* 主工具栏 */}
      {showToolbar && rect && (
        <div style={{
          position: 'absolute',
          left: rect.left + rect.width / 2,
          top: rect.top + rect.height + 8,
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'white',
          borderRadius: 6,
          boxShadow: '0 2px 12px rgba(0,0,0,0.2)'
        }}>
          {/* 标注工具 */}
          <button
            onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')}
            style={{
              padding: '6px 10px',
              background: activeTool === 'arrow' ? '#007AFF' : '#f0f0f0',
              color: activeTool === 'arrow' ? 'white' : '#333',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="箭头 (A)"
          >
            →
          </button>
          <button
            onClick={() => setActiveTool(activeTool === 'rectangle' ? null : 'rectangle')}
            style={{
              padding: '6px 10px',
              background: activeTool === 'rectangle' ? '#007AFF' : '#f0f0f0',
              color: activeTool === 'rectangle' ? 'white' : '#333',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="矩形 (R)"
          >
            □
          </button>
          <button
            onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')}
            style={{
              padding: '6px 10px',
              background: activeTool === 'text' ? '#007AFF' : '#f0f0f0',
              color: activeTool === 'text' ? 'white' : '#333',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="文字 (T)"
          >
            T
          </button>
          <button
            onClick={() => setActiveTool(activeTool === 'mosaic' ? null : 'mosaic')}
            style={{
              padding: '6px 10px',
              background: activeTool === 'mosaic' ? '#007AFF' : '#f0f0f0',
              color: activeTool === 'mosaic' ? 'white' : '#333',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="马赛克 (M)"
          >
            ■
          </button>
          
          <div style={{ width: 1, background: '#E5E5EA', margin: '0 4px' }} />
          
          {/* 操作按钮 */}
          <button onClick={handleSave} style={{ padding: '6px 12px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            保存
          </button>
          <button onClick={handleCopy} style={{ padding: '6px 12px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            复制
          </button>
          <button onClick={handlePin} style={{ padding: '6px 12px', background: '#34C759', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            贴图
          </button>
          <button onClick={handleOCR} style={{ padding: '6px 12px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            OCR
          </button>
          <button onClick={handleConfirm} style={{ padding: '6px 12px', background: '#FF9500', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            识别
          </button>
          <button onClick={handleCancel} style={{ padding: '6px 12px', background: '#FF3B30', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
            取消
          </button>
        </div>
      )}

      {/* 长截图继续按钮 */}
      {isLongScreenshot && showContinueBtn && (
        <div style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8
        }}>
          <button
            onClick={handleContinueLongScreenshot}
            style={{
              padding: '10px 20px',
              background: '#007AFF',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          >
            继续截图
          </button>
          <button
            onClick={handleFinishLongScreenshot}
            style={{
              padding: '10px 20px',
              background: '#34C759',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          >
            完成拼接
          </button>
        </div>
      )}
    </div>
  );
}
