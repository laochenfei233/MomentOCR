"""
须臾OCR - OCR 结果整理

识别引擎吐出的是一个个独立的文本框：同一行常被切成好几个框，
英文词与词之间的空格也并不可靠（PP-OCRv4 系模型会整段吞掉空格）。
直接按框换行，英文就会变成 "HelloWorldfromMomentOCR" 这种连体字。

这里按纵向重叠把文本框归并成行，行内按横向顺序拼接：
中文之间不加空格，西文之间补回空格。2.x / 3.x 引擎共用这一套整理逻辑。
"""


# 中日韩标点：紧贴前文，不该被空格隔开
_CJK_CLOSERS = "。，、；：！？）〕〉》」』】”’…—"
_CJK_OPENERS = "（〔〈《「『【“‘"


def _needs_space(left_text, right_text, gap, height):
    """同一行相邻两框之间是否补一个空格。"""
    if not left_text or not right_text:
        return False
    if left_text.endswith(" ") or right_text.startswith(" "):
        return False

    left = left_text[-1]
    right = right_text[0]

    # 标点不该被空格隔开：……结束。 + 下一框、开括号 + 后续文字
    if right in _CJK_CLOSERS or left in _CJK_OPENERS:
        return False

    # 间隔明显大于字高：分栏、表格或带编号的列表，用空格分开
    if gap > 1.5 * height:
        return True

    # 中日韩文字相邻：中文本身不用空格分词
    if not left.isascii() and not right.isascii():
        return False

    return True


def merge_boxes(items):
    """items 为 [(box, text), ...]，box 是四个角点坐标。

    返回按阅读顺序排好的文本：行内用空格拼接，行间用换行符。
    """
    entries = []
    for box, text in items:
        text = (text or "").strip()
        if not text or box is None or len(box) == 0:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        top, bottom = min(ys), max(ys)
        entries.append({
            "x0": min(xs),
            "x1": max(xs),
            "y0": top,
            "y1": bottom,
            "h": max(1.0, bottom - top),
            "text": text,
        })

    if not entries:
        return ""

    entries.sort(key=lambda e: (e["y0"] + e["y1"]) / 2)

    lines = []
    for entry in entries:
        for line in lines:
            # 与行内已有框的纵向重叠超过较矮者一半，即视为同一行
            ref = line[0]
            overlap = min(entry["y1"], ref["y1"]) - max(entry["y0"], ref["y0"])
            if overlap > 0.5 * min(entry["h"], ref["h"]):
                line.append(entry)
                break
        else:
            lines.append([entry])

    lines.sort(key=lambda line: min(e["y0"] for e in line))

    rendered = []
    for line in lines:
        line.sort(key=lambda e: e["x0"])
        parts = []
        for index, entry in enumerate(line):
            if index:
                prev = line[index - 1]
                if _needs_space(prev["text"], entry["text"],
                                entry["x0"] - prev["x1"],
                                max(entry["h"], prev["h"])):
                    parts.append(" ")
            parts.append(entry["text"])
        rendered.append("".join(parts))
    return "\n".join(rendered)


def configure_stdout():
    """结果由父进程（Rust）按 UTF-8 逐行解析，固定编码以免中文被本地代码页改写。"""
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
