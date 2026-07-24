import { PaddleOcrPlugin } from './paddleOcrPlugin';
import { OpenaiVisionPlugin } from './openaiVisionPlugin';
import { LocalLlmPlugin } from './localLlmPlugin';
import { GoogleTranslatePlugin } from './googleTranslatePlugin';
import { AiTranslatePlugin } from './aiTranslatePlugin';
import { Plugin } from '../types/plugin';

export const builtinPlugins: Plugin[] = [
  new PaddleOcrPlugin(),
  new OpenaiVisionPlugin(),
  new LocalLlmPlugin(),
  new GoogleTranslatePlugin(),
  new AiTranslatePlugin(),
];

export { PaddleOcrPlugin } from './paddleOcrPlugin';
export { OpenaiVisionPlugin } from './openaiVisionPlugin';
export { LocalLlmPlugin } from './localLlmPlugin';
export { GoogleTranslatePlugin } from './googleTranslatePlugin';
export { AiTranslatePlugin } from './aiTranslatePlugin';
export { PluginManager } from './pluginManager';
