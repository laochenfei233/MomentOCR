import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '../stores/settingsStore';
import { useOcrStore } from '../stores/ocrStore';
import { builtinPlugins } from '../plugins';
import { Logo } from './Logo';
import { DEFAULT_SHORTCUTS, formatShortcut, isModifierKeyEvent, shortcutFromKeyboardEvent, validateShortcut } from '../utils/shortcut';
type SettingsTab = 'general' | 'config' | 'screenshot' | 'api' | 'shortcuts' | 'update' | 'about';

/** 一个可独立安装的本地组件的状态 */
interface ComponentStatus {
  installed: boolean;
  version: string;
  disk_bytes: number;
  download_mb: number;
  disk_mb: number;
}

/** 本地组件总览：两个组件共用同一个隔离运行时 */
interface ComponentsStatus {
  runtime_installed: boolean;
  runtime_download_mb: number;
  ocr: ComponentStatus;
  /** Windows 安装包自带覆盖层，截图组件就不必再下载 */
  screenshot_bundled: boolean;
  screenshot: ComponentStatus;
  runtime_bytes: number;
}

/** 安装进度事件（Rust 端 local-engine-progress） */
interface LocalEngineProgress {
  stage: string;
  percent: number;
  detail: string;
}

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: '常规' },
  { key: 'config', label: '配置' },
  { key: 'screenshot', label: '截图' },
  { key: 'api', label: '接口' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'update', label: '更新' },
  { key: 'about', label: '关于' },
];

function Settings({ shortcutIssues = {}, autostartIssue = null }: {
  shortcutIssues?: Record<string, string>;
  autostartIssue?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  // 本地组件都是按需下载的：装进应用自己的目录，不碰系统环境
  const [components, setComponents] = useState<ComponentsStatus | null>(null);
  const [engineProgress, setEngineProgress] = useState<LocalEngineProgress | null>(null);
  const [engineBusy, setEngineBusy] = useState<string | null>(null);
  const [engineMsg, setEngineMsg] = useState<Record<string, string | null>>({});
  const [clearCacheMsg, setClearCacheMsg] = useState<string | null>(null);
  const [clearCacheOk, setClearCacheOk] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);
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

  // 本地组件：挂载时查一次状态，安装过程靠事件推进度
  const refreshComponents = async () => {
    try {
      setComponents(await invoke<ComponentsStatus>('get_local_components_status'));
    } catch (err) {
      setEngineMsg((m) => ({ ...m, status: `读取组件状态失败：${err}` }));
    }
  };

  useEffect(() => {
    refreshComponents();
    const unlisten = listen<LocalEngineProgress>('local-engine-progress', (event) => {
      setEngineProgress(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const installComponent = async (id: 'ocr' | 'screenshot') => {
    setEngineBusy(id);
    setEngineMsg((m) => ({ ...m, [id]: null }));
    setEngineProgress({ stage: 'python', percent: 0, detail: '正在准备下载…' });
    try {
      const message = await invoke<string>('install_local_component', { component: id });
      setEngineMsg((m) => ({ ...m, [id]: message }));
    } catch (err) {
      setEngineMsg((m) => ({ ...m, [id]: `安装失败：${err}` }));
    } finally {
      setEngineBusy(null);
      setEngineProgress(null);
      await refreshComponents();
    }
  };

  const removeComponent = async (id: 'ocr' | 'screenshot', label: string) => {
    if (!window.confirm(`移除${label}？需要时再重新下载。`)) return;
    setEngineBusy(id);
    setEngineMsg((m) => ({ ...m, [id]: null }));
    try {
      const message = await invoke<string>('remove_local_component', { component: id });
      setEngineMsg((m) => ({ ...m, [id]: message }));
    } catch (err) {
      setEngineMsg((m) => ({ ...m, [id]: `移除失败：${err}` }));
    } finally {
      setEngineBusy(null);
      await refreshComponents();
    }
  };

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
  };

  const handleAutoStartChange = async (v: boolean) => {
    setStartup({ autoStart: v });
    setAutoStartError(null);
    try {
      await invoke('set_autostart', { enable: v });
    } catch (err) {
      // 没写进系统就别让勾留着，否则用户会以为已经设好了
      setStartup({ autoStart: !v });
      setAutoStartError(v ? `开启失败：${err}` : `关闭失败：${err}`);
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
              {(autoStartError || autostartIssue) && (
                <p style={{ fontSize: 11, color: '#FF3B30', margin: '4px 0 0' }}>{autoStartError || autostartIssue}</p>
              )}
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
              <SelectItem label="翻译结果显示" value={language.translateLayout || '下方'} options={['下方', '右侧']} onChange={(v) => setLanguage({ translateLayout: v })} />
              <p style={{ fontSize: 11, color: '#AEAEB2', marginTop: 4 }}>翻译结果独立成框，显示在识别原文的下方或右侧</p>
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
            <SettingsCard title="截图组件">
              <LocalComponentPanel
                id="screenshot"
                title="截图覆盖层"
                description="抓屏与选区用的全屏覆盖窗口（PyQt5）。Windows 安装包已随包自带，其他平台按需下载到应用自己的目录。"
                status={components?.screenshot ?? null}
                bundled={components?.screenshot_bundled ?? false}
                runtimeInstalled={components?.runtime_installed ?? false}
                runtimeDownloadMb={components?.runtime_download_mb ?? 12}
                busy={engineBusy === 'screenshot'}
                progress={engineBusy === 'screenshot' ? engineProgress : null}
                msg={engineMsg.screenshot ?? null}
                onInstall={() => installComponent('screenshot')}
                onRemove={() => removeComponent('screenshot', '截图组件')}
                onRefresh={refreshComponents}
              />
            </SettingsCard>
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
              {(activeOcrPlugin === 'paddle-ocr' || activeOcrPlugin === 'rapid-ocr') && (
                <LocalComponentPanel
                  id="ocr"
                  title="本地识别引擎"
                  description="RapidOCR（PP-OCRv6）：本地识别、离线可用、不上传图片。装进应用自己的目录，不需要系统里预先装 Python。"
                  status={components?.ocr ?? null}
                  bundled={false}
                  runtimeInstalled={components?.runtime_installed ?? false}
                  runtimeDownloadMb={components?.runtime_download_mb ?? 12}
                  busy={engineBusy === 'ocr'}
                  progress={engineBusy === 'ocr' ? engineProgress : null}
                  msg={engineMsg.ocr ?? null}
                  onInstall={() => installComponent('ocr')}
                  onRemove={() => removeComponent('ocr', '本地识别引擎')}
                  onRefresh={refreshComponents}
                />
              )}
              {activeOcrPlugin === 'paddle-ocr' && (
                <p style={{ fontSize: 11, color: '#FF9500', marginTop: 8, lineHeight: 1.6 }}>
                  ⚠ PaddleOCR 不随应用下载（paddlepaddle 就要 290 MB 以上），本地识别请用 RapidOCR
                </p>
              )}
              {activeOcrPlugin === 'openai-vision' && (
                <PluginApiKeyConfig pluginId="openai-vision" listProvider="openai" defaultBaseUrl="https://api.openai.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key', required: true },
                  { key: 'model', label: '模型', default: 'gpt-4o' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'local-llm' && (
                <PluginApiKeyConfig pluginId="local-llm" listProvider="ollama" defaultBaseUrl="http://localhost:11434" endpointKey="endpoint" fields={[
                  { key: 'endpoint', label: 'Ollama 地址', default: 'http://localhost:11434' },
                  { key: 'model', label: '模型名称', default: 'llava' },
                ]} />
              )}
              {activeOcrPlugin === 'qwen-vision' && (
                <PluginApiKeyConfig pluginId="qwen-vision" listProvider="openai" defaultBaseUrl="https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" fields={[
                  { key: 'apiKey', label: 'API Key (阿里云百炼)', required: true },
                  { key: 'model', label: '模型', default: 'qwen-vl-max' },
                  { key: 'baseUrl', label: 'Base URL（开箱即用；生产环境建议换成控制台复制的专属 API Host）', default: 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'zhipu-vision' && (
                <PluginApiKeyConfig pluginId="zhipu-vision" listProvider="openai" defaultBaseUrl="https://open.bigmodel.cn/api/paas/v4" fields={[
                  { key: 'apiKey', label: 'API Key (智谱)', required: true },
                  { key: 'model', label: '模型', default: 'glm-4v' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://open.bigmodel.cn/api/paas/v4' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'doubao-vision' && (
                <PluginApiKeyConfig pluginId="doubao-vision" listProvider="openai" defaultBaseUrl="https://ark.cn-beijing.volces.com/api/v3" fields={[
                  { key: 'apiKey', label: 'API Key (火山引擎)', required: true },
                  { key: 'model', label: '模型 ID', default: 'doubao-vision-pro-32k' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://ark.cn-beijing.volces.com/api/v3' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'gemini-vision' && (
                <PluginApiKeyConfig pluginId="gemini-vision" listProvider="openai" defaultBaseUrl="https://generativelanguage.googleapis.com/v1beta/openai" fields={[
                  { key: 'apiKey', label: 'API Key (Google)', required: true },
                  { key: 'model', label: '模型', default: 'gemini-1.5-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://generativelanguage.googleapis.com/v1beta/openai' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'mimo-vision' && (
                <PluginApiKeyConfig pluginId="mimo-vision" listProvider="openai" defaultBaseUrl="https://api.xiaomimimo.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key (MiMo)', required: true },
                  { key: 'model', label: '模型', default: '' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.xiaomimimo.com/v1' },
                  { key: 'maxTokens', label: '最大Token数', default: '1024' },
                ]} />
              )}
              {activeOcrPlugin === 'claude-vision' && (
                <PluginApiKeyConfig pluginId="claude-vision" listProvider="anthropic" defaultBaseUrl="https://api.anthropic.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key (Anthropic)', required: true },
                  { key: 'model', label: '模型', default: 'claude-sonnet-4-5' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.anthropic.com/v1' },
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
              {activeTranslationPlugin === 'openai-translate' && (
                <PluginApiKeyConfig pluginId="openai-translate" listProvider="openai" defaultBaseUrl="https://api.openai.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key', required: true },
                  { key: 'model', label: '模型', default: 'gpt-4o' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.openai.com/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'qwen-translate' && (
                <PluginApiKeyConfig pluginId="qwen-translate" listProvider="openai" defaultBaseUrl="https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" fields={[
                  { key: 'apiKey', label: 'API Key (阿里云百炼)', required: true },
                  { key: 'model', label: '模型', default: 'qwen-turbo' },
                  { key: 'baseUrl', label: 'Base URL（开箱即用；生产环境建议换成控制台复制的专属 API Host）', default: 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'zhipu-translate' && (
                <PluginApiKeyConfig pluginId="zhipu-translate" listProvider="openai" defaultBaseUrl="https://open.bigmodel.cn/api/paas/v4" fields={[
                  { key: 'apiKey', label: 'API Key (智谱)', required: true },
                  { key: 'model', label: '模型', default: 'glm-4-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://open.bigmodel.cn/api/paas/v4' },
                ]} />
              )}
              {activeTranslationPlugin === 'doubao-translate' && (
                <PluginApiKeyConfig pluginId="doubao-translate" listProvider="openai" defaultBaseUrl="https://ark.cn-beijing.volces.com/api/v3" fields={[
                  { key: 'apiKey', label: 'API Key (火山引擎)', required: true },
                  { key: 'model', label: '模型 ID', default: 'doubao-pro-32k' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://ark.cn-beijing.volces.com/api/v3' },
                ]} />
              )}
              {activeTranslationPlugin === 'gemini-translate' && (
                <PluginApiKeyConfig pluginId="gemini-translate" listProvider="openai" defaultBaseUrl="https://generativelanguage.googleapis.com/v1beta/openai" fields={[
                  { key: 'apiKey', label: 'API Key (Google)', required: true },
                  { key: 'model', label: '模型', default: 'gemini-1.5-flash' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://generativelanguage.googleapis.com/v1beta/openai' },
                ]} />
              )}
              {activeTranslationPlugin === 'mimo-translate' && (
                <PluginApiKeyConfig pluginId="mimo-translate" listProvider="openai" defaultBaseUrl="https://api.xiaomimimo.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key (MiMo)', required: true },
                  { key: 'model', label: '模型', default: '' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.xiaomimimo.com/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'deepseek-translate' && (
                <PluginApiKeyConfig pluginId="deepseek-translate" listProvider="openai" defaultBaseUrl="https://api.deepseek.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key (DeepSeek)', required: true },
                  { key: 'model', label: '模型', default: 'deepseek-chat' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.deepseek.com/v1' },
                ]} />
              )}
              {activeTranslationPlugin === 'claude-translate' && (
                <PluginApiKeyConfig pluginId="claude-translate" listProvider="anthropic" defaultBaseUrl="https://api.anthropic.com/v1" fields={[
                  { key: 'apiKey', label: 'API Key (Anthropic)', required: true },
                  { key: 'model', label: '模型', default: 'claude-sonnet-4-5' },
                  { key: 'baseUrl', label: 'Base URL', default: 'https://api.anthropic.com/v1' },
                ]} />
              )}
            </SettingsCard>
          </div>
        )}

        {/* ===== 快捷键 ===== */}
        {activeTab === 'shortcuts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="全局快捷键">
              <p style={{ fontSize: 12, color: '#8E8E93', marginBottom: 8 }}>
                快捷键在应用后台也能生效。点右侧按钮后按下新的组合，按 Esc 取消录制。
              </p>
              <p style={{ fontSize: 12, color: '#C77700', background: 'rgba(255,149,0,0.08)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.6, marginBottom: 4 }}>
                这些是系统级快捷键：注册之后，其他软件里同一个组合会被本应用接管。如果和常用软件冲突（尤其是 Alt+F4、Ctrl+Q、Ctrl+W 这类退出/关闭键），点「禁用」把按键交还回去。
              </p>
              <ShortcutEditor
                label="截图识别"
                value={shortcuts.screenshot}
                defaultValue={DEFAULT_SHORTCUTS.screenshot}
                issue={shortcutIssues.screenshot}
                onChange={(v) => setShortcuts({ screenshot: v })}
              />
              <ShortcutEditor
                label="复制文本"
                value={shortcuts.copy}
                defaultValue={DEFAULT_SHORTCUTS.copy}
                issue={shortcutIssues.copy}
                onChange={(v) => setShortcuts({ copy: v })}
              />
              <ShortcutEditor
                label="翻译"
                value={shortcuts.translate}
                defaultValue={DEFAULT_SHORTCUTS.translate}
                issue={shortcutIssues.translate}
                onChange={(v) => setShortcuts({ translate: v })}
              />
            </SettingsCard>
          </div>
        )}

        {/* ===== 更新 ===== */}
        {activeTab === 'update' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SettingsCard title="版本更新">
              <p style={{ fontSize: 13, color: '#1c1c1e', marginBottom: 8 }}>当前版本: 0.2.0</p>
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
            <p style={{ fontSize: 13, color: '#8E8E93' }}>版本 0.2.0</p>
            <p style={{ fontSize: 12, color: '#AEAEB2', textAlign: 'center', lineHeight: 1.6 }}>
              智能OCR桌面软件<br/>
              支持 PaddleOCR / RapidOCR / OpenAI / 通义千问 / 智谱 / 豆包 / Gemini / MiMo / DeepSeek / Claude / 本地LLM
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

function ShortcutEditor({ label, value, defaultValue, issue, onChange }: {
  label: string; value: string; defaultValue: string; issue?: string; onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // 已经存下来的组合也可能是坏的（旧版本录进来的无修饰键组合），同样要拦住不让它去抢按键
  const warning = editing ? captureError : (captureError || issue || validateShortcut(value));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {   // Esc 只用来取消录制，绝不录成快捷键
      setEditing(false);
      setCaptureError(null);
      return;
    }
    if (isModifierKeyEvent(e.nativeEvent)) return;   // 还在按修饰键，继续等主键

    const captured = shortcutFromKeyboardEvent(e.nativeEvent);
    if ('error' in captured) {
      setCaptureError(captured.error);
      return;
    }
    setCaptureError(null);
    setEditing(false);
    onChange(captured.combo);
  };

  const linkStyle: React.CSSProperties = {
    fontSize: 11, color: '#007AFF', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#1c1c1e' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            onClick={() => { setCaptureError(null); setEditing(true); }}
            onBlur={() => { setEditing(false); setCaptureError(null); }}
            onKeyDown={editing ? handleKeyDown : undefined}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              border: `1px solid ${editing ? '#007AFF' : '#D1D1D6'}`,
              borderRadius: 8,
              background: editing ? '#F0F8FF' : '#FFFFFF',
              color: value ? '#1c1c1e' : '#8E8E93',
              cursor: 'pointer',
              minWidth: 120,
              textAlign: 'center',
              outline: editing ? '2px solid rgba(0,122,255,0.3)' : 'none',
            }}
          >
            {editing ? '请按下快捷键…' : formatShortcut(value)}
          </button>
          {value !== defaultValue && (
            <button onClick={() => { setCaptureError(null); onChange(defaultValue); }} style={linkStyle}>恢复默认</button>
          )}
          {value ? (
            <button onClick={() => { setCaptureError(null); onChange(''); }} style={linkStyle}>禁用</button>
          ) : null}
        </div>
      </div>
      {editing && (
        <div style={{ fontSize: 11, color: '#8E8E93', textAlign: 'right', marginTop: 4 }}>
          需要配合 Ctrl / Alt / Shift 一起按；单独一个按键会独占整个系统的这个键
        </div>
      )}
      {warning && (
        <div style={{ fontSize: 11, color: '#FF9500', textAlign: 'right', marginTop: 4, lineHeight: 1.5 }}>
          ⚠ {warning}
        </div>
      )}
    </div>
  );
}

function PluginApiKeyConfig({ pluginId, fields, listProvider, defaultBaseUrl, endpointKey }: {
  pluginId: string;
  fields: { key: string; label: string; required?: boolean; default?: string }[];
  listProvider?: 'openai' | 'anthropic' | 'ollama';
  defaultBaseUrl?: string;
  endpointKey?: string;
}) {
  const { pluginSettings, setPluginSetting } = useSettingsStore();
  const settings = pluginSettings[pluginId] || {};
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState(false);

  const modelField = fields.find((f) => f.key === 'model');
  const apiKeyField = fields.find((f) => f.key === 'apiKey');
  const baseUrlField = fields.find((f) => f.key === 'baseUrl');
  const endpointField = endpointKey ? fields.find((f) => f.key === endpointKey) : undefined;

  // 挂载时把默认值写入 store，确保后续读取不落空
  useEffect(() => {
    for (const field of fields) {
      if (field.default && !settings[field.key]) {
        setPluginSetting(pluginId, field.key, field.default);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId]);

  const handleFetchModels = async () => {
    if (!listProvider) return;
    const apiKey = (settings[apiKeyField?.key || 'apiKey'] as string) || '';
    const effectiveBaseUrl = endpointKey
      ? ((settings[endpointKey] as string) || endpointField?.default || defaultBaseUrl || '')
      : ((settings[baseUrlField?.key || 'baseUrl'] as string) || defaultBaseUrl || '');

    setFetching(true);
    setFetchError(null);
    try {
      const list = await invoke<string[]>('list_models', {
        baseUrl: effectiveBaseUrl,
        apiKey,
        provider: listProvider,
      });
      setModels(list);
      if (list.length === 0) setFetchError('接口返回了空模型列表');
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setFetching(false);
    }
  };

  const currentModel = (settings['model'] as string) || modelField?.default || '';

  return (
    <div style={{ marginTop: 12, padding: 12, background: '#F2F2F7', borderRadius: 12 }}>
      {fields.map((field) => (
        <div key={field.key} style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: '#636366', marginBottom: 4, display: 'block' }}>
            {field.label} {field.required && <span style={{ color: '#FF3B30' }}>*</span>}
          </label>
          {field.key === 'model' && listProvider && !manualModel ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={currentModel}
                onChange={(e) => setPluginSetting(pluginId, 'model', e.target.value)}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
              >
                {models.length === 0 && (
                  <option value="" disabled>{currentModel || '点击"拉取模型列表"后选择'}</option>
                )}
                {currentModel && !models.includes(currentModel) && (
                  <option value={currentModel}>{currentModel}</option>
                )}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button
                onClick={handleFetchModels}
                disabled={fetching}
                style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, background: fetching ? '#AEAEB2' : '#007AFF', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {fetching ? '拉取中...' : '拉取模型列表'}
              </button>
              <button
                onClick={() => setManualModel(true)}
                title="手动输入模型名称"
                style={{ padding: '6px 10px', fontSize: 12, background: '#E5E5EA', color: '#1c1c1e', border: 'none', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                手动
              </button>
            </div>
          ) : field.key === 'model' && manualModel ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={currentModel}
                onChange={(e) => setPluginSetting(pluginId, 'model', e.target.value)}
                placeholder={field.default || ''}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
              />
              {listProvider && (
                <button
                  onClick={() => setManualModel(false)}
                  style={{ padding: '6px 10px', fontSize: 12, background: '#E5E5EA', color: '#1c1c1e', border: 'none', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  下拉
                </button>
              )}
            </div>
          ) : (
            <input
              type={field.key === 'maxTokens' ? 'number' : 'text'}
              value={(settings[field.key] as string) || field.default || ''}
              onChange={(e) => setPluginSetting(pluginId, field.key, e.target.value)}
              placeholder={field.default || ''}
              style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '0.5px solid #D1D1D6', borderRadius: 12, background: '#FFFFFF', outline: 'none' }}
            />
          )}
        </div>
      ))}
      {fetchError && <p style={{ fontSize: 11, color: '#FF3B30', marginTop: 0 }}>{fetchError}</p>}
      {!fetchError && models.length > 0 && (
        <p style={{ fontSize: 11, color: '#34C759', marginTop: 0 }}>已拉取 {models.length} 个模型</p>
      )}
    </div>
  );
}

function LocalComponentPanel({ id, title, description, status, bundled, runtimeInstalled, runtimeDownloadMb, busy, progress, msg, onInstall, onRemove, onRefresh }: {
  id: 'ocr' | 'screenshot';
  title: string;
  description: string;
  status: ComponentStatus | null;
  /** 安装包里是否已经带了这个组件（Windows 的截图覆盖层） */
  bundled: boolean;
  runtimeInstalled: boolean;
  runtimeDownloadMb: number;
  busy: boolean;
  progress: LocalEngineProgress | null;
  msg: string | null;
  onInstall: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const installed = !!status?.installed;
  const failed = !!msg && (msg.startsWith('安装失败') || msg.startsWith('移除失败'));
  const toMb = (bytes: number) => Math.round(bytes / 1048576);
  // 第一次装组件时还要把共享的运行时一起下下来
  const downloadHint = (status?.download_mb ?? 0) + (runtimeInstalled ? 0 : runtimeDownloadMb);
  const buttonStyle: React.CSSProperties = {
    padding: '6px 12px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 600,
  };

  return (
    <div data-component={id} style={{ marginTop: 12, padding: 12, background: '#F2F2F7', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#1c1c1e' }}>
          {title}：
          {bundled ? '已随安装包提供' : status === null ? '读取中…' : installed ? `已安装 ${status.version || '已就绪'}` : '未安装'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onRefresh} disabled={busy}
            style={{ ...buttonStyle, background: '#E5E5EA', color: '#1c1c1e', cursor: busy ? 'default' : 'pointer' }}>
            检测
          </button>
          {!bundled && (installed ? (
            <button onClick={onRemove} disabled={busy}
              style={{ ...buttonStyle, background: '#E5E5EA', color: '#FF3B30', cursor: busy ? 'default' : 'pointer' }}>
              移除
            </button>
          ) : (
            <button onClick={onInstall} disabled={busy}
              style={{ ...buttonStyle, background: busy ? '#AEAEB2' : '#007AFF', color: 'white', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? '下载中…' : `下载并安装（约 ${downloadHint} MB）`}
            </button>
          ))}
        </div>
      </div>

      {progress && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 6, borderRadius: 3, background: '#E5E5EA', overflow: 'hidden' }}>
            <div style={{ width: `${progress.percent}%`, height: '100%', background: '#007AFF', transition: 'width 200ms ease-out' }} />
          </div>
          <p style={{ fontSize: 11, color: '#636366', marginTop: 6 }}>{progress.detail}</p>
        </div>
      )}

      {msg && <p style={{ fontSize: 12, color: failed ? '#FF3B30' : '#34C759', marginTop: 8 }}>{msg}</p>}

      {!progress && (bundled ? (
        <p style={{ fontSize: 11, color: '#8E8E93', marginTop: 8, lineHeight: 1.6 }}>
          {description} 安装包已自带，无需下载，也不需要系统里预先装 Python。
        </p>
      ) : installed ? (
        <p style={{ fontSize: 11, color: '#AEAEB2', marginTop: 8, lineHeight: 1.6 }}>
          占用磁盘约 {toMb(status?.disk_bytes ?? 0)} MB，装在应用自己的目录里，不动系统环境；
          移除时只删这个组件的文件（两个组件都移除后运行时一起清掉）。
        </p>
      ) : (
        <p style={{ fontSize: 11, color: '#8E8E93', marginTop: 8, lineHeight: 1.6 }}>
          {description} 按需下载：约 {status?.download_mb ?? 0} MB
          {runtimeInstalled ? '' : `，首次还需下载共享运行时约 ${runtimeDownloadMb} MB`}
          ，磁盘约 {status?.disk_mb ?? 0} MB，不改动也不需要系统里预先装 Python。
        </p>
      ))}
    </div>
  );
}

export default Settings;
