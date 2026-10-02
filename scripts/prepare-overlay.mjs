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

/// 找一个装了打包工具的 Python（必须是用户环境里那个，不是随便哪个解释器）
function findPython() {
  const candidates = [
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
    { cmd: 'py', args: ['-3'] },
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate.cmd, [...candidate.args, '-c', 'import PyInstaller, PyQt5'], {
        stdio: 'ignore',
      });
      return candidate;
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

console.log(`[overlay] 用 ${python.cmd} 打包截图覆盖层（${process.platform}）…`);
try {
  execFileSync(python.cmd, [...python.args, join(root, 'scripts', 'build-overlay.py')], {
    stdio: 'inherit',
    cwd: root,
  });
} catch {
  console.error('[overlay] 打包失败，请看上面的 PyInstaller 输出。');
  process.exit(1);
}
