import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class ClaudeVisionPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'claude-vision',
    name: 'Claude 视觉',
    version: '0.1.0',
    type: 'ocr',
    description: 'Anthropic Claude 视觉识别（Messages API）',
    author: 'MomentOCR',
  };
  private config: PluginConfig = {};
  async init(config: PluginConfig) { this.config = config; }
  async process(input: PluginInput): Promise<PluginOutput> {
    if (input.type !== 'image') return { success: false, data: '', error: '需要图片输入' };
    try {
      const result = await invoke<string>('ocr_claude', {
        baseUrl: this.config.baseUrl || 'https://api.anthropic.com/v1',
        apiKey: this.config.apiKey,
        model: this.config.model || 'claude-sonnet-4-5',
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
      model: { type: 'string', required: false, default: 'claude-sonnet-4-5' },
      baseUrl: { type: 'string', required: false, default: 'https://api.anthropic.com/v1' },
      maxTokens: { type: 'number', required: false, default: 1024 },
    };
  }
}
