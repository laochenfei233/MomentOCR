import { PaddleOcrPlugin } from './paddleOcrPlugin';
import { OpenaiVisionPlugin } from './openaiVisionPlugin';
import { LocalLlmPlugin } from './localLlmPlugin';
import { Plugin } from '../types/plugin';

export const builtinPlugins: Plugin[] = [new PaddleOcrPlugin(), new OpenaiVisionPlugin(), new LocalLlmPlugin()];

export { PaddleOcrPlugin } from './paddleOcrPlugin';
export { OpenaiVisionPlugin } from './openaiVisionPlugin';
export { LocalLlmPlugin } from './localLlmPlugin';
export { PluginManager } from './pluginManager';
