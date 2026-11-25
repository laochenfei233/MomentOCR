import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSnipasteStore, type Annotation, type AnnotationType, type Point, type PinData } from '../stores/snipasteStore';
import { drawAnnotation } from '../lib/annotations';
import { pickColorFromImage, drawLoupe } from '../lib/colorPicker';
import {
  IconPen, IconHighlighter, IconText, IconArrow, IconRect,
  IconRotateCcw, IconRotateCw, IconFlipH, IconFlipV, IconThrough, IconPipette, IconX,
} from '../lib/icons';

const PIN_TOOLS: AnnotationType[] = ['pen', 'arrow', 'rectangle', 'text', 'highlighter'];

export default function PinWindow() {
  const [pin, setPin] = useState<PinData | null>(null);
  const [scale, setScale] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 贴图本地标注（与 overlay 的全局 store 独立）
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const { activeTool, setActiveTool, annotationColor, setAnnotationColor, strokeWidth } = useSnipasteStore();

  const win = getCurrentWindow();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const annotatingRef = useRef(false);
  const pickingRef = useRef(false);
  annotatingRef.current = annotating;
  pickingRef.current = picking;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }, []);

  // 按 label 取回贴图数据（Rust 侧 PIN_IMAGES）
  useEffect(() => {
    invoke<PinData>('snipaste_get_pin_image', { label: win.label })
      .then(setPin)
      .catch((err) => console.error('Failed to load pin data:', err));
  }, [win]);

  const exitModes = useCallback(() => {
    setAnnotating(false);
    setPicking(false);
    setDraft(null);
    setIsDrawing(false);
  }, []);

  // 归位视图变换：奇数次旋转交换过窗口物理尺寸，这里一并还原
  const resetTransform = useCallback(async () => {
    setScale(1);
    setQuarterTurns(0);
    setFlipH(false);
    setFlipV(false);
    if (pin) {
      try {
        await invoke('snipaste_pin_resize', { width: Math.round(pin.width), height: Math.round(pin.height) });
      } catch (err) {
        console.error('reset size failed:', err);
      }
    }
  }, [pin, win]);

  // 旋转：奇数次 90° 交换窗口物理尺寸
  const rotate = useCallback(async (dir: 1 | -1) => {
    const p = pin;
    if (!p) return;
    const next = (quarterTurns + (dir === 1 ? 1 : 3)) % 4;
    setQuarterTurns(next);
    const w = next % 2 === 1 ? p.height : p.width;
    const h = next % 2 === 1 ? p.width : p.height;
    try {
      await invoke('snipaste_pin_resize', { width: Math.round(w), height: Math.round(h) });
    } catch (err) {
      console.error('rotate resize failed:', err);
    }
  }, [pin, quarterTurns, win]);

  // 键盘：ESC 退出模式或关闭；1/2 旋转、3/4 镜像、空格标注
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (annotating || picking || activeTool) {
          exitModes();
          setActiveTool(null);
        } else {
          invoke('snipaste_pin_close').catch(() => {});
        }
        return;
      }
      if (e.altKey) return; // Alt 系列由取色监听 / 全局 Alt+P 处理
      if (annotating && e.key === ' ') {
        e.preventDefault();
        exitModes();
        return;
      }
      if (annotating || picking) return;
      if (e.key === '1') rotate(-1);
      else if (e.key === '2') rotate(1);
      else if (e.key === '3') setFlipH((v) => !v);
      else if (e.key === '4') setFlipV((v) => !v);
      else if (e.key === ' ') {
        e.preventDefault();
        setActiveTool(null);
        void resetTransform().then(() => setAnnotating(true));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [annotating, picking, activeTool, win, exitModes, setActiveTool, rotate, resetTransform]);

  // 滚轮：普通=缩放内容，Ctrl=透明度（原生非 passive 监听以便 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (annotatingRef.current || pickingRef.current) return;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      if (e.ctrlKey) {
        setOpacity((o) => Math.max(0.1, Math.min(1, +(o + delta).toFixed(2))));
      } else {
        setScale((s) => Math.max(0.1, Math.min(5, +(s + delta).toFixed(2))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 左键按住 → 原生拖拽（标注/取色模式下不拖拽）。
  // startDragging 的原生循环会吞掉后续鼠标事件，浏览器的 dblclick 永远不会触发，
  // 所以双击隐藏用自计时（400ms 内第二次按下）实现，且该次按下不再启动拖拽。
  const lastPressRef = useRef(0);
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || annotating || picking) return;
    const now = Date.now();
    if (now - lastPressRef.current < 400) {
      lastPressRef.current = 0;
      invoke('snipaste_set_pin_visible', { label: win.label, visible: false })
        .catch((err) => console.error('hide failed:', err));
      return;
    }
    lastPressRef.current = now;
    invoke('snipaste_pin_start_drag').catch((err) => console.error('startDragging failed:', err));
  }, [win, annotating, picking]);

  // ---- 贴图内标注绘制 ----
  const redrawPinCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    for (const a of annotations) drawAnnotation(ctx, a);
    if (draft) drawAnnotation(ctx, draft);
  }, [annotations, draft]);

  useEffect(() => {
    if (annotating) redrawPinCanvas();
  }, [annotating, redrawPinCanvas]);

  const canvasPos = (e: React.MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

  const handleAnnotateDown = useCallback((e: React.MouseEvent) => {
    if (!annotating || !activeTool || e.button !== 0) return;
    const p = canvasPos(e);
    const base: Annotation = {
      id: `pin-${Date.now()}`,
      type: activeTool,
      x: p.x,
      y: p.y,
      color: annotationColor,
      strokeWidth,
    };
    if (activeTool === 'pen' || activeTool === 'highlighter') base.points = [p];
    if (activeTool === 'text') {
      const text = prompt('请输入文字:');
      if (text) {
        setAnnotations((prev) => [...prev, { ...base, text }]);
      }
      return;
    }
    setIsDrawing(true);
    setDraft(base);
  }, [annotating, activeTool, annotationColor, strokeWidth]);

  const handleAnnotateMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !draft) return;
    const p = canvasPos(e);
    if (draft.type === 'pen' || draft.type === 'highlighter') {
      setDraft({ ...draft, points: [...(draft.points ?? []), p] });
    } else {
      setDraft({ ...draft, endX: p.x, endY: p.y, width: p.x - draft.x, height: p.y - draft.y });
    }
  }, [isDrawing, draft]);

  const handleAnnotateUp = useCallback(() => {
    if (!isDrawing || !draft) return;
    setAnnotations((prev) => [...prev, draft]);
    setDraft(null);
    setIsDrawing(false);
  }, [isDrawing, draft]);

  // ---- 取色（Alt 切换，单击复制 HEX）----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'p') return;
      if (e.altKey && e.key === 'Alt') {
        e.preventDefault();
        if (picking) {
          setPicking(false);
        } else {
          void resetTransform().then(() => setPicking(true));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picking, resetTransform]);

  const handlePickMove = useCallback((e: React.MouseEvent) => {
    if (!picking) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawLoupe(ctx, img, e.clientX, e.clientY, { dpr, cssW: canvas.clientWidth, cssH: canvas.clientHeight });
  }, [picking]);

  const handlePickClick = useCallback(async (e: React.MouseEvent) => {
    if (!picking) return;
    const img = imgRef.current;
    if (!img) return;
    const info = pickColorFromImage(img, e.clientX, e.clientY, window.devicePixelRatio || 1);
    if (info) {
      try {
        await navigator.clipboard.writeText(info.hex);
        showToast(`已复制 ${info.hex}`);
      } catch {
        showToast(info.hex);
      }
    }
  }, [picking, showToast]);

  // 鼠标穿透（开启后本窗口收不到输入，Alt+P 全局恢复）
  const enableMouseThrough = useCallback(() => {
    invoke('snipaste_toggle_mouse_through', { label: win.label, enable: true })
      .catch((err) => console.error('mouse-through failed:', err));
  }, [win]);

  if (!pin) {
    return <div style={{ width: '100%', height: '100%', background: 'transparent' }} />;
  }

  const dpr = window.devicePixelRatio || 1;
  const showImgControls = showControls && !annotating && !picking;
  const toolIcon: Partial<Record<AnnotationType, React.ReactNode>> = {
    pen: <IconPen size={13} />, arrow: <IconArrow size={13} />, rectangle: <IconRect size={13} />,
    text: <IconText size={13} />, highlighter: <IconHighlighter size={13} />,
  };

  return (
    <div
      ref={containerRef}
      style={{
        // fixed 而非 100%：#root/body 没有高度，100% 会把内容塌成 0 高推出视口
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'transparent',
        cursor: annotating ? 'crosshair' : picking ? 'none' : 'grab',
        userSelect: 'none',
        overflow: 'hidden',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { setShowControls(false); if (picking) { const c = canvasRef.current?.getContext('2d'); c?.clearRect(0, 0, 10000, 10000); } }}
    >
      {/* 图片：CSS 尺寸=原始物理/dpr，居中后做旋转/翻转/缩放变换 */}
      <img
        ref={imgRef}
        src={`data:image/png;base64,${pin.image_data}`}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${pin.width / dpr}px`,
          height: `${pin.height / dpr}px`,
          transform: `translate(-50%, -50%) rotate(${quarterTurns * 90}deg) scale(${scale}) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
          transformOrigin: 'center',
          opacity,
          pointerEvents: 'none',
        }}
        draggable={false}
      />

      {/* 标注 / 取色画布层 */}
      {(annotating || picking) && (
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          onMouseDown={annotating ? handleAnnotateDown : undefined}
          onMouseMove={annotating ? handleAnnotateMove : handlePickMove}
          onMouseUp={annotating ? handleAnnotateUp : undefined}
          onClick={picking ? handlePickClick : undefined}
        />
      )}

      {/* hover 工具条 */}
      {showImgControls && (
        <div
          style={{
            position: 'absolute', top: 4, right: 4, display: 'flex', flexDirection: 'column', gap: 4,
            background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 4,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <PinBtn title="鼠标穿透开启（Alt+P 恢复）" onClick={enableMouseThrough}><IconThrough size={13} /></PinBtn>
          <PinBtn title="逆时针旋转 (1)" onClick={() => rotate(-1)}><IconRotateCcw size={13} /></PinBtn>
          <PinBtn title="顺时针旋转 (2)" onClick={() => rotate(1)}><IconRotateCw size={13} /></PinBtn>
          <PinBtn title="水平镜像 (3)" onClick={() => setFlipH((v) => !v)}><IconFlipH size={13} /></PinBtn>
          <PinBtn title="垂直镜像 (4)" onClick={() => setFlipV((v) => !v)}><IconFlipV size={13} /></PinBtn>
          <PinBtn title="标注 (空格)" onClick={() => { void resetTransform().then(() => setAnnotating(true)); }}><IconPen size={13} /></PinBtn>
          <PinBtn title="取色 (Alt)" onClick={() => { void resetTransform().then(() => setPicking(true)); }}><IconPipette size={13} /></PinBtn>
          <PinBtn title="关闭 (Esc)" onClick={() => invoke('snipaste_pin_close').catch(() => {})}><IconX size={13} /></PinBtn>
        </div>
      )}

      {/* 标注模式工具条 */}
      {annotating && (
        <div
          style={{
            position: 'absolute', top: 4, left: 4, display: 'flex', gap: 4, alignItems: 'center',
            background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 4,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {PIN_TOOLS.map((t) => (
            <button
              key={t}
              title={t}
              onClick={() => setActiveTool(activeTool === t ? null : t)}
              style={{
                width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                background: activeTool === t ? '#007AFF' : 'transparent', color: '#fff',
              }}
            >
              {toolIcon[t]}
            </button>
          ))}
          <input
            type="color"
            value={annotationColor}
            onChange={(e) => setAnnotationColor(e.target.value)}
            style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
            title="标注颜色"
          />
          <button
            onClick={exitModes}
            style={{ width: 24, height: 24, border: 'none', borderRadius: 4, background: '#FF3B30', color: '#fff', cursor: 'pointer' }}
            title="退出标注 (空格)"
          >
            ✓
          </button>
        </div>
      )}

      {/* 状态提示 */}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 10px', background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 12, borderRadius: 4,
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      {/* 缩放比例 */}
      {showImgControls && scale !== 1 && (
        <div style={{
          position: 'absolute', bottom: 4, right: 4, padding: '2px 6px',
          background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 10, borderRadius: 3,
        }}>
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}

function PinBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer',
        background: 'transparent', color: '#fff', fontSize: 12, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}
