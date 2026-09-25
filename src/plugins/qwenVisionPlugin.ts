import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class QwenVisionPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'qwen-vision',
    name: '通义千问VL',
    version: '0.1.0',
    type: 'ocr',
    description: '阿里云通义千问视觉大模型（OpenAI 兼容协议）',
    author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') return { success: false, data: '', error: '需要图片输入' };
    try {
      const result = await invoke<string>('ocr_custom_vision', {
        baseUrl: this.config.baseUrl || 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        apiKey: this.config.apiKey,
        model: this.config.model || 'qwen-vl-max',
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
      model: { type: 'string', required: false, default: 'qwen-vl-max' },
      baseUrl: { type: 'string', required: false, default: 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
      maxTokens: { type: 'number', required: false, default: 1024 },
    };
  }
}