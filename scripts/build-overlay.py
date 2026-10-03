# -*- coding: utf-8 -*-
"""把截图覆盖层打成自带运行时的 onedir 程序，随安装包一起分发。

为什么不用 onefile（Windows 实测）：onefile 每次启动都要把 ~36 MB 自解压到临时目录，
「按下热键到覆盖窗口出现」要 1.6-1.8 s；onedir 只要 0.66-0.91 s（直接跑 python 脚本
是 0.4-0.56 s）。截图是热键触发的操作，延迟最影响手感，所以选 onedir。

各平台都要在各自平台上打包（PyInstaller 不能交叉编译）：
  · Windows → src-tauri/binaries/screenshot_overlay/screenshot_overlay.exe
  · macOS / Linux → src-tauri/binaries/screenshot_overlay/screenshot_overlay
由 scripts/prepare-overlay.mjs 在 tauri build 之前调用；CI 每个平台的 job 各跑一次。

瘦身：模块级排除在所有平台都做（覆盖层只用 QtWidgets/QtCore/QtGui，QML/Quick/网络那
一堆确实用不到）；文件级清理只在 Windows 做——那份清单是在真机上验证过的，其他平台
先按 PyInstaller 默认输出，等 CI 上看到真实布局再瘦。

用法：python scripts/build-overlay.py
"""

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "src-tauri" / "scripts"
OUT_DIR = ROOT / "src-tauri" / "binaries"
WORK = OUT_DIR / ".build"
TARGET_NAME = "screenshot_overlay"

# 覆盖层只用 QtWidgets/QtCore/QtGui；这些模块和标准库都用不到
EXCLUDE_MODULES = [
    "PyQt5.QtQml", "PyQt5.QtQuick", "PyQt5.QtNetwork", "PyQt5.QtSql",
    "PyQt5.QtTest", "PyQt5.QtXml", "PyQt5.QtSvg", "PyQt5.QtPrintSupport",
    "PyQt5.QtBluetooth", "PyQt5.QtWebChannel", "PyQt5.QtWebEngineWidgets",
    "unittest", "pydoc", "doctest", "lib2to3", "distutils", "setuptools",
]

# 相对 _internal 的路径；只在 Windows 生效（该清单已在真机验证）
PRUNE_FILES_WINDOWS = [
    "PyQt5/Qt5/bin/opengl32sw.dll",        # 软件 OpenGL 兜底，20 MB
    "PyQt5/Qt5/bin/Qt5Quick.dll",
    "PyQt5/Qt5/bin/Qt5Qml.dll",
    "PyQt5/Qt5/bin/Qt5QmlModels.dll",
    "PyQt5/Qt5/bin/libGLESv2.dll",
    "PyQt5/Qt5/bin/d3dcompiler_47.dll",
    "PyQt5/Qt5/bin/Qt5Network.dll",
    "PyQt5/Qt5/bin/Qt5Sql.dll",
    "PyQt5/Qt5/bin/Qt5Test.dll",
    "PyQt5/Qt5/bin/Qt5Xml.dll",
    "PyQt5/Qt5/bin/Qt5Svg.dll",
    "PyQt5/Qt5/bin/Qt5Pdf.dll",
    "PyQt5/Qt5/bin/Qt5PrintSupport.dll",
    "PyQt5/Qt5/plugins/platforms/qminimal.dll",
    "PyQt5/Qt5/plugins/platforms/qoffscreen.dll",
    "PyQt5/Qt5/plugins/platforms/qwebgl.dll",
]
PRUNE_DIRS_WINDOWS = [
    "PyQt5/Qt5/translations",
    "PyQt5/Qt5/qml",
    "PyQt5/Qt5/plugins/qmltooling",
    "PyQt5/Qt5/plugins/sqldrivers",
    "PyQt5/Qt5/plugins/printsupport",
    "PyQt5/Qt5/plugins/networkinformation",
    "PyQt5/Qt5/plugins/tls",
    "PyQt5/Qt5/plugins/platforminputcontexts",
]




def detect_arch(path: Path) -> str:
    """读可执行文件头判断架构，返回 x86_64 / arm64 / i386 / universal / unknown:<hex>。

    直接解析头部而不是调 lipo/file：CI 上（尤其是 Windows runner）不一定有这些工具。
    """
    header = path.open("rb").read(4096)
    if len(header) < 64:
        return "unknown:short"

    # PE（Windows）
    if header[:2] == b"MZ":
        pe_offset = int.from_bytes(header[0x3C:0x40], "little")
        if header[pe_offset:pe_offset + 4] == b"PE\x00\x00":
            machine = int.from_bytes(header[pe_offset + 4:pe_offset + 6], "little")
            return {0x8664: "x86_64", 0xAA64: "arm64", 0x014C: "i386"}.get(
                machine, f"unknown:{machine:#x}"
            )

    # ELF（Linux）
    if header[:4] == b"\x7fELF":
        machine = int.from_bytes(header[0x12:0x14], "little")
        return {0x3E: "x86_64", 0xB7: "arm64"}.get(machine, f"unknown:{machine:#x}")

    # Mach-O（macOS）
    magic = int.from_bytes(header[:4], "little")
    if magic in (0xFEEDFACF, 0xFEEDFACE):
        cputype = int.from_bytes(header[4:8], "little")
        return {0x01000007: "x86_64", 0x0100000C: "arm64"}.get(
            cputype, f"unknown:{cputype:#x}"
        )
    if header[:4] in (b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"):
        return "universal"

    return "unknown:format"


def expected_arch() -> str:
    """目标架构：CI 用 MOMENTOCR_OVERLAY_ARCH 显式指定，本地缺省用当前机器。"""
    explicit = os.environ.get("MOMENTOCR_OVERLAY_ARCH", "").strip()
    if explicit:
        return {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x86_64", "amd64": "x86_64"}.get(
            explicit, explicit
        )
    return {"arm64": "arm64", "aarch64": "arm64"}.get(platform.machine(), "x86_64")

def use_utf8_stdout():
    """CI runner 上 stdout 可能是 cp1252/POSIX，打印中文会 UnicodeEncodeError。

    本地开发环境通常是 UTF-8，所以这个坑只在 CI 上暴露（Windows 与 Linux runner 都踩过）。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def dir_size(path: Path) -> float:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / 1048576


def executable_name() -> str:
    return f"{TARGET_NAME}.exe" if platform.system() == "Windows" else TARGET_NAME


def build(script: Path, out: Path) -> Path:
    """打包 + （Windows）瘦身，返回产物目录（可执行文件与 _internal 同级）。"""
    use_utf8_stdout()
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--name", TARGET_NAME,
        "--workpath", str(WORK / "work"), "--distpath", str(WORK / "dist"),
        "--specpath", str(WORK),
    ]
    if platform.system() == "Windows":
        # 覆盖层是窗口程序，别弹控制台
        cmd.append("--noconsole")
    for module in EXCLUDE_MODULES:
        cmd += ["--exclude-module", module]
    cmd.append(str(script))

    print(f"PyInstaller 打包中（{platform.system()}，约 1 分钟）…")
    result = subprocess.run(cmd, cwd=script.parent, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-3000:])
        print(result.stderr[-3000:])
        raise SystemExit(result.returncode)

    built = WORK / "dist" / TARGET_NAME
    internal = built / "_internal"
    before = dir_size(built)
    removed = 0

    if platform.system() == "Windows":
        for rel in PRUNE_FILES_WINDOWS:
            path = internal / rel
            if path.is_file():
                removed += path.stat().st_size
                path.unlink()
        for rel in PRUNE_DIRS_WINDOWS:
            path = internal / rel
            if path.exists():
                removed += dir_size(path) * 1048576
                shutil.rmtree(path, ignore_errors=True)

    shutil.rmtree(out, ignore_errors=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(built, out)

    # 可执行位要留住，否则 Linux/macOS 上拉起会报权限错误
    program = out / executable_name()
    if platform.system() != "Windows" and program.exists():
        program.chmod(program.stat().st_mode | 0o755)

    shutil.rmtree(WORK, ignore_errors=True)

    if removed:
        print(f"瘦身前 {before:.1f} MB，删掉 {removed / 1048576:.1f} MB，最终 {dir_size(out):.1f} MB")
    else:
        print(f"产物 {dir_size(out):.1f} MB（该平台暂未做文件级瘦身）")

    # 架构必须和目标一致：arm64 机器上给 x64 包打出 arm64 覆盖层，
    # 用户会看到「CPU 不匹配」，而 CI 是绿的——所以这里直接拦住
    program = out / executable_name()
    actual = detect_arch(program)
    want = expected_arch()
    print(f"架构校验：{program.name} = {actual}，目标 = {want}")
    if actual != want:
        raise SystemExit(
            f"产物架构不匹配：{program} 是 {actual}，但目标是 {want}。"
            f"检查打包用的 Python 架构（macOS 上用 setup-python 的 architecture: x64）"
        )

    print(f"-> {out}")
    return out


def main() -> int:
    use_utf8_stdout()
    build(SCRIPTS / "screenshot_overlay.py", OUT_DIR / TARGET_NAME)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
