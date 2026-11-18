import type { ReactNode } from 'react';

// 与主窗口工具栏同款的线条图标（Feather 风格：24 viewBox、2px 描边、圆角端点、currentColor）。
// 路径语义参考 Feather/lucide 与 iconfont 线性风格，全部不填充。

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export const IconPen = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </Icon>
);

export const IconLine = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <line x1="5" y1="19" x2="19" y2="5" />
  </Icon>
);

export const IconArrow = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Icon>
);

export const IconRect = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
  </Icon>
);

export const IconHighlighter = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4l8 8Z" />
  </Icon>
);

export const IconText = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </Icon>
);

export const IconMosaic = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
  </Icon>
);

export const IconBlur = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
  </Icon>
);

export const IconSave = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Icon>
);

export const IconCopy = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);

export const IconPin = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
  </Icon>
);

export const IconScanText = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="8" y1="16" x2="13" y2="16" />
  </Icon>
);

export const IconScan = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </Icon>
);

export const IconX = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Icon>
);

export const IconRotateCcw = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </Icon>
);

export const IconRotateCw = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Icon>
);

export const IconFlipH = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 3v18" strokeDasharray="2 3" />
    <path d="M8 8l-4 4 4 4" />
    <path d="M16 8l4 4-4 4" />
  </Icon>
);

export const IconFlipV = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 12h18" strokeDasharray="2 3" />
    <path d="M8 8l4-4 4 4" />
    <path d="M8 16l4 4 4-4" />
  </Icon>
);

export const IconThrough = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z" />
    <line x1="15" y1="15" x2="21" y2="21" />
  </Icon>
);

export const IconPipette = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m2 22 1-1h3l9-9" />
    <path d="M3 21v-3l9-9" />
    <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
  </Icon>
);
