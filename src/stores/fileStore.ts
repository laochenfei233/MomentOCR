import { create } from 'zustand';

export type FileStatus = 'pending' | 'processing' | 'done' | 'error';

export interface FileItem {
  id: string;
  name: string;
  path: string;
  status: FileStatus;
  result?: string;
  error?: string;
}

interface FileState {
  files: FileItem[];
  addFiles: (files: Omit<FileItem, 'id' | 'status'>[]) => void;
  updateFileStatus: (id: string, status: FileStatus, result?: string, error?: string) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  addFiles: (newFiles) =>
    set((state) => ({
      files: [
        ...state.files,
        ...newFiles.map((f) => ({
          ...f,
          id: crypto.randomUUID(),
          status: 'pending' as const,
        })),
      ],
    })),
  updateFileStatus: (id, status, result, error) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, status, result, error } : f
      ),
    })),
  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
    })),
  clearFiles: () => set({ files: [] }),
}));
