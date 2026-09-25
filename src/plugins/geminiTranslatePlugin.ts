import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class GeminiTranslatePlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'gemini-translate', name: 'Gemini 翻译', version: '0.1.0', type: 'translation',
    description: 'Google Gemini 大模型翻译', author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'text') return { success: false, data: '', error: '需要文本输入' };
    try {
      const result = await invoke<string>('translate_custom', {
        baseUrl: this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: this.config.apiKey, model: this.config.model || 'gemini-1.5-flash',
        text: input.data, targetLang: input.language || 'zh',
      });
      return { success: true, data: result, language: input.language ?? 'zh-CN' };
    } catch (e) { return { success: false, data: '', error: String(e) }; }
  }
  getConfigSchema() { return { apiKey: { type: 'string', required: true }, model: { type: 'string', default: 'gemini-1.5-flash' }, baseUrl: { type: 'string', default: 'https://generativelanguage.googleapis.com/v1beta/openai' } }; }
}