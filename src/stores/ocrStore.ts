import { create } from 'zustand';
import type { PluginOutput } from '../types/plugin';

interface HistoryEntry {
  timestamp: number;
  result: PluginOutput;
}

interface OcrState {
  isProcessing: boolean;
  result: PluginOutput | null;
  history: HistoryEntry[];
  setProcessing: (isProcessing: boolean) => void;
  setResult: (result: PluginOutput | null) => void;
  addToHistory: (result: PluginOutput) => void;
}

export const useOcrStore = create<OcrState>((set) => ({
  isProcessing: false,
  result: null,
  history: [],
  setProcessing: (isProcessing) => set({ isProcessing }),
  setResult: (result) => set({ result }),
  addToHistory: (result) =>
    set((state) => ({
      history: [{ timestamp: Date.now(), result }, ...state.history].slice(0, 50),
    })),
}));
