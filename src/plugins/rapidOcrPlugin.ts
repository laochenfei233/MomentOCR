import { Plugin, PluginConfig, PluginInput, PluginOutput, PluginMetadata } from '../types/plugin';

export class RapidOcrPlugin implements Plugin {
  metadata: PluginMetadata = {
    id: 'rapid-ocr',
    name: 'RapidOCR',
    version: '0.1.0',
    type: 'ocr',
    description: 'RapidOCR 本地识别引擎（ONNX Runtime，轻量快速，无需 GPU）',
    author: 'MomentOCR',
  };

  private initialized = false;

  async init(_config: PluginConfig): Promise<void> {
    this.initialized = true;
  }

  async process(input: PluginInput): Promise<PluginOutput> {
    if (!this.initialized) {
      return { success: false, data: '', error: 'Plugin not initialized' };
    }

    if (input.type !== 'image') {
      return { success: false, data: '', error: 'RapidOCR only accepts image input' };
    }

    return {
      success: false,
      data: '',
      error: 'RapidOCR: please install RapidOCR first in Settings → 接口 → OCR 引擎.',
      language: input.language ?? 'ch',
    };
  }

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }> {
    return {
      useGpu: {
        type: 'boolean',
        required: false,
        default: false,
      },
    };
  }
}
