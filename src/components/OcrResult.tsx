import { useState, useCallback, useEffect } from 'react';
import { useOcrStore } from '../stores/ocrStore';

interface OcrResultProps {
  onTextChange?: (text: string) => void;
}

function OcrResult({ onTextChange }: OcrResultProps) {
  const { isProcessing, result, history } = useOcrStore();
  const [copied, setCopied] = useState(false);
  const [editableText, setEditableText] = useState('');

  // 当结果变化时更新可编辑文本
  useEffect(() => {
    if (result?.data) {
      setEditableText(result.data);
      if (onTextChange) onTextChange(result.data);
    }
  }, [result, onTextChange]);

  // 文本变化时通知父组件
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setEditableText(newText);
    if (onTextChange) onTextChange(newText);
  }, [onTextChange]);

  const handleCopy = useCallback(async () => {
    const textToCopy = editableText || result?.data || '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 备用方案
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }, [editableText, result?.data]);

  const handleCopyHistory = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, []);

  if (isProcessing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner-sm" />
          <span style={{ fontSize: 13, color: '#8E8E93' }}>识别中...</span>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#FFFFFF' }}>
        {/* 结果头部 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '0.5px solid #E5E5EA' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>识别结果</span>
            {result.language && <span style={{ padding: '2px 6px', fontSize: 10, background: '#F2F2F7', color: '#8E8E93', borderRadius: 6 }}>{result.language}</span>}
            {result.confidence !== undefined && result.confidence > 0 && <span style={{ fontSize: 10, color: '#AEAEB2' }}>{Math.round(result.confidence * 100)}%</span>}
          </div>
          <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, color: '#007AFF', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>

        {/* 可编辑的识别结果 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <textarea
            value={editableText}
            onChange={handleTextChange}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 200,
              fontSize: 13,
              color: '#1c1c1e',
              fontFamily: 'SF Mono, Menlo, monospace',
              lineHeight: 1.6,
              border: 'none',
              outline: 'none',
              resize: 'none',
              background: 'transparent',
            }}
            placeholder="识别结果将显示在这里..."
          />
        </div>

        {!result.success && result.error && (
          <div style={{ padding: '8px 16px', background: 'rgba(255,59,48,0.08)', borderTop: '0.5px solid rgba(255,59,48,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#FF3B30' }}>⚠</span>
            <span style={{ fontSize: 12, color: '#FF3B30' }}>{result.error}</span>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ borderTop: '0.5px solid #E5E5EA' }}>
            <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: '#AEAEB2', textTransform: 'uppercase' }}>历史</span>
              <span style={{ fontSize: 10, color: '#C7C7CC' }}>{history.length}</span>
            </div>
            <div style={{ maxHeight: 80, overflowY: 'auto' }}>
              {history.slice(0, 3).map((entry) => (
                <button key={entry.timestamp} onClick={() => handleCopyHistory(entry.result.data)}
                  style={{ width: '100%', textAlign: 'left', padding: '6px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: '#AEAEB2' }}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ fontSize: 10, color: '#C7C7CC' }}>点击复制</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#636366', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.result.data}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#C7C7CC' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p style={{ fontSize: 12, marginTop: 8 }}>截图后显示识别结果</p>
    </div>
  );
}

export default OcrResult;
