"""由各尺寸 PNG 拼装 src-tauri/icons/icon.ico 与 icon.icns。

ico/各 PNG 用满版几何（Windows/Linux），icns 用 macOS 留白几何（Apple 网格）。


由 scripts/build-icons.mjs 调用（原生尺寸帧已渲染在 docs/icon-preview/）。
Windows 的 16/32/48px 图标直接取这些帧，而不是把 1024 缩下来；
macOS 的 icns 用 PNG 载荷（Apple 从 10.7 起支持 icp4/icp5 等 PNG 条目）。
"""

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
    frames = [frame(size) for size in ICO_SIZES]
    path = os.path.join(ICON_DIR, "icon.ico")
    frames[-1].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=frames,
    )
    print(f"已写入 icon.ico：{ICO_SIZES}")


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
