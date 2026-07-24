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
    <div className="w-full px-4 py-3">
      {/* Processing state - Apple style spinner */}
      {isProcessing && (
        <div className="flex items-center justify-center gap-2 py-4 animate-fade-in">
          <svg className="h-4 w-4 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-gray-500">识别中...</span>
        </div>
      )}

      {/* Result display - Compact card */}
      {!isProcessing && result && (
        <div className="animate-slide-up">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">识别结果</span>
              {result.language && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">
                  {result.language}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {result.confidence !== undefined && result.confidence > 0 && (
                <span className="text-[10px] text-gray-400">
                  {Math.round(result.confidence * 100)}%
                </span>
              )}
              <button
                onClick={handleCopy}
                className="btn-fluid px-2 py-1 text-[10px] font-medium text-blue-500 hover:bg-blue-50 rounded transition-colors"
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <pre className="whitespace-pre-wrap text-xs text-gray-700 font-mono leading-relaxed max-h-32 overflow-y-auto">
              {result.data}
            </pre>
          </div>

          {/* Error display */}
          {!result.success && result.error && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-500">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isProcessing && !result && (
        <div className="py-6 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 mb-2">
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-xs text-gray-400">截图后显示识别结果</p>
        </div>
      )}

      {/* History - Compact list */}
      {history.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">历史</span>
            <span className="text-[10px] text-gray-300">{history.length}</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {history.slice(0, 5).map((entry) => (
              <button
                key={entry.timestamp}
                onClick={() => navigator.clipboard.writeText(entry.result.data)}
                className="btn-fluid w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">复制</span>
                </div>
                <p className="text-xs text-gray-600 truncate mt-0.5">{entry.result.data}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OcrResult;
