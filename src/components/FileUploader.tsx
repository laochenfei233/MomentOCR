import { useCallback, useRef, useState } from 'react';
import { useFileStore } from '../stores/fileStore';

const Icons = {
  upload: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  close: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`"${file.name}" 格式不支持`);
      } else if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" 超过10MB`);
      } else {
        validFiles.push(file);
      }
    });

    if (errors.length > 0) {
      setValidationError(errors.join(', '));
      setTimeout(() => setValidationError(null), 2500);
    }

    return validFiles;
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      const validFiles = validateFiles(fileList);
      if (validFiles.length > 0) {
        const newFiles = validFiles.map((f) => ({ name: f.name, path: f.name }));
        addFiles(newFiles);
      }
    },
    [addFiles, validateFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div className="p-3 space-y-2">
      {/* 拖拽区域 - 紧凑 */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
      >
        {Icons.upload}
        <p className="text-xs text-gray-500 mt-1">
          {isDragging ? '释放添加文件' : '拖拽或点击选择'}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, GIF, WebP, BMP</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* 验证错误 */}
      {validationError && (
        <div className="flex items-center gap-1.5 p-2 bg-red-50 rounded text-xs text-red-600">
          <span className="text-red-500">⚠</span>
          <span>{validationError}</span>
        </div>
      )}

      {/* 文件列表 - 紧凑 */}
      {files.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400">文件 ({files.length})</span>
            <button
              onClick={clearFiles}
              className="text-[10px] text-red-400 hover:text-red-500"
            >
              清空
            </button>
          </div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-50 group"
              >
                <span className="text-xs text-gray-600 truncate flex-1 mr-2" title={f.name}>
                  {f.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400">
                    {f.status === 'pending' ? '待处理' :
                     f.status === 'processing' ? '处理中' :
                     f.status === 'done' ? '完成' : '失败'}
                  </span>
                  {f.status === 'pending' && (
                    <button
                      onClick={() => removeFile(f.id)}
                      className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {Icons.close}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUploader;
