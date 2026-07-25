import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  const [paddleocrInstalled, setPaddleocrInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
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

  const checkPaddleOcr = async () => {
    try {
      const installed = await invoke<boolean>('check_paddleocr');
      setPaddleocrInstalled(installed);
    } catch {
      setPaddleocrInstalled(false);
    }
  };

  const handleInstallPaddleOcr = async () => {
    setInstalling(true);
    setInstallMsg(null);
    try {
      const msg = await invoke<string>('install_paddleocr');
      setInstallMsg(msg);
      setPaddleocrInstalled(true);
    } catch (err) {
      setInstallMsg(`安装失败: ${err}`);
      setPaddleocrInstalled(false);
    } finally {
      setInstalling(false);
    }
  };

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === 'api' && paddleocrInstalled === null) {
      checkPaddleOcr();
    }
  };

  return (
    <div className="flex h-full">
      {/* 左侧导航 - iOS 18 风格 */}
      <div style={{ width: 88, borderRight: '0.5px solid #E5E5EA', background: '#F2F2F7' }}>
        <nav style={{ padding: '8px 0' }}>
          {SETTINGS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              style={{
                width: '100%',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: 13,
                background: activeTab === key ? 'rgba(0,122,255,0.12)' : 'transparent',
                color: activeTab === key ? '#007AFF' : '#1c1c1e',
                fontWeight: activeTab === key ? 600 : 400,
                border: 'none',
                cursor: 'pointer',
                borderLeft: activeTab === key ? '2px solid #007AFF' : '2px solid transparent',
                transition: 'all 100ms ease-out',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#F2F2F7' }}>
        {activeTab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="启动时">
              <CheckboxItem label="开机时自动启动" />
              <CheckboxItem label="以管理员身份运行" />
              <CheckboxItem label="启动时显示窗口" checked />
              <CheckboxItem label="启动时显示工具栏" checked />
            </SettingsCard>
            <SettingsCard title="截图时">
              <CheckboxItem label="截图时启用十字线" checked />
              <CheckboxItem label="复制图片和文件" checked />
              <CheckboxItem label="截图时启用放大镜" />
            </SettingsCard>
            <SettingsCard title="识别后">
              <CheckboxItem label="识别后文本叠加" />
              <CheckboxItem label="识别后播放音效" />
            </SettingsCard>
          </div>
        )}

        {activeTab === 'hotkey' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="截图热键">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>截图快捷键:</label>
                <input
                  type="text"
                  value={hotkey}
                  onChange={(e) => setHotkey(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 8, background: '#F2F2F7', outline: 'none', width: 180 }}
                  placeholder="Ctrl+Shift+Q"
                />
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === 'api' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="OCR 引擎">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>选择引擎:</label>
                <select
                  value={activeOcrPlugin}
                  onChange={(e) => setActiveOcrPlugin(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 8, background: '#F2F2F7', outline: 'none' }}
                >
                  {ocrPlugins.map((p) => (
                    <option key={p.metadata.id} value={p.metadata.id}>{p.metadata.name}</option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 8 }}>
                {ocrPlugins.find((p) => p.metadata.id === activeOcrPlugin)?.metadata.description}
              </p>
              {activeOcrPlugin === 'paddle-ocr' && (
                <div style={{ marginTop: 12, padding: 12, background: '#F2F2F7', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: '#1c1c1e' }}>
                      PaddleOCR: {paddleocrInstalled === null ? '检查中...' : paddleocrInstalled ? '✅ 已安装' : '❌ 未安装'}
                    </span>
                    {!paddleocrInstalled && (
                      <button onClick={handleInstallPaddleOcr} disabled={installing}
                        style={{ padding: '6px 12px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {installing ? '安装中...' : '安装'}
                      </button>
                    )}
                  </div>
                  {installMsg && <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 8 }}>{installMsg}</p>}
                </div>
              )}
            </SettingsCard>
            <SettingsCard title="翻译服务">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>选择翻译:</label>
                <select
                  value={activeTranslationPlugin}
                  onChange={(e) => setActiveTranslationPlugin(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 8, background: '#F2F2F7', outline: 'none' }}
                >
                  {translationPlugins.map((p) => (
                    <option key={p.metadata.id} value={p.metadata.id}>{p.metadata.name}</option>
                  ))}
                </select>
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === 'hotkey' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="截图热键">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>截图快捷键:</label>
                <input type="text" value={hotkey} onChange={(e) => setHotkey(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 8, background: '#F2F2F7', outline: 'none', width: 180 }} />
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === 'about' && (
          <SettingsCard title="关于须臾OCR">
            <p style={{ fontSize: 13, color: '#1c1c1e', marginBottom: 4 }}>版本: 0.1.0</p>
            <p style={{ fontSize: 12, color: '#8E8E93' }}>须臾OCR - 智能OCR桌面软件</p>
            <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 4 }}>支持 PaddleOCR / OpenAI Vision / 本地LLM</p>
          </SettingsCard>
        )}

        {!['general', 'hotkey', 'api', 'about'].includes(activeTab) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <p style={{ fontSize: 13, color: '#8E8E93' }}>开发中...</p>
          </div>
        )}
      </div>
    </div>
  );
}

// iOS 18 风格设置卡片
function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 10,
      padding: 16,
      boxShadow: '0 0.5px 0 rgba(0,0,0,0.04)',
    }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e', margin: '0 0 12px 0' }}>{title}</h3>
      {children}
    </div>
  );
}

// iOS 18 风格复选框
function CheckboxItem({ label, checked: defaultChecked = false }: { label: string; checked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: '#007AFF', cursor: 'pointer' }} />
      <span style={{ fontSize: 13, color: '#1c1c1e' }}>{label}</span>
    </label>
  );
}

export default Settings;
