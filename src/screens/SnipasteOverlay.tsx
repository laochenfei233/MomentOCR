import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSnipasteStore, type Point, type Annotation, type AnnotationType } from '../stores/snipasteStore';
import { drawAnnotation, hitTestAnnotation, getResizeHandles } from '../lib/annotations';
import {
  IconPen, IconLine, IconArrow, IconRect, IconHighlighter, IconText, IconMosaic, IconBlur,
  IconSave, IconCopy, IconPin, IconScanText, IconScan, IconX,
} from '../lib/icons';
import { pickColorFromImage, drawLoupe } from '../lib/colorPicker';

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface GhostRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// Rust snipaste::DetectRect（物理坐标）
interface DetectRectRaw {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [detectRect, setDetectRect] = useState<GhostRect | null>(null);

  // 绘图状态
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);

  // 选择和调整状态
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<Point | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [moveStart, setMoveStart] = useState<Point | null>(null);

  const {
    activeTool,
    setActiveTool,
    annotations,
    addAnnotation,
    updateAnnotation,
    undoAnnotation,
    redoAnnotation,
    clearAnnotations,
    annotationColor,
    setAnnotationColor,
    strokeWidth,
    setStrokeWidth,
    opacity,
    setOpacity,
  } = useSnipasteStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const outerOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastDetectRef = useRef(0);

  // 检查是否为长截图模式
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsLongScreenshot(params.get('mode') === 'long');
  }, []);

  // 加载截图（base64 data URL，避免依赖未启用的 asset 协议）
  useEffect(() => {
    const loadScreenshot = async () => {
      try {
        const base64 = await invoke<string>('snipaste_get_screenshot_base64');
        setImageSrc(`data:image/png;base64,${base64}`);
      } catch (err) {
        console.error('Failed to load screenshot:', err);
      }
    };
    loadScreenshot();
  }, []);

  // 记录 overlay 窗口的全局物理原点（= 所在显示器原点），CSS↔全局物理坐标换算用
  useEffect(() => {
    getCurrentWindow().outerPosition()
      .then((p) => { outerOriginRef.current = { x: p.x, y: p.y }; })
      .catch((err) => console.error('outerPosition failed:', err));
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }, []);

  // 历史回放：,/. 在最近截图间切换
  const stepHistory = useCallback(async (delta: number) => {
    try {
      const base64 = await invoke<string>('snipaste_history_step', { delta });
      setImageSrc(`data:image/png;base64,${base64}`);
      setSelection(null);
      setShowToolbar(false);
      setShowContinueBtn(false);
      setSelectedId(null);
      clearAnnotations();
      setDetectRect(null);
    } catch (err) {
      console.error('history failed:', err);
    }
  }, [clearAnnotations]);

  // 窗口自动检测：光标下窗口高亮（物理坐标 = overlay 原点 + CSS×dpr）
  const detectWindowAt = useCallback(async (cssX: number, cssY: number) => {
    const now = Date.now();
    if (now - lastDetectRef.current < 60) return;
    lastDetectRef.current = now;
    try {
      const dpr = window.devicePixelRatio || 1;
      const origin = outerOriginRef.current;
      const r = await invoke<DetectRectRaw | null>('snipaste_detect_window', {
        x: origin.x + Math.round(cssX * dpr),
        y: origin.y + Math.round(cssY * dpr),
      });
      setDetectRect(r ? {
        left: (r.x - origin.x) / dpr,
        top: (r.y - origin.y) / dpr,
        width: r.width / dpr,
        height: r.height / dpr,
      } : null);
    } catch {
      /* 检测失败静默忽略 */
    }
  }, []);

  // 取色：跟随光标绘制放大镜
  const drawLoupeAt = useCallback((cssX: number, cssY: number) => {
    const canvas = loupeRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawLoupe(ctx, img, cssX, cssY, { dpr, cssW: canvas.clientWidth, cssH: canvas.clientHeight });
  }, []);

  const copyPickedColor = useCallback(async (cssX: number, cssY: number) => {
    const img = imgRef.current;
    if (!img) return;
    const info = pickColorFromImage(img, cssX, cssY, window.devicePixelRatio || 1);
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.hex);
      showToast(`已复制 ${info.hex}`);
    } catch {
      showToast(info.hex);
    }
  }, [showToast]);

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

    // 绘制选中状态和调整手柄
    if (selectedId) {
      const selected = annotations.find(a => a.id === selectedId);
      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        // 绘制选中框
        if (selected.width !== undefined && selected.height !== undefined) {
          ctx.strokeRect(selected.x - 2, selected.y - 2, selected.width + 4, selected.height + 4);

          // 绘制调整手柄
          ctx.setLineDash([]);
          ctx.fillStyle = '#007AFF';
          const handles = getResizeHandles(selected);
          for (const handle of handles) {
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (selected.endX !== undefined && selected.endY !== undefined) {
          // 线段类标注
          ctx.strokeRect(
            Math.min(selected.x, selected.endX) - 2,
            Math.min(selected.y, selected.endY) - 2,
            Math.abs(selected.endX - selected.x) + 4,
            Math.abs(selected.endY - selected.y) + 4
          );
        } else if (selected.type === 'text') {
          // 文字标注
          const textWidth = (selected.text?.length || 5) * 10;
          ctx.strokeRect(selected.x - 2, selected.y - 22, textWidth + 4, 26);
        }

        ctx.restore();
      }
    }
  }, [annotations, selectedId]);

  // 选区外的暗色遮罩
  const rect = selection ? {
    left: Math.min(selection.startX, selection.endX),
    top: Math.min(selection.startY, selection.endY),
    width: Math.abs(selection.endX - selection.startX),
    height: Math.abs(selection.endY - selection.startY),
  } : null;

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 取色模式：复制颜色
    if (picking) {
      void copyPickedColor(e.clientX, e.clientY);
      return;
    }

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

    // 检查是否点击了调整手柄
    if (selectedId) {
      const selected = annotations.find(a => a.id === selectedId);
      if (selected) {
        const handles = getResizeHandles(selected);
        for (const handle of handles) {
          if (Math.abs(e.clientX - handle.x) < 8 && Math.abs(e.clientY - handle.y) < 8) {
            setIsResizing(true);
            setResizeHandle(handle.id);
            setResizeStart({ x: e.clientX, y: e.clientY });
            return;
          }
        }
        // 检查是否点击了选中的标注内部（用于移动）
        if (hitTestAnnotation(annotations, e.clientX, e.clientY)?.id === selectedId) {
          setIsMoving(true);
          setMoveStart({ x: e.clientX, y: e.clientY });
          return;
        }
      }
    }

    // 检查是否点击了已有标注
    const hit = hitTestAnnotation(annotations, e.clientX, e.clientY);
    if (hit) {
      setSelectedId(hit.id);
      return;
    }

    // 否则开始选区
    if (showToolbar) return;
    setSelectedId(null);
    setIsDragging(true);
    setShowToolbar(false);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    });
  }, [activeTool, showToolbar, selectedId, annotations]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 取色模式：绘制放大镜
    if (picking) {
      drawLoupeAt(e.clientX, e.clientY);
      return;
    }

    // 窗口自动检测：空闲状态下高亮光标下窗口
    if (!isDragging && !isDrawing && !isMoving && !isResizing && !activeTool && !selection) {
      void detectWindowAt(e.clientX, e.clientY);
    }

    // 移动模式
    if (isMoving && selectedId && moveStart) {
      const dx = e.clientX - moveStart.x;
      const dy = e.clientY - moveStart.y;
      const annotation = annotations.find(a => a.id === selectedId);
      if (annotation) {
        const updates: Partial<Annotation> = {
          x: annotation.x + dx,
          y: annotation.y + dy,
        };
        // 如果有 endX/endY（线段类），也需要移动
        if (annotation.endX !== undefined && annotation.endY !== undefined) {
          updates.endX = annotation.endX + dx;
          updates.endY = annotation.endY + dy;
        }
        // 如果有 points（画笔/荧光笔），需要移动所有点
        if (annotation.points) {
          updates.points = annotation.points.map(p => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
        }
        updateAnnotation(selectedId, updates);
        setMoveStart({ x: e.clientX, y: e.clientY });
      }
      return;
    }

    // 调整大小模式
    if (isResizing && selectedId && resizeStart && resizeHandle) {
      const dx = e.clientX - resizeStart.x;
      const dy = e.clientY - resizeStart.y;
      const annotation = annotations.find(a => a.id === selectedId);
      if (annotation && annotation.width !== undefined && annotation.height !== undefined) {
        let newX = annotation.x;
        let newY = annotation.y;
        let newWidth = annotation.width;
        let newHeight = annotation.height;

        if (resizeHandle.includes('w')) {
          newX += dx;
          newWidth -= dx;
        }
        if (resizeHandle.includes('e')) {
          newWidth += dx;
        }
        if (resizeHandle.includes('n')) {
          newY += dy;
          newHeight -= dy;
        }
        if (resizeHandle.includes('s')) {
          newHeight += dy;
        }

        updateAnnotation(selectedId, {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        });
        setResizeStart({ x: e.clientX, y: e.clientY });
      }
      return;
    }

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
  }, [isResizing, selectedId, resizeStart, resizeHandle, annotations, isDrawing, drawStart, activeTool, isDragging, picking, drawLoupeAt, detectWindowAt, selection]);

  // 鼠标抬起
  const handleMouseUp = useCallback(() => {
    // 移动模式 - 结束移动
    if (isMoving) {
      setIsMoving(false);
      setMoveStart(null);
      return;
    }

    // 调整大小模式 - 结束调整
    if (isResizing) {
      setIsResizing(false);
      setResizeHandle(null);
      setResizeStart(null);
      return;
    }

    // 绘图模式 - 完成标注
    if (isDrawing && drawStart && drawEnd && activeTool) {
      const newAnnotation: Annotation = {
        id: Date.now().toString(),
        type: activeTool,
        x: drawStart.x,
        y: drawStart.y,
        color: annotationColor,
        strokeWidth,
        opacity,
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
      // 长截图模式下显示继续按钮
      if (isLongScreenshot) {
        setShowContinueBtn(true);
      }
    } else if (detectRect) {
      // 近似单击：采纳检测到的窗口区域（Snipaste 同款行为）
      setSelection({
        startX: detectRect.left,
        startY: detectRect.top,
        endX: detectRect.left + detectRect.width,
        endY: detectRect.top + detectRect.height,
      });
      setShowToolbar(true);
      setDetectRect(null);
    } else {
      setSelection(null);
    }
  }, [isMoving, isResizing, isDrawing, drawStart, drawEnd, activeTool, currentPoints, annotationColor, strokeWidth, opacity, isDragging, selection, isLongScreenshot, detectRect]);

  // ESC 取消 / 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (picking) {
          setPicking(false);
          return;
        }
        if (activeTool) {
          setActiveTool(null);
          setIsDrawing(false);
          setDrawStart(null);
          setDrawEnd(null);
          setCurrentPoints([]);
        } else {
          handleCancel();
        }
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 取色器开关
        if (!activeTool && !selection) {
          setPicking((v) => !v);
          setDetectRect(null);
        }
      } else if (e.key === ',') {
        stepHistory(-1);
      } else if (e.key === '.') {
        stepHistory(1);
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        undoAnnotation();
      } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        redoAnnotation();
      } else if (e.key === 'Delete' && selectedId) {
        // Delete 键删除选中的标注
        const { removeAnnotation } = useSnipasteStore.getState();
        removeAnnotation(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, undoAnnotation, redoAnnotation, selectedId, picking, stepHistory, selection]);

  // 双击编辑文字
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool) return;
    const hit = hitTestAnnotation(annotations, e.clientX, e.clientY);
    if (hit && hit.type === 'text') {
      const newText = prompt('编辑文字:', hit.text || '');
      if (newText !== null) {
        updateAnnotation(hit.id, { text: newText });
      }
    }
  }, [activeTool, annotations]);

  // 生成带标注的图片（物理像素分辨率：CSS 坐标 × devicePixelRatio 映射到背景图）
  const generateAnnotatedImage = useCallback(async (selection: Selection): Promise<string> => {
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(x * dpr);
    const py = Math.round(y * dpr);
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));

    // 创建临时画布
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pw;
    tempCanvas.height = ph;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create canvas');

    // 绘制背景图片：源图为物理像素，平移到裁剪原点后 1:1 贴上
    const img = new Image();
    img.src = imageSrc;
    await new Promise((resolve) => { img.onload = resolve; });
    ctx.setTransform(1, 0, 0, 1, -px, -py);
    ctx.drawImage(img, 0, 0);

    // 绘制标注（CSS 坐标，经 dpr 变换对齐物理像素）
    ctx.setTransform(dpr, 0, 0, dpr, -px, -py);
    for (const annotation of annotations) {
      drawAnnotation(ctx, annotation);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 转换为 base64
    return tempCanvas.toDataURL('image/png').split(',')[1];
  }, [imageSrc, annotations]);

  const handleCancel = useCallback(async () => {
    try {
      await invoke('snipaste_finish');
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selection) return;
    try {
      const imageData = await generateAnnotatedImage(selection);
      // 转换为 Uint8Array
      const binaryString = atob(imageData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      // 未指定路径时由命令侧落到桌面
      await invoke('snipaste_save_screenshot', { data: Array.from(bytes), path: null });
      await invoke('snipaste_finish');
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [selection, generateAnnotatedImage]);

  const handleCopy = useCallback(async () => {
    if (!selection) return;
    try {
      const imageData = await generateAnnotatedImage(selection);
      const binaryString = atob(imageData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await invoke('snipaste_copy_to_clipboard', { data: Array.from(bytes) });
      await invoke('snipaste_finish');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, [selection, generateAnnotatedImage]);

  const handlePin = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);

    try {
      // 带标注导出的 base64，Rust 侧创建 pin 窗口并保存数据
      const imageData = await generateAnnotatedImage(selection);
      await invoke('snipaste_create_pin', { imageData, x, y, width, height });

      setShowToolbar(false);
      setSelection(null);
    } catch (err) {
      console.error('Pin failed:', err);
      alert(`贴图失败: ${err}`);
    }
  }, [selection, generateAnnotatedImage]);

  const handleOCR = useCallback(async () => {
    if (!selection) return;
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);
    // CSS 坐标 → 物理像素（背景图为物理分辨率）
    const dpr = window.devicePixelRatio || 1;

    try {
      const cropPath = await invoke<string>('snipaste_crop_region', {
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.max(1, Math.round(width * dpr)),
        height: Math.max(1, Math.round(height * dpr)),
      });
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snipaste-ocr', { path: cropPath });
      await invoke('snipaste_finish');
    } catch (err) {
      console.error('OCR failed:', err);
    }
  }, [selection]);

  const handleContinueLongScreenshot = useCallback(async () => {
    try {
      await invoke<string>('snipaste_capture_next');
      // capture_next 已更新 last_screenshot，直接重取 base64
      const base64 = await invoke<string>('snipaste_get_screenshot_base64');
      setImageSrc(`data:image/png;base64,${base64}`);
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
      await invoke('snipaste_finish');
    } catch (err) {
      console.error('Finish long screenshot failed:', err);
    }
  }, []);

  // 工具栏按钮样式：对齐主窗口 .tool-btn（透明底灰字，active 蓝字浅蓝底）
  const toolBtnStyle = (tool: AnnotationType) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    background: activeTool === tool ? 'rgba(0, 122, 255, 0.12)' : 'transparent',
    color: activeTool === tool ? '#007AFF' : '#6E6E73',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer' as const,
  });

  const actionBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 10px',
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer' as const,
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#000', cursor: picking ? 'none' : activeTool ? 'crosshair' : isMoving ? 'grabbing' : selectedId ? 'move' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* 截图背景（物理像素图 1:1 铺满显示器逻辑尺寸） */}
      {imageSrc && (
        <img
          ref={imgRef}
          src={imageSrc}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'fill' }}
          draggable={false}
          onError={(e) => console.error('Image load error:', e)}
        />
      )}

      {/* 标注画布 */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />

      {/* 取色放大镜层 */}
      {picking && (
        <canvas
          ref={loupeRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      )}

      {/* 窗口自动检测高亮 */}
      {detectRect && !selection && !picking && detectRect.width > 0 && (
        <>
          <div style={{ position: 'absolute', left: detectRect.left, top: detectRect.top, width: detectRect.width, height: detectRect.height, border: '2px dashed #00C8FF', background: 'rgba(0,200,255,0.08)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: detectRect.left, top: detectRect.top - 22, padding: '2px 8px', background: 'rgba(0,0,0,0.75)', color: '#00C8FF', fontSize: 11, borderRadius: 3, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            点击选中窗口 {Math.round(detectRect.width)} × {Math.round(detectRect.height)}
          </div>
        </>
      )}

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
      {!isDragging && !showToolbar && !selection && !activeTool && !isDrawing && !picking && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '8px 16px', background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 13, borderRadius: 6, pointerEvents: 'none' }}>
          {isLongScreenshot ? '拖拽选择区域 · C 取色 · ESC 取消' : '拖拽选择要识别的区域 · 单击选窗口 · C 取色 · ,/. 历史 · ESC 取消'}
        </div>
      )}

      {/* 取色模式提示 */}
      {picking && (
        <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 12, borderRadius: 4, pointerEvents: 'none' }}>
          单击复制颜色 · C / ESC 退出
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '6px 14px', background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 13, borderRadius: 5, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast}
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
          <button onClick={() => setActiveTool(activeTool === 'pen' ? null : 'pen')} style={toolBtnStyle('pen')} title="画笔 (P)"><IconPen /></button>
          <button onClick={() => setActiveTool(activeTool === 'line' ? null : 'line')} style={toolBtnStyle('line')} title="直线 (L)"><IconLine /></button>
          <button onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')} style={toolBtnStyle('arrow')} title="箭头 (A)"><IconArrow /></button>
          <button onClick={() => setActiveTool(activeTool === 'rectangle' ? null : 'rectangle')} style={toolBtnStyle('rectangle')} title="矩形 (R)"><IconRect /></button>
          <button onClick={() => setActiveTool(activeTool === 'highlighter' ? null : 'highlighter')} style={toolBtnStyle('highlighter')} title="荧光笔 (H)"><IconHighlighter /></button>
          <button onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')} style={toolBtnStyle('text')} title="文字 (T)"><IconText /></button>
          <button onClick={() => setActiveTool(activeTool === 'mosaic' ? null : 'mosaic')} style={toolBtnStyle('mosaic')} title="马赛克 (M)"><IconMosaic /></button>
          <button onClick={() => setActiveTool(activeTool === 'blur' ? null : 'blur')} style={toolBtnStyle('blur')} title="模糊 (B)"><IconBlur /></button>

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

          {/* 透明度选择 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#666' }}>透明度</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ width: 60 }}
            />
            <span style={{ fontSize: 11, color: '#666' }}>{Math.round(opacity * 100)}%</span>
          </div>

          <div style={{ width: 1, background: '#E5E5EA', margin: '0 4px' }} />

          {/* 操作按钮 */}
          <button onClick={handleSave} style={{ ...actionBtnStyle, background: '#f0f0f0', color: '#333' }}>
            <IconSave size={13} /> 保存
          </button>
          <button onClick={handleCopy} style={{ ...actionBtnStyle, background: '#f0f0f0', color: '#333' }}>
            <IconCopy size={13} /> 复制
          </button>
          <button onClick={handlePin} style={{ ...actionBtnStyle, background: '#34C759', color: 'white' }}>
            <IconPin size={13} /> 贴图
          </button>
          <button onClick={handleOCR} style={{ ...actionBtnStyle, background: '#007AFF', color: 'white' }}>
            <IconScanText size={13} /> OCR
          </button>
          <button onClick={handleOCR} style={{ ...actionBtnStyle, background: '#FF9500', color: 'white' }}>
            <IconScan size={13} /> 识别
          </button>
          <button onClick={handleCancel} style={{ ...actionBtnStyle, background: '#FF3B30', color: 'white' }}>
            <IconX size={13} /> 取消
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
