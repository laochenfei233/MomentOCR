import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useFileStore } from '../stores/fileStore';
import { useOcrStore } from '../stores/ocrStore';
import { useSettingsStore } from '../stores/settingsStore';

function FileUploader() {
  const { files, addFiles, removeFile, clearFiles } = useFileStore();
  const { setProcessing, setResult, addToHistory } = useOcrStore();
  const { activeOcrPlugin, pluginSettings, afterRecognize } = useSettingsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // OCR识别
  const doOcr = useCallback(async (imagePath: string) => {
    setProcessing(true);
    setProcessingFile(imagePath.split(/[/\\]/).pop() || imagePath);
    try {
      let ocrResult = '';
      const customVisionPlugins = ['qwen-vision', 'zhipu-vision', 'doubao-vision', 'gemini-vision', 'mimo-vision'];
      if (activeOcrPlugin === 'openai-vision') {
        const apiKey = (pluginSettings['openai-vision']?.apiKey as string) || '';
        const model = (pluginSettings['openai-vision']?.model as string) || 'gpt-4o';
        const maxTokens = Number(pluginSettings['openai-vision']?.maxTokens) || 1024;
        if (!apiKey) { ocrResult = '错误：未配置OpenAI API Key'; } else {
          ocrResult = await invoke<string>('ocr_openai', { apiKey, imagePath, model, maxTokens });
        }
      } else if (customVisionPlugins.includes(activeOcrPlugin)) {
        const cfg = pluginSettings[activeOcrPlugin] || {};
        const apiKey = (cfg.apiKey as string) || '';
        const model = (cfg.model as string) || '';
        const baseUrl = (cfg.baseUrl as string) || '';
        const maxTokens = Number(cfg.maxTokens) || 1024;
        if (!apiKey) { ocrResult = `错误：未配置${activeOcrPlugin} API Key`; } else {
          ocrResult = await invoke<string>('ocr_custom_vision', { baseUrl, apiKey, model, imagePath, maxTokens });
        }
      } else if (activeOcrPlugin === 'claude-vision') {
        const cfg = pluginSettings['claude-vision'] || {};
        const apiKey = (cfg.apiKey as string) || '';
        const model = (cfg.model as string) || 'claude-sonnet-4-5';
        const baseUrl = (cfg.baseUrl as string) || 'https://api.anthropic.com/v1';
        const maxTokens = Number(cfg.maxTokens) || 1024;
        if (!apiKey) { ocrResult = '错误：未配置 Claude API Key'; } else {
          ocrResult = await invoke<string>('ocr_claude', { baseUrl, apiKey, model, imagePath, maxTokens });
        }
      } else if (activeOcrPlugin === 'local-llm') {
        const endpoint = (pluginSettings['local-llm']?.endpoint as string) || 'http://localhost:11434';
        const model = (pluginSettings['local-llm']?.model as string) || 'llava';
        ocrResult = await invoke<string>('ocr_ollama', { endpoint, model, imagePath });
      } else if (activeOcrPlugin === 'paddle-ocr') {
        ocrResult = await invoke<string>('ocr_paddleocr', { imagePath });
      } else if (activeOcrPlugin === 'rapid-ocr') {
        ocrResult = await invoke<string>('ocr_rapidocr', { imagePath });
      } else {
        ocrResult = `未知引擎: ${activeOcrPlugin}`;
      }
      const result = { success: !ocrResult.startsWith('错误'), data: ocrResult, confidence: 0, language: 'auto' };
      setResult(result);
      addToHistory(result);
      // 自动复制
      if (afterRecognize.autoCopy && result.success) {
        try { await navigator.clipboard.writeText(result.data); } catch {}
      }
    } catch (err) {
      setResult({ success: false, data: '', error: String(err) });
    } finally {
      setProcessing(false);
      setProcessingFile(null);
    }
  }, [activeOcrPlugin, pluginSettings, setProcessing, setResult, addToHistory, afterRecognize.autoCopy]);

  // 使用 Tauri 文件对话框选择文件
  const handleSelectFiles = useCallback(async () => {
    try {
      const selected = await invoke<string[]>('select_image_files');
      if (selected && selected.length > 0) {
        const newFiles = selected.map(path => ({
          name: path.split(/[/\\]/).pop() || path,
          path: path
        }));
        addFiles(newFiles);
        // 对第一个文件进行OCR
        await doOcr(newFiles[0].path);
      }
    } catch (err) {
      if (err !== 'Cancelled') {
        setError(String(err));
        setTimeout(() => setError(null), 3000);
      }
    }
  }, [addFiles, doOcr]);

  // 拖拽文件 - 读取文件内容作为临时路径
  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    
    // 拖拽的文件需要保存到临时目录才能被OCR引擎读取
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    
    try {
      // 将文件保存到临时目录
      const tempFiles = await invoke<string[]>('save_temp_files', { 
        fileNames: files.map(f => f.name),
        fileData: await Promise.all(files.map(f => f.arrayBuffer().then(buf => Array.from(new Uint8Array(buf)))))
      });
      
      const newFiles = tempFiles.map(path => ({
        name: path.split(/[/\\]/).pop() || path,
        path: path
      }));
      addFiles(newFiles);
      
      // 对第一个文件进行OCR
      if (newFiles.length > 0) {
        await doOcr(newFiles[0].path);
      }
    } catch (err) {
      setError(String(err));
      setTimeout(() => setError(null), 3000);
    }
  }, [addFiles, doOcr]);

  return (
    <div style={{ padding: 12 }}>
      {/* 拖拽区域 */}
      <div
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={handleSelectFiles}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 24, border: `1.5px dashed ${isDragging ? '#007AFF' : '#D1D1D6'}`,
          borderRadius: 12, background: isDragging ? 'rgba(0,122,255,0.05)' : '#F2F2F7',
          cursor: 'pointer', transition: 'all 200ms ease-out',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#007AFF' : '#AEAEB2'} strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <p style={{ fontSize: 12, color: isDragging ? '#007AFF' : '#636366', marginTop: 8 }}>
          {isDragging ? '释放添加文件' : '点击选择图片文件'}
        </p>
        <p style={{ fontSize: 10, color: '#AEAEB2', marginTop: 2 }}>支持拖拽或点击选择</p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,59,48,0.08)', borderRadius: 12, fontSize: 11, color: '#FF3B30' }}>
          {error}
        </div>
      )}

      {/* 识别进度 */}
      {processingFile && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,122,255,0.08)', borderRadius: 12, fontSize: 11, color: '#007AFF', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="spinner-sm"></span>
          正在识别: {processingFile}
        </div>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#AEAEB2', textTransform: 'uppercase' }}>文件 ({files.length})</span>
            <button onClick={clearFiles} style={{ fontSize: 10, color: '#FF3B30', background: 'none', border: 'none', cursor: 'pointer' }}>清空</button>
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {files.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#FFFFFF', borderRadius: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12, color: '#1c1c1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                <button onClick={() => removeFile(f.id)} style={{ fontSize: 10, color: '#AEAEB2', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUploader;
