"""
须臾OCR - RapidOCR 文字识别脚本
支持 rapidocr_onnxruntime (2.x) / rapidocr (3.x) API
"""

import sys
import json


def _load_engine():
    """加载 RapidOCR 引擎，兼容 2.x 与 3.x 包名"""
    try:
        from rapidocr_onnxruntime import RapidOCR
        return RapidOCR()
    except ImportError:
        from rapidocr import RapidOCR
        return RapidOCR()


def ocr_recognize(image_path):
    """使用RapidOCR识别图片中的文字"""
    try:
        ocr = _load_engine()
        result, _elapse = ocr(image_path)

        # result: [[box, text, score], ...]，未识别到时为 None
        if result:
            texts = [line[1] for line in result if line and len(line) >= 2 and line[1]]
            if texts:
                return {
                    'success': True,
                    'data': '\n'.join(texts),
                    'confidence': 0.95,
                    'language': 'ch'
                }

        return {
            'success': False,
            'data': '',
            'error': '未识别到文字',
            'confidence': 0,
            'language': 'ch'
        }
    except Exception as e:
        return {
            'success': False,
            'data': '',
            'error': str(e),
            'confidence': 0,
            'language': 'ch'
        }


def main():
    if len(sys.argv) < 2:
        result = {'success': False, 'data': '', 'error': '请提供图片路径'}
        print(json.dumps(result))
        sys.stdout.flush()
        return

    image_path = sys.argv[1]
    result = ocr_recognize(image_path)
    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
