import { create } from 'zustand';

export type AnnotationType = 'pen' | 'line' | 'arrow' | 'rectangle' | 'text' | 'mosaic' | 'highlighter' | 'blur';

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  type: AnnotationType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
  strokeWidth?: number;
  opacity?: number;  // 透明度 0-1
  points?: Point[];  // 用于画笔和荧光笔的路径点
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
  activeTool: AnnotationType | null;
  annotations: Annotation[];
  annotationColor: string;
  strokeWidth: number;
  opacity: number;

  // 贴图管理
  pins: PinState[];

  // Actions
  setCapturing: (isCapturing: boolean) => void;
  setScreenshotPath: (path: string | null) => void;
  setLongScreenshot: (isLong: boolean) => void;
  addLongScreenshotPath: (path: string) => void;
  clearLongScreenshotPaths: () => void;
  setCurrentStitchedPath: (path: string | null) => void;
  setActiveTool: (tool: AnnotationType | null) => void;
  setAnnotationColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setOpacity: (opacity: number) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
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
  annotationColor: '#FF3B30',
  strokeWidth: 3,
  opacity: 1,
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
  setAnnotationColor: (color) => set({ annotationColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setOpacity: (opacity) => set({ opacity }),
  addAnnotation: (annotation) => set((state) => ({
    annotations: [...state.annotations, annotation]
  })),
  updateAnnotation: (id, updates) => set((state) => ({
    annotations: state.annotations.map(a => a.id === id ? { ...a, ...updates } : a)
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
