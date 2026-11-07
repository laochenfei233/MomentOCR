// 共享取色器：截图 overlay（C 键）与贴图窗口（Alt 键）共用。
// 背景图为物理像素；cssX/cssY 为 CSS 坐标，内部按 dpr 映射。

export interface ColorInfo {
  hex: string;
  r: number;
  g: number;
  b: number;
}

const sourceCache = new WeakMap<HTMLImageElement, { src: string; canvas: HTMLCanvasElement; data: ImageData }>();

function getSource(img: HTMLImageElement): { canvas: HTMLCanvasElement; data: ImageData } {
  // 同一 <img> 节点会随历史回放/续拍换 src，缓存必须按 src 失效
  const cached = sourceCache.get(img);
  if (cached && cached.src === img.src) {
    return cached;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const entry = { src: img.src, canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  sourceCache.set(img, entry);
  return entry;
}

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

// 读取 CSS 坐标处像素颜色
export function pickColorFromImage(
  img: HTMLImageElement,
  cssX: number,
  cssY: number,
  dpr: number
): ColorInfo | null {
  const { data } = getSource(img);
  const px = Math.round(cssX * dpr);
  const py = Math.round(cssY * dpr);
  if (px < 0 || py < 0 || px >= data.width || py >= data.height) return null;
  const i = (py * data.width + px) * 4;
  const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
  return { hex: toHex(r, g, b), r, g, b };
}

// 放大镜：在 ctx 上绘制光标周围像素网格 + 中心框 + 颜色信息
export function drawLoupe(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cssX: number,
  cssY: number,
  opts: { dpr: number; cssW: number; cssH: number; grid?: number; zoom?: number }
) {
  const grid = opts.grid ?? 15;      // 网格像素数（奇数）
  const zoom = opts.zoom ?? 10;      // 每源像素的屏幕像素
  const dpr = opts.dpr;
  const half = Math.floor(grid / 2);

  const { data } = getSource(img);
  const srcX = Math.round(cssX * dpr);
  const srcY = Math.round(cssY * dpr);
  const at = (sx: number, sy: number): [number, number, number] | null => {
    if (sx < 0 || sy < 0 || sx >= data.width || sy >= data.height) return null;
    const i = (sy * data.width + sx) * 4;
    return [data.data[i], data.data[i + 1], data.data[i + 2]];
  };

  // 放大镜窗体（防越界翻转）
  const boxW = grid * zoom;
  const boxH = boxW + 34; // 底部信息条
  const gap = 16;
  let bx = Math.round(cssX) + gap;
  let by = Math.round(cssY) + gap;
  if (bx + boxW > opts.cssW - 8) bx = Math.round(cssX) - gap - boxW;
  if (by + boxH > opts.cssH - 8) by = Math.round(cssY) - gap - boxH;

  ctx.save();

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();

  // 像素网格（越界画黑）
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const c = at(srcX - half + gx, srcY - half + gy);
      ctx.fillStyle = c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#111';
      ctx.fillRect(bx + gx * zoom, by + gy * zoom, zoom, zoom);
    }
  }

  // 中心像素描边
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + half * zoom + 0.5, by + half * zoom + 0.5, zoom - 1, zoom - 1);

  // 信息条：色块 + HEX + RGB
  const info = pickColorFromImage(img, cssX, cssY, dpr);
  if (info) {
    ctx.fillStyle = info.hex;
    ctx.fillRect(bx + 8, by + boxW + 8, 18, 18);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(bx + 8.5, by + boxW + 8.5, 17, 17);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${info.hex}  ${info.r},${info.g},${info.b}`, bx + 32, by + boxW + 17);
  }

  ctx.restore();
}
