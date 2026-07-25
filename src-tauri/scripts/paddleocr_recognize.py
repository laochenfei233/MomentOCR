"""
须臾OCR - PaddleOCR 文字识别脚本
从Tauri接收图片路径，执行OCR识别，返回识别结果
"""

import sys
import json
from paddleocr import PaddleOCR

def ocr_recognize(image_path):
    """使用PaddleOCR识别图片中的文字"""
    try:
        # 初始化OCR引擎
        ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
        
        # 执行识别
        result = ocr.ocr(image_path, cls=True)
        
        # 解析结果
        if result and len(result) > 0 and len(result[0]) > 0:
            # 提取所有识别到的文字
            texts = []
            for line in result[0]:
                if line and len(line) >= 2:
                    text = line[1][0]  # 文字内容
                    confidence = line[1][1]  # 置信度
                    texts.append(text)
            
            return {
                'success': True,
                'data': '\n'.join(texts),
                'confidence': 0.95,
                'language': 'ch'
            }
        else:
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
