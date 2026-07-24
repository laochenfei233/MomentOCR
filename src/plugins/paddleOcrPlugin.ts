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

    // PaddleOCR requires local model files to be downloaded first.
    // Run the setup script or manually place models in the configured modelPath.
    return {
      success: false,
      data: '',
      error: 'PaddleOCR: please download the model first. Run: python scripts/setup_paddleocr.py or place models in the configured modelPath.',
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
