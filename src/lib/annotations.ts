import type { Annotation } from '../stores/snipasteStore';

// 从 SnipasteOverlay 提取的共享绘制引擎：截图 overlay 与贴图窗口共用。
// 所有函数在当前 canvas 变换下工作（CSS 坐标），调用方负责设置变换。

export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = annotation.opacity ?? 1;

  switch (annotation.type) {
    case 'pen':
      drawPen(ctx, annotation);
      break;
    case 'line':
      drawLine(ctx, annotation);
      break;
    case 'arrow':
      drawArrow(ctx, annotation);
      break;
    case 'rectangle':
      drawRectangle(ctx, annotation);
      break;
    case 'text':
      drawText(ctx, annotation);
      break;
    case 'mosaic':
      drawMosaic(ctx, annotation);
      break;
    case 'highlighter':
      drawHighlighter(ctx, annotation);
      break;
    case 'blur':
      drawBlur(ctx, annotation);
      break;
  }

  ctx.restore();
}

// 画笔
function drawPen(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (!annotation.points || annotation.points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
  for (let i = 1; i < annotation.points.length; i++) {
    ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
  }
  ctx.stroke();
}

// 直线
function drawLine(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.endX === undefined || annotation.endY === undefined) return;
  ctx.beginPath();
  ctx.moveTo(annotation.x, annotation.y);
  ctx.lineTo(annotation.endX, annotation.endY);
  ctx.stroke();
}

// 箭头
function drawArrow(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.endX === undefined || annotation.endY === undefined) return;
  const headLength = 15;
  const dx = annotation.endX - annotation.x;
  const dy = annotation.endY - annotation.y;
  const angle = Math.atan2(dy, dx);

  ctx.beginPath();
  ctx.moveTo(annotation.x, annotation.y);
  ctx.lineTo(annotation.endX, annotation.endY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(annotation.endX, annotation.endY);
  ctx.lineTo(
    annotation.endX - headLength * Math.cos(angle - Math.PI / 6),
    annotation.endY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(annotation.endX, annotation.endY);
  ctx.lineTo(
    annotation.endX - headLength * Math.cos(angle + Math.PI / 6),
    annotation.endY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

// 矩形
function drawRectangle(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.width === undefined || annotation.height === undefined) return;
  ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
}

// 文字
function drawText(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (!annotation.text) return;
  ctx.font = '16px sans-serif';
  ctx.fillText(annotation.text, annotation.x, annotation.y);
}

// 马赛克（色块近似）
function drawMosaic(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.width === undefined || annotation.height === undefined) return;
  const blockSize = 10;
  ctx.fillStyle = annotation.color;
  for (let x = annotation.x; x < annotation.x + annotation.width; x += blockSize) {
    for (let y = annotation.y; y < annotation.y + annotation.height; y += blockSize) {
      ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
    }
  }
}

// 荧光笔
function drawHighlighter(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (!annotation.points || annotation.points.length < 2) return;
  ctx.save();
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
  for (let i = 1; i < annotation.points.length; i++) {
    ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// 模糊（像素化；注意 getImageData 不受变换影响，需设备像素坐标）
export function drawBlur(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.width === undefined || annotation.height === undefined) return;
  const w = Math.max(1, Math.round(annotation.width));
  const h = Math.max(1, Math.round(annotation.height));
  const imageData = ctx.getImageData(Math.round(annotation.x), Math.round(annotation.y), w, h);
  const pixelSize = 8;
  for (let y = 0; y < h; y += pixelSize) {
    for (let x = 0; x < w; x += pixelSize) {
      const i = (y * w + x) * 4;
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(annotation.x + x, annotation.y + y, pixelSize, pixelSize);
    }
  }
}

// 检查点是否在标注内（从后向前，后绘制的在上面）
export function hitTestAnnotation(annotations: Annotation[], x: number, y: number): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    const padding = 5;
    if (a.width !== undefined && a.height !== undefined) {
      const minX = Math.min(a.x, a.x + a.width) - padding;
      const maxX = Math.max(a.x, a.x + a.width) + padding;
      const minY = Math.min(a.y, a.y + a.height) - padding;
      const maxY = Math.max(a.y, a.y + a.height) + padding;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return a;
    } else if (a.endX !== undefined && a.endY !== undefined) {
      const minX = Math.min(a.x, a.endX) - padding;
      const maxX = Math.max(a.x, a.endX) + padding;
      const minY = Math.min(a.y, a.endY) - padding;
      const maxY = Math.max(a.y, a.endY) + padding;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return a;
    } else if (a.type === 'text') {
      const textWidth = (a.text?.length || 5) * 10;
      const textHeight = 20;
      if (x >= a.x - padding && x <= a.x + textWidth + padding &&
          y >= a.y - textHeight - padding && y <= a.y + padding) return a;
    } else if (a.points && a.points.length > 0) {
      for (const p of a.points) {
        if (Math.abs(x - p.x) < padding + 5 && Math.abs(y - p.y) < padding + 5) return a;
      }
    }
  }
  return null;
}

// 获取调整手柄位置
export function getResizeHandles(annotation: Annotation): { id: string; x: number; y: number }[] {
  if (annotation.width === undefined || annotation.height === undefined) return [];
  const x = annotation.x;
  const y = annotation.y;
  const w = annotation.width;
  const h = annotation.height;
  return [
    { id: 'nw', x, y },
    { id: 'ne', x: x + w, y },
    { id: 'sw', x, y: y + h },
    { id: 'se', x: x + w, y: y + h },
  ];
}
