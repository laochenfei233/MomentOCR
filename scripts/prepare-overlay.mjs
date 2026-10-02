// 构建前准备截图覆盖层产物（各平台各打一份，因为 PyInstaller 不能交叉编译）。
//
// 产物随安装包分发，用户零下载：Windows / macOS / Linux 都走这条路。
// 打不出来时不要静默跳过——那会让安装包里的截图功能变成需要用户自备 Python，
// 所以这里直接让构建失败并给出补救命令。
//
// 产物已是最新就跳过，避免每次构建都重跑一分钟的 PyInstaller。
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32' ? 'screenshot_overlay.exe' : 'screenshot_overlay';
const target = join(root, 'src-tauri', 'binaries', 'screenshot_overlay', executable);
const sources = [
  join(root, 'src-tauri', 'scripts', 'screenshot_overlay.py'),
  join(root, 'scripts', 'build-overlay.py'),
];

if (existsSync(target) && sources.every((s) => statSync(s).mtimeMs <= statSync(target).mtimeMs)) {
  console.log('[overlay] 已有最新产物，跳过打包');
  process.exit(0);
}

/// 目标架构：CI 由 workflow 显式给出；本地 tauri build 时 Tauri 会注入 TAURI_ENV_ARCH。
/// 传下去让 build-overlay.py 校验产物架构，避免「arm64 机器打出 x64 覆盖层」这类事故。
const expectedArch = process.env.MOMENTOCR_OVERLAY_ARCH || process.env.TAURI_ENV_ARCH || '';

/// 目标架构与当前进程架构不同时，必须让整条工具链按目标架构跑。
/// macOS 上 arm64 机器出 Intel 包就是这种情况：setup-python 给的「x64」解释器实际以 arm64
/// 运行，pip 会装 arm64 的 PyQt5 wheel，PyInstaller 也按 arm64 出包——用户装上是「CPU 不匹配」。
function crossArchPrefix() {
  const want = expectedArch === 'aarch64' ? 'arm64' : expectedArch;
  const host = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  if (process.platform === 'darwin' && want && want !== host) {
    return ['arch', [`-${want}`]];
  }
  return null;
}

const prefix = crossArchPrefix();
if (prefix) {
  console.log(`[overlay] 目标架构 ${expectedArch} 与本机 ${process.arch} 不同，用 ${prefix[0]} ${prefix[1][0]} 跑工具链`);
}

/// 找一个装了打包工具的 Python（必须是用户环境里那个，不是随便哪个解释器）
function findPython() {
  const candidates = [
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
    { cmd: 'py', args: ['-3'] },
  ];
  for (const candidate of candidates) {
    const cmd = prefix ? prefix[0] : candidate.cmd;
    const args = prefix ? [...prefix[1], candidate.cmd, ...candidate.args] : candidate.args;
    try {
      execFileSync(cmd, [...args, '-c', 'import PyInstaller, PyQt5'], { stdio: 'ignore' });
      return { cmd, args };
    } catch {
      // 换下一个候选
    }
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error('[overlay] 找不到带 PyInstaller 与 PyQt5 的 Python，无法打包自带覆盖层。');
  console.error('[overlay] 先执行：pip install pyinstaller PyQt5');
  process.exit(1);
}

console.log(`[overlay] 用 ${python.cmd} 打包截图覆盖层（${process.platform}，目标架构 ${expectedArch || '本机'}）…`);
try {
  execFileSync(python.cmd, [...python.args, join(root, 'scripts', 'build-overlay.py')], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, MOMENTOCR_OVERLAY_ARCH: expectedArch },
  });
} catch {
  console.error('[overlay] 打包失败，请看上面的 PyInstaller 输出。');
  process.exit(1);
}
