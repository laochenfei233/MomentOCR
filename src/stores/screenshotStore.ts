import { create } from 'zustand';

interface ScreenshotState {
  isCapturing: boolean;
  screenshotPath: string | null;
  setCapturing: (isCapturing: boolean) => void;
  setScreenshotPath: (path: string | null) => void;
}

export const useScreenshotStore = create<ScreenshotState>((set) => ({
  isCapturing: false,
  screenshotPath: null,
  setCapturing: (isCapturing) => set({ isCapturing }),
  setScreenshotPath: (screenshotPath) => set({ screenshotPath }),
}));
