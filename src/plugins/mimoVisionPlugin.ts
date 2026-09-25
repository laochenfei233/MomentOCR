import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class MimoVisionPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'mimo-vision',
    name: 'MiMo 视觉',
    version: '0.1.0',
    type: 'ocr',
    description: '小米 MiMo 大模型视觉识别（OpenAI 兼容协议）',
    author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') return { success: false, data: '', error: '需要图片输入' };
    try {
      const result = await invoke<string>('ocr_custom_vision', {
        baseUrl: this.config.baseUrl || 'https://api.xiaomimimo.com/v1',
        apiKey: this.config.apiKey,
        model: this.config.model || '',
        imagePath: input.data,
        maxTokens: Number(this.config.maxTokens) || 1024,
      });
      return { success: true, data: result, confidence: 0.9, language: input.language ?? 'ch' };
    } catch (e) {
      return { success: false, data: '', error: String(e), language: input.language ?? 'ch' };
    }
  }
  getConfigSchema() {
    return {
      apiKey: { type: 'string', required: true },
      model: { type: 'string', required: false },
      baseUrl: { type: 'string', required: false, default: 'https://api.xiaomimimo.com/v1' },
      maxTokens: { type: 'number', required: false, default: 1024 },
    };
  }
}
