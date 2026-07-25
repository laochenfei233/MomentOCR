import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotStore } from '../stores/screenshotStore';
import { useOcrStore } from '../stores/ocrStore';
import { useSettingsStore } from '../stores/settingsStore';

function ScreenshotTool() {
  const { isCapturing, setCapturing, setScreenshotPath } = useScreenshotStore();
  const { setProcessing, setResult, addToHistory } = useOcrStore();
  const { activeOcrPlugin, pluginSettings } = useSettingsStore();
  const [error, setError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  // OCR识别函数
  const doOcr = useCallback(async (imagePath: string) => {
    setProcessing(true);
    try {
      let ocrResult = '';

      if (activeOcrPlugin === 'openai-vision') {
        const apiKey = (pluginSettings['openai-vision']?.apiKey as string) || '';
        const model = (pluginSettings['openai-vision']?.model as string) || 'gpt-4o';
        const maxTokens = (pluginSettings['openai-vision']?.maxTokens as number) || 1024;
        
        if (!apiKey) {
          ocrResult = '错误：未配置OpenAI API Key，请在设置中配置';
        } else {
          ocrResult = await invoke<string>('ocr_openai', {
            apiKey, imagePath, model, maxTokens
          });
        }
      } else if (activeOcrPlugin === 'local-llm') {
        const endpoint = (pluginSettings['local-llm']?.endpoint as string) || 'http://localhost:11434';
        const model = (pluginSettings['local-llm']?.model as string) || 'llava';
        
        ocrResult = await invoke<string>('ocr_ollama', { endpoint, model, imagePath });
      } else if (activeOcrPlugin === 'paddle-ocr') {
        ocrResult = 'PaddleOCR需要下载模型，暂未实现';
      } else {
        ocrResult = `未知的OCR引擎: ${activeOcrPlugin}`;
      }

      const result = {
        success: !ocrResult.startsWith('错误'),
        data: ocrResult,
        confidence: 0,
        language: 'auto'
      };

      setResult(result);
      addToHistory(result);
    } catch (err) {
      const result = {
        success: false,
        data: '',
        error: String(err)
      };
      setResult(result);
    } finally {
      setProcessing(false);
    }
  }, [activeOcrPlugin, pluginSettings, setProcessing, setResult, addToHistory]);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      await invoke<string>('start_screenshot_overlay');
    } catch (err) {
      setError(String(err));
      setCapturing(false);
    }
  }, [setCapturing]);

  useEffect(() => {
    const unlisten1 = listen<string>('screenshot-cropped', async (event) => {
      const imagePath = event.payload;
      setScreenshotPath(imagePath);
      setCaptureSuccess(true);
      setCapturing(false);
      setTimeout(() => setCaptureSuccess(false), 1500);
      
      // 自动调用OCR识别
      await doOcr(imagePath);
    });

    const unlisten2 = listen('screenshot-cancel', () => {
      setCapturing(false);
    });

    const unlisten3 = listen<string>('screenshot-error', (event) => {
      setError(event.payload);
      setCapturing(false);
    });

    const unlisten4 = listen('screenshot-triggered', () => {
      handleScreenshot();
    });

    return () => {
      unlisten1.then(fn => fn());
      unlisten2.then(fn => fn());
      unlisten3.then(fn => fn());
      unlisten4.then(fn => fn());
    };
  }, [handleScreenshot, setCapturing, setScreenshotPath, doOcr]);

  return (
    <div className="p-3">
      <button onClick={handleScreenshot} disabled={isCapturing} className="screenshot-btn">
        {isCapturing ? '截图中...' : captureSuccess ? '✓ 完成' : '截图'}
      </button>
      {error && <div className="error-msg"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
    </div>
  );
}

export default ScreenshotTool;
