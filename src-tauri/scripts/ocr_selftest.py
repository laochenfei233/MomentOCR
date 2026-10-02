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

# 字体按平台找候选：Windows / macOS / 常见 Linux 发行版各列几个。
# Linux 精简容器里常常没有中文字体，那时就只验英文——识别通路本身与字体无关。
LATIN_FONTS = (
    r"C:\Windows\Fonts\arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
)
CJK_FONTS = (
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
)


def _pick(candidates):
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _load_font(path, size):
    """取一个字号可用的字体；连候选都没有时退到 Pillow 自带字体（只有西文）。"""
    from PIL import ImageFont

    if path is not None:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


def make_image(path):
    """画一张中英混排的图，返回必须命中的片段。

    英文能验证空格，中文能验证字符表加载；没找到中文字体就不画第二行。
    """
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (760, 190), "white")
    draw = ImageDraw.Draw(img)
    draw.text((30, 40), "Hello Moment Self Check",
              font=_load_font(_pick(LATIN_FONTS), 34), fill="black")

    cjk_path = _pick(CJK_FONTS)
    if cjk_path is None:
        img.save(path)
        return ("Moment",)

    draw.text((30, 110), "须臾 OCR 自检", font=_load_font(cjk_path, 34), fill="black")
    img.save(path)
    return ("Moment", "须臾")


def main():
    ocr_text.configure_stdout()
    with tempfile.TemporaryDirectory(prefix="momentocr-selftest-") as tmp:
        image = os.path.join(tmp, "selftest.png")
        expected = make_image(image)
        result = ocr_recognize(image)

    if not result.get("success"):
        print(json.dumps(result, ensure_ascii=False))
        return

    text = result.get("data", "")
    missing = [word for word in expected if word not in text]
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
