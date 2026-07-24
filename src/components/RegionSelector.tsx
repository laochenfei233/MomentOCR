import { useState, useEffect, useCallback, useRef } from 'react';

interface RegionSelectorProps {
  onSelect: (region: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

function RegionSelector({ onSelect, onCancel }: RegionSelectorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const getRect = useCallback(() => {
    if (!start || !current) return null;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    return { x, y, width, height };
  }, [start, current]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    const rect = getRect();
    if (rect && rect.width > 10 && rect.height > 10) {
      onSelect(rect);
    }
  }, [isDragging, getRect, onSelect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const rect = getRect();

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        cursor: 'crosshair',
        background: 'rgba(0, 0, 0, 0.3)',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              border: '2px solid #007AFF',
              background: 'rgba(0, 122, 255, 0.1)',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: rect.x + rect.width / 2,
              top: rect.y - 20,
              transform: 'translateX(-50%)',
              padding: '2px 6px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              fontSize: '11px',
              borderRadius: '3px',
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 12px',
          background: 'rgba(0, 0, 0, 0.6)',
          color: 'white',
          fontSize: '12px',
          borderRadius: '4px',
        }}
      >
        拖拽选择区域 · ESC 取消
      </div>
    </div>
  );
}

export default RegionSelector;
