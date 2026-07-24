import { useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { builtinPlugins } from '../plugins';

type SettingsTab = 'general' | 'advanced' | 'config' | 'screenshot' | 'extra' | 'hotkey' | 'api' | 'update' | 'about';

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: '常规' },
  { key: 'advanced', label: '高级' },
  { key: 'config', label: '配置' },
  { key: 'screenshot', label: '截图' },
  { key: 'extra', label: '附加' },
  { key: 'hotkey', label: '热键' },
  { key: 'api', label: '接口' },
  { key: 'update', label: '更新' },
  { key: 'about', label: '关于' },
];

function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const {
    activeOcrPlugin,
    activeTranslationPlugin,
    hotkey,
    setActiveOcrPlugin,
    setActiveTranslationPlugin,
    setHotkey,
  } = useSettingsStore();

  const ocrPlugins = builtinPlugins.filter((p) => p.metadata.type === 'ocr');
  const translationPlugins = builtinPlugins.filter((p) => p.metadata.type === 'translation');

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <div className="w-24 border-r border-gray-200 bg-gray-50">
        <nav className="py-2">
          {SETTINGS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                activeTab === key
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 常规设置 */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            <SettingsSection title="启动时">
              <CheckboxItem label="开机时自动启动" defaultChecked={false} />
              <CheckboxItem label="以管理员身份运行" defaultChecked={false} />
              <CheckboxItem label="启动时显示窗口" defaultChecked={true} />
              <CheckboxItem label="启动时显示工具栏" defaultChecked={true} />
            </SettingsSection>

            <SettingsSection title="截图时">
              <CheckboxItem label="截图时启用十字线" defaultChecked={true} />
              <CheckboxItem label="复制图片和文件" defaultChecked={true} />
              <CheckboxItem label="截图时启用放大镜" defaultChecked={false} />
            </SettingsSection>

            <SettingsSection title="识别时">
              <CheckboxItem label="识别时启用十字线" defaultChecked={false} />
              <CheckboxItem label="识别时启用放大镜" defaultChecked={true} />
            </SettingsSection>

            <SettingsSection title="识别后">
              <CheckboxItem label="识别后文本叠加" defaultChecked={false} />
              <CheckboxItem label="识别后播放音效" defaultChecked={false} />
            </SettingsSection>
          </div>
        )}

        {/* 热键设置 */}
        {activeTab === 'hotkey' && (
          <div className="space-y-6">
            <SettingsSection title="截图热键">
              <div className="flex items-center gap-3">
                <label className="ios-text-body text-gray-700">截图快捷键:</label>
                <input
                  type="text"
                  value={hotkey}
                  onChange={(e) => setHotkey(e.target.value)}
                  className="ios-input w-48"
                  placeholder="Ctrl+Shift+Q"
                />
              </div>
            </SettingsSection>
          </div>
        )}

        {/* 接口设置 */}
        {activeTab === 'api' && (
          <div className="space-y-6">
            <SettingsSection title="OCR 引擎">
              <div className="flex items-center gap-3">
                <label className="ios-text-body text-gray-700">选择引擎:</label>
                <select
                  value={activeOcrPlugin}
                  onChange={(e) => setActiveOcrPlugin(e.target.value)}
                  className="ios-select"
                >
                  {ocrPlugins.map((p) => (
                    <option key={p.metadata.id} value={p.metadata.id}>
                      {p.metadata.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="ios-text-caption text-gray-500 mt-2">
                {ocrPlugins.find((p) => p.metadata.id === activeOcrPlugin)?.metadata.description}
              </p>
            </SettingsSection>

            <SettingsSection title="翻译服务">
              <div className="flex items-center gap-3">
                <label className="ios-text-body text-gray-700">选择翻译:</label>
                <select
                  value={activeTranslationPlugin}
                  onChange={(e) => setActiveTranslationPlugin(e.target.value)}
                  className="ios-select"
                >
                  {translationPlugins.map((p) => (
                    <option key={p.metadata.id} value={p.metadata.id}>
                      {p.metadata.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="ios-text-caption text-gray-500 mt-2">
                {translationPlugins.find((p) => p.metadata.id === activeTranslationPlugin)?.metadata.description}
              </p>
            </SettingsSection>
          </div>
        )}

        {/* 关于 */}
        {activeTab === 'about' && (
          <div className="space-y-6">
            <SettingsSection title="关于须臾OCR">
              <div className="space-y-2">
                <p className="ios-text-body text-gray-700">版本: 0.1.0</p>
                <p className="ios-text-body text-gray-700">构建: 2024.07.24</p>
                <p className="ios-text-caption text-gray-500 mt-4">
                  须臾OCR - 智能OCR软件
                </p>
                <p className="ios-text-caption text-gray-500">
                  支持本地OCR引擎、AI大模型、截图识别
                </p>
              </div>
            </SettingsSection>
          </div>
        )}

        {/* 其他标签页占位 */}
        {['advanced', 'config', 'screenshot', 'extra', 'update'].includes(activeTab) && (
          <div className="flex items-center justify-center h-64">
            <p className="ios-text-body text-gray-400">设置开发中...</p>
          </div>
        )}
      </div>
    </div>
  );
}

// 设置区块组件
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="ios-text-headline text-gray-900 mb-3">{title}</h3>
      <div className="ios-card">
        <div className="space-y-3">
          {children}
        </div>
      </div>
    </div>
  );
}

// 复选框项组件
function CheckboxItem({ label, defaultChecked = false }: { label: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="ios-checkbox"
      />
      <span className="ios-text-body text-gray-700">{label}</span>
    </label>
  );
}

export default Settings;
