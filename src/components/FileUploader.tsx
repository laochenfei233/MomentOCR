import { useCallback, useRef } from 'react';
import { useFileStore } from '../stores/fileStore';

const STATUS_MAP = {
  pending: { label: '待处理', color: 'bg-yellow-100 text-yellow-800' },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-800' },
  done: { label: '已完成', color: 'bg-green-100 text-green-800' },
  error: { label: '失败', color: 'bg-red-100 text-red-800' },
};

function FileUploader() {
  const { files, addFiles, removeFile, clearFiles } = useFileStore();
  const inputRef = useRef<HTMLInputElement>(null);

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
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-4 max-w-lg mx-auto">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <div className="text-gray-500">
          <svg className="mx-auto h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0L8 8m4-4l4 4" />
          </svg>
          <p className="text-lg font-medium">拖拽图片到此处</p>
          <p className="text-sm mt-1">或点击选择文件（支持图片格式）</p>
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

      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">共 {files.length} 个文件</span>
            <button
              onClick={clearFiles}
              className="text-sm text-red-500 hover:text-red-700"
            >
              清空列表
            </button>
          </div>
          <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm truncate flex-1 mr-2" title={f.name}>
                  {f.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_MAP[f.status].color}`}>
                    {STATUS_MAP[f.status].label}
                  </span>
                  {f.status === 'pending' && (
                    <button
                      onClick={() => removeFile(f.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      ×
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
