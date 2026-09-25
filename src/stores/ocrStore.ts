import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface HistoryEntry {
  id: string;
  timestamp: number;
  data: string;
}

interface OcrState {
  isProcessing: boolean;
  result: { success: boolean; data: string; confidence?: number; language?: string; error?: string } | null;
  history: HistoryEntry[];
  setProcessing: (isProcessing: boolean) => void;
  setResult: (result: { success: boolean; data: string; confidence?: number; language?: string; error?: string } | null) => void;
  addToHistory: (result: { success: boolean; data: string; confidence?: number; language?: string; error?: string }) => void;
  clearHistory: () => void;
  restoreFromHistory: (id: string) => void;
}

export const useOcrStore = create<OcrState>()(
  persist(
    (set) => ({
      isProcessing: false,
      result: null,
      history: [],
      setProcessing: (isProcessing) => set({ isProcessing }),
      setResult: (result) => set({ result }),
      addToHistory: (result) =>
        set((state) => ({
          history: [
            { id: Date.now().toString(), timestamp: Date.now(), data: result.data },
            ...state.history,
          ].slice(0, 100),
        })),
      clearHistory: () => set({ history: [] }),
      restoreFromHistory: (id) =>
        set((state) => {
          const entry = state.history.find((h) => h.id === id);
          return entry ? { result: { success: true, data: entry.data } } : {};
        }),
    }),
    {
      name: 'moment-ocr-history',
    }
  )
);
