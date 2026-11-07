import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PinSummary {
  label: string;
  visible: boolean;
  width: number;
  height: number;
}

/// Rust snipaste_list_pins 返回：[(label, PinData)]
type PinList = [string, { visible: boolean; width: number; height: number }][];

/// 主窗口的贴图恢复面板：列出所有贴图（含已隐藏），支持显示/关闭
export default function PinPanel() {
  const [pins, setPins] = useState<PinSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<PinList>('snipaste_list_pins');
      setPins(list.map(([label, d]) => ({ label, visible: d.visible, width: d.width, height: d.height })));
    } catch {
      setPins([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const setVisible = async (label: string, visible: boolean) => {
    try {
      await invoke('snipaste_set_pin_visible', { label, visible });
      await refresh();
    } catch (err) {
      console.error('set pin visible failed:', err);
    }
  };

  const closePin = async (label: string) => {
    try {
      await invoke('snipaste_close_pin', { label });
      await refresh();
    } catch (err) {
      console.error('close pin failed:', err);
    }
  };

  return (
    <div style={{ borderBottom: '0.5px solid var(--system-gray5)', background: 'var(--system-bg)', padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pins.length ? 6 : 0 }}>
        <span style={{ fontSize: 12, color: 'var(--system-gray)', fontWeight: 500 }}>贴图（{pins.length}）</span>
        <button
          onClick={refresh}
          style={{ border: 'none', background: 'transparent', fontSize: 11, color: '#007AFF', cursor: 'pointer', padding: 0 }}
        >
          刷新
        </button>
      </div>
      {pins.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--system-gray)' }}>暂无贴图 · 截图后选择"贴图"可钉在屏幕上</div>
      ) : (
        pins.map((p) => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ fontSize: 12 }}>
              {p.label.replace('pin-', '贴图 ')} · {Math.round(p.width)}×{Math.round(p.height)}
              {!p.visible && <span style={{ color: '#FF9500', marginLeft: 6 }}>已隐藏</span>}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setVisible(p.label, !p.visible)}
                style={{ border: 'none', background: 'transparent', fontSize: 11, color: '#007AFF', cursor: 'pointer', padding: 0 }}
              >
                {p.visible ? '隐藏' : '显示'}
              </button>
              <button
                onClick={() => closePin(p.label)}
                style={{ border: 'none', background: 'transparent', fontSize: 11, color: '#FF3B30', cursor: 'pointer', padding: 0 }}
              >
                关闭
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
