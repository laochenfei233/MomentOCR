import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface SettingsState {
  activeOcrPlugin: string;
  activeTranslationPlugin: string;
  pluginSettings: Record<string, Record<string, unknown>>;
  theme: Theme;
  hotkey: string;

  setActiveOcrPlugin: (id: string) => void;
  setActiveTranslationPlugin: (id: string) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setTheme: (theme: Theme) => void;
  setHotkey: (hotkey: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  activeOcrPlugin: 'paddle-ocr',
  activeTranslationPlugin: 'google-translate',
  pluginSettings: {},
  theme: 'light',
  hotkey: 'CommandOrControl+Shift+O',

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
  setHotkey: (hotkey) => set({ hotkey }),
}));
