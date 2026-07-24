import { builtinPlugins } from '../plugins';
import { useSettingsStore } from '../stores/settingsStore';
import type { Plugin } from '../types/plugin';

function PluginConfigForm({ plugin }: { plugin: Plugin }) {
  const { pluginSettings, setPluginSetting } = useSettingsStore();
  const schema = plugin.getConfigSchema();
  const saved = pluginSettings[plugin.metadata.id] ?? {};

  const fields = Object.entries(schema);
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {fields.map(([key, spec]) => {
        const current = saved[key] ?? spec.default ?? '';
        const isRequired = !!spec.required;

        if (spec.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={!!current}
                onChange={(e) => setPluginSetting(plugin.metadata.id, key, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span>{key}</span>
              {isRequired && <span className="text-xs text-red-500">*</span>}
            </label>
          );
        }

        return (
          <label key={key} className="block text-sm text-gray-700">
            <span className="mb-1 flex items-center gap-1">
              {key}
              {isRequired && <span className="text-xs text-red-500">*</span>}
            </span>
            <input
              type={spec.type === 'number' ? 'number' : 'text'}
              value={String(current)}
              onChange={(e) =>
                setPluginSetting(
                  plugin.metadata.id,
                  key,
                  spec.type === 'number' ? Number(e.target.value) : e.target.value,
                )
              }
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
        );
      })}
    </div>
  );
}

function Settings() {
  const {
    activeOcrPlugin,
    activeTranslationPlugin,
    theme,
    hotkey,
    setActiveOcrPlugin,
    setActiveTranslationPlugin,
    setTheme,
    setHotkey,
  } = useSettingsStore();

  const ocrPlugins = builtinPlugins.filter((p) => p.metadata.type === 'ocr');
  const translationPlugins = builtinPlugins.filter((p) => p.metadata.type === 'translation');

  const selectedOcr = ocrPlugins.find((p) => p.metadata.id === activeOcrPlugin);
  const selectedTranslation = translationPlugins.find((p) => p.metadata.id === activeTranslationPlugin);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 text-left">
      {/* OCR Engine */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-sm font-semibold text-gray-700">OCR 引擎</span>
        </div>
        <div className="p-4 space-y-4">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block">选择 OCR 插件</span>
            <select
              value={activeOcrPlugin}
              onChange={(e) => setActiveOcrPlugin(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {ocrPlugins.map((p) => (
                <option key={p.metadata.id} value={p.metadata.id}>
                  {p.metadata.name}
                </option>
              ))}
            </select>
          </label>
          {selectedOcr && (
            <div className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {selectedOcr.metadata.description}
            </div>
          )}
          {selectedOcr && <PluginConfigForm plugin={selectedOcr} />}
        </div>
      </section>

      {/* Translation Service */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-sm font-semibold text-gray-700">翻译服务</span>
        </div>
        <div className="p-4 space-y-4">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block">选择翻译插件</span>
            <select
              value={activeTranslationPlugin}
              onChange={(e) => setActiveTranslationPlugin(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {translationPlugins.map((p) => (
                <option key={p.metadata.id} value={p.metadata.id}>
                  {p.metadata.name}
                </option>
              ))}
            </select>
          </label>
          {selectedTranslation && (
            <div className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {selectedTranslation.metadata.description}
            </div>
          )}
          {selectedTranslation && <PluginConfigForm plugin={selectedTranslation} />}
        </div>
      </section>

      {/* Theme */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-sm font-semibold text-gray-700">外观</span>
        </div>
        <div className="p-4">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block">主题</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      </section>

      {/* Hotkey */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-sm font-semibold text-gray-700">快捷键</span>
        </div>
        <div className="p-4">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block">截图快捷键</span>
            <input
              type="text"
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="CommandOrControl+Shift+O"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

export default Settings;
