import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class OpenaiVisionPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'openai-vision',
    name: 'OpenAI GPT-4V',
    version: '0.1.0',
    type: 'ocr',
    description: 'OpenAI GPT-4V Vision plugin for OCR via API',
    author: 'MomentOCR',
  };

  private initialized = false;
  private config: PluginConfig = {};

  async init(config: PluginConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  async process(input: PluginInput): Promise<PluginOutput> {
    if (!this.initialized) {
      return { success: false, data: '', error: 'Plugin not initialized' };
    }

    const apiKey = this.config.apiKey as string;
    if (!apiKey) {
      return { success: false, data: '', error: 'OpenAI API key not configured' };
    }

    if (input.type !== 'image') {
      return { success: false, data: '', error: 'OpenAI Vision only accepts image input' };
    }

    try {
      const result = await invoke<string>('ocr_openai', {
        apiKey: this.config.apiKey,
        imagePath: input.data,
        model: this.config.model || 'gpt-4-vision-preview',
        maxTokens: this.config.maxTokens || 1024
      });

      return {
        success: true,
        data: result,
        confidence: 0.95,
        language: input.language ?? 'ch',
      };
    } catch (error) {
      return {
        success: false,
        data: '',
        error: `OpenAI Vision error: ${error}`,
        language: input.language ?? 'ch',
      };
    }
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      apiKey: {
        type: 'string',
        required: true,
      },
      model: {
        type: 'string',
        required: false,
        default: 'gpt-4-vision-preview',
      },
      maxTokens: {
        type: 'number',
        required: false,
        default: 1024,
      },
    };
  }
}
