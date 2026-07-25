import { useCallback, useRef, useState } from 'react';
import { useFileStore } from '../stores/fileStore';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

function FileUploader() {
  const { files, addFiles, removeFile, clearFiles } = useFileStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateFiles = useCallback((fileList: FileList | null): File[] => {
    if (!fileList) return [];
    const validFiles: File[] = [];
    const errors: string[] = [];
    Array.from(fileList).forEach((file) => {
      if (!ALLOWED_TYPES.includes(file.type)) errors.push(`"${file.name}" 格式不支持`);
      else if (file.size > 10 * 1024 * 1024) errors.push(`"${file.name}" 超过10MB`);
      else validFiles.push(file);
    });
    if (errors.length > 0) { setValidationError(errors.join(', ')); setTimeout(() => setValidationError(null), 2500); }
    return validFiles;
  }, []);

  const handleFiles = useCallback((fileList: FileList | null) => {
    const valid = validateFiles(fileList);
    if (valid.length > 0) addFiles(valid.map(f => ({ name: f.name, path: f.name })));
  }, [addFiles, validateFiles]);

  return (
    <div style={{ padding: 12 }}>
      <div
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 24, border: `1.5px dashed ${isDragging ? '#007AFF' : '#D1D1D6'}`,
          borderRadius: 10, background: isDragging ? 'rgba(0,122,255,0.05)' : '#F2F2F7',
          cursor: 'pointer', transition: 'all 200ms ease-out',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#007AFF' : '#AEAEB2'} strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p style={{ fontSize: 12, color: isDragging ? '#007AFF' : '#636366', marginTop: 8 }}>{isDragging ? '释放添加文件' : '拖拽或点击选择'}</p>
        <p style={{ fontSize: 10, color: '#AEAEB2', marginTop: 2 }}>JPG, PNG, GIF, WebP, BMP</p>
        <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>
      {validationError && <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,59,48,0.08)', borderRadius: 8, fontSize: 11, color: '#FF3B30' }}>⚠ {validationError}</div>}
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
      <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  );
}

export default FileUploader;
