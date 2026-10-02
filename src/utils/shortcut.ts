/**
 * 全局快捷键组合串的校验、归一化与显示。
 *
 * 组合串格式与 tauri-plugin-global-shortcut 的解析器（global-hotkey）保持一致：
 * 修饰键在前、主键在最后，例如 `CmdOrCtrl+Shift+S`、`Alt+A`。空串表示「未启用」。
 *
 * 这里的校验只做一件事：**不让本应用注册会抢走其他软件按键的组合**。
 * 全局快捷键一旦注册，系统会把该组合从所有软件手上截走；若抢到的是别人的
 * 「退出 / 关闭」键（Alt+F4、Ctrl+Q、Ctrl+W 之类），用户就会觉得其他软件坏掉了。
 */

export type ShortcutAction = 'screenshot' | 'copy' | 'translate';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  screenshot: 'CmdOrCtrl+Shift+S',
  copy: 'CmdOrCtrl+Shift+C',
  translate: 'CmdOrCtrl+Shift+T',
};

export interface ShortcutRegistration {
  action: string;
  ok: boolean;
  error?: string | null;
}

export const isMacPlatform = () => navigator.platform.includes('Mac');

const MODIFIER_ALIASES: Record<string, 'CmdOrCtrl' | 'Shift' | 'Alt' | 'Super'> = {
  CMDORCTRL: 'CmdOrCtrl',
  CMDORCONTROL: 'CmdOrCtrl',
  COMMANDORCONTROL: 'CmdOrCtrl',
  COMMANDORCTRL: 'CmdOrCtrl',
  CONTROL: 'CmdOrCtrl',
  CTRL: 'CmdOrCtrl',
  SHIFT: 'Shift',
  ALT: 'Alt',
  OPTION: 'Alt',
  SUPER: 'Super',
  COMMAND: 'Super',
  CMD: 'Super',
  WIN: 'Super',
  META: 'Super',
};

const MODIFIER_ORDER = ['CmdOrCtrl', 'Shift', 'Alt', 'Super'];

/** 主键别名 → 归一化名字，两边写法不同但指向同一个键。 */
const KEY_ALIASES: Record<string, string> = {
  ESC: 'ESCAPE',
  UP: 'ARROWUP',
  DOWN: 'ARROWDOWN',
  LEFT: 'ARROWLEFT',
  RIGHT: 'ARROWRIGHT',
  '`': 'BACKQUOTE',
  '\\': 'BACKSLASH',
  '[': 'BRACKETLEFT',
  ']': 'BRACKETRIGHT',
  ',': 'COMMA',
  '=': 'EQUAL',
  '-': 'MINUS',
  '.': 'PERIOD',
  "'": 'QUOTE',
  ';': 'SEMICOLON',
  '/': 'SLASH',
};

const SUPPORTED_KEYS = new Set<string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NUMPAD${i}`),
  'BACKQUOTE', 'BACKSLASH', 'BRACKETLEFT', 'BRACKETRIGHT', 'COMMA', 'EQUAL', 'MINUS',
  'PERIOD', 'QUOTE', 'SEMICOLON', 'SLASH', 'BACKSPACE', 'CAPSLOCK', 'ENTER', 'SPACE',
  'TAB', 'DELETE', 'END', 'HOME', 'INSERT', 'PAGEDOWN', 'PAGEUP', 'PRINTSCREEN',
  'SCROLLLOCK', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'ARROWUP', 'NUMLOCK', 'ESCAPE',
  'PAUSE', 'NUMPADADD', 'NUMPADDECIMAL', 'NUMPADDIVIDE', 'NUMPADENTER', 'NUMPADEQUAL',
  'NUMPADMULTIPLY', 'NUMPADSUBTRACT',
]);

/** 点下去就会退出 / 关闭的键，抢走它们最招人烦。 */
const RESERVED_COMBOS: Record<string, string> = {
  'Alt+F4': '关闭当前窗口 / 退出程序',
  'CmdOrCtrl+Q': '多数软件的「退出」',
  'CmdOrCtrl+Shift+Q': '多数软件的「退出」',
  'CmdOrCtrl+W': '多数软件的「关闭窗口 / 关闭标签页」',
  'CmdOrCtrl+Shift+W': '多数软件的「关闭窗口 / 关闭标签页」',
  'CmdOrCtrl+Esc': 'Windows 开始菜单',
  'CmdOrCtrl+Shift+Esc': 'Windows 任务管理器',
  'CmdOrCtrl+Alt+DELETE': 'Windows 安全界面',
  'Alt+TAB': '切换窗口',
  'Alt+ESCAPE': '切换窗口',
};

function normalizeKeyToken(token: string): string | null {
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  const alias = KEY_ALIASES[upper];
  if (alias) return alias;
  const letter = /^KEY([A-Z])$/.exec(upper);
  if (letter) return letter[1];
  const digit = /^DIGIT([0-9])$/.exec(upper);
  if (digit) return digit[1];
  return upper;
}

/**
 * 归一化组合串，用于比较：修饰键按固定顺序排列，主键统一写法。
 * 无法识别的写法返回 null。
 */
export function normalizeShortcut(combo: string): string | null {
  const tokens = combo.split('+').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const mods = new Set<string>();
  let key: string | null = null;
  for (const token of tokens) {
    const mod = MODIFIER_ALIASES[token.toUpperCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key) return null;
    key = normalizeKeyToken(token);
  }
  if (!key) return null;

  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...ordered, key].join('+');
}

/**
 * 校验组合串。返回 null 表示可用，否则返回拒绝原因（中文，可直接展示给用户）。
 * 空串表示未启用，属于合法状态。
 */
export function validateShortcut(combo: string): string | null {
  if (!combo.trim()) return null;

  const canonical = normalizeShortcut(combo);
  if (!canonical) return '这个组合无法识别，请重新录制';

  const [key] = canonical.split('+').slice(-1);
  const mods = canonical.split('+').slice(0, -1);

  if (!SUPPORTED_KEYS.has(key)) return '这个按键不支持，请换一个组合';

  const reserved = RESERVED_COMBOS[canonical];
  if (reserved) return `「${reserved}」被其他软件占用，抢走它会让人以为其他软件坏了`;

  if (key === 'ESCAPE') return 'Esc 是通用的「取消 / 退出」键，不能独占';

  if (!isMacPlatform() && mods.includes('Super')) {
    return 'Win 组合键由 Windows 系统保留，无法注册，请改用 Ctrl / Alt / Shift';
  }

  // 不带修饰键的字母、数字、方向键等会独占键盘上的这个键，只有 F1~F24 例外
  if (mods.length === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return '必须配合 Ctrl / Alt / Shift 使用，否则这个键会被本应用独占';
  }

  return null;
}

/** 纯修饰键（或输入法合成键）本身不能作为快捷键，录制时应继续等待主键。 */
export function isModifierKeyEvent(e: KeyboardEvent): boolean {
  return ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process'].includes(e.key);
}

/**
 * 从键盘事件生成组合串。返回 { error } 表示这个组合不该被注册，原因可直接展示。
 */
export function shortcutFromKeyboardEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): { combo: string } | { error: string } {
  const mac = isMacPlatform();
  const mods: string[] = [];
  if (e.ctrlKey || (mac && e.metaKey)) mods.push('CmdOrCtrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  if (!mac && e.metaKey) mods.push('Super');

  const key = keyTokenFromEvent(e);
  if (!key) return { error: '这个按键不支持作为快捷键，请换一个组合' };

  const combo = [...mods, key].join('+');
  const issue = validateShortcut(combo);
  return issue ? { error: issue } : { combo };
}

function keyTokenFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code'>,
): string | null {
  // 字母/数字优先用物理键位 code，避免 Shift 之后 e.key 变成 '!' '@' 这类符号
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return code.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  const named: Record<string, string> = {
    ' ': 'SPACE',
    Escape: 'ESCAPE',
    Enter: 'ENTER',
    Tab: 'TAB',
    Backspace: 'BACKSPACE',
    Delete: 'DELETE',
    Insert: 'INSERT',
    Home: 'HOME',
    End: 'END',
    PageUp: 'PAGEUP',
    PageDown: 'PAGEDOWN',
    ArrowUp: 'ARROWUP',
    ArrowDown: 'ARROWDOWN',
    ArrowLeft: 'ARROWLEFT',
    ArrowRight: 'ARROWRIGHT',
    PrintScreen: 'PRINTSCREEN',
  };
  if (named[e.key]) return named[e.key];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key;
  if (e.key.length === 1) return normalizeKeyToken(e.key);
  return null;
}

/** 显示用格式：macOS 用符号，Windows 用文字。 */
export function formatShortcut(combo: string): string {
  if (!combo.trim()) return '未启用';

  const mac = isMacPlatform();
  const labels: Record<string, string> = {
    CMDORCTRL: mac ? '⌘' : 'Ctrl',
    SHIFT: mac ? '⇧' : 'Shift',
    ALT: mac ? '⌥' : 'Alt',
    SUPER: mac ? '⌘' : 'Win',
    ESCAPE: 'Esc',
    ARROWUP: '↑',
    ARROWDOWN: '↓',
    ARROWLEFT: '←',
    ARROWRIGHT: '→',
    SPACE: 'Space',
    PAGEUP: 'PgUp',
    PAGEDOWN: 'PgDn',
  };

  return combo
    .split('+')
    .map((token) => labels[token.toUpperCase()] ?? token)
    .join(mac ? ' ' : ' + ');
}
