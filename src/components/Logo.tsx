interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 应用图标 Logo：直接使用软件真实图标 src-tauri/icons/icon.png
 * （通过 public/icon.png 由 Vite 提供服务）
 */
export function Logo({ size = 48, className, style }: LogoProps) {
  return (
    <img
      src="/icon.png"
      width={size}
      height={size}
      alt="须臾OCR"
      className={className}
      style={style}
      draggable={false}
    />
  );
}
