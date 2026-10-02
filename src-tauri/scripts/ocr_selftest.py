"""
须臾OCR - 本地引擎自检

装完必须真跑一次识别，出字才算装好——只查 pip 返回码会漏掉「装上却没引擎后端」
这类半成品状态。用 PIL 现画一张中英混排的图，走和正式识别完全相同的代码路径。

输出一行 JSON：{"success": true, "data": "识别到的文字"} / {"success": false, "error": "..."}
"""

import json
import os
import sys
import tempfile

import ocr_text
from rapidocr_recognize import ocr_recognize

# 中英各留一个必须命中的片段：英文能验证空格，中文能验证字符表加载
EXPECTED = ("Moment", "须臾")


def make_image(path):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (760, 190), "white")
    draw = ImageDraw.Draw(img)
    latin = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 34)
    cjk_path = r"C:\Windows\Fonts\msyh.ttc"
    if not os.path.exists(cjk_path):
        cjk_path = r"C:\Windows\Fonts\simhei.ttf"
    cjk = ImageFont.truetype(cjk_path, 34)
    draw.text((30, 40), "Hello Moment Self Check", font=latin, fill="black")
    draw.text((30, 110), "须臾 OCR 自检", font=cjk, fill="black")
    img.save(path)


def main():
    ocr_text.configure_stdout()
    with tempfile.TemporaryDirectory(prefix="momentocr-selftest-") as tmp:
        image = os.path.join(tmp, "selftest.png")
        make_image(image)
        result = ocr_recognize(image)

    if not result.get("success"):
        print(json.dumps(result, ensure_ascii=False))
        return

    text = result.get("data", "")
    missing = [word for word in EXPECTED if word not in text]
    if missing:
        print(json.dumps({
            "success": False,
            "data": text,
            "error": "自检识别结果缺少：" + "、".join(missing),
        }, ensure_ascii=False))
        return

    print(json.dumps({"success": True, "data": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
