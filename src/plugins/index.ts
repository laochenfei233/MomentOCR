import { invoke } from '@tauri-apps/api/core';

export type PluginType = 'ocr' | 'translation';

/** 一个内置引擎的静态信息 + 调它时需要兜底的默认值。 */
export interface PluginInfo {
  id: string;
  name: string;
  type: PluginType;
  description: string;
  /** 用户没填时用的接入地址（分派时兜底） */
  defaultBaseUrl?: string;
  /** 用户没选时用的模型 */
  defaultModel?: string;
}

// 顺序就是设置页下拉框里的顺序
export const builtinPlugins: PluginInfo[] = [
  { id: 'paddle-ocr', name: 'PaddleOCR', type: 'ocr', description: 'PaddleOCR plugin using Rust FFI bridge for text recognition' },
  { id: 'rapid-ocr', name: 'RapidOCR', type: 'ocr', description: 'RapidOCR 本地识别引擎（ONNX Runtime，轻量快速，无需 GPU）' },
  { id: 'openai-vision', name: 'OpenAI GPT', type: 'ocr', description: 'OpenAI GPT Vision plugin for OCR via API', defaultModel: 'gpt-4o' },
  { id: 'qwen-vision', name: '通义千问VL', type: 'ocr', description: '阿里云通义千问视觉大模型（OpenAI 兼容协议）' },
  { id: 'zhipu-vision', name: '智谱GLM', type: 'ocr', description: '智谱AI GLM 视觉大模型（OpenAI 兼容协议）' },
  { id: 'doubao-vision', name: '豆包视觉', type: 'ocr', description: '字节跳动豆包视觉大模型（火山引擎 OpenAI 兼容协议）' },
  { id: 'gemini-vision', name: 'Gemini', type: 'ocr', description: 'Google Gemini 视觉模型（OpenAI 兼容协议）' },
  { id: 'mimo-vision', name: 'MiMo 视觉', type: 'ocr', description: '小米 MiMo 大模型视觉识别（OpenAI 兼容协议）' },
  { id: 'claude-vision', name: 'Claude 视觉', type: 'ocr', description: 'Anthropic Claude 视觉识别（Messages API）', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5' },
  { id: 'local-llm', name: '本地LLM', type: 'ocr', description: 'Local LLM plugin for OCR via Ollama API', defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llava' },

  { id: 'google-translate', name: 'Google翻译', type: 'translation', description: 'Google Translate plugin for text translation' },
  { id: 'openai-translate', name: 'OpenAI 翻译', type: 'translation', description: 'OpenAI GPT 大模型翻译', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { id: 'qwen-translate', name: '通义千问翻译', type: 'translation', description: '阿里云通义千问大模型翻译', defaultBaseUrl: 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-turbo' },
  { id: 'zhipu-translate', name: '智谱清言翻译', type: 'translation', description: '智谱AI GLM 大模型翻译', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { id: 'doubao-translate', name: '豆包翻译', type: 'translation', description: '字节跳动豆包大模型翻译（火山引擎）', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-32k' },
  { id: 'gemini-translate', name: 'Gemini 翻译', type: 'translation', description: 'Google Gemini 大模型翻译', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-1.5-flash' },
  { id: 'mimo-translate', name: 'MiMo 翻译', type: 'translation', description: '小米 MiMo 大模型翻译（OpenAI 兼容协议）', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: '' },
  { id: 'deepseek-translate', name: 'DeepSeek 翻译', type: 'translation', description: 'DeepSeek 大模型翻译（OpenAI 兼容协议）', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'claude-translate', name: 'Claude 翻译', type: 'translation', description: 'Anthropic Claude 大模型翻译（Messages API）', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5' },
];

export const findPlugin = (id: string) => builtinPlugins.find((p) => p.id === id);

/** 走 OpenAI 兼容 /chat/completions 的视觉模型，用一个命令 */
const CUSTOM_VISION = ['qwen-vision', 'zhipu-vision', 'doubao-vision', 'gemini-vision', 'mimo-vision'];

/**
 * 按当前 OCR 引擎调对应命令，返回识别文本；配置缺失时返回以「错误」开头的提示。
 * 五个 OpenAI 兼容的视觉模型共用一个 Rust 命令，差异只在 baseUrl/model。
 */
export async function runOcr(
  engineId: string,
  imagePath: string,
  pluginSettings: Record<string, Record<string, unknown>>,
): Promise<string> {
  const plugin = findPlugin(engineId);
  if (!plugin) return `未知引擎: ${engineId}`;

  const cfg = pluginSettings[engineId] || {};
  const apiKey = (cfg.apiKey as string) || '';
  const model = (cfg.model as string) || plugin.defaultModel || '';
  const baseUrl = (cfg.baseUrl as string) || plugin.defaultBaseUrl || '';
  const maxTokens = Number(cfg.maxTokens) || 1024;

  if (engineId === 'paddle-ocr') return invoke<string>('ocr_paddleocr', { imagePath });
  if (engineId === 'rapid-ocr') return invoke<string>('ocr_rapidocr', { imagePath });
  if (engineId === 'local-llm') {
    return invoke<string>('ocr_ollama', {
      endpoint: (cfg.endpoint as string) || plugin.defaultBaseUrl,
      model,
      imagePath,
    });
  }
  if (engineId === 'openai-vision') {
    return apiKey
      ? invoke<string>('ocr_openai', { apiKey, model, imagePath, maxTokens })
      : '错误：未配置OpenAI API Key';
  }
  if (engineId === 'claude-vision') {
    return apiKey
      ? invoke<string>('ocr_claude', { baseUrl, apiKey, model, imagePath, maxTokens })
      : '错误：未配置 Claude API Key';
  }
  if (CUSTOM_VISION.includes(engineId)) {
    return apiKey
      ? invoke<string>('ocr_custom_vision', { baseUrl, apiKey, model, imagePath, maxTokens })
      : `错误：未配置${engineId} API Key`;
  }
  return `未知引擎: ${engineId}`;
}
