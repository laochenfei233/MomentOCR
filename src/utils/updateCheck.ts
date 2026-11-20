// 「检查更新」共用逻辑：主窗口菜单与设置页两个入口。
// 仓库 slug 曾经写错（chenfei-xy），导致 API 永远 404
const RELEASE_API = 'https://api.github.com/repos/laochenfei233/MomentOCR/releases/latest';

export async function fetchLatestRelease() {
  try {
    const resp = await fetch(RELEASE_API);
    if (resp.ok) return await resp.json();
  } catch { /* 直连失败或被限流，走镜像 */ }
  const resp = await fetch(`https://gh-proxy.com/${RELEASE_API}`);
  if (!resp.ok) throw new Error('无可用更新');
  return resp.json();
}

// 逐段数值比较，字符串比较会把旧版也判成「有更新」
export function cmpVersion(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
