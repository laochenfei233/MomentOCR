// 从 src-tauri/icons/icon.svg 生成完整应用图标（PNG / ICO / ICNS）。
//
// 用法：node scripts/build-icons.mjs
//
// 为什么要自己渲染每个尺寸：把 1024 缩到 16 会让笔画糊成一团，
// 每个尺寸都从矢量直接栅格化才够锐利。24px 及以下还会去掉指针（见 icon.svg 注释）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const iconsDir = join(root, 'src-tauri', 'icons');
const previewDir = join(root, 'docs', 'icon-preview');
const svg = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

/** 小于这个尺寸就渲染无指针版本：16/24px 上指针只会糊成脏点 */
const HANDS_MIN_SIZE = 32;
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function variantFor(size) {
  if (size >= HANDS_MIN_SIZE) return svg;
  return svg
    .replace(/<!-- hands:start -->[\s\S]*?<!-- hands:end -->/, '')
    .replace('r="24"', 'r="30"');
}

async function render(size) {
  return sharp(Buffer.from(variantFor(size)), { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
}

/// 直接拉起可执行文件（不走 shell）：路径里的空格和 npx 垫片都不会被二次解释
function run(command, args) {
  try {
    execFileSync(command, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    // tauri / pillow 的报错都在子进程输出里，原样打出来才知道哪里错了
    if (err.stdout) console.error(err.stdout);
    if (err.stderr) console.error(err.stderr);
    throw new Error(`命令执行失败：${command} ${args.join(' ')}`);
  }
}

const frames = {};
for (const size of SIZES) frames[size] = await render(size);

mkdirSync(previewDir, { recursive: true });
for (const size of SIZES) writeFileSync(join(previewDir, `icon-${size}.png`), frames[size]);

// 交给 tauri 生成 icns（macOS 需要），顺带产出一份 ico 作为兜底
// 应用图标：用原生尺寸帧覆盖 tauri 缩放出来的版本
writeFileSync(join(iconsDir, '32x32.png'), frames[32]);
writeFileSync(join(iconsDir, '128x128.png'), frames[128]);
writeFileSync(join(iconsDir, '128x128@2x.png'), frames[256]);
writeFileSync(join(iconsDir, 'icon.png'), frames[512]);
writeFileSync(join(iconsDir, 'icon-1024.png'), frames[1024]);
// 应用内 Logo 走 public/ 目录，保持与图标同源
copyFileSync(join(iconsDir, 'icon.png'), join(root, 'public', 'icon.png'));

// ICO / ICNS 用各原生尺寸帧拼装
run(process.env.MIMO_PYTHON || 'python', [join(here, 'assemble-icons.py')]);

console.log('图标构建完成：src-tauri/icons + public/icon.png + docs/icon-preview');
