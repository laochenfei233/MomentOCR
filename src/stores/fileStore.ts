import { create } from 'zustand';

export interface FileItem {
  id: string;
  name: string;
  path: string;
}

interface FileState {
  files: FileItem[];
  addFiles: (files: Omit<FileItem, 'id'>[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  addFiles: (newFiles) =>
    set((state) => ({
      files: [
        ...state.files,
        ...newFiles.map((f) => ({ ...f, id: crypto.randomUUID() })),
      ],
    })),
  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
    })),
  clearFiles: () => set({ files: [] }),
}));
