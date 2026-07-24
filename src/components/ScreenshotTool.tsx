import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import RegionSelector from './RegionSelector';

function ScreenshotTool() {
  const { isCapturing, setCapturing, screenshotPath, setScreenshotPath } = useScreenshotStore();
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
      setTimeout(() => setCaptureSuccess(false), 2000);
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
        setTimeout(() => setCaptureSuccess(false), 2000);
      } catch (err) {
        setError(String(err));
      } finally {
        setCapturing(false);
      }
    },
    [setCapturing, setScreenshotPath]
  );

  const handleRetry = useCallback(() => {
    setError(null);
    handleFullScreen();
  }, [handleFullScreen]);

  if (showRegionSelector) {
    return (
      <RegionSelector
        onSelect={handleRegionSelect}
        onCancel={() => setShowRegionSelector(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* 截图按钮组 */}
      <div className="flex gap-2">
        <button
          onClick={handleFullScreen}
          disabled={isCapturing}
          className="flex-1 ios-btn ios-btn-primary"
        >
          {isCapturing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner"></span>
              截图中...
            </span>
          ) : captureSuccess ? (
            <span className="flex items-center justify-center gap-2">
              <span>✓</span>
              截图完成
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <span>📷</span>
              全屏截图
            </span>
          )}
        </button>
        
        <button
          onClick={() => setShowRegionSelector(true)}
          disabled={isCapturing}
          className="flex-1 ios-btn ios-btn-secondary"
        >
          <span className="flex items-center justify-center gap-2">
            <span>✂️</span>
            区域截图
          </span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="ios-alert ios-alert-error">
          <span className="ios-alert-icon">⚠️</span>
          <div className="flex-1">
            <p className="ios-text-body">{error}</p>
            <button onClick={handleRetry} className="ios-link text-sm mt-1">
              重试
            </button>
          </div>
        </div>
      )}

      {/* 截图路径 */}
      {screenshotPath && !isCapturing && (
        <div className="ios-text-caption text-center text-gray-400 truncate">
          {screenshotPath.split(/[/\\]/).pop()}
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
