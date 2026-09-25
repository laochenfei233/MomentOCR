import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class DoubaoTranslatePlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'doubao-translate', name: '豆包翻译', version: '0.1.0', type: 'translation',
    description: '字节跳动豆包大模型翻译（火山引擎）', author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'text') return { success: false, data: '', error: '需要文本输入' };
    try {
      const result = await invoke<string>('translate_custom', {
        baseUrl: this.config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: this.config.apiKey, model: this.config.model || 'doubao-pro-32k',
        text: input.data, targetLang: input.language || 'zh',
      });
      return { success: true, data: result, language: input.language ?? 'zh-CN' };
    } catch (e) { return { success: false, data: '', error: String(e) }; }
  }
  getConfigSchema() { return { apiKey: { type: 'string', required: true }, model: { type: 'string', default: 'doubao-pro-32k' }, baseUrl: { type: 'string', default: 'https://ark.cn-beijing.volces.com/api/v3' } }; }
}