import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * 把主窗口显示 + 取消最小化 + 置顶夺焦点（实现在原生侧，见 Rust 的 focus_main_window）。
 * 失败不处理：这只是「让用户看见结果」，做不到也不该影响识别本身。
 */
function focusMain() {
  return invoke('focus_main_window').catch(() => {});
}

function ScreenshotTool() {
  const { isCapturing, setCapturing } = useScreenshotStore();
  const { screenshot } = useSettingsStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

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
      // 统一走 Tauri 覆盖层的 instant 模式：框选松开即识别
      await invoke('start_snipaste', { mode: 'instant' });
    } catch (err) {
      setError(String(err));
      setCapturing(false);
      await focusMain();
    }
  }, [setCapturing, screenshot.hideMainWindow]);

  useEffect(() => {
    // 识别本体在 App.tsx 的 snipaste-ocr 监听里跑（那里常驻，不随标签页卸载）；
    // 这里只管按钮状态与焦点恢复。取消时主窗口已由 Rust 侧 restore_main_window 还原。
    const unlisten1 = listen('snipaste-ocr', () => {
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
    });
    const unlisten2 = listen('snipaste-cancel', async () => {
      setCapturing(false);
      focusMain();
    });
    const unlisten3 = listen<string>('snipaste-error', async (event) => {
      setError(event.payload);
      setCapturing(false);
      focusMain();
    });
    return () => { unlisten1.then(fn => fn()); unlisten2.then(fn => fn()); unlisten3.then(fn => fn()); };
  }, [setCapturing]);

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
