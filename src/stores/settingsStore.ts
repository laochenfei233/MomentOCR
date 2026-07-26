import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

interface SettingsState {
  activeOcrPlugin: string;
  activeTranslationPlugin: string;
  pluginSettings: Record<string, Record<string, unknown>>;
  theme: Theme;

  // 启动时
  startup: {
    autoStart: boolean;
    runAsAdmin: boolean;
    showWindow: boolean;
    showToolbar: boolean;
  };

  // 截图时（基础）
  captureOpt: {
    crosshair: boolean;
    copyImageAndFile: boolean;
    magnifier: boolean;
  };

  // 语言
  language: {
    ocrLang: string;
    translateTarget: string;
  };

  // 识别后功能
  afterRecognize: {
    textOverlay: boolean;
    soundEffect: boolean;
    autoCopy: boolean;
    autoCopyOfficeFormula: boolean;
    popupWindow: boolean;
  };

  // 配置 - 样式
  style: {
    fontSize: string;
    fontStyle: string;
    firstLineIndent: boolean;
    paragraphAlign: string;
  };

  // 配置 - 设置
  config: {
    colorCode: string;
    searchEngine: string;
    wordCountMode: string;
    autoSegment: string;
    toolbarLayout: string;
    verticalSpacing: boolean;
    verticalDirection: string;
  };

  // 配置 - 快捷操作
  quickAction: {
    closeAction: string;
    trayClick: string;
  };

  // 快捷键
  shortcuts: {
    screenshot: string;
    copy: string;
    translate: string;
    snipaste: string;
    longScreenshot: string;
  };

  // 配置 - 代理
  proxy: {
    type: 'none' | 'system' | 'custom';
    server: string;
    port: string;
    username: string;
    password: string;
  };

  // 截图设置
  screenshot: {
    showRightPanel: boolean;
    filenamePrefix: string;
    filenameExt: string;
    autoSave: boolean;
    savePath: string;
    hideMainWindow: boolean;
    autoRecognize: boolean;
    showPreview: boolean;
    multiScreen: boolean;
    saveFormat: string;
  };

  // Actions
  setActiveOcrPlugin: (id: string) => void;
  setActiveTranslationPlugin: (id: string) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setTheme: (theme: Theme) => void;
  setStartup: (patch: Partial<SettingsState['startup']>) => void;
  setCaptureOpt: (patch: Partial<SettingsState['captureOpt']>) => void;
  setLanguage: (patch: Partial<SettingsState['language']>) => void;
  setAfterRecognize: (patch: Partial<SettingsState['afterRecognize']>) => void;
  setStyle: (patch: Partial<SettingsState['style']>) => void;
  setConfig: (patch: Partial<SettingsState['config']>) => void;
  setQuickAction: (patch: Partial<SettingsState['quickAction']>) => void;
  setShortcuts: (patch: Partial<SettingsState['shortcuts']>) => void;
  setProxy: (patch: Partial<SettingsState['proxy']>) => void;
  setScreenshot: (patch: Partial<SettingsState['screenshot']>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      activeOcrPlugin: 'paddle-ocr',
      activeTranslationPlugin: 'google-translate',
      pluginSettings: {},
      theme: 'light',

      afterRecognize: {
        textOverlay: false,
        soundEffect: false,
        autoCopy: false,
        autoCopyOfficeFormula: false,
        popupWindow: true,
      },

      startup: {
        autoStart: false,
        runAsAdmin: false,
        showWindow: true,
        showToolbar: true,
      },

      captureOpt: {
        crosshair: true,
        copyImageAndFile: true,
        magnifier: false,
      },

      language: {
        ocrLang: '自动检测',
        translateTarget: '中文',
      },

      style: {
        fontSize: '小四',
        fontStyle: '新罗马',
        firstLineIndent: true,
        paragraphAlign: '左对齐',
      },

      config: {
        colorCode: 'RGB',
        searchEngine: '百度',
        wordCountMode: 'Word模式',
        autoSegment: '标点符号',
        toolbarLayout: '横向',
        verticalSpacing: false,
        verticalDirection: '从左向右',
      },

      quickAction: {
        closeAction: '最小化到托盘',
        trayClick: '显示窗口',
      },

      shortcuts: {
        screenshot: 'CmdOrCtrl+Shift+S',
        copy: 'CmdOrCtrl+Shift+C',
        translate: 'CmdOrCtrl+Shift+T',
        snipaste: 'CmdOrCtrl+Shift+X',
        longScreenshot: 'CmdOrCtrl+Shift+L',
      },

      proxy: {
        type: 'none',
        server: '',
        port: '',
        username: '',
        password: '',
      },

      screenshot: {
        showRightPanel: true,
        filenamePrefix: '截图',
        filenameExt: 'png',
        autoSave: false,
        savePath: '',
        hideMainWindow: true,
        autoRecognize: true,
        showPreview: true,
        multiScreen: true,
        saveFormat: 'PNG (无损)',
      },

      setActiveOcrPlugin: (id) => set({ activeOcrPlugin: id }),
      setActiveTranslationPlugin: (id) => set({ activeTranslationPlugin: id }),
      setPluginSetting: (pluginId, key, value) =>
        set((state) => ({
          pluginSettings: {
            ...state.pluginSettings,
            [pluginId]: {
              ...state.pluginSettings[pluginId],
              [key]: value,
            },
          },
        })),
      setTheme: (theme) => set({ theme }),
      setStartup: (patch) =>
        set((state) => ({ startup: { ...state.startup, ...patch } })),
      setCaptureOpt: (patch) =>
        set((state) => ({ captureOpt: { ...state.captureOpt, ...patch } })),
      setLanguage: (patch) =>
        set((state) => ({ language: { ...state.language, ...patch } })),
      setAfterRecognize: (patch) =>
        set((state) => ({ afterRecognize: { ...state.afterRecognize, ...patch } })),
      setStyle: (patch) =>
        set((state) => ({ style: { ...state.style, ...patch } })),
      setConfig: (patch) =>
        set((state) => ({ config: { ...state.config, ...patch } })),
      setQuickAction: (patch) =>
        set((state) => ({ quickAction: { ...state.quickAction, ...patch } })),
      setShortcuts: (patch) =>
        set((state) => ({ shortcuts: { ...state.shortcuts, ...patch } })),
      setProxy: (patch) =>
        set((state) => ({ proxy: { ...state.proxy, ...patch } })),
      setScreenshot: (patch) =>
        set((state) => ({ screenshot: { ...state.screenshot, ...patch } })),
    }),
    {
      name: 'moment-ocr-settings',
    }
  )
);
