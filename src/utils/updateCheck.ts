// 「检查更新」共用逻辑：主窗口菜单与设置页两个入口。
// 仓库 slug 曾经写错（chenfei-xy），导致 API 永远 404
const RELEASE_API = 'https://api.github.com/repos/laochenfei233/MomentOCR/releases/latest';
const RELEASE_PAGE = 'https://github.com/laochenfei233/MomentOCR/releases/tag';

export interface LatestRelease {
  tagName: string;
  // 发布页 URL 一律本地拼接，不消费 API 响应里的 html_url：
  // gh-proxy 回退返回的元数据不可信，用它导航等于把钓鱼页挂到应用更新流里
  // （审计 run-1: update-check.gh-proxy-json-into-shell-open）
  url: string;
}

// tag 必须是严格 semver（可带 v 前缀）；镜像给的垃圾值一律按「无更新」处理
function parseTag(tagName: unknown): string | null {
  if (typeof tagName !== 'string') return null;
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(tagName.trim());
  return m ? m[1] : null;
}

async function fetchLatestReleaseRaw(): Promise<any> {
  try {
    const resp = await fetch(RELEASE_API);
    if (resp.ok) return await resp.json();
  } catch { /* 直连失败或被限流，走镜像 */ }
  const resp = await fetch(`https://gh-proxy.com/${RELEASE_API}`);
  if (!resp.ok) throw new Error('无可用更新');
  return resp.json();
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const data = await fetchLatestReleaseRaw();
  const tagName = parseTag(data?.tag_name);
  if (!tagName) throw new Error('无可用更新');
  return { tagName, url: `${RELEASE_PAGE}/v${tagName}` };
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
