import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class DoubaoVisionPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'doubao-vision',
    name: '豆包视觉',
    version: '0.1.0',
    type: 'ocr',
    description: '字节跳动豆包视觉大模型（火山引擎 OpenAI 兼容协议）',
    author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') return { success: false, data: '', error: '需要图片输入' };
    try {
      const result = await invoke<string>('ocr_custom_vision', {
        baseUrl: this.config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: this.config.apiKey,
        model: this.config.model || 'doubao-vision-pro-32k',
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
      model: { type: 'string', required: false, default: 'doubao-vision-pro-32k' },
      baseUrl: { type: 'string', required: false, default: 'https://ark.cn-beijing.volces.com/api/v3' },
      maxTokens: { type: 'number', required: false, default: 1024 },
    };
  }
}