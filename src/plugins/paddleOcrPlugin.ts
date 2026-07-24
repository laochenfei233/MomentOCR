import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';

export class PaddleOcrPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'paddle-ocr',
    name: 'PaddleOCR',
    version: '0.1.0',
    type: 'ocr',
    description: 'PaddleOCR plugin using Rust FFI bridge for text recognition',
    author: 'MomentOCR',
  };

  private initialized = false;

  async init(_config: PluginConfig): Promise<void> {
    // TODO: initialize PaddleOCR engine via Rust FFI
    this.initialized = true;
  }

  async process(input: PluginInput): Promise<PluginOutput> {
    if (!this.initialized) {
      return { success: false, data: '', error: 'Plugin not initialized' };
    }

    if (input.type !== 'image') {
      return { success: false, data: '', error: 'PaddleOCR only accepts image input' };
    }

    // TODO: call Rust FFI bridge to PaddleOCR engine
    return {
      success: true,
      data: '[PaddleOCR placeholder] OCR result will be populated via Rust FFI',
      confidence: 0.95,
      language: input.language ?? 'ch',
    };
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      modelPath: {
        type: 'string',
        required: false,
        default: './models/ppocr',
      },
      useGpu: {
        type: 'boolean',
        required: false,
        default: false,
      },
    };
  }
}
