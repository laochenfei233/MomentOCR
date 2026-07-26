import { useState, useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

interface PinWindowProps {
  imageData: string;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
}

export default function PinWindow({
  imageData,
  initialX = 100,
  initialY = 100,
  initialWidth = 300,
  initialHeight = 300,
}: PinWindowProps) {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // 拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  }, [position]);

  // 拖拽中
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  }, [isDragging, dragOffset]);

  // 拖拽结束
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(5, scale + delta));
    setScale(newScale);
    setSize({
      width: initialWidth * newScale,
      height: initialHeight * newScale
    });
  }, [scale, initialWidth, initialHeight]);

  // 双击关闭
  const handleDoubleClick = useCallback(async () => {
    await getCurrentWindow().close();
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        getCurrentWindow().close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 设置窗口位置
  useEffect(() => {
    const updatePosition = async () => {
      try {
        await getCurrentWindow().setPosition(new PhysicalPosition(Math.round(position.x), Math.round(position.y)));
      } catch (err) {
        console.error('Failed to set window position:', err);
      }
    };
    updatePosition();
  }, [position]);

  // 设置窗口大小
  useEffect(() => {
    const updateSize = async () => {
      try {
        await getCurrentWindow().setSize(new PhysicalSize(Math.round(size.width), Math.round(size.height)));
      } catch (err) {
        console.error('Failed to set window size:', err);
      }
    };
    updateSize();
  }, [size]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); setShowControls(false); }}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setShowControls(true)}
    >
      {/* 图片 */}
      <img
        src={imageData}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
        draggable={false}
      />

      {/* 关闭按钮 */}
      {showControls && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            getCurrentWindow().close();
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}

      {/* 缩放比例显示 */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            padding: '2px 6px',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: 10,
            borderRadius: 3,
          }}
        >
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
