import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import { useOcrStore } from '../stores/ocrStore';
import { useSettingsStore } from '../stores/settingsStore';
import { runOcr } from '../plugins';

function ScreenshotTool() {
  const { isCapturing, setCapturing } = useScreenshotStore();
  const { setProcessing, setResult, addToHistory } = useOcrStore();
  const { activeOcrPlugin, pluginSettings, screenshot, afterRecognize } = useSettingsStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  const doOcr = useCallback(async (imagePath: string) => {
    setProcessing(true);
    try {
      const ocrResult = await runOcr(activeOcrPlugin, imagePath, pluginSettings);
      const result = { success: !ocrResult.startsWith('错误'), data: ocrResult, confidence: 0, language: 'auto' };
      setResult(result);
      addToHistory(result);
      // 识别后自动复制
      if (afterRecognize.autoCopy && result.success) {
        try { await navigator.clipboard.writeText(result.data); } catch {}
      }
    } catch (err) {
      setResult({ success: false, data: '', error: String(err) });
    } finally {
      setProcessing(false);
    }
  }, [activeOcrPlugin, pluginSettings, setProcessing, setResult, addToHistory, afterRecognize.autoCopy]);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      // 截图前隐藏主窗口（按设置）
      if (screenshot.hideMainWindow) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().hide();
        } catch {}
      }
      await invoke<string>('start_screenshot_overlay');
    } catch (err) {
      setError(String(err));
      setCapturing(false);
      // 失败时恢复窗口
      if (screenshot.hideMainWindow) {
        try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().show(); } catch {}
      }
    }
  }, [setCapturing, screenshot.hideMainWindow]);

  useEffect(() => {
    const unlisten1 = listen<string>('screenshot-cropped', async (event) => {
      const imagePath = event.payload;
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
      // 截图后恢复主窗口
      if (screenshot.hideMainWindow) {
        try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().show(); } catch {}
      }
      // 按设置决定是否自动识别
      if (screenshot.autoRecognize) {
        await doOcr(imagePath);
      }
    });
    const unlisten2 = listen('screenshot-cancel', async () => {
      setCapturing(false);
      if (screenshot.hideMainWindow) {
        try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().show(); } catch {}
      }
    });
    const unlisten3 = listen<string>('screenshot-error', async (event) => {
      setError(event.payload);
      setCapturing(false);
      if (screenshot.hideMainWindow) {
        try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().show(); } catch {}
      }
    });
    const unlisten4 = listen('screenshot-triggered', () => handleScreenshot());
    return () => { unlisten1.then(fn => fn()); unlisten2.then(fn => fn()); unlisten3.then(fn => fn()); unlisten4.then(fn => fn()); };
  }, [handleScreenshot, setCapturing, doOcr, screenshot.autoRecognize, screenshot.hideMainWindow]);

  return (
    <div style={{ padding: 12 }}>
      <button onClick={handleScreenshot} disabled={isCapturing} className="screenshot-btn">
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
      </button>
      
      {error && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,59,48,0.08)', borderRadius: 12, fontSize: 11, color: '#FF3B30' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default ScreenshotTool;
