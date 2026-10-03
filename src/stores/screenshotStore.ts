import { create } from 'zustand';

interface ScreenshotState {
  isCapturing: boolean;
  setCapturing: (isCapturing: boolean) => void;
}

export const useScreenshotStore = create<ScreenshotState>((set) => ({
  isCapturing: false,
  setCapturing: (isCapturing) => set({ isCapturing }),
}));
