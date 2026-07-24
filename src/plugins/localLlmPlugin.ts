import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';

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

    const endpoint = (this.config.endpoint as string) || 'http://localhost:11434';
    const model = (this.config.model as string) || 'llava';

    // TODO: call Ollama API at `${endpoint}/api/generate` with model and image
    return {
      success: true,
      data: `[Local LLM placeholder] OCR result via ${model} at ${endpoint} — will be populated via Ollama API call`,
      confidence: 0.0,
      language: input.language ?? 'ch',
    };
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
