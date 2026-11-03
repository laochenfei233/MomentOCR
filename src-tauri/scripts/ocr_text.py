"""
须臾OCR - OCR 结果整理

识别引擎吐出的是一个个独立的文本框：同一行常被切成好几个框，
英文词与词之间的空格也并不可靠（PP-OCRv4 系模型会整段吞掉空格）。
直接按框换行，英文就会变成 "HelloWorldfromMomentOCR" 这种连体字。

这里按纵向重叠把文本框归并成行，行内按横向顺序拼接：
中文之间不加空格，西文之间补回空格。相邻的普通行最后拼成一整段，
识别结果才能随窗口宽度自动换行铺满，而不是每行后面空一大块；
表格行、分栏这类行保持独立成行，版面结构不被打散：宽表靠行内大间隔
识别，紧表靠同一列跨行 x 起点对齐识别。项目符号或编号开头的行另起一段，
分点清单不被拍平，每一点自己换行续写的部分仍并进该点。
2.x / 3.x 引擎共用这一套整理逻辑。
"""

import re


# 中日韩标点：紧贴前文，不该被空格隔开
_CJK_CLOSERS = "。，、；：！？）〕〉》」』】”’…—"
_CJK_OPENERS = "（〔〈《「『【“‘"

# 列表项起始：项目符号或编号。1. / 1、 后面排除数字，免得 2.1 GB 这类小数被当编号
_LIST_ITEM = re.compile(
    r"^(?:[·•●○◦▪■◆◇★☆➢➤→✓✔]"
    r"|[-*](?=\s|[^\x00-\x7f])"
    r"|\d{1,2}[.、．)）](?!\d)"
    r"|[(（]\d{1,2}[)）]"
    r"|[一二三四五六七八九十]{1,3}[、.．]"
    r"|[①-⑳]"
    r"|[a-zA-Z][.)）](?=\s))"
)


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


def _has_wide_gap(line):
    """行内相邻框之间出现明显大于字高的空隙：表格行、分栏或目录页。

    这类行承载版面结构，行与行之间不并入段落。
    """
    for left, right in zip(line, line[1:]):
        if right["x0"] - left["x1"] > 1.5 * max(right["h"], left["h"]):
            return True
    return False


def _columns_align(a, b):
    """两行是否有除行首以外的框在同一 x 起点上对齐（紧凑表格的列信号）。

    行首框正文每行都有，不算列；只看第 2 个及之后的框。
    """
    tol = 0.5 * max(e["h"] for e in a + b)
    return any(abs(ea["x0"] - eb["x0"]) <= tol for ea in a[1:] for eb in b[1:])


def _find_table_rows(lines):
    """返回属于紧凑表格的行下标集合。

    列距只有一两个字高的表格，格间间隔不够大，_has_wide_gap 抓不到；
    但引擎仍把每格单独分框，且同一列的 x 起点跨行对齐。相邻两行列对齐
    即连成块，块内 ≥ 2 行才算表格——单行偶然对齐不触发。
    """
    table = set()
    block = [0]
    for i in range(1, len(lines)):
        if _columns_align(lines[i - 1], lines[i]):
            block.append(i)
        else:
            if len(block) >= 2:
                table.update(block)
            block = [i]
    if len(block) >= 2:
        table.update(block)
    return table


def merge_paragraph(lines):
    """把连续的普通文本行拼成一整段，让结果能随窗口宽度自动换行铺满。

    行间沿用 _needs_space 的判断：任一侧是中日韩等非 ASCII 字符就直接
    相接，两侧都是西文才补一个空格；行尾连字符 + 小写行首视为换行时
    被拆开的英文词，把词拼回去。
    """
    out = ""
    for line in lines:
        if not line:
            continue
        if not out:
            out = line
        elif out[-1] == "-" and line[0].islower():
            out = out[:-1] + line
        elif not out[-1].isascii() and not line[0].isascii():
            out += line
        else:
            out += " " + line
    return out


def merge_boxes(items):
    """items 为 [(box, text), ...]，box 是四个角点坐标。

    返回按阅读顺序拼好的文本：相邻的普通行拼成段落；表格行（行内带
    大间隔，或跨行列对齐）保持独立成行，行与行之间用换行符分开。
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
    for line in lines:
        line.sort(key=lambda e: e["x0"])

    # 表格行/分栏行独立成行，只有相邻的普通行才拼进同一段。
    # 宽表靠行内大间隔识别，紧表靠跨行列对齐识别，命中任一即独立。
    # 列对齐看的是行首之外各框的 x 起点，行内必须先按 x 排好序。
    table_rows = _find_table_rows(lines)

    rendered = []
    for index, line in enumerate(lines):
        parts = []
        for pos, entry in enumerate(line):
            if pos:
                prev = line[pos - 1]
                # 表格行内格与格之间固定补空格：紧表相邻中文格若按
                # _needs_space 处理会贴成一体（姓名年龄城市）
                if index in table_rows or _needs_space(prev["text"], entry["text"],
                                entry["x0"] - prev["x1"],
                                max(entry["h"], prev["h"])):
                    parts.append(" ")
            parts.append(entry["text"])
        rendered.append("".join(parts))

    paragraphs = []
    prose = []
    for index, (line, text) in enumerate(zip(lines, rendered)):
        if index in table_rows or _has_wide_gap(line):
            if prose:
                paragraphs.append(merge_paragraph(prose))
                prose = []
            paragraphs.append(text)
        else:
            # 列表项另起一段：前面的段先收口，续行仍会并进这一点
            if prose and _LIST_ITEM.match(text):
                paragraphs.append(merge_paragraph(prose))
                prose = []
            prose.append(text)
    if prose:
        paragraphs.append(merge_paragraph(prose))
    return "\n".join(paragraphs)


def configure_stdout():
    """结果由父进程（Rust）按 UTF-8 逐行解析，固定编码以免中文被本地代码页改写。"""
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
