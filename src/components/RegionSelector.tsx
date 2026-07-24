import { useState, useEffect, useCallback, useRef } from 'react';

interface RegionSelectorProps {
  onSelect: (region: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

function RegionSelector({ onSelect, onCancel }: RegionSelectorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Apple Design: Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

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
      className={`fixed inset-0 z-50 cursor-crosshair transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          {/* Apple Design: Selection highlight with subtle shadow */}
          <div
            className="absolute border border-white/80"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4), 0 4px 24px rgba(0, 0, 0, 0.2)',
              background: 'transparent',
              transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
            }}
          />

          {/* Corner handles - Apple style */}
          {rect.width > 20 && rect.height > 20 && (
            <>
              <div className="absolute w-2 h-2 bg-white rounded-full shadow-lg" style={{ left: rect.x - 4, top: rect.y - 4 }} />
              <div className="absolute w-2 h-2 bg-white rounded-full shadow-lg" style={{ left: rect.x + rect.width - 4, top: rect.y - 4 }} />
              <div className="absolute w-2 h-2 bg-white rounded-full shadow-lg" style={{ left: rect.x - 4, top: rect.y + rect.height - 4 }} />
              <div className="absolute w-2 h-2 bg-white rounded-full shadow-lg" style={{ left: rect.x + rect.width - 4, top: rect.y + rect.height - 4 }} />
            </>
          )}

          {/* Dimension label - Apple style */}
          <div
            className="absolute px-2 py-0.5 rounded-md text-[10px] font-medium text-white pointer-events-none"
            style={{
              left: rect.x + rect.width / 2,
              top: rect.y - 24,
              transform: 'translateX(-50%)',
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}

      {/* Instructions - Apple style floating hint */}
      <div
        className="absolute top-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-xs font-medium text-white pointer-events-none"
        style={{
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(12px)',
        }}
      >
        拖拽选择区域 · ESC 取消
      </div>
    </div>
  );
}

export default RegionSelector;
