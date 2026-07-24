import { useCallback, useRef, useState } from 'react';
import { useFileStore } from '../stores/fileStore';

const STATUS_CONFIG = {
  pending: { label: '待处理', color: 'text-yellow-500', bg: 'bg-yellow-50' },
  processing: { label: '处理中', color: 'text-blue-500', bg: 'bg-blue-50' },
  done: { label: '完成', color: 'text-green-500', bg: 'bg-green-50' },
  error: { label: '失败', color: 'text-red-500', bg: 'bg-red-50' },
};

function FileUploader() {
  const { files, addFiles, removeFile, clearFiles } = useFileStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const newFiles = Array.from(fileList)
        .filter((f) => f.type.startsWith('image/'))
        .map((f) => ({ name: f.name, path: f.name }));
      if (newFiles.length > 0) addFiles(newFiles);
    },
    [addFiles]
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
    <div className="w-full max-w-xs animate-slide-up">
      {/* Drop zone - Apple style */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`btn-fluid relative rounded-xl border-2 border-dashed p-6 text-center cursor-pointer
          transition-all duration-200 ${
            isDragging
              ? 'border-blue-400 bg-blue-50/80 scale-[1.02]'
              : 'border-gray-200 bg-white/50 hover:border-gray-300 hover:bg-gray-50/50'
          }`}
      >
        <div className={`transition-colors ${isDragging ? 'text-blue-500' : 'text-gray-400'}`}>
          <svg className="mx-auto h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0L8 8m4-4l4 4" />
          </svg>
          <p className="text-xs font-medium text-gray-600">
            {isDragging ? '释放以添加文件' : '拖拽图片或点击选择'}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">支持 JPG, PNG, GIF 等格式</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* File list - Compact */}
      {files.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              文件 ({files.length})
            </span>
            <button
              onClick={clearFiles}
              className="btn-fluid text-[10px] text-red-400 hover:text-red-500 transition-colors"
            >
              清空
            </button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.id}
                className="btn-fluid flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/60 border border-gray-100 group"
              >
                <span className="text-xs text-gray-600 truncate flex-1 mr-2" title={f.name}>
                  {f.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] ${STATUS_CONFIG[f.status].color}`}>
                    {STATUS_CONFIG[f.status].label}
                  </span>
                  {f.status === 'pending' && (
                    <button
                      onClick={() => removeFile(f.id)}
                      className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
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
