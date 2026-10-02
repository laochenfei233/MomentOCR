// 由 src-tauri/icons/icon.svg 生成各尺寸 PNG，并输出预览图到 docs/icon-preview/。
//
// 两套几何：
//   · 满版（Windows / Linux）：图形几乎占满画布
//   · macOS：按 Apple 网格留白约 19.5%（图形占 80.5%），只有 icns 用这套
// 每个尺寸都从矢量直接栅格化，不走「大图缩到底」那条路，小尺寸才不会糊。
//
// 用法：node scripts/build-icons.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const iconsDir = join(root, 'src-tauri', 'icons');
const previewDir = join(root, 'docs', 'icon-preview');
const source = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

/// 直接拉起可执行文件（不走 shell）：路径里的空格不会被二次解释
function run(command, args) {
  try {
    execFileSync(command, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    if (err.stdout) console.error(err.stdout);
    if (err.stderr) console.error(err.stderr);
    throw new Error(`命令执行失败：${command} ${args.join(' ')}`);
  }
}

/** 小于这个尺寸就渲染无指针版本：16/24px 上指针只会糊成脏点 */
const HANDS_MIN_SIZE = 32;
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** macOS 图标要在画布上留白（824/1024 ≈ 80.5%），换 viewBox 最省事：图形等比例缩小并居中 */
const MAC_VIEWBOX = '-62 -62 636 636';

function variantFor(size, mac) {
  let svg = mac ? source.replace('viewBox="0 0 512 512"', `viewBox="${MAC_VIEWBOX}"`) : source;
  if (size < HANDS_MIN_SIZE) {
    // 去掉指针后把圆心放大顶住画面；两处都按标记整体替换，不靠猜字符串
    svg = svg
      .replace(/<!-- hands:start -->[\s\S]*?<!-- hands:end -->/, '')
      .replace(
        /<!-- dot:start -->[\s\S]*?<!-- dot:end -->/,
        '<circle cx="256" cy="256" r="34" fill="#007AFF"/>',
      );
  }
  return svg;
}

async function render(size, mac) {
  return sharp(Buffer.from(variantFor(size, mac)), { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
}

mkdirSync(previewDir, { recursive: true });

const frames = {};
for (const size of SIZES) {
  frames[size] = await render(size, false);
  writeFileSync(join(previewDir, `icon-${size}.png`), frames[size]);
  writeFileSync(join(previewDir, `mac-${size}.png`), await render(size, true));
}

// 应用图标：Windows/Linux 用满版几何
writeFileSync(join(iconsDir, '32x32.png'), frames[32]);
writeFileSync(join(iconsDir, '128x128.png'), frames[128]);
writeFileSync(join(iconsDir, '128x128@2x.png'), frames[256]);
writeFileSync(join(iconsDir, 'icon.png'), frames[512]);
writeFileSync(join(iconsDir, 'icon-1024.png'), frames[1024]);
// 应用内 Logo 走 public/ 目录，保持与图标同源
copyFileSync(join(iconsDir, 'icon.png'), join(root, 'public', 'icon.png'));

// ICO 用满版帧拼装；ICNS 用 mac 留白帧拼装（Apple 网格）
run(process.env.MIMO_PYTHON || 'python', [join(here, 'assemble-icons.py')]);

console.log('图标构建完成：src-tauri/icons + public/icon.png + docs/icon-preview');
