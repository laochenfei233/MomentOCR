import { PaddleOcrPlugin } from './paddleOcrPlugin';
import { Plugin } from '../types/plugin';

export const builtinPlugins: Plugin[] = [new PaddleOcrPlugin()];

export { PaddleOcrPlugin } from './paddleOcrPlugin';
export { PluginManager } from './pluginManager';
