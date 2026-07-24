export type PluginType = 'ocr' | 'translation' | 'ai';

export type PluginConfig = Record<string, string | number | boolean>;

export interface PluginInput {
  type: 'image' | 'text';
  data: string | Uint8Array;
  language?: string;
}

export interface PluginOutput {
  success: boolean;
  data: string;
  confidence?: number;
  language?: string;
  error?: string;
}

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description: string;
  author: string;
}

export interface Plugin {
  metadata: PluginMetadata;

  init(config: PluginConfig): Promise<void>;

  process(input: PluginInput): Promise<PluginOutput>;

  getConfigSchema(): Record<string, { type: string; required?: boolean; default?: unknown }>;
}
