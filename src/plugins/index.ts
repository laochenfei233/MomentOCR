import { PaddleOcrPlugin } from './paddleOcrPlugin';
import { OpenaiVisionPlugin } from './openaiVisionPlugin';
import { Plugin } from '../types/plugin';

export const builtinPlugins: Plugin[] = [new PaddleOcrPlugin(), new OpenaiVisionPlugin()];

export { PaddleOcrPlugin } from './paddleOcrPlugin';
export { OpenaiVisionPlugin } from './openaiVisionPlugin';
export { PluginManager } from './pluginManager';
