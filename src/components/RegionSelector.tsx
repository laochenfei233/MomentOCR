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
    if (rect && rect.width > 5 && rect.height > 5) {
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
      className="fixed inset-0 z-50 cursor-crosshair"
      style={{ background: 'rgba(0, 0, 0, 0.3)' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          {/* Cutout hole in the overlay */}
          <div
            className="absolute border-2 border-white shadow-lg"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
              background: 'transparent',
            }}
          />
          {/* Selection dimensions label */}
          <div
            className="absolute bg-black/70 text-white text-xs px-2 py-1 rounded pointer-events-none"
            style={{
              left: rect.x,
              top: rect.y - 28,
            }}
          >
            {rect.width} x {rect.height}
          </div>
        </>
      )}
      {/* Instructions */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-lg pointer-events-none">
        拖拽选择区域，按 ESC 取消
      </div>
    </div>
  );
}

export default RegionSelector;
