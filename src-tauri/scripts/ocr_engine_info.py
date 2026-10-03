"""
须臾OCR - 本机包版本探测

用 importlib.metadata 查已安装分发包的版本，不真正 import 引擎：
既快，又不会被 paddle / onnxruntime 加载时的日志和告警污染输出。

用法：python ocr_engine_info.py [包名 ...]
不带参数时探测 OCR 相关包。
"""

import json
import sys
from importlib.metadata import version

DEFAULT_PACKAGES = ("rapidocr", "onnxruntime", "paddleocr", "paddlepaddle")


def installed_version(package):
    # 没装（PackageNotFoundError）和探测本身出错，对调用方都一样：当作没有版本
    try:
        return version(package)
    except Exception:
        return ""


def main():
    packages = sys.argv[1:] or list(DEFAULT_PACKAGES)
    print(json.dumps({p: installed_version(p) for p in packages}))


if __name__ == "__main__":
    main()
