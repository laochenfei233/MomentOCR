---
feature: pyqt5-runtime-prune
status: in-progress
updated: 2026-10-03
branch: feat/pyqt5-runtime-prune
commits:
---

# PyQt5 Runtime Prune

## Report

## [S1] Problem

随安装包分发的截图覆盖层是 PyInstaller `--onedir` 产物，自带一整套 PyQt5 运行时。`scripts/build-overlay.py` 里已经有文件级瘦身，但它被 `if platform.system() == "Windows"` 卡住：只有 Windows 会删 `PRUNE_FILES_WINDOWS` / `PRUNE_DIRS_WINDOWS` 里那批文件，代码注释写明「那份清单是在真机上验证过的，其他平台先按 PyInstaller 默认输出，等 CI 上看到真实布局再瘦」。

结果是 macOS 与 Linux 的安装包白背一份用不到的 Qt 运行时。本机实测（macOS，PyInstaller 6.11.1 + PyQt5 5.15.11，按文件实体大小算、不跟随符号链接）：

```
66.9 MB  产物总量
19.8 MB  覆盖层永远用不到的部分
         （QtQuick / QtQml / QtQmlModels / QtNetwork / QtSvg / QtWebSockets
          六个框架 + translations/ + platforms/ 下三个没用到的平台插件）
```

覆盖层只 `import` 了 `PyQt5.QtWidgets` / `QtCore` / `QtGui`（见 `src-tauri/scripts/screenshot_overlay.py:9-11`），但 PyInstaller 仍会把 QML/Quick、Network、Svg 这些 Qt 模块当二进制依赖收进来——它们由平台插件（如 `libqwebgl`）和图片格式插件（如 `libqsvg`）反向链接引入，`--exclude-module` 管不到二进制层。

顺带暴露一个只在 macOS 上踩得到的问题：`shutil.copytree(built, out)` 默认会把 PyInstaller 生成的 48 个符号链接展开成实体副本，同一份 Qt 二进制在产物里存三份，66.9 MB 被撑到 133 MB——瘦身省下的量还不够填这个坑。之前文件级清理只在 Windows 做，Windows 的 PyInstaller 输出基本没有符号链接，所以一直没暴露。

## [S2] Design

### 整体思路

Windows 那份清单里每一条都能归到三类之一：Qt 模块、Qt 插件文件、Qt 数据/插件目录。三类在不同平台上的**真实路径不同**（Windows 在 `PyQt5/Qt5/bin/`、后缀 `.dll`；macOS 在 `PyQt5/Qt5/lib/`、是 `.framework` 整目录外加一个顶层符号链接；Linux 在 `PyQt5/Qt5/lib/`、文件名是 `libQt5*.so.5`），但**语义完全相同**。

所以设计拆成两层：

1. **语义清单**（平台无关）：要删哪些 Qt 模块、哪些插件、哪些目录。
2. **按平台解析**：把语义清单映射成该平台真实的相对路径列表，交给同一个删除循环。

这样三平台共享一套词汇，以后新增一项只改一处；同时 Windows 的删除结果必须与现状逐字节一致。

### 语义清单

PyInstaller 的 Qt 相对目录对所有平台都是 `PyQt5/Qt5`（`PyQt5 >= 5.15.4` 起固定新布局，`PyInstaller/utils/hooks/qt/__init__.py:124-128`），所以语义清单直接挂在它下面：

```
DROP_QT_MODULES           要删的 Qt 模块短名
DROP_QT_MODULES_KEEP      某平台上不能删的例外
DROP_PLUGIN_FILES         要删的插件（相对 plugins/，不含 lib 前缀与后缀）
DROP_QT_DIRS              要删的目录（相对 PyQt5/Qt5/）
DROP_EXTRA_FILES          某平台独占的非 Qt 文件（Windows 的那三个）
REQUIRED_PLATFORM_PLUGIN  每个平台唯一必需的那个平台插件
```

模块短名集合取 Windows 清单里已有的 `Quick / Qml / QmlModels / Network / Sql / Test / Xml / Svg / Pdf / PrintSupport`，加上 `WebSockets / QmlWorkerScript`。后两个是实测补的：`libqwebgl` / `qwebgl.dll` 链接它们，所以 Windows 产物里其实也有 `Qt5WebSockets.dll`，原来那份清单漏了。Windows 上「原本就会删掉的条目」一条不少，只多出这两个同类模块。

### 平台解析规则

| | Qt 模块 | 插件文件 | 目录 |
| --- | --- | --- | --- |
| Windows | `PyQt5/Qt5/bin/Qt5<M>.dll` | `PyQt5/Qt5/plugins/<cat>/<name>.dll` | 同左列，直接拼相对路径 |
| Linux | `PyQt5/Qt5/lib/libQt5<M>.so*`（glob） | `PyQt5/Qt5/plugins/<cat>/lib<name>.so` | 同上 |
| macOS | `PyQt5/Qt5/lib/Qt<M>.framework`（整目录） | `PyQt5/Qt5/plugins/<cat>/lib<name>.dylib` | 同上 |

插件名的 `lib` 前缀是踩出来的：Windows 是 `qminimal.dll`，macOS / Linux 是 `libqminimal.dylib` / `libqminimal.so`。与其拼字符串，非 Windows 直接 `glob("lib<name>.*")`。

macOS 额外两步收尾：

- **顶层符号链接**：PyInstaller 会在 `_internal/` 根上生成 `QtNetwork -> PyQt5/Qt5/lib/QtNetwork.framework/Versions/5/QtNetwork` 这类链接。删掉 framework 后这些链接会悬空，所以删完统一扫一遍 `_internal/` 下的符号链接，指向已不存在文件的直接删掉。做成通用的「清悬空链接」而不是逐条枚举，避免将来 PyInstaller 改命名时要跟着改清单。
- `.framework` 目录内部还有 `Versions/5/Resources/Info.plist` 等，整目录删掉即可。

所有删除都沿用现有语义：**目标不存在就跳过**（不报错）。所以一份跨平台清单在某个平台上少收几项时天然安全。

### macOS 的 QtPrintSupport 例外

真机实测得到的、最反直觉的一条：**macOS 不能删 `QtPrintSupport`**。`libqcocoa.dylib`（macOS 唯一能用的平台插件）强链接它，删掉之后 `dlopen` 直接失败：

```
dlopen(.../platforms/libqcocoa.dylib): Library not loaded: @rpath/QtPrintSupport
```

`otool -L` 上没有 weak 标记，是强引用，所以应用根本起不来。Windows 的 `qwindows.dll` 和 Linux 的 `libqxcb.so` 都不链接它（`DT_NEEDED` 里没有），所以只有 macOS 需要这条例外——`DROP_QT_MODULES_KEEP = {"Darwin": {"PrintSupport"}}`，代价 0.63 MB。

### 构建期「悬空引用」校验

macOS 的清单能在本机真机验证，Linux 不行（本机无 Linux、无 Docker）。清单写错的表现是运行时才炸——某个保留下来的 Qt 库/插件 `dlopen` 时找不到已删的依赖，而 CI 构建仍然是绿的。

所以在打包+瘦身之后加一道静态校验，扫描保留下来的二进制，解析其加载期依赖，若引用的文件在 bundle 内已被删掉就报出来：

- **Mach-O**：解析 load commands 的 `LC_LOAD_DYLIB` / `LC_LOAD_WEAK_DYLIB` / `LC_REEXPORT_DYLIB` / `LC_LOAD_UPWARD_DYLIB`，取 `@loader_path/`、`@executable_path/`、`@rpath/`（用 `LC_RPATH` 展开）。
- **ELF**：解析 `PT_DYNAMIC` 的 `DT_NEEDED`，用 `DT_RPATH` / `DT_RUNPATH`（含 `$ORIGIN` 展开）解析。
- **PE**：不实现。Windows 清单已真机验证过，且 PE 的 DLL 搜索路径包含系统目录，静态解析容易误报。Windows 上这一步打印一行跳过原因。

纯 Python 按魔数解析，不依赖 `otool` / `readelf` / `ldd`——CI 上这些工具不一定有，`ldd` 还会真的去加载二进制。

两个关键细节：

- **只对瘦身后新增的悬空引用报错**。瘦身前后各算一次悬空集合，只对差集报错。这样 PyInstaller 输出里本来就有的悬空引用（`@rpath` 指向未收集的库、ELF 里按 rpath 展开后落在 bundle 内的系统库名——本机实测 Linux 侧基线就有 1025 条）不会造成假失败。
- **分致命与可选两级**。`plugins/` 下的东西除真正必需的那个平台插件（`REQUIRED_PLATFORM_PLUGIN`：Windows `qwindows` / macOS `libqcocoa` / Linux `libqxcb`）外都是按需 `dlopen` 的，依赖缺失只让 Qt 打一行警告、应用照跑，所以只提示不失败；插件之外的二进制和必需平台插件上的悬空引用才是致命，直接让构建失败。

这条分级不是设计里的假设，而是实测逼出来的：`libqvnc.so`（VNC 平台插件）也链接 `libQt5Network`，如果按「`plugins/platforms/` 一律致命」判，Linux 构建会被自己的清单拦下来。

### 符号链接必须原样保留

`shutil.copytree()` 默认 `symlinks=False`，会把符号链接展开成实体副本。macOS 上 PyInstaller 用链接把 `_internal/QtCore` 指到框架里的真身，展开后一份 Qt 二进制在产物里存三份，66.9 MB 变 133 MB。所以拷贝改用 `symlinks=True`。

配套地，`dir_size()` 也改成不跟随符号链接——否则同一份二进制被算好几遍，打印出来的体积比实际占盘大一倍（「瘦身前 133.2 MB」就是这么来的）。

### 边界

- 只动 `scripts/build-overlay.py`，不改 CI workflow、不改 `tauri.*.conf.json`、不改覆盖层 Python 脚本。
- 瘦身逻辑仍然是「打包后删文件」，不引入 PyInstaller spec/`TOC` 层的过滤。

## [S3] Out of Scope

- **不动 Windows 已经会删的那些条目**：现有 16 文件 + 8 目录一条不少，只补了 `Qt5WebSockets.dll` / `Qt5QmlWorkerScript.dll` 两个同类模块。
- **不清理因裁剪变成孤儿的文件**：被删 `QtSvg` 拖死的 `libqsvgicon` / `libqsvg` 插件、macOS 上毫无意义的 `platformthemes/libqxdgdesktopportal`、可选 `imageformats`（tiff/webp/tga…）、删掉 `QtNetwork` 后可能孤立的顶层 `libssl` / `libcrypto`。这些留到清单稳定后再评估。
- **不调整 `EXCLUDE_MODULES`**（模块级排除）：本次只做文件级清理。
- **不做签名 / 公证**：macOS 安装包本来就未签名。
- **不追求 AppImage/deb 内部进一步压缩**。

## Tasks

- [x] T1: 把 Windows 的硬编码路径清单重构成「语义清单 + 按平台解析」，Windows 删除集合保持不变 — acceptance: Windows 分支解析出的列表覆盖现有 `PRUNE_FILES_WINDOWS` / `PRUNE_DIRS_WINDOWS` 全部 16 文件 + 8 目录；只多出 `Qt5WebSockets.dll` / `Qt5QmlWorkerScript.dll` 两个同类模块 (covers: S2)
- [x] T2: 加 macOS 解析（`Qt<M>.framework` 整目录 + 顶层悬空符号链接清理 + QtPrintSupport 例外）— acceptance: 本机真机打包，66.9 MB → 47.1 MB，删掉 19.8 MB (covers: S2; depends: T1)
- [x] T3: 加 Linux 解析（`libQt5<M>.so*` + 插件 `lib<name>.so`）— acceptance: 对 Linux 版 PyQt5-Qt5 wheel 的真实文件名全部命中；用「实际会被收集的文件」拼出的近似 bundle 跑完整 prune + check，致命 0 条 (covers: S2; depends: T1)
- [x] T4: 加构建期悬空引用校验（Mach-O / ELF，纯 Python，致命 / 可选分级）— acceptance: 正常清单下构建通过；瘦身前就存在的悬空引用（Linux 实测 1025 条）不报错；必需的平台插件悬空会失败 (covers: S2; depends: T2, T3)
- [x] T5: 真机验证 macOS 产物 — acceptance: 瘦身后产物启动成功（进程存活、stderr 无输出），关键二进制逐个 dlopen 成功 (covers: S2; depends: T2, T4)
- [x] T6: 修 `copytree` 不保留符号链接导致的体积膨胀（macOS 上 66.9 MB 被撑到 133 MB）— acceptance: 产物保留 24 个符号链接，`dir_size` 与 `du -sh` 一致 (covers: S2; depends: T2)
