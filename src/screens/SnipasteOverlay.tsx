import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSnipasteStore, type Point, type Annotation, type AnnotationType } from '../stores/snipasteStore';

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#000000', '#FFFFFF'];

export default function SnipasteOverlay() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isLongScreenshot, setIsLongScreenshot] = useState(false);
  const [showContinueBtn, setShowContinueBtn] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // 绘图状态
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);

  const {
    activeTool,
    setActiveTool,
    annotations,
    addAnnotation,
    undoAnnotation,
    annotationColor,
    setAnnotationColor,
    strokeWidth,
    setStrokeWidth,
    numberCounter,
    incrementNumber,
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

  // 绘制画布
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置画布大小
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制所有标注
    for (const annotation of annotations) {
      drawAnnotation(ctx, annotation);
    }
  }, [annotations]);

  // 绘制单个标注
  const drawAnnotation = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    ctx.save();
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.strokeWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (annotation.type) {
      case 'pen':
        drawPen(ctx, annotation);
        break;
      case 'line':
        drawLine(ctx, annotation);
        break;
      case 'arrow':
        drawArrow(ctx, annotation);
        break;
      case 'rectangle':
        drawRectangle(ctx, annotation);
        break;
      case 'text':
        drawText(ctx, annotation);
        break;
      case 'mosaic':
        drawMosaic(ctx, annotation);
        break;
      case 'highlighter':
        drawHighlighter(ctx, annotation);
        break;
      case 'number':
        drawNumber(ctx, annotation);
        break;
      case 'blur':
        drawBlur(ctx, annotation);
        break;
    }

    ctx.restore();
  };

  // 画笔
  const drawPen = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (!annotation.points || annotation.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
    for (let i = 1; i < annotation.points.length; i++) {
      ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
    }
    ctx.stroke();
  };

  // 直线
  const drawLine = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.endX === undefined || annotation.endY === undefined) return;
    ctx.beginPath();
    ctx.moveTo(annotation.x, annotation.y);
    ctx.lineTo(annotation.endX, annotation.endY);
    ctx.stroke();
  };

  // 箭头
  const drawArrow = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.endX === undefined || annotation.endY === undefined) return;
    const headLength = 15;
    const dx = annotation.endX - annotation.x;
    const dy = annotation.endY - annotation.y;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(annotation.x, annotation.y);
    ctx.lineTo(annotation.endX, annotation.endY);
    ctx.stroke();

    // 箭头
    ctx.beginPath();
    ctx.moveTo(annotation.endX, annotation.endY);
    ctx.lineTo(
      annotation.endX - headLength * Math.cos(angle - Math.PI / 6),
      annotation.endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(annotation.endX, annotation.endY);
    ctx.lineTo(
      annotation.endX - headLength * Math.cos(angle + Math.PI / 6),
      annotation.endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  };

  // 矩形
  const drawRectangle = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.width === undefined || annotation.height === undefined) return;
    ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
  };

  // 文字
  const drawText = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (!annotation.text) return;
    ctx.font = '16px sans-serif';
    ctx.fillText(annotation.text, annotation.x, annotation.y);
  };

  // 马赛克
  const drawMosaic = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.width === undefined || annotation.height === undefined) return;
    const blockSize = 10;
    ctx.fillStyle = annotation.color;
    for (let x = annotation.x; x < annotation.x + annotation.width; x += blockSize) {
      for (let y = annotation.y; y < annotation.y + annotation.height; y += blockSize) {
        ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
      }
    }
  };

  // 荧光笔
  const drawHighlighter = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (!annotation.points || annotation.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
    for (let i = 1; i < annotation.points.length; i++) {
      ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  };

  // 序号
  const drawNumber = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.number === undefined) return;
    const radius = 15;
    ctx.beginPath();
    ctx.arc(annotation.x, annotation.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(annotation.number.toString(), annotation.x, annotation.y);
    ctx.restore();
  };

  // 模糊
  const drawBlur = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    if (annotation.width === undefined || annotation.height === undefined) return;
    // 简单的像素化模糊效果
    const imageData = ctx.getImageData(annotation.x, annotation.y, annotation.width, annotation.height);
    const pixelSize = 8;
    for (let y = 0; y < annotation.height; y += pixelSize) {
      for (let x = 0; x < annotation.width; x += pixelSize) {
        const i = (y * annotation.width + x) * 4;
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(annotation.x + x, annotation.y + y, pixelSize, pixelSize);
      }
    }
  };

  // 选区外的暗色遮罩
  const rect = selection ? {
    left: Math.min(selection.startX, selection.endX),
    top: Math.min(selection.startY, selection.endY),
    width: Math.abs(selection.endX - selection.startX),
    height: Math.abs(selection.endY - selection.startY),
  } : null;

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 如果有活动工具，开始绘图
    if (activeTool) {
      setIsDrawing(true);
      const point = { x: e.clientX, y: e.clientY };
      setDrawStart(point);
      setDrawEnd(point);
      if (activeTool === 'pen' || activeTool === 'highlighter') {
        setCurrentPoints([point]);
      }
      return;
    }

    // 否则开始选区
    if (showToolbar) return;
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    });
  }, [activeTool, showToolbar]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 绘图模式
    if (isDrawing && drawStart) {
      const point = { x: e.clientX, y: e.clientY };
      setDrawEnd(point);
      if (activeTool === 'pen' || activeTool === 'highlighter') {
        setCurrentPoints(prev => [...prev, point]);
      }
      return;
    }

    // 选区模式
    if (!isDragging) return;
    setSelection(prev => prev ? {
      ...prev,
      endX: e.clientX,
      endY: e.clientY
    } : null);
  }, [isDrawing, drawStart, activeTool, isDragging]);

  // 鼠标抬起
  const handleMouseUp = useCallback(() => {
    // 绘图模式 - 完成标注
    if (isDrawing && drawStart && drawEnd && activeTool) {
      const newAnnotation: Annotation = {
        id: Date.now().toString(),
        type: activeTool,
        x: drawStart.x,
        y: drawStart.y,
        color: annotationColor,
        strokeWidth,
      };

      switch (activeTool) {
        case 'pen':
        case 'highlighter':
          newAnnotation.points = currentPoints;
          break;
        case 'line':
        case 'arrow':
          newAnnotation.endX = drawEnd.x;
          newAnnotation.endY = drawEnd.y;
          break;
        case 'rectangle':
        case 'mosaic':
        case 'blur':
          newAnnotation.width = drawEnd.x - drawStart.x;
          newAnnotation.height = drawEnd.y - drawStart.y;
          break;
        case 'text':
          const text = prompt('请输入文字:');
          if (text) {
            newAnnotation.text = text;
          } else {
            setIsDrawing(false);
            setDrawStart(null);
            setDrawEnd(null);
            setCurrentPoints([]);
            return;
          }
          break;
        case 'number':
          newAnnotation.number = numberCounter;
          incrementNumber();
          break;
      }

      addAnnotation(newAnnotation);
      setIsDrawing(false);
      setDrawStart(null);
      setDrawEnd(null);
      setCurrentPoints([]);
      return;
    }

    // 选区模式 - 完成选区
    if (!isDragging || !selection) return;
    setIsDragging(false);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    if (width > 10 && height > 10) {
      setShowToolbar(true);
    } else {
      setSelection(null);
    }
  }, [isDrawing, drawStart, drawEnd, activeTool, currentPoints, annotationColor, strokeWidth, numberCounter, isDragging, selection]);

  // ESC 取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTool) {
          setActiveTool(null);
          setIsDrawing(false);
          setDrawStart(null);
          setDrawEnd(null);
          setCurrentPoints([]);
        } else {
          handleCancel();
        }
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        undoAnnotation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, undoAnnotation]);

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

      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-create-pin', {
        imageData,
        x: selection.startX,
        y: selection.startY,
        width,
        height
      });

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

  // 工具栏按钮样式
  const toolBtnStyle = (tool: AnnotationType) => ({
    padding: '6px 10px',
    background: activeTool === tool ? '#007AFF' : '#f0f0f0',
    color: activeTool === tool ? 'white' : '#333',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer' as const,
  });

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
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
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
      {!isDragging && !showToolbar && !selection && !activeTool && !isDrawing && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 13, borderRadius: 6, pointerEvents: 'none' }}>
          {isLongScreenshot ? '拖拽选择区域 · ESC 取消' : '拖拽选择要识别的区域 · ESC 取消'}
        </div>
      )}

      {/* 标注工具提示 */}
      {activeTool && (
        <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 12, borderRadius: 4, pointerEvents: 'none' }}>
          {activeTool === 'pen' ? '按住鼠标拖动绘制' :
           activeTool === 'line' ? '按住鼠标拖动绘制直线' :
           activeTool === 'arrow' ? '按住鼠标拖动绘制箭头' :
           activeTool === 'rectangle' ? '按住鼠标拖动绘制矩形' :
           activeTool === 'text' ? '点击添加文字' :
           activeTool === 'mosaic' ? '按住鼠标拖动添加马赛克' :
           activeTool === 'highlighter' ? '按住鼠标拖动高亮' :
           activeTool === 'number' ? '点击添加序号' :
           activeTool === 'blur' ? '按住鼠标拖动添加模糊' : ''} · ESC 取消
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
          boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          flexWrap: 'wrap',
          maxWidth: '90vw',
        }}>
          {/* 绘图工具 */}
          <button onClick={() => setActiveTool(activeTool === 'pen' ? null : 'pen')} style={toolBtnStyle('pen')} title="画笔 (P)">✏️</button>
          <button onClick={() => setActiveTool(activeTool === 'line' ? null : 'line')} style={toolBtnStyle('line')} title="直线 (L)">╱</button>
          <button onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')} style={toolBtnStyle('arrow')} title="箭头 (A)">→</button>
          <button onClick={() => setActiveTool(activeTool === 'rectangle' ? null : 'rectangle')} style={toolBtnStyle('rectangle')} title="矩形 (R)">□</button>
          <button onClick={() => setActiveTool(activeTool === 'highlighter' ? null : 'highlighter')} style={toolBtnStyle('highlighter')} title="荧光笔 (H)">🖍️</button>
          <button onClick={() => setActiveTool(activeTool === 'number' ? null : 'number')} style={toolBtnStyle('number')} title="序号 (N)">①</button>
          <button onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')} style={toolBtnStyle('text')} title="文字 (T)">T</button>
          <button onClick={() => setActiveTool(activeTool === 'mosaic' ? null : 'mosaic')} style={toolBtnStyle('mosaic')} title="马赛克 (M)">▦</button>
          <button onClick={() => setActiveTool(activeTool === 'blur' ? null : 'blur')} style={toolBtnStyle('blur')} title="模糊 (B)">朦胧</button>

          <div style={{ width: 1, background: '#E5E5EA', margin: '0 4px' }} />

          {/* 颜色选择 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              style={{
                padding: '6px 10px',
                background: annotationColor,
                border: '2px solid #ccc',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              title="选择颜色"
            />
            {showColorPicker && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                background: 'white',
                padding: 4,
                borderRadius: 4,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                display: 'flex',
                gap: 2,
                flexWrap: 'wrap',
                width: 120,
              }}>
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => { setAnnotationColor(color); setShowColorPicker(false); }}
                    style={{
                      width: 20,
                      height: 20,
                      background: color,
                      border: annotationColor === color ? '2px solid #007AFF' : '1px solid #ccc',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 线宽选择 */}
          <select
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={{ padding: '4px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12 }}
          >
            <option value={1}>细</option>
            <option value={3}>中</option>
            <option value={5}>粗</option>
            <option value={8}>特粗</option>
          </select>

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
