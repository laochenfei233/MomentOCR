# -*- coding: utf-8 -*-
"""把截图覆盖层打成自带运行时的 onedir 程序，随安装包一起分发。

为什么不用 onefile（Windows 实测）：onefile 每次启动都要把 ~36 MB 自解压到临时目录，
「按下热键到覆盖窗口出现」要 1.6-1.8 s；onedir 只要 0.66-0.91 s（直接跑 python 脚本
是 0.4-0.56 s）。截图是热键触发的操作，延迟最影响手感，所以选 onedir。

各平台都要在各自平台上打包（PyInstaller 不能交叉编译）：
  · Windows → src-tauri/binaries/screenshot_overlay/screenshot_overlay.exe
  · macOS / Linux → src-tauri/binaries/screenshot_overlay/screenshot_overlay
由 scripts/prepare-overlay.mjs 在 tauri build 之前调用；CI 每个平台的 job 各跑一次。

瘦身：模块级排除（--exclude-module）三平台都做，但那只能挡住 Python 层——PyQt5 的
Qt 模块会被平台插件、图片格式插件反向链接收进来，所以打包后还要在文件层删一遍。
「删什么」是平台无关的语义清单（DROP_*），「各平台叫什么」交给 resolve_drop_paths()：
Windows 是 PyQt5/Qt5/bin/*.dll，Linux 是 PyQt5/Qt5/lib/libQt5*.so*，
macOS 是 PyQt5/Qt5/lib/Qt*.framework（外加 PyInstaller 在 _internal 根上生成的符号链接）。
删完跑一次悬空引用校验：保留下来的二进制若还引用被删的文件，构建直接失败。

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

# PyInstaller 收集 Qt 时用的相对目录，三平台一致（PyQt5 >= 5.15.4 起固定是新布局）
QT_REL = Path("PyQt5") / "Qt5"

# 要删的 Qt 模块短名（对应 Qt5Quick / libQt5Quick / QtQuick.framework 这一族）。
# WebSockets 与 QmlWorkerScript 是 libqwebgl 链接进来的，Windows 上同样存在，
# 只是原来那份清单漏了。
DROP_QT_MODULES = [
    "Quick", "Qml", "QmlModels", "QmlWorkerScript", "Network", "Sql",
    "Test", "Xml", "Svg", "Pdf", "PrintSupport", "WebSockets",
]

# macOS 例外：libqcocoa.dylib 强链接 QtPrintSupport（Windows 的 qwindows.dll、Linux 的
# libqxcb.so 都不链接它）。删掉 QtPrintSupport.framework 后平台插件 dlopen 失败，实测报
# "Library not loaded: @rpath/QtPrintSupport"，应用根本起不来。
DROP_QT_MODULES_KEEP = {"Darwin": {"PrintSupport"}}

# 平台独占、且不是 Qt 模块的文件
DROP_EXTRA_FILES = {
    "Windows": [
        "PyQt5/Qt5/bin/opengl32sw.dll",        # 软件 OpenGL 兜底，20 MB
        "PyQt5/Qt5/bin/libGLESv2.dll",
        "PyQt5/Qt5/bin/d3dcompiler_47.dll",
    ],
}

# 每个平台真正必需的那个平台插件（Windows qwindows / macOS libqcocoa / Linux libqxcb）。
# plugins/ 下其余东西都是按需 dlopen 的可选件，加载失败只让 Qt 打一行警告，应用照跑。
REQUIRED_PLATFORM_PLUGIN = {"Windows": "qwindows", "Darwin": "libqcocoa", "Linux": "libqxcb"}

# platforms/ 下这几个确认用不到（offscreen 只在自测里当兜底，覆盖层从来不用）
DROP_PLUGIN_FILES = ["platforms/qminimal", "platforms/qoffscreen", "platforms/qwebgl"]

# 整目录删，相对 PyQt5/Qt5/；三平台布局一致
DROP_QT_DIRS = [
    "translations",
    "qml",
    "plugins/qmltooling",
    "plugins/sqldrivers",
    "plugins/printsupport",
    "plugins/networkinformation",
    "plugins/tls",
    "plugins/platforminputcontexts",
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
    """目录内容大小（MB）。

    不跟随符号链接：macOS 上框架内部和 _internal 根上都有链接，跟随会把同一份二进制
    算好几遍，报出来的数比实际占盘大一倍。
    """
    return sum(
        f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink()
    ) / 1048576


def executable_name() -> str:
    return f"{TARGET_NAME}.exe" if platform.system() == "Windows" else TARGET_NAME


def plugin_paths(internal: Path, system: str, name: str) -> list:
    """某个插件的真实路径。

    Windows 上叫 qminimal.dll；macOS / Linux 带 lib 前缀且后缀不同
    （libqminimal.dylib / libqminimal.so），所以非 Windows 用 glob 抓，别拼字符串。
    """
    base = internal / QT_REL / "plugins" / name
    if system == "Windows":
        return [Path(f"{base}.dll")]
    return sorted(base.parent.glob(f"lib{base.name}.*"))


def resolve_drop_paths(internal: Path, system: str) -> tuple:
    """把语义清单解析成该平台真实的路径，返回 (要删的文件, 要删的目录)。

    清单一律按「目标不存在就跳过」用，所以某个平台少收几项时天然安全。
    """
    keep = DROP_QT_MODULES_KEEP.get(system, set())
    modules = [m for m in DROP_QT_MODULES if m not in keep]

    files, dirs = [], []
    if system == "Windows":
        files += [internal / QT_REL / "bin" / f"Qt5{m}.dll" for m in modules]
    elif system == "Darwin":
        dirs += [internal / QT_REL / "lib" / f"Qt{m}.framework" for m in modules]
    else:
        # Linux 的 Qt 库是 libQt5Xxx.so.5 这种带版本后缀的文件，用 glob 才抓得全
        lib_dir = internal / QT_REL / "lib"
        for module in modules:
            files += sorted(lib_dir.glob(f"libQt5{module}.so*"))

    files += [internal / rel for rel in DROP_EXTRA_FILES.get(system, [])]
    for name in DROP_PLUGIN_FILES:
        files += plugin_paths(internal, system, name)
    dirs += [internal / QT_REL / rel for rel in DROP_QT_DIRS]
    return files, dirs


def prune(internal: Path, system: str) -> int:
    """按解析出的路径删除，返回省下的字节数。"""
    # 清单失效要响，不能静默：QT_REL 假定的是 PyQt5 >= 5.15.4 的新布局，旧版是
    # PyQt5/Qt（PyInstaller/utils/hooks/qt/__init__.py:124-128）。布局对不上时下面每一条
    # 都会被「不存在就跳过」吞掉，瘦身白做而构建全绿。
    if not (internal / QT_REL).is_dir():
        raise SystemExit(
            f"{internal / QT_REL} 不存在：PyInstaller 没按预期收集 Qt。"
            f"若是 PyQt5 < 5.15.4，布局是 PyQt5/Qt，需要改 QT_REL；"
            f"若是本地用发行版（apt 等）装的 PyQt5，它的 Qt 库不在 site-packages、会被平铺到 "
            f"_internal 根下，换装 PyPI 版 PyQt5 才能瘦身。"
        )
    files, dirs = resolve_drop_paths(internal, system)
    if not any(path.exists() for path in files + dirs):
        # 正常构建不可能是 0 命中（三平台都至少能命中那几个平台插件）。真出现 0 只剩两种可能：
        # 布局整体变了，或者上游 PyInstaller 不再收集这些东西——两种都该有人看一眼，
        # 所以直接失败而不是警告：警告的代价是静默发出一个没瘦身的安装包。
        raise SystemExit(
            f"{system} 上一条都没命中：要么 {internal / QT_REL} 下的布局整体变了，"
            f"要么上游 PyInstaller 已经不收集这些文件（后者的话这条断言该放宽）。"
            f"请对照实际内容更新 DROP_* 清单。"
        )

    removed = 0
    for path in files:
        if path.is_file() and not path.is_symlink():
            removed += path.stat().st_size
            path.unlink()
    for path in dirs:
        if path.exists():
            removed += dir_size(path) * 1048576
            shutil.rmtree(path, ignore_errors=True)

    # macOS 上 PyInstaller 会在 _internal 根上给 Qt 框架建符号链接
    # （QtCore -> PyQt5/Qt5/lib/QtCore.framework/Versions/5/QtCore）。框架一删这些链接
    # 就悬空了，统一清一遍，不逐条枚举——将来 PyInstaller 改命名也不用跟着改清单。
    for link in internal.iterdir():
        if link.is_symlink() and not link.exists():
            link.unlink()
    return removed


# ---------------------------------------------------------------------------
# 悬空引用校验
#
# macOS 的清单能在真机验证，Linux 不能（开发机不一定有 Linux，CI 上跑一次也只看得到
# 构建绿不绿）。清单写错的表现是运行时才炸：某个保留下来的库 dlopen 时找不到已删的
# 依赖，而构建仍然是成功的。
#
# 所以删完扫一遍：解析保留下来的二进制的加载期依赖，若引用的文件在 bundle 内却不存在
# 就报出来。纯 Python 按魔数解析，不依赖 otool / readelf / ldd——CI 上这些不一定有，
# ldd 还会真的去加载二进制。
#
# 只对「瘦身之后新增的」悬空引用报错：PyInstaller 输出里本来就有的（@rpath 指向未收集
# 的库、ELF 里按 rpath 展开后落在 bundle 内的系统库名）不算我们的问题，否则全是假失败。
#
# PE 不实现：Windows 的清单已经在真机上跑过，而 PE 的 DLL 搜索路径含系统目录，静态解析
# 容易误报。
# ---------------------------------------------------------------------------

MACHO_MAGICS_32 = (b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce")
MACHO_MAGICS_64 = (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf")
FAT_MAGICS = (b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca")

LC_REQ_DYLD = 0x80000000
MACHO_DEP_COMMANDS = (0xC, LC_REQ_DYLD | 0x18, LC_REQ_DYLD | 0x1F, LC_REQ_DYLD | 0x23)
MACHO_RPATH_COMMAND = LC_REQ_DYLD | 0x1C

ELF_PT_LOAD = 1
ELF_PT_DYNAMIC = 2
ELF_DT_NEEDED = 1
ELF_DT_STRTAB = 5
ELF_DT_RPATH = 15
ELF_DT_RUNPATH = 29


def _u32(blob, offset, endian):
    return int.from_bytes(blob[offset:offset + 4], endian)


def _u64(blob, offset, endian):
    return int.from_bytes(blob[offset:offset + 8], endian)


def _cstr(blob, offset):
    return blob[offset:blob.index(b"\x00", offset)].decode("utf-8", "replace")


def _macho_slices(blob):
    magic = blob[:4]
    if magic in FAT_MAGICS:
        endian = "big" if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf") else "little"
        wide = magic in (b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca")
        position, step = 8, (32 if wide else 20)
        for _ in range(_u32(blob, 4, endian)):
            yield _u64(blob, position + 8, endian) if wide else _u32(blob, position + 8, endian)
            position += step
        return
    yield 0


def _macho_slice_deps(blob, base):
    magic = blob[base:base + 4]
    if magic in MACHO_MAGICS_64:
        endian, header_size = ("little" if magic == b"\xcf\xfa\xed\xfe" else "big"), 32
    elif magic in MACHO_MAGICS_32:
        endian, header_size = ("little" if magic == b"\xce\xfa\xed\xfe" else "big"), 28
    else:
        return [], []

    position = base + header_size
    deps, rpaths = [], []
    for _ in range(_u32(blob, base + 16, endian)):
        command = _u32(blob, position, endian)
        command_size = _u32(blob, position + 4, endian)
        if command_size < 8:
            break
        if command in MACHO_DEP_COMMANDS:
            deps.append(_cstr(blob, position + _u32(blob, position + 8, endian)))
        elif command == MACHO_RPATH_COMMAND:
            rpaths.append(_cstr(blob, position + _u32(blob, position + 8, endian)))
        position += command_size
    return deps, rpaths


def _macho_deps(blob):
    deps, rpaths = [], []
    for base in _macho_slices(blob):
        slice_deps, slice_rpaths = _macho_slice_deps(blob, base)
        deps += slice_deps
        rpaths += slice_rpaths
    return deps, rpaths


def _elf_deps(blob):
    is_64 = blob[4] == 2
    endian = "little" if blob[5] == 1 else "big"
    if is_64:
        phoff = _u64(blob, 0x20, endian)
        entsize = int.from_bytes(blob[0x36:0x38], endian)
        phnum = int.from_bytes(blob[0x38:0x3A], endian)
    else:
        phoff = _u32(blob, 0x1C, endian)
        entsize = int.from_bytes(blob[0x2A:0x2C], endian)
        phnum = int.from_bytes(blob[0x2C:0x2E], endian)

    # DT_NEEDED / DT_RPATH 存的是虚拟地址，要通过 PT_LOAD 段换算成文件偏移
    loads, dynamic = [], None
    for index in range(phnum):
        header = phoff + index * entsize
        kind = _u32(blob, header, endian)
        if is_64:
            offset, vaddr, size = _u64(blob, header + 8, endian), _u64(blob, header + 16, endian), _u64(blob, header + 32, endian)
        else:
            offset, vaddr, size = _u32(blob, header + 4, endian), _u32(blob, header + 8, endian), _u32(blob, header + 16, endian)
        if kind == ELF_PT_LOAD:
            loads.append((vaddr, offset, size))
        elif kind == ELF_PT_DYNAMIC:
            dynamic = (offset, size)
    if dynamic is None:
        return [], []

    entries, position = [], dynamic[0]
    while position < dynamic[0] + dynamic[1]:
        if is_64:
            tag, value = _u64(blob, position, endian), _u64(blob, position + 8, endian)
            position += 16
        else:
            tag, value = _u32(blob, position, endian), _u32(blob, position + 4, endian)
            position += 8
        if tag == 0:
            break
        entries.append((tag, value))

    def to_offset(vaddr):
        for segment_vaddr, segment_offset, segment_size in loads:
            if segment_vaddr <= vaddr < segment_vaddr + segment_size:
                return segment_offset + (vaddr - segment_vaddr)
        return None

    needed, rpaths, strtab = [], [], None
    for tag, value in entries:
        if tag == ELF_DT_NEEDED:
            needed.append(value)
        elif tag in (ELF_DT_RPATH, ELF_DT_RUNPATH):
            rpaths.append(value)
        elif tag == ELF_DT_STRTAB:
            strtab = value
    strtab_offset = to_offset(strtab) if strtab is not None else None
    if strtab_offset is None:
        return [], []
    return (
        [_cstr(blob, strtab_offset + n) for n in needed],
        [_cstr(blob, strtab_offset + n) for n in rpaths],
    )


def loader_deps(path: Path):
    """返回 (依赖字符串, rpath)；既不是 Mach-O 也不是 ELF 就返回 None。"""
    blob = path.read_bytes()
    if len(blob) < 8:
        return None
    if blob[:4] in MACHO_MAGICS_32 + MACHO_MAGICS_64 + FAT_MAGICS:
        return _macho_deps(blob)
    if blob[:4] == b"\x7fELF":
        return _elf_deps(blob)
    return None


def _resolve(dep, binary_dir, exec_dir, rpaths, root_prefix):
    """把一条依赖解析成路径；不落在 bundle 内就返回 None（系统库，不管）。"""
    def expand(base):
        return (
            base.replace("@loader_path", str(binary_dir))
            .replace("@executable_path", str(exec_dir))
            .replace("${ORIGIN}", str(binary_dir))
            .replace("$ORIGIN", str(binary_dir))
        )

    if dep.startswith("@loader_path/") or dep.startswith("@executable_path/"):
        candidates = [Path(expand(dep))]
    elif dep.startswith("@rpath/"):
        tail = dep[len("@rpath/"):]
        candidates = [Path(expand(rp)) / tail for rp in rpaths]
        candidates.append(binary_dir / tail)
    elif dep.startswith("/"):
        candidates = [Path(dep)]
    else:
        # ELF 的 DT_NEEDED 只有裸文件名，靠 rpath 定位
        candidates = [Path(expand(rp)) / dep for rp in rpaths]
        candidates.append(binary_dir / dep)

    for candidate in candidates:
        normalized = Path(os.path.normpath(str(candidate)))
        if str(normalized).startswith(root_prefix):
            return normalized
    return None


def dangling_refs(internal: Path) -> tuple:
    """扫描 bundle 内的二进制，返回 ({(引用方, 依赖, 缺失目标)}, 扫描数)，路径相对 _internal。"""
    root = internal.resolve()
    root_prefix = str(root) + os.sep
    exec_dir = root.parent
    found = set()
    scanned = 0

    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        deps = loader_deps(path)
        if deps is None:
            continue
        scanned += 1
        names, rpaths = deps
        for dep in names:
            target = _resolve(dep, path.parent, exec_dir, rpaths, root_prefix)
            if target is None or target.exists():
                continue
            found.add((
                path.relative_to(root).as_posix(),
                dep,
                os.path.relpath(str(target), str(root)),
            ))
    return found, scanned


def check_dangling(before: tuple, after: tuple, system: str) -> None:
    """只报瘦身新增的悬空引用：插件之外的二进制、以及必需的平台插件算致命，其余只提示。"""
    baseline, _ = before
    current, scanned = after
    new = sorted(current - baseline)
    if not new:
        print(f"悬空引用校验：扫描 {scanned} 个二进制，没有新增悬空引用")
        return

    plugins_prefix = f"{QT_REL.as_posix()}/plugins/"
    required = f"{plugins_prefix}platforms/{REQUIRED_PLATFORM_PLUGIN.get(system, '')}"

    def is_load_bearing(referrer):
        if not referrer.startswith(plugins_prefix):
            return True
        # 可选插件的依赖缺失只让 Qt 跳过它；必需的平台插件缺失则整个应用起不来
        return referrer.startswith(required)

    fatal = [item for item in new if is_load_bearing(item[0])]
    optional = [item for item in new if not is_load_bearing(item[0])]
    print(f"悬空引用校验：扫描 {scanned} 个二进制，新增悬空 {len(new)} 条"
          f"（致命 {len(fatal)}，可选插件 {len(optional)}）")
    for referrer, dep, target in optional:
        print(f"  · 可选插件 {referrer}  --{dep}-->  缺失 {target}（Qt 会跳过这个插件）")

    if fatal:
        for referrer, dep, target in fatal:
            print(f"  ! 致命：{referrer}  --{dep}-->  缺失 {target}")
        raise SystemExit(
            "瘦身清单删掉了仍在被引用的文件（见上面「致命」几行）。"
            "把对应模块从 DROP_QT_MODULES 里去掉，或一并删掉引用它的文件。"
        )


def build(script: Path, out: Path) -> Path:
    """打包 + 瘦身 + 校验，返回产物目录（可执行文件与 _internal 同级）。"""
    use_utf8_stdout()
    system = platform.system()
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--name", TARGET_NAME,
        "--workpath", str(WORK / "work"), "--distpath", str(WORK / "dist"),
        "--specpath", str(WORK),
    ]
    if system == "Windows":
        # 覆盖层是窗口程序，别弹控制台
        cmd.append("--noconsole")
    for module in EXCLUDE_MODULES:
        cmd += ["--exclude-module", module]
    cmd.append(str(script))

    print(f"PyInstaller 打包中（{system}，约 1 分钟）…")
    result = subprocess.run(cmd, cwd=script.parent, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-3000:])
        print(result.stderr[-3000:])
        raise SystemExit(result.returncode)

    built = WORK / "dist" / TARGET_NAME
    internal = built / "_internal"
    before = dir_size(built)

    # 瘦身前的悬空引用是 PyInstaller 自己的事，只当基线用来比对
    baseline = dangling_refs(internal) if system != "Windows" else None
    removed = prune(internal, system)
    if system == "Windows":
        print("悬空引用校验：Windows 走 PE，不解析（清单已在真机验证）")
    else:
        check_dangling(baseline, dangling_refs(internal), system)

    shutil.rmtree(out, ignore_errors=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    # symlinks=True 不能省：PyInstaller 在 macOS 上靠符号链接把 _internal/QtCore 指到
    # QtCore.framework 里的真身，默认的 copytree 会把链接展开成实体副本，一份 Qt 变三份，
    # 瘦身省下来的量又全还回去了（实测 36 MB 被撑到 114 MB）。
    shutil.copytree(built, out, symlinks=True)

    # 可执行位要留住，否则 Linux/macOS 上拉起会报权限错误
    program = out / executable_name()
    if system != "Windows" and program.exists():
        program.chmod(program.stat().st_mode | 0o755)

    shutil.rmtree(WORK, ignore_errors=True)

    print(f"瘦身前 {before:.1f} MB，删掉 {removed / 1048576:.1f} MB，最终 {dir_size(out):.1f} MB")

    # 架构必须和目标一致：arm64 机器上给 x64 包打出 arm64 覆盖层，
    # 用户会看到「CPU 不匹配」，而 CI 是绿的——所以这里直接拦住
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
