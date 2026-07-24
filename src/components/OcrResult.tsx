import { useState, useCallback } from 'react';
import { useOcrStore } from '../stores/ocrStore';

function OcrResult() {
  const { isProcessing, result, history } = useOcrStore();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!result?.data) return;
    try {
      await navigator.clipboard.writeText(result.data);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  }, [result?.data]);

  return (
    <div className="flex flex-col h-full" role="region" aria-label="OCR识别结果">
      {/* 处理中状态 */}
      {isProcessing && (
        <div className="flex items-center justify-center gap-2 py-8">
          <span className="spinner"></span>
          <span className="ios-text-body text-gray-500">识别中...</span>
        </div>
      )}

      {/* 结果显示 */}
      {!isProcessing && result && (
        <div className="flex flex-col h-full">
          {/* 结果头部 */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="ios-text-headline">识别结果</span>
              {result.language && (
                <span className="ios-badge" aria-label={`语言: ${result.language}`}>
                  {result.language}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {result.confidence !== undefined && result.confidence > 0 && (
                <span className="ios-text-caption" aria-label={`置信度: ${Math.round(result.confidence * 100)}%`}>
                  {Math.round(result.confidence * 100)}%
                </span>
              )}
              <button
                onClick={handleCopy}
                disabled={!result.data}
                aria-label={copied ? '已复制到剪贴板' : '复制识别结果'}
                className="ios-btn-text text-sm"
              >
                {copied ? '✓ 已复制' : copyError ? '复制失败' : '复制'}
              </button>
            </div>
          </div>

          {/* 结果内容 */}
          <div className="flex-1 overflow-auto p-4">
            <pre className="ios-text-body whitespace-pre-wrap font-mono leading-relaxed" aria-label="识别文本内容">
              {result.data}
            </pre>
          </div>

          {/* 错误显示 */}
          {!result.success && result.error && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-100">
              <p className="ios-text-caption text-red-600">{result.error}</p>
            </div>
          )}
        </div>
      )}

      {/* 空状态 */}
      {!isProcessing && !result && (
        <div className="flex flex-col items-center justify-center h-full py-12">
          <div className="text-4xl mb-3">📋</div>
          <p className="ios-text-body text-gray-400">截图后显示识别结果</p>
        </div>
      )}

      {/* 历史记录 */}
      {history.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="ios-text-caption uppercase tracking-wider">历史</span>
            <span className="ios-text-caption">{history.length}</span>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {history.slice(0, 5).map((entry) => (
              <button
                key={entry.timestamp}
                onClick={() => navigator.clipboard.writeText(entry.result.data)}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors"
                aria-label={`${new Date(entry.timestamp).toLocaleTimeString()} - 点击复制`}
              >
                <div className="flex items-center justify-between">
                  <span className="ios-text-caption">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="ios-text-caption text-gray-300">复制</span>
                </div>
                <p className="ios-text-caption text-gray-600 truncate mt-1">{entry.result.data}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OcrResult;
