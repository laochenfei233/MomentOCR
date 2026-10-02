"""
须臾OCR - RapidOCR 文字识别脚本

引擎优先级：
  1. rapidocr（3.x）：官方现役包（PyPI `pip install -U rapidocr`），PP-OCRv6 模型，
     英文空格完整，模型随包内置无需下载。
  2. rapidocr_onnxruntime（2.x）：已停止更新的旧包，仅作兼容；其 PP-OCRv4 模型
     会吞掉英文空格，识别纯英文时请升级到 3.x。

两个版本的返回结构不同（3.x 返回 RapidOCROutput 对象，2.x 返回 (result, elapse)），
这里统一成一串 (box, text) 后交给 ocr_text.merge_boxes 整理成行。
"""

import json
import logging
import sys

import ocr_text  # 与脚本同目录，随应用一起分发

logging.disable(logging.INFO)  # 引擎日志走 stderr，静音减少管道压力


def _load_engine():
    """返回 (引擎实例, 是否为已停更的旧包)。"""
    try:
        from rapidocr import RapidOCR
        return RapidOCR(), False
    except ImportError:
        from rapidocr_onnxruntime import RapidOCR
        return RapidOCR(), True


def _collect(engine, image_path):
    """把两种返回结构统一成 [(box, text), ...]。"""
    output = engine(image_path)
    if hasattr(output, "txts"):
        # 3.x: RapidOCROutput(boxes=..., txts=..., scores=...)
        boxes = output.boxes if output.boxes is not None else []
        txts = output.txts if output.txts is not None else []
        return [(box, text) for box, text in zip(boxes, txts) if text]
    # 2.x: (result, elapse)，result 为 [[box, text, score], ...]
    result, _elapse = output
    return [(line[0], line[1]) for line in (result or [])
            if line and len(line) >= 2 and line[1]]


def ocr_recognize(image_path):
    """使用 RapidOCR 识别图片中的文字。"""
    try:
        engine, legacy = _load_engine()
        text = ocr_text.merge_boxes(_collect(engine, image_path))
        if text:
            return {
                "success": True,
                "data": text,
                "confidence": 0.95,
                "language": "ch",
                "engine": "rapidocr_onnxruntime" if legacy else "rapidocr",
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
