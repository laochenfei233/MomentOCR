import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';
import { invoke } from '@tauri-apps/api/core';

export class LocalLlmPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'local-llm',
    name: '本地LLM',
    version: '0.1.0',
    type: 'ocr',
    description: 'Local LLM plugin for OCR via Ollama API',
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

    if (input.type !== 'image') {
      return { success: false, data: '', error: 'Local LLM only accepts image input' };
    }

    try {
      const result = await invoke<string>('ocr_ollama', {
        endpoint: this.config.endpoint || 'http://localhost:11434',
        model: this.config.model || 'llava',
        imagePath: input.data
      });

      return {
        success: true,
        data: result,
        confidence: 0.9,
        language: input.language ?? 'ch',
      };
    } catch (error) {
      return {
        success: false,
        data: '',
        error: `Ollama OCR error: ${error}`,
        language: input.language ?? 'ch',
      };
    }
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      endpoint: {
        type: 'string',
        required: false,
        default: 'http://localhost:11434',
      },
      model: {
        type: 'string',
        required: false,
        default: 'llava',
      },
    };
  }
}
