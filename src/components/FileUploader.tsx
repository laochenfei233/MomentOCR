import { useCallback, useRef, useState } from 'react';
import { useFileStore } from '../stores/fileStore';

const STATUS_CONFIG = {
  pending: { label: '待处理', color: 'text-gray-500' },
  processing: { label: '处理中', color: 'text-blue-500' },
  done: { label: '完成', color: 'text-green-500' },
  error: { label: '失败', color: 'text-red-500' },
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
        errors.push(`"${file.name}" 超过10MB限制`);
      } else {
        validFiles.push(file);
      }
    });

    if (errors.length > 0) {
      setValidationError(errors.join(', '));
      setTimeout(() => setValidationError(null), 3000);
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="flex flex-col gap-3 p-4" role="region" aria-label="文件上传">
      {/* 拖拽区域 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="点击或拖拽图片文件到此处"
        className={`ios-dropzone ${isDragging ? 'ios-dropzone-active' : ''}`}
      >
        <div className="text-center">
          <div className="text-3xl mb-2">📁</div>
          <p className="ios-text-body text-gray-600">
            {isDragging ? '释放以添加文件' : '拖拽图片或点击选择'}
          </p>
          <p className="ios-text-caption text-gray-400 mt-1">
            支持 JPG, PNG, GIF, WebP, BMP (最大10MB)
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-hidden="true"
        />
      </div>

      {/* 验证错误 */}
      {validationError && (
        <div className="ios-alert ios-alert-warning">
          <span className="ios-alert-icon">⚠️</span>
          <p className="ios-text-body">{validationError}</p>
        </div>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="ios-text-caption uppercase tracking-wider text-gray-500">
              文件 ({files.length})
            </span>
            <button
              onClick={clearFiles}
              aria-label="清空所有文件"
              className="ios-btn-text text-red-500 text-sm"
            >
              清空
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto" role="list" aria-label="已添加的文件">
            {files.map((f) => (
              <div
                key={f.id}
                className="ios-list-item group"
                role="listitem"
              >
                <span className="ios-text-body text-gray-700 truncate flex-1 mr-2" title={f.name}>
                  {f.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`ios-text-caption ${STATUS_CONFIG[f.status].color}`}>
                    {STATUS_CONFIG[f.status].label}
                  </span>
                  {f.status === 'pending' && (
                    <button
                      onClick={() => removeFile(f.id)}
                      aria-label={`删除 ${f.name}`}
                      className="ios-btn-icon text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
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
