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
    <div className="space-y-2 mt-2">
      {fields.map(([key, spec]) => {
        const current = saved[key] ?? spec.default ?? '';
        const isRequired = !!spec.required;

        if (spec.type === 'boolean') {
          return (
            <label key={key} className="flex items-center justify-between py-1">
              <span className="text-xs text-gray-600">{key}</span>
              <input
                type="checkbox"
                checked={!!current}
                onChange={(e) => setPluginSetting(plugin.metadata.id, key, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
            </label>
          );
        }

        return (
          <div key={key}>
            <label className="flex items-center gap-1 mb-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{key}</span>
              {isRequired && <span className="text-red-400">*</span>}
            </label>
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
              className="w-full rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1.5 text-xs
                focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
                placeholder:text-gray-300 transition-colors"
              placeholder={`输入${key}`}
            />
          </div>
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
    <div className="w-full space-y-3 animate-slide-up">
      {/* OCR Engine Section */}
      <div className="rounded-xl bg-white/80 border border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700">OCR 引擎</span>
        </div>
        <select
          value={activeOcrPlugin}
          onChange={(e) => setActiveOcrPlugin(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-1.5 text-xs
            focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
        >
          {ocrPlugins.map((p) => (
            <option key={p.metadata.id} value={p.metadata.id}>
              {p.metadata.name}
            </option>
          ))}
        </select>
        {selectedOcr && (
          <>
            <p className="text-[10px] text-gray-400 mt-1.5">{selectedOcr.metadata.description}</p>
            <PluginConfigForm plugin={selectedOcr} />
          </>
        )}
      </div>

      {/* Translation Service Section */}
      <div className="rounded-xl bg-white/80 border border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700">翻译服务</span>
        </div>
        <select
          value={activeTranslationPlugin}
          onChange={(e) => setActiveTranslationPlugin(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-1.5 text-xs
            focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
        >
          {translationPlugins.map((p) => (
            <option key={p.metadata.id} value={p.metadata.id}>
              {p.metadata.name}
            </option>
          ))}
        </select>
        {selectedTranslation && (
          <>
            <p className="text-[10px] text-gray-400 mt-1.5">{selectedTranslation.metadata.description}</p>
            <PluginConfigForm plugin={selectedTranslation} />
          </>
        )}
      </div>

      {/* Appearance Section */}
      <div className="rounded-xl bg-white/80 border border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700">外观</span>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg bg-gray-100/80">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`btn-fluid flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                theme === t
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
      </div>

      {/* Hotkey Section */}
      <div className="rounded-xl bg-white/80 border border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700">快捷键</span>
        </div>
        <input
          type="text"
          value={hotkey}
          onChange={(e) => setHotkey(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-1.5 text-xs
            focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
          placeholder="Ctrl+Shift+Q"
        />
      </div>
    </div>
  );
}

export default Settings;
