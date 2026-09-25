import { PaddleOcrPlugin } from './paddleOcrPlugin';
import { RapidOcrPlugin } from './rapidOcrPlugin';
import { OpenaiVisionPlugin } from './openaiVisionPlugin';
import { LocalLlmPlugin } from './localLlmPlugin';
import { QwenVisionPlugin } from './qwenVisionPlugin';
import { ZhipuVisionPlugin } from './zhipuVisionPlugin';
import { DoubaoVisionPlugin } from './doubaoVisionPlugin';
import { GeminiVisionPlugin } from './geminiVisionPlugin';
import { MimoVisionPlugin } from './mimoVisionPlugin';
import { ClaudeVisionPlugin } from './claudeVisionPlugin';
import { GoogleTranslatePlugin } from './googleTranslatePlugin';
import { OpenaiTranslatePlugin } from './openaiTranslatePlugin';
import { QwenTranslatePlugin } from './qwenTranslatePlugin';
import { ZhipuTranslatePlugin } from './zhipuTranslatePlugin';
import { DoubaoTranslatePlugin } from './doubaoTranslatePlugin';
import { GeminiTranslatePlugin } from './geminiTranslatePlugin';
import { MimoTranslatePlugin } from './mimoTranslatePlugin';
import { DeepseekTranslatePlugin } from './deepseekTranslatePlugin';
import { ClaudeTranslatePlugin } from './claudeTranslatePlugin';
import { Plugin } from '../types/plugin';

export const builtinPlugins: Plugin[] = [
  new PaddleOcrPlugin(),
  new RapidOcrPlugin(),
  new OpenaiVisionPlugin(),
  new QwenVisionPlugin(),
  new ZhipuVisionPlugin(),
  new DoubaoVisionPlugin(),
  new GeminiVisionPlugin(),
  new MimoVisionPlugin(),
  new ClaudeVisionPlugin(),
  new LocalLlmPlugin(),
  new GoogleTranslatePlugin(),
  new OpenaiTranslatePlugin(),
  new QwenTranslatePlugin(),
  new ZhipuTranslatePlugin(),
  new DoubaoTranslatePlugin(),
  new GeminiTranslatePlugin(),
  new MimoTranslatePlugin(),
  new DeepseekTranslatePlugin(),
  new ClaudeTranslatePlugin(),
];

export { PaddleOcrPlugin } from './paddleOcrPlugin';
export { RapidOcrPlugin } from './rapidOcrPlugin';
export { OpenaiVisionPlugin } from './openaiVisionPlugin';
export { LocalLlmPlugin } from './localLlmPlugin';
export { QwenVisionPlugin } from './qwenVisionPlugin';
export { ZhipuVisionPlugin } from './zhipuVisionPlugin';
export { DoubaoVisionPlugin } from './doubaoVisionPlugin';
export { GeminiVisionPlugin } from './geminiVisionPlugin';
export { MimoVisionPlugin } from './mimoVisionPlugin';
export { ClaudeVisionPlugin } from './claudeVisionPlugin';
export { GoogleTranslatePlugin } from './googleTranslatePlugin';
export { OpenaiTranslatePlugin } from './openaiTranslatePlugin';
export { QwenTranslatePlugin } from './qwenTranslatePlugin';
export { ZhipuTranslatePlugin } from './zhipuTranslatePlugin';
export { DoubaoTranslatePlugin } from './doubaoTranslatePlugin';
export { GeminiTranslatePlugin } from './geminiTranslatePlugin';
export { MimoTranslatePlugin } from './mimoTranslatePlugin';
export { DeepseekTranslatePlugin } from './deepseekTranslatePlugin';
export { ClaudeTranslatePlugin } from './claudeTranslatePlugin';
export { PluginManager } from './pluginManager';
