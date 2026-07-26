import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';
import { useOcrStore } from '../stores/ocrStore';
import { builtinPlugins } from '../plugins';
import { Logo } from './Logo';
type SettingsTab = 'general' | 'config' | 'screenshot' | 'api' | 'shortcuts' | 'update' | 'about';

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: '常规' },
  { key: 'config', label: '配置' },
  { key: 'screenshot', label: '截图' },
  { key: 'api', label: '接口' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'update', label: '更新' },
  { key: 'about', label: '关于' },
];

function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [paddleocrInstalled, setPaddleocrInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [clearCacheMsg, setClearCacheMsg] = useState<string | null>(null);
  const [clearCacheOk, setClearCacheOk] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const store = useSettingsStore();
  const { clearHistory } = useOcrStore();
  const {
    activeOcrPlugin,
    activeTranslationPlugin,
    startup,
    captureOpt,
    language,
    afterRecognize,
    style,
    config,
    quickAction,
    proxy,
    screenshot,
    setActiveOcrPlugin,
    setActiveTranslationPlugin,
    setStartup,
    setCaptureOpt,
    setLanguage,
    setAfterRecognize,
    setStyle,
    setConfig,
    setQuickAction,
    setProxy,
    setScreenshot,
    shortcuts,
    setShortcuts,
  } = store;

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
  };

  const handleAutoStartChange = async (v: boolean) => {
    setStartup({ autoStart: v });
    try {
      await invoke('set_autostart', { enable: v });
    } catch (err) {
      console.error('set_autostart failed:', err);
    }
  };


  const handleClearCache = async () => {
    try {
      await invoke('clear_temp_cache');
      clearHistory();
      setClearCacheOk(true);
      setClearCacheMsg('已清除临时文件和识别历史');
    } catch (err) {
      clearHistory();
      setClearCacheOk(false);
      setClearCacheMsg(`部分清除失败: ${err}`);
    }
    setTimeout(() => setClearCacheMsg(null), 3000);
  };

  return (
    <div className="flex h-full">
      {/* 左侧导航 - Apple 侧边栏风格 */}
      <div style={{ width: 200, borderRight: '0.5px solid #E5E5EA', background: '#F2F2F7', padding: '12px 8px' }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 100ms ease-out',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#F2F2F7' }}>
        {/* ===== 常规 ===== */}
        {activeTab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="启动时">
              <CheckboxItem label="开机时自动启动" checked={startup.autoStart} onChange={handleAutoStartChange} />
              <CheckboxItem label="以管理员身份运行" checked={startup.runAsAdmin} onChange={(v) => setStartup({ runAsAdmin: v })} />
              <CheckboxItem label="启动时显示窗口" checked={startup.showWindow} onChange={(v) => setStartup({ showWindow: v })} />
              <CheckboxItem label="启动时显示工具栏" checked={startup.showToolbar} onChange={(v) => setStartup({ showToolbar: v })} />
            </SettingsCard>
            <SettingsCard title="截图时">
              <CheckboxItem label="截图时启用十字线" checked={captureOpt.crosshair} onChange={(v) => setCaptureOpt({ crosshair: v })} />
              <CheckboxItem label="复制图片和文件" checked={captureOpt.copyImageAndFile} onChange={(v) => setCaptureOpt({ copyImageAndFile: v })} />
              <CheckboxItem label="截图时启用放大镜" checked={captureOpt.magnifier} onChange={(v) => setCaptureOpt({ magnifier: v })} />
            </SettingsCard>
            <SettingsCard title="识别后">
              <CheckboxItem label="识别后文本叠加" checked={afterRecognize.textOverlay} onChange={(v) => setAfterRecognize({ textOverlay: v })} />
              <CheckboxItem label="识别后播放音效" checked={afterRecognize.soundEffect} onChange={(v) => setAfterRecognize({ soundEffect: v })} />
              <CheckboxItem label="识别后复制到剪贴板" checked={afterRecognize.autoCopy} onChange={(v) => setAfterRecognize({ autoCopy: v })} />
              <CheckboxItem label="自动复制Office公式" checked={afterRecognize.autoCopyOfficeFormula} onChange={(v) => setAfterRecognize({ autoCopyOfficeFormula: v })} />
              <CheckboxItem label="识别后弹出窗体" checked={afterRecognize.popupWindow} onChange={(v) => setAfterRecognize({ popupWindow: v })} />
            </SettingsCard>
            <SettingsCard title="语言设置">
              <SelectItem label="识别语言" value={language.ocrLang} options={['自动检测', '中文', '英文', '日文', '韩文']} onChange={(v) => setLanguage({ ocrLang: v })} />
              <SelectItem label="翻译目标" value={language.translateTarget} options={['中文', '英文', '日文', '韩文']} onChange={(v) => setLanguage({ translateTarget: v })} />
            </SettingsCard>
          </div>
        )}

        {/* ===== 配置 ===== */}
        {activeTab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="样式">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <SelectItem label="字体大小" value={style.fontSize} options={['小四', '小三', '四号', '五号']} onChange={(v) => setStyle({ fontSize: v })} inline />
                <SelectItem label="字体样式" value={style.fontStyle} options={['新罗马', '宋体', '微软雅黑', '黑体']} onChange={(v) => setStyle({ fontStyle: v })} inline />
                <CheckboxItem label="首行缩进" checked={style.firstLineIndent} onChange={(v) => setStyle({ firstLineIndent: v })} />
                <SelectItem label="段落对齐" value={style.paragraphAlign} options={['左对齐', '居中', '右对齐', '两端对齐']} onChange={(v) => setStyle({ paragraphAlign: v })} inline />
              </div>
            </SettingsCard>
            <SettingsCard title="设置">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <SelectItem label="取色代码" value={config.colorCode} options={['RGB', 'HEX', 'HSL']} onChange={(v) => setConfig({ colorCode: v })} inline />
                <SelectItem label="搜索引擎" value={config.searchEngine} options={['百度', '谷歌', '必应', '搜狗']} onChange={(v) => setConfig({ searchEngine: v })} inline />
                <SelectItem label="字数统计" value={config.wordCountMode} options={['Word模式', '字符模式']} onChange={(v) => setConfig({ wordCountMode: v })} inline />
                <SelectItem label="自动分段" value={config.autoSegment} options={['标点符号', '换行符', '无']} onChange={(v) => setConfig({ autoSegment: v })} inline />
                <SelectItem label="工具栏" value={config.toolbarLayout} options={['横向', '纵向']} onChange={(v) => setConfig({ toolbarLayout: v })} inline />
                <CheckboxItem label="竖排空格" checked={config.verticalSpacing} onChange={(v) => setConfig({ verticalSpacing: v })} />
                <SelectItem label="竖排方向" value={config.verticalDirection} options={['从左向右', '从右向左']} onChange={(v) => setConfig({ verticalDirection: v })} inline />
              </div>
            </SettingsCard>
            <SettingsCard title="快捷操作">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <SelectItem label="关闭软件" value={quickAction.closeAction} options={['最小化到托盘', '直接退出']} onChange={(v) => setQuickAction({ closeAction: v })} inline />
                <SelectItem label="单击托盘" value={quickAction.trayClick} options={['显示窗口', '无操作']} onChange={(v) => setQuickAction({ trayClick: v })} inline />
              </div>
            </SettingsCard>
            <SettingsCard title="代理类型">
              <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
                <RadioItem label="不使用代理" checked={proxy.type === 'none'} onChange={() => setProxy({ type: 'none' })} />
                <RadioItem label="使用系统代理" checked={proxy.type === 'system'} onChange={() => setProxy({ type: 'system' })} />
                <RadioItem label="自定义代理" checked={proxy.type === 'custom'} onChange={() => setProxy({ type: 'custom' })} />
              </div>
              {proxy.type === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <InputItem label="服务器" value={proxy.server} onChange={(v) => setProxy({ server: v })} placeholder="" />
                  <InputItem label="端口" value={proxy.port} onChange={(v) => setProxy({ port: v })} placeholder="" />
                  <InputItem label="用户名" value={proxy.username} onChange={(v) => setProxy({ username: v })} placeholder="" />
                  <InputItem label="密码" value={proxy.password} onChange={(v) => setProxy({ password: v })} placeholder="" type="password" />
                </div>
              )}
            </SettingsCard>
            <SettingsCard title="数据管理">
              <button onClick={handleClearCache} style={{ padding: '6px 12px', background: '#FF3B30', color: 'white', border: 'none', borderRadius: 12, fontSize: 12, cursor: 'pointer' }}>清除缓存</button>
              <p style={{ fontSize: 11, color: '#AEAEB2', marginTop: 8 }}>清除临时文件和识别历史</p>
              {clearCacheMsg && <p style={{ fontSize: 11, color: clearCacheOk ? '#34C759' : '#FF3B30', marginTop: 4 }}>{clearCacheMsg}</p>}
            </SettingsCard>
          </div>
        )}

        {/* ===== 截图 ===== */}
        {activeTab === 'screenshot' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="截图按钮">
              <CheckboxItem label="是否显示截图右侧识别框" checked={screenshot.showRightPanel} onChange={(v) => setScreenshot({ showRightPanel: v })} />
              <p style={{ fontSize: 11, color: '#AEAEB2', marginTop: 4 }}>蓝色为截图时显示该按钮</p>
            </SettingsCard>
            <SettingsCard title="图片保存名称">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <InputItem label="截图前缀" value={screenshot.filenamePrefix} onChange={(v) => setScreenshot({ filenamePrefix: v })} />
                <InputItem label="截图扩展名" value={screenshot.filenameExt} onChange={(v) => setScreenshot({ filenameExt: v })} />
              </div>
            </SettingsCard>
            <SettingsCard title="图片自动保存">
              <CheckboxItem label="是否启用" checked={screenshot.autoSave} onChange={(v) => setScreenshot({ autoSave: v })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <InputItem label="图片路径" value={screenshot.savePath} onChange={(v) => setScreenshot({ savePath: v })} />
                <button
                  onClick={async () => {
                    try {
                      const path = await invoke<string>('select_folder');
                      setScreenshot({ savePath: path });
                    } catch (err) {
                      console.error('Failed to select folder:', err);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    background: '#007AFF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  选择文件夹
                </button>
              </div>
            </SettingsCard>
            <SettingsCard title="截图设置">
              <CheckboxItem label="截图时隐藏主窗口" checked={screenshot.hideMainWindow} onChange={(v) => setScreenshot({ hideMainWindow: v })} />
              <CheckboxItem label="截图后自动识别" checked={screenshot.autoRecognize} onChange={(v) => setScreenshot({ autoRecognize: v })} />
              <CheckboxItem label="显示截图预览" checked={screenshot.showPreview} onChange={(v) => setScreenshot({ showPreview: v })} />
              <CheckboxItem label="支持多屏幕截图" checked={screenshot.multiScreen} onChange={(v) => setScreenshot({ multiScreen: v })} />
              <SelectItem label="保存格式" value={screenshot.saveFormat} options={['PNG (无损)', 'JPG (有损)']} onChange={(v) => setScreenshot({ saveFormat: v })} />
            </SettingsCard>
          </div>
        )}

        {/* ===== 接口（OCR引擎 + 翻译 + 大模型OCR） ===== */}
        {activeTab === 'api' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="OCR 引擎">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>选择引擎:</label>
                <select
                  value={activeOcrPlugin}
                  onChange={(e) => setActiveOcrPlugin(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
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
                <div style={{ marginTop: 12, padding: 12, background: '#F2F2F7', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: '#1c1c1e' }}>
                      PaddleOCR: {paddleocrInstalled === null ? '未检测' : paddleocrInstalled ? '已安装' : '未安装'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={checkPaddleOcr}
                        style={{ padding: '6px 12px', background: '#E5E5EA', color: '#1c1c1e', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        检测
                      </button>
                      {!paddleocrInstalled && (
                        <button onClick={handleInstallPaddleOcr} disabled={installing}
                          style={{ padding: '6px 12px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {installing ? '安装中...' : '安装'}
                        </button>
                      )}
                    </div>
                  </div>
                  {installMsg && <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 8 }}>{installMsg}</p>}
                </div>
              )}
              {activeOcrPlugin === 'openai-vision' && (
                <PluginApiKeyConfig pluginId="openai-vision" fields={[
                  { key: 'apiKey', label: 'API Key', required: true },
                  { key: 'model', label: '模型', default: 'gpt-4o' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'local-llm' && (
                <PluginApiKeyConfig pluginId="local-llm" fields={[
                  { key: 'endpoint', label: 'Ollama 地址', default: 'http://localhost:11434' },
                  { key: 'model', label: '模型名称', default: 'llava' },
                ]} />
              )}
              {activeOcrPlugin === 'qwen-vision' && (
                <PluginApiKeyConfig pluginId="qwen-vision" fields={[
                  { key: 'apiKey', label: 'API Key (阿里云 DashScope)', required: true },
                  { key: 'model', label: '模型', default: 'qwen-vl-max' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'zhipu-vision' && (
                <PluginApiKeyConfig pluginId="zhipu-vision" fields={[
                  { key: 'apiKey', label: 'API Key (智谱)', required: true },
                  { key: 'model', label: '模型', default: 'glm-4v' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://open.bigmodel.cn/api/paas/v4' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'doubao-vision' && (
                <PluginApiKeyConfig pluginId="doubao-vision" fields={[
                  { key: 'apiKey', label: 'API Key (火山引擎)', required: true },
                  { key: 'model', label: '模型 ID', default: 'doubao-vision-pro-32k' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://ark.cn-beijing.volces.com/api/v3' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'gemini-vision' && (
                <PluginApiKeyConfig pluginId="gemini-vision" fields={[
                  { key: 'apiKey', label: 'API Key (Google)', required: true },
                  { key: 'model', label: '模型', default: 'gemini-1.5-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://generativelanguage.googleapis.com/v1beta/openai' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
            </SettingsCard>
            <SettingsCard title="翻译服务">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 13, color: '#1c1c1e' }}>选择翻译:</label>
                <select
                  value={activeTranslationPlugin}
                  onChange={(e) => setActiveTranslationPlugin(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
                >
                  {translationPlugins.map((p) => (
                    <option key={p.metadata.id} value={p.metadata.id}>{p.metadata.name}</option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 8 }}>
                {translationPlugins.find((p) => p.metadata.id === activeTranslationPlugin)?.metadata.description}
              </p>
              {activeTranslationPlugin === 'ai-translate' && (
                <PluginApiKeyConfig pluginId="ai-translate" fields={[
                  { key: 'apiKey', label: 'API Key', required: true },
                  { key: 'model', label: '模型', default: 'gpt-4o' },
                ]} />
              )}
              {activeTranslationPlugin === 'openai-translate' && (
                <PluginApiKeyConfig pluginId="openai-translate" fields={[
                  { key: 'apiKey', label: 'API Key', required: true },
                  { key: 'model', label: '模型', default: 'gpt-4o' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.openai.com/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'qwen-translate' && (
                <PluginApiKeyConfig pluginId="qwen-translate" fields={[
                  { key: 'apiKey', label: 'API Key (阿里云 DashScope)', required: true },
                  { key: 'model', label: '模型', default: 'qwen-turbo' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'zhipu-translate' && (
                <PluginApiKeyConfig pluginId="zhipu-translate" fields={[
                  { key: 'apiKey', label: 'API Key (智谱)', required: true },
                  { key: 'model', label: '模型', default: 'glm-4-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://open.bigmodel.cn/api/paas/v4' },
                ]} />
              )}
              {activeTranslationPlugin === 'doubao-translate' && (
                <PluginApiKeyConfig pluginId="doubao-translate" fields={[
                  { key: 'apiKey', label: 'API Key (火山引擎)', required: true },
                  { key: 'model', label: '模型 ID', default: 'doubao-pro-32k' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://ark.cn-beijing.volces.com/api/v3' },
                ]} />
              )}
              {activeTranslationPlugin === 'gemini-translate' && (
                <PluginApiKeyConfig pluginId="gemini-translate" fields={[
                  { key: 'apiKey', label: 'API Key (Google)', required: true },
                  { key: 'model', label: '模型', default: 'gemini-1.5-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://generativelanguage.googleapis.com/v1beta/openai' },
                ]} />
              )}
            </SettingsCard>
          </div>
        )}

        {/* ===== 快捷键 ===== */}
        {activeTab === 'shortcuts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="全局快捷键">
              <p style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
                快捷键在应用后台也能生效。点击右侧按钮后按下新的快捷键组合。
              </p>
              <ShortcutEditor label="截图识别" value={shortcuts.screenshot} onChange={(v) => setShortcuts({ screenshot: v })} />
              <ShortcutEditor label="复制文本" value={shortcuts.copy} onChange={(v) => setShortcuts({ copy: v })} />
              <ShortcutEditor label="翻译" value={shortcuts.translate} onChange={(v) => setShortcuts({ translate: v })} />
            </SettingsCard>
          </div>
        )}

        {/* ===== 更新 ===== */}
        {activeTab === 'update' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="版本更新">
              <p style={{ fontSize: 13, color: '#1c1c1e', marginBottom: 8 }}>当前版本: 0.1.0</p>
              <button onClick={() => { setUpdateChecking(true); setTimeout(() => { setUpdateChecking(false); setUpdateChecked(true); }, 1500); }} disabled={updateChecking}
                style={{ padding: '8px 16px', background: '#007AFF', color: 'white', border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {updateChecking ? '检查中...' : '检查更新'}
              </button>
              {updateChecked && <p style={{ fontSize: 12, color: '#8E8E93', marginTop: 8 }}>已是最新版本</p>}
            </SettingsCard>
          </div>
        )}

        {/* ===== 关于 ===== */}
        {activeTab === 'about' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Logo size={80} />
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1c1c1e' }}>须臾OCR</h2>
            <p style={{ fontSize: 13, color: '#8E8E93' }}>版本 0.1.0</p>
            <p style={{ fontSize: 12, color: '#AEAEB2', textAlign: 'center', lineHeight: 1.6 }}>
              智能OCR桌面软件<br/>
              支持 PaddleOCR / OpenAI / 通义千问 / 智谱 / 豆包 / Gemini / 本地LLM
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 12,
      padding: 16,
      boxShadow: '0 0.5px 0 rgba(0,0,0,0.04)',
    }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e', margin: '0 0 12px 0' }}>{title}</h3>
      {children}
    </div>
  );
}

function CheckboxItem({ label, checked = false, onChange }: { label: string; checked?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0', transition: 'transform 100ms ease-out' }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: '#007AFF', cursor: 'pointer' }} />
      <span style={{ fontSize: 13, color: '#1c1c1e' }}>{label}</span>
    </label>
  );
}

function SelectItem({ label, value, options, onChange, inline }: {
  label: string; value: string; options: string[]; onChange?: (v: string) => void; inline?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', flexWrap: inline ? 'nowrap' : 'wrap' }}>
      <label style={{ fontSize: 13, color: '#1c1c1e', minWidth: inline ? 70 : undefined, whiteSpace: 'nowrap' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none', flex: 1, cursor: 'pointer', transition: 'border-color 100ms ease-out' }}
      >
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function InputItem({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <label style={{ fontSize: 13, color: '#1c1c1e', minWidth: 70, whiteSpace: 'nowrap' }}>{label}:</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        style={{ padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none', flex: 1, cursor: 'text', transition: 'border-color 100ms ease-out' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#007AFF'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.18)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#D1D1D6'; e.currentTarget.style.boxShadow = 'none'; }}
      />
    </div>
  );
}

function RadioItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#1c1c1e' }}>
      <input type="radio" checked={checked} onChange={onChange} style={{ accentColor: '#007AFF' }} />
      {label}
    </label>
  );
}

function ShortcutEditor({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key;
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      parts.push(key.toUpperCase());
      onChange(parts.join('+'));
      setEditing(false);
    }
  };

  const formatShortcut = (s: string) => {
    return s.replace('CmdOrCtrl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
             .replace('Shift', '⇧')
             .replace('Alt', navigator.platform.includes('Mac') ? '⌥' : 'Alt')
             .replace(/\+/g, ' ');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <span style={{ fontSize: 13, color: '#1c1c1e' }}>{label}</span>
      <button
        onClick={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onKeyDown={editing ? handleKeyDown : undefined}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          border: `1px solid ${editing ? '#007AFF' : '#D1D1D6'}`,
          borderRadius: 8,
          background: editing ? '#F0F8FF' : '#FFFFFF',
          cursor: 'pointer',
          minWidth: 120,
          textAlign: 'center',
          outline: editing ? '2px solid rgba(0,122,255,0.3)' : 'none',
        }}
      >
        {editing ? '请按下快捷键...' : formatShortcut(value)}
      </button>
    </div>
  );
}

function PluginApiKeyConfig({ pluginId, fields }: { pluginId: string; fields: { key: string; label: string; required?: boolean; default?: string }[] }) {
  const { pluginSettings, setPluginSetting } = useSettingsStore();
  const settings = pluginSettings[pluginId] || {};

  // 挂载时把默认值写入 store，确保后续读取不落空
  useEffect(() => {
    for (const field of fields) {
      if (field.default && !settings[field.key]) {
        setPluginSetting(pluginId, field.key, field.default);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId]);

  return (
    <div style={{ marginTop: 12, padding: 12, background: '#F2F2F7', borderRadius: 12 }}>
      {fields.map((field) => (
        <div key={field.key} style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: '#636366', marginBottom: 4, display: 'block' }}>
            {field.label} {field.required && <span style={{ color: '#FF3B30' }}>*</span>}
          </label>
          <input
            type={field.key === 'maxTokens' ? 'number' : 'text'}
            value={(settings[field.key] as string) || field.default || ''}
            onChange={(e) => setPluginSetting(pluginId, field.key, e.target.value)}
            placeholder={field.default || ''}
            style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
          />
        </div>
      ))}
    </div>
  );
}

export default Settings;
