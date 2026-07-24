import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';

export class AiTranslatePlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'ai-translate',
    name: 'AI大模型翻译',
    version: '0.1.0',
    type: 'translation',
    description: 'AI LLM-based translation plugin for high-quality text translation',
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

    if (input.type !== 'text') {
      return { success: false, data: '', error: 'AI Translate only accepts text input' };
    }

    // TODO: call AI translation provider API
    return {
      success: true,
      data: `[AI大模型翻译占位] ${input.data}`,
      language: input.language ?? 'zh-CN',
    };
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      provider: {
        type: 'string',
        required: true,
        default: 'openai',
      },
      apiKey: {
        type: 'string',
        required: true,
      },
      model: {
        type: 'string',
        required: false,
        default: 'gpt-4o',
      },
    };
  }
}
