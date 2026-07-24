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
      // Apple Design: Success feedback
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

  return (
    <div className="w-full max-w-xs animate-slide-up">
      {showRegionSelector && (
        <RegionSelector
          onSelect={handleRegionSelect}
          onCancel={() => setShowRegionSelector(false)}
        />
      )}

      {/* Apple Design: Compact button group */}
      <div className="flex flex-col gap-2">
        {/* Primary action - Full screen capture */}
        <button
          onClick={handleFullScreen}
          disabled={isCapturing || showRegionSelector}
          className="btn-fluid group relative w-full rounded-xl bg-blue-500 px-4 py-3 text-white font-medium text-sm
            hover:bg-blue-600 active:bg-blue-700
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200"
        >
          <div className="flex items-center justify-center gap-2">
            {isCapturing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>截图中...</span>
              </>
            ) : captureSuccess ? (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>截图完成</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>全屏截图</span>
              </>
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20 rounded-b-xl opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* Secondary action - Region capture */}
        <button
          onClick={() => setShowRegionSelector(true)}
          disabled={isCapturing || showRegionSelector}
          className="btn-fluid group w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-700 font-medium text-sm
            hover:bg-gray-50 active:bg-gray-100
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200"
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span>区域截图</span>
          </div>
        </button>
      </div>

      {/* Error display - Apple style alert */}
      {error && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600 animate-slide-up">
          <div className="flex items-start gap-2">
            <svg className="h-4 w-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Screenshot path preview */}
      {screenshotPath && !isCapturing && (
        <div className="mt-3 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-[10px] text-gray-400 break-all animate-fade-in">
          {screenshotPath.split(/[/\\]/).pop()}
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
