import { useState, useCallback, useEffect } from 'react';
import { useOcrStore } from '../stores/ocrStore';

interface OcrResultProps {
  onTextChange?: (text: string) => void;
  searchText?: string;
}

const Icons = {
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  warning: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  file: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
};

function OcrResult({ onTextChange, searchText = '' }: OcrResultProps) {
  const { isProcessing, result, history } = useOcrStore();
  const [copied, setCopied] = useState(false);

  // 通知父组件文本变化
  useEffect(() => {
    if (onTextChange && result?.data) {
      onTextChange(searchText ? result.data : result.data);
    }
  }, [result, onTextChange, searchText]);

  const handleCopy = useCallback(async () => {
    if (!result?.data) return;
    try {
      await navigator.clipboard.writeText(result.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 静默失败
    }
  }, [result?.data]);

  const handleCopyHistory = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 静默失败
    }
  }, []);

  // 处理中状态
  if (isProcessing) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-gray-400">
          <span className="spinner-sm"></span>
          <span className="text-sm">识别中...</span>
        </div>
      </div>
    );
  }

  // 有结果
  if (result) {
    return (
      <div className="flex flex-col h-full">
        {/* 结果头部 - 紧凑 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">识别结果</span>
            {result.language && (
              <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500 rounded">
                {result.language}
              </span>
            )}
            {result.confidence !== undefined && result.confidence > 0 && (
              <span className="text-[10px] text-gray-400">
                {Math.round(result.confidence * 100)}%
              </span>
            )}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 rounded transition-colors"
          >
            {copied ? Icons.check : Icons.copy}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>

        {/* 结果内容 - 重点区域 */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm text-gray-800 font-mono leading-relaxed whitespace-pre-wrap">
            {result.data}
          </pre>
        </div>

        {/* 错误显示 */}
        {!result.success && result.error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-100 flex items-center gap-2">
            <span className="text-red-500">{Icons.warning}</span>
            <span className="text-xs text-red-600">{result.error}</span>
          </div>
        )}

        {/* 历史记录 - 最多显示3条 */}
        {history.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="px-4 py-1.5 flex items-center justify-between">
              <span className="text-[10px] text-gray-400 uppercase">历史</span>
              <span className="text-[10px] text-gray-300">{history.length}</span>
            </div>
            <div className="max-h-20 overflow-y-auto">
              {history.slice(0, 3).map((entry) => (
                <button
                  key={entry.timestamp}
                  onClick={() => handleCopyHistory(entry.result.data)}
                  className="w-full text-left px-4 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-gray-300">点击复制</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{entry.result.data}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 空状态
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-300">
      {Icons.file}
      <p className="text-xs mt-2">截图后显示识别结果</p>
    </div>
  );
}

export default OcrResult;
