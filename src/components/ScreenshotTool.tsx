import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import RegionSelector from './RegionSelector';

// 简洁的SVG图标
const Icons = {
  camera: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
  crop: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6.13 1L6 16a2 2 0 002 2h15"/>
      <path d="M1 6.13L16 6a2 2 0 012 2v15"/>
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  image: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
};

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const [error, setError] = useState<string | null>(null);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const handleFullScreen = useCallback(async () => {
    setCapturing(true);
    setError(null);
    setCaptureSuccess(false);
    try {
      const path = await invoke<string>('take_screenshot');
      setScreenshotPath(path);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setCapturing(false);
    }
  }, [setCapturing, setScreenshotPath]);

  useEffect(() => {
    const unlisten = listen('screenshot-triggered', () => {
      handleFullScreen();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleFullScreen]);

  const handleRegionSelect = useCallback(
    async (region: { x: number; y: number; width: number; height: number }) => {
      setShowRegionSelector(false);
      setCapturing(true);
      setError(null);
      setCaptureSuccess(false);
      try {
        const path = await invoke<string>('take_screenshot_region', {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        });
        setScreenshotPath(path);
        setCaptureSuccess(true);
        setTimeout(() => setCaptureSuccess(false), 1500);
      } catch (err) {
        setError(String(err));
      } finally {
        setCapturing(false);
      }
    },
    [setCapturing, setScreenshotPath]
  );

  if (showRegionSelector) {
    return (
      <RegionSelector
        onSelect={handleRegionSelect}
        onCancel={() => setShowRegionSelector(false)}
      />
    );
  }

  return (
    <div className="p-3 space-y-2">
      {/* 按钮组 - 紧凑 */}
      <div className="flex gap-2">
        <button
          onClick={handleFullScreen}
          disabled={isCapturing}
          className="flex-1 btn-tool"
        >
          {isCapturing ? (
            <span className="flex items-center gap-1.5">
              <span className="spinner-sm"></span>
              <span className="text-xs">截图中</span>
            </span>
          ) : captureSuccess ? (
            <span className="flex items-center gap-1.5 text-green-600">
              {Icons.check}
              <span className="text-xs">完成</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {Icons.camera}
              <span className="text-xs">全屏截图</span>
            </span>
          )}
        </button>
        
        <button
          onClick={() => setShowRegionSelector(true)}
          disabled={isCapturing}
          className="flex-1 btn-tool"
        >
          <span className="flex items-center gap-1.5">
            {Icons.crop}
            <span className="text-xs">区域截图</span>
          </span>
        </button>
      </div>

      {/* 错误提示 - 紧凑 */}
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-50 rounded text-red-600 text-xs">
          <span className="mt-0.5">{Icons.warning}</span>
          <div className="flex-1">
            <p>{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 underline mt-0.5">
              重试
            </button>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            {Icons.close}
          </button>
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
