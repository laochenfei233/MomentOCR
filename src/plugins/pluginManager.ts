import { Plugin, PluginInput, PluginOutput, PluginType } from '../types/plugin';

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private activePlugins: Map<PluginType, Plugin> = new Map();

  async register(plugin: Plugin, config: Record<string, unknown>): Promise<void> {
    await plugin.init(config);
    this.plugins.set(plugin.metadata.id, plugin);
  }

  unregister(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    if (this.activePlugins.get(plugin.metadata.type)?.metadata.id === pluginId) {
      this.activePlugins.delete(plugin.metadata.type);
    }

    return this.plugins.delete(pluginId);
  }

  setActivePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    this.activePlugins.set(plugin.metadata.type, plugin);
    return true;
  }

  getActivePlugin(type: PluginType): Plugin | undefined {
    return this.activePlugins.get(type);
  }

  async process(input: PluginInput, type: PluginType): Promise<PluginOutput> {
    const plugin = this.activePlugins.get(type);
    if (!plugin) {
      return {
        success: false,
        data: '',
        error: `No active plugin for type: ${type}`,
      };
    }

    return plugin.process(input);
  }

  getPluginsByType(type: PluginType): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.metadata.type === type);
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}
