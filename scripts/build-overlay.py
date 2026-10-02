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


def build(script: Path, out: Path, name: str = TARGET_NAME) -> Path:
    """打包 + （Windows）瘦身，返回产物目录（可执行文件与 _internal 同级）。"""
    use_utf8_stdout()
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--name", name,
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

    built = WORK / "dist" / name
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
    print(f"-> {out}")
    return out


def main() -> int:
    use_utf8_stdout()
    build(SCRIPTS / "screenshot_overlay.py", OUT_DIR / TARGET_NAME)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
