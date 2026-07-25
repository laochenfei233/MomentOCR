"""
须臾OCR - PaddleOCR 文字识别脚本
支持 PaddleOCR 2.7.x API
"""

import sys
import json
from paddleocr import PaddleOCR

def ocr_recognize(image_path):
    """使用PaddleOCR识别图片中的文字"""
    try:
        # PaddleOCR 2.7.x API
        ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
        
        # 执行识别
        result = ocr.ocr(image_path, cls=True)
        
        # 解析结果
        if result and len(result) > 0 and result[0]:
            texts = []
            for line in result[0]:
                if line and len(line) >= 2:
                    text = line[1][0]  # 文字内容
                    texts.append(text)
            
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
    print(json.dumps(result))
    sys.stdout.flush()

if __name__ == '__main__':
    main()