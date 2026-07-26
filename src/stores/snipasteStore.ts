import { create } from 'zustand';

export interface Annotation {
  id: string;
  type: 'arrow' | 'rectangle' | 'text' | 'mosaic';
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
}

export interface PinState {
  id: string;
  imageData: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

interface SnipasteState {
  // 截图状态
  isCapturing: boolean;
  screenshotPath: string | null;
  
  // 长截图状态
  isLongScreenshot: boolean;
  longScreenshotPaths: string[];
  currentStitchedPath: string | null;
  
  // 标注状态
  activeTool: 'arrow' | 'rectangle' | 'text' | 'mosaic' | null;
  annotations: Annotation[];
  
  // 贴图管理
  pins: PinState[];
  
  // Actions
  setCapturing: (isCapturing: boolean) => void;
  setScreenshotPath: (path: string | null) => void;
  setLongScreenshot: (isLong: boolean) => void;
  addLongScreenshotPath: (path: string) => void;
  clearLongScreenshotPaths: () => void;
  setCurrentStitchedPath: (path: string | null) => void;
  setActiveTool: (tool: 'arrow' | 'rectangle' | 'text' | 'mosaic' | null) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  undoAnnotation: () => void;
  clearAnnotations: () => void;
  addPin: (pin: PinState) => void;
  removePin: (id: string) => void;
  updatePin: (id: string, updates: Partial<PinState>) => void;
  clearPins: () => void;
}

export const useSnipasteStore = create<SnipasteState>((set) => ({
  // 初始状态
  isCapturing: false,
  screenshotPath: null,
  isLongScreenshot: false,
  longScreenshotPaths: [],
  currentStitchedPath: null,
  activeTool: null,
  annotations: [],
  pins: [],
  
  // Actions
  setCapturing: (isCapturing) => set({ isCapturing }),
  setScreenshotPath: (path) => set({ screenshotPath: path }),
  setLongScreenshot: (isLong) => set({ isLongScreenshot: isLong }),
  addLongScreenshotPath: (path) => set((state) => ({
    longScreenshotPaths: [...state.longScreenshotPaths, path]
  })),
  clearLongScreenshotPaths: () => set({ longScreenshotPaths: [] }),
  setCurrentStitchedPath: (path) => set({ currentStitchedPath: path }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  addAnnotation: (annotation) => set((state) => ({
    annotations: [...state.annotations, annotation]
  })),
  removeAnnotation: (id) => set((state) => ({
    annotations: state.annotations.filter(a => a.id !== id)
  })),
  undoAnnotation: () => set((state) => ({
    annotations: state.annotations.slice(0, -1)
  })),
  clearAnnotations: () => set({ annotations: [] }),
  addPin: (pin) => set((state) => ({
    pins: [...state.pins, pin]
  })),
  removePin: (id) => set((state) => ({
    pins: state.pins.filter(p => p.id !== id)
  })),
  updatePin: (id, updates) => set((state) => ({
    pins: state.pins.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  clearPins: () => set({ pins: [] }),
}));
