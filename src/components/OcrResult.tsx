import { useState } from 'react';
import { useOcrStore } from '../stores/ocrStore';

function OcrResult() {
  const { isProcessing, result, history } = useOcrStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!result?.data) return;
    await navigator.clipboard.writeText(result.data);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 space-y-4">
      {isProcessing && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-6 py-8">
          <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-blue-700 font-medium">识别中...</span>
        </div>
      )}

      {!isProcessing && result && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">识别结果</span>
              {result.language && (
                <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                  {result.language}
                </span>
              )}
              {result.confidence !== undefined && (
                <span className="text-xs text-gray-500">
                  置信度 {(result.confidence * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <button
              onClick={handleCopy}
              className="rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 transition-colors"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap p-4 text-sm text-gray-800 font-mono max-h-60 overflow-y-auto">
            {result.data}
          </pre>
          {!result.success && result.error && (
            <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
              {result.error}
            </div>
          )}
        </div>
      )}

      {!isProcessing && !result && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm text-gray-400">截图后将在此显示识别结果</p>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
            <span className="text-sm font-semibold text-gray-700">历史记录</span>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
            {history.map((entry) => (
              <div key={entry.timestamp} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  {entry.result.confidence !== undefined && (
                    <span className="text-xs text-gray-400">
                      {(entry.result.confidence * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 line-clamp-2">{entry.result.data}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OcrResult;
