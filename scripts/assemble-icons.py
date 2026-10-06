"""由各尺寸 PNG 拼装 src-tauri/icons/icon.ico 与 icon.icns。

ico/各 PNG 用满版几何（Windows/Linux），icns 用 macOS 留白几何（Apple 网格）。


由 scripts/build-icons.mjs 调用（原生尺寸帧已渲染在 docs/icon-preview/）。
Windows 的 16/32/48px 图标直接取这些帧，而不是把 1024 缩下来；
macOS 的 icns 用 PNG 载荷（Apple 从 10.7 起支持 icp4/icp5 等 PNG 条目）。
"""

import io
import os
import struct

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICON_DIR = os.path.join(ROOT, "src-tauri", "icons")
PREVIEW = os.path.join(ROOT, "docs", "icon-preview")

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# ICNS 条目 → 需要的像素尺寸（同一个尺寸会被标准屏和高分屏各引用一次）
ICNS_ENTRIES = (
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),    # 16pt @2x
    ("ic12", 64),    # 32pt @2x
    ("ic13", 256),   # 128pt @2x
    ("ic14", 512),   # 256pt @2x
)


def frame(size, mac=False):
    """macos 的 icns 用留白版（Apple 网格），其余用满版。"""
    name = f"mac-{size}.png" if mac else f"icon-{size}.png"
    return Image.open(os.path.join(PREVIEW, name)).convert("RGBA")


def write_ico():
    """自己拼 ICO 目录，不走 Pillow 的 ICO 保存。

    原因：tauri-codegen 生成 default_window_icon 时只读目录的第 0 帧
    （tauri-codegen/src/image.rs 的 icon_dir.entries()[0]），把那**一帧**转成 RGBA
    交给窗口和托盘。所以第 0 帧是 16x16 时，运行时图标永远是一张 16px 位图，
    在 150% 缩放下被系统放大到 24/48px，必然发糊。

    Pillow 的 _save 对 sizes 做 sorted()，写出来必然升序，没法把 256 放到最前，
    所以这里直接按目标顺序写目录：最大帧置前，其余升序。
    Windows 是按目录里的尺寸字节挑帧的，与顺序无关，改顺序不影响资源管理器。
    """
    order = (256,) + tuple(size for size in ICO_SIZES if size != 256)

    payloads = []
    for size in order:
        buf = io.BytesIO()
        frame(size).save(buf, "png")
        payloads.append(buf.getvalue())

    header = struct.pack("<HHH", 0, 1, len(order))
    offset = len(header) + 16 * len(order)

    entries = b""
    for size, payload in zip(order, payloads):
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,  # 256 在目录里记作 0
            size if size < 256 else 0,
            0,                          # 调色板色数：32bpp PNG 载荷不适用
            0,                          # reserved
            0,                          # color planes
            32,                         # bits per pixel
            len(payload),
            offset,
        )
        offset += len(payload)

    path = os.path.join(ICON_DIR, "icon.ico")
    with open(path, "wb") as f:
        f.write(header + entries + b"".join(payloads))
    print(f"已写入 icon.ico：{order}（最大帧置前，供运行时窗口/托盘取用）")


def write_icns():
    cache = {}
    body = b""
    for kind, size in ICNS_ENTRIES:
        if size not in cache:
            # macOS 的 icns 用留白版，才能和系统里其他应用一样大
            png_path = os.path.join(PREVIEW, f"mac-{size}.png")
            cache[size] = open(png_path, "rb").read()
        payload = cache[size]
        body += kind.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload

    path = os.path.join(ICON_DIR, "icon.icns")
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"已写入 icon.icns：{len(ICNS_ENTRIES)} 个条目")


def main():
    write_ico()
    write_icns()


if __name__ == "__main__":
    main()
