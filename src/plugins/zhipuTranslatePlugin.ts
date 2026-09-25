import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class ZhipuTranslatePlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'zhipu-translate', name: '智谱清言翻译', version: '0.1.0', type: 'translation',
    description: '智谱AI GLM 大模型翻译', author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'text') return { success: false, data: '', error: '需要文本输入' };
    try {
      const result = await invoke<string>('translate_custom', {
        baseUrl: this.config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: this.config.apiKey, model: this.config.model || 'glm-4-flash',
        text: input.data, targetLang: input.language || 'zh',
      });
      return { success: true, data: result, language: input.language ?? 'zh-CN' };
    } catch (e) { return { success: false, data: '', error: String(e) }; }
  }
  getConfigSchema() { return { apiKey: { type: 'string', required: true }, model: { type: 'string', default: 'glm-4-flash' }, baseUrl: { type: 'string', default: 'https://open.bigmodel.cn/api/paas/v4' } }; }
}