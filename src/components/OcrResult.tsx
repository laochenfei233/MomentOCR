import { useState, useCallback, useEffect, useRef } from 'react';
import { useOcrStore } from '../stores/ocrStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Logo } from './Logo';

interface OcrResultProps {
  onTextChange?: (text: string) => void;
  /** 译文内容（独立翻译框显示） */
  translation?: string;
  /** 翻译框位置：'下方' | '右侧' */
  translationLayout?: string;
  /** 翻译目标语言（标签展示） */
  translationTarget?: string;
}

const FONT_SIZE_MAP: Record<string, string> = { '小四': '16px', '小三': '19px', '四号': '18px', '五号': '14px' };
const FONT_FAMILY_MAP: Record<string, string> = { '新罗马': '"Times New Roman", serif', '宋体': '"SimSun", serif', '微软雅黑': '"Microsoft YaHei", sans-serif', '黑体': '"SimHei", sans-serif' };

function OcrResult({ onTextChange, translation, translationLayout, translationTarget }: OcrResultProps) {
  const { isProcessing, result } = useOcrStore();
  const { style, translateSplit, setTranslateSplit } = useSettingsStore();
  const [copied, setCopied] = useState(false);
  const [translationCopied, setTranslationCopied] = useState(false);
  const [editableText, setEditableText] = useState('');
  const splitAreaRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // 分割线拖动：按指针位置换算翻译区占比
  const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !splitAreaRef.current) return;
    const rect = splitAreaRef.current.getBoundingClientRect();
    const isRight = translationLayout === '右侧';
    const pct = isRight
      ? ((rect.right - e.clientX) / rect.width) * 100
      : ((rect.bottom - e.clientY) / rect.height) * 100;
    setTranslateSplit(Math.round(pct));
  }, [translationLayout, setTranslateSplit]);

  const handleDividerPointerUp = useCallback(() => { draggingRef.current = false; setDragging(false); }, []);
  const handleDividerReset = useCallback(() => setTranslateSplit(42), [setTranslateSplit]);

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

  const handleCopyTranslation = useCallback(async () => {
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      setTranslationCopied(true);
      setTimeout(() => setTranslationCopied(false), 1200);
    } catch {}
  }, [translation]);

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

        {/* 原文 + 翻译框 */}
        {(() => {
          const showTranslation = !!translation && translation.trim().length > 0;
          const isRight = showTranslation && translationLayout === '右侧';
          const textareaStyle: React.CSSProperties = {
            width: '100%',
            height: '100%',
            minHeight: showTranslation ? 80 : 200,
            fontSize: FONT_SIZE_MAP[style.fontSize] || '13px',
            color: '#1c1c1e',
            fontFamily: FONT_FAMILY_MAP[style.fontStyle] || 'inherit',
            lineHeight: 1.8,
            padding: '4px 0',
            textAlign: style.paragraphAlign === '左对齐' ? 'left' : style.paragraphAlign === '居中' ? 'center' : style.paragraphAlign === '右对齐' ? 'right' : 'justify',
            textIndent: style.firstLineIndent ? '2em' : 0,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            overflow: 'auto',
          };
          return (
            <div ref={splitAreaRef} style={{ flex: 1, display: 'flex', flexDirection: isRight ? 'row' : 'column', overflow: 'hidden', minHeight: 0 }}>
              {/* 原文区 */}
              <div style={{
                flex: '1 1 auto',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'auto',
                padding: '16px 20px',
              }}>
                <textarea
                  value={editableText}
                  onChange={handleTextChange}
                  style={textareaStyle}
                  placeholder="识别结果将显示在这里..."
                />
              </div>

              {/* 可拖动分割线 */}
              {showTranslation && (
                <div
                  onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); draggingRef.current = true; setDragging(true); }}
                  onPointerMove={handleDividerPointerMove}
                  onPointerUp={handleDividerPointerUp}
                  onPointerCancel={handleDividerPointerUp}
                  onDoubleClick={handleDividerReset}
                  title="拖动调整原文/翻译区域大小（双击复位）"
                  style={{
                    flex: isRight ? '0 0 6px' : '0 0 6px',
                    cursor: isRight ? 'col-resize' : 'row-resize',
                    background: dragging ? '#007AFF' : '#E5E5EA',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    touchAction: 'none',
                    userSelect: 'none',
                    transition: dragging ? 'none' : 'background 100ms ease-out',
                  }}
                >
                  <span style={{
                    display: 'block',
                    background: dragging ? '#FFFFFF' : '#C7C7CC',
                    borderRadius: 2,
                    ...(isRight ? { width: 2, height: 20 } : { width: 20, height: 2 }),
                  }} />
                </div>
              )}

              {/* 独立翻译框 */}
              {showTranslation && (
                <div style={{
                  flex: `0 0 ${translateSplit}%`,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  background: '#FAFAFA',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', borderBottom: '0.5px solid #E5E5EA' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>翻译结果</span>
                      <span style={{ padding: '2px 6px', fontSize: 10, background: '#E8F0FE', color: '#007AFF', borderRadius: 6 }}>→ {translationTarget}</span>
                    </div>
                    <button onClick={handleCopyTranslation} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, color: '#007AFF', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                      {translationCopied ? '✓ 已复制' : '复制'}
                    </button>
                  </div>
                  <textarea
                    value={translation}
                    readOnly
                    style={{ ...textareaStyle, padding: '12px 16px', textIndent: 0, textAlign: 'left' }}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {!result.success && result.error && (
          <div style={{ padding: '8px 16px', background: 'rgba(255,59,48,0.08)', borderTop: '0.5px solid rgba(255,59,48,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#FF3B30' }}>⚠</span>
            <span style={{ fontSize: 12, color: '#FF3B30' }}>{result.error}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#C7C7CC' }}>
      <Logo size={64} />
      <p style={{ fontSize: 13, color: '#AEAEB2', marginTop: 12 }}>截图后显示识别结果</p>
    </div>
  );
}

export default OcrResult;
