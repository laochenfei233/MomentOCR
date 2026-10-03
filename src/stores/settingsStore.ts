import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SHORTCUTS } from '../utils/shortcut';

interface SettingsState {
  activeOcrPlugin: string;
  activeTranslationPlugin: string;
  pluginSettings: Record<string, Record<string, unknown>>;

  // 启动时
  startup: {
    autoStart: boolean;
  };

  // 语言
  language: {
    translateTarget: string;
    /** 翻译结果显示位置：'下方' | '右侧' */
    translateLayout: string;
  };

  // 识别后功能
  afterRecognize: {
    autoCopy: boolean;
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
    wordCountMode: string;
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
  };

  // 截图设置
  screenshot: {
    hideMainWindow: boolean;
    autoRecognize: boolean;
  };

  /** 原文/翻译分割线位置：翻译区域所占百分比（15~80） */
  translateSplit: number;

  // Actions
  setActiveOcrPlugin: (id: string) => void;
  setActiveTranslationPlugin: (id: string) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setStartup: (patch: Partial<SettingsState['startup']>) => void;
  setLanguage: (patch: Partial<SettingsState['language']>) => void;
  setAfterRecognize: (patch: Partial<SettingsState['afterRecognize']>) => void;
  setStyle: (patch: Partial<SettingsState['style']>) => void;
  setConfig: (patch: Partial<SettingsState['config']>) => void;
  setQuickAction: (patch: Partial<SettingsState['quickAction']>) => void;
  setShortcuts: (patch: Partial<SettingsState['shortcuts']>) => void;
  setScreenshot: (patch: Partial<SettingsState['screenshot']>) => void;
  setTranslateSplit: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      activeOcrPlugin: 'rapid-ocr',
      activeTranslationPlugin: 'google-translate',
      pluginSettings: {},
      translateSplit: 42,

      afterRecognize: {
        autoCopy: false,
      },

      startup: {
        autoStart: false,
      },

      language: {
        translateTarget: '中文',
        translateLayout: '下方',
      },

      style: {
        fontSize: '小四',
        fontStyle: '新罗马',
        firstLineIndent: true,
        paragraphAlign: '左对齐',
      },

      config: {
        wordCountMode: 'Word模式',
      },

      quickAction: {
        closeAction: '最小化到托盘',
        trayClick: '显示窗口',
      },

      shortcuts: { ...DEFAULT_SHORTCUTS },

      screenshot: {
        hideMainWindow: true,
        autoRecognize: true,
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
      setStartup: (patch) =>
        set((state) => ({ startup: { ...state.startup, ...patch } })),
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
      setScreenshot: (patch) =>
        set((state) => ({ screenshot: { ...state.screenshot, ...patch } })),
      setTranslateSplit: (v) => set({ translateSplit: Math.min(80, Math.max(15, v)) }),
    }),
    {
      name: 'moment-ocr-settings',
    }
  )
);
