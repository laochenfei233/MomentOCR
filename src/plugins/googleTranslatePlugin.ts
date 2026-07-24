import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class GoogleTranslatePlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'google-translate',
    name: 'Google翻译',
    version: '0.1.0',
    type: 'translation',
    description: 'Google Translate plugin for text translation',
    author: 'MomentOCR',
  };

  private initialized = false;

  async init(_config: PluginConfig): Promise<void> {
    this.initialized = true;
  }

  async process(input: PluginInput): Promise<PluginOutput> {
    if (!this.initialized) {
      return { success: false, data: '', error: 'Plugin not initialized' };
    }

    if (input.type !== 'text') {
      return { success: false, data: '', error: 'Google Translate only accepts text input' };
    }

    try {
      const result = await invoke<string>('translate_google', {
        text: input.data,
        targetLang: input.language || 'zh-CN'
      });

      return {
        success: true,
        data: result,
        language: input.language ?? 'zh-CN',
      };
    } catch (error) {
      return {
        success: false,
        data: '',
        error: `Google Translate error: ${error}`,
        language: input.language ?? 'zh-CN',
      };
    }
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      apiKey: {
        type: 'string',
        required: false,
      },
    };
  }
}
