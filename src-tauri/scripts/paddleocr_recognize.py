"""
须臾OCR - PaddleOCR 文字识别脚本

同时兼容两代 API：
  1. PaddleOCR 3.x（`predict`，PP-OCRv5 模型）：推荐，英文空格完整。
     升级：pip install -U paddlepaddle paddleocr
  2. PaddleOCR 2.7.x（`ocr(..., cls=True)`）：旧版兼容，其 PP-OCRv4 模型
     会吞掉英文空格，识别纯英文时请升级到 3.x。

两代 API 用能力探测区分（2.x 的 PaddleOCR 没有 predict），不依赖版本号解析。
"""

import json
import logging
import sys

import ocr_text  # 与脚本同目录，随应用一起分发

logging.disable(logging.INFO)  # 引擎日志走 stderr，静音减少管道压力


def _load_engine():
    """返回 (引擎实例, 是否支持 3.x 的 predict 接口)。"""
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        raise RuntimeError(
            "未安装 PaddleOCR 引擎。应用内置的本地引擎只含 RapidOCR"
            "（PaddleOCR 需要 400MB+ 的 paddlepaddle，不随应用下载）"
        )
    if hasattr(PaddleOCR, "predict"):
        # 3.x 默认会跑文档方向分类与去扭曲，截图 OCR 用不上，关掉省时省模型
        return PaddleOCR(lang="ch", use_doc_orientation_classify=False,
                         use_doc_unwarping=False, use_textline_orientation=True), True
    return PaddleOCR(use_angle_cls=True, lang="ch", show_log=False), False


def _field(result, key):
    """paddlex 的结果对象既支持 result['x'] 也支持 result.x，两边都兜住。"""
    if hasattr(result, key):
        return getattr(result, key)
    if hasattr(result, "get"):
        return result.get(key)
    try:
        return result[key]
    except (TypeError, KeyError, IndexError):
        return None


def _collect(ocr, modern, image_path):
    """把两代 API 的返回结构统一成 [(box, text), ...]。"""
    items = []
    if modern:
        for page in ocr.predict(image_path) or []:
            texts = _field(page, "rec_texts") or []
            boxes = _field(page, "rec_polys") or _field(page, "dt_polys") or []
            items.extend(zip(boxes, texts))
        return items

    for page in ocr.ocr(image_path, cls=True) or []:
        for line in page or []:
            if line and len(line) >= 2:
                items.append((line[0], line[1][0]))
    return items


def ocr_recognize(image_path):
    """使用 PaddleOCR 识别图片中的文字。"""
    try:
        ocr, modern = _load_engine()
        text = ocr_text.merge_boxes(_collect(ocr, modern, image_path))
        if text:
            return {
                "success": True,
                "data": text,
                "confidence": 0.95,
                "language": "ch",
            }
        return {
            "success": False,
            "data": "",
            "error": "未识别到文字",
            "confidence": 0,
            "language": "ch",
        }
    except Exception as e:
        return {
            "success": False,
            "data": "",
            "error": str(e),
            "confidence": 0,
            "language": "ch",
        }


def main():
    ocr_text.configure_stdout()
    if len(sys.argv) < 2:
        result = {"success": False, "data": "", "error": "请提供图片路径"}
        print(json.dumps(result))
        sys.stdout.flush()
        return

    result = ocr_recognize(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
