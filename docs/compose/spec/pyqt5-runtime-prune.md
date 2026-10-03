---
feature: pyqt5-runtime-prune
status: delivered
updated: 2026-10-03
branch: feat/pyqt5-runtime-prune
commits: ed90237..c0a5402
---

# PyQt5 Runtime Prune

## Report

**What was built** — `scripts/build-overlay.py` 的运行时瘦身从「只有 Windows 生效」推到三平台。要删什么是一份平台无关的语义清单（`DROP_QT_MODULES` / `DROP_PLUGIN_FILES` / `DROP_QT_DIRS` / `DROP_EXTRA_FILES` / `DROP_QT_MODULES_KEEP`），各平台解析成真实路径：Windows 的 `PyQt5/Qt5/bin/Qt5<M>.dll`、Linux 的 `libQt5<M>.so*`、macOS 的整目录 `Qt<M>.framework` 加 PyInstaller 在 `_internal` 根上生成的符号链接（非 Windows 的插件还带 `lib` 前缀）。macOS 必须留 `QtPrintSupport`——`libqcocoa.dylib` 强链接它，删掉之后平台插件加载失败、应用根本起不来。打包后新增一道悬空引用校验（Mach-O load commands / ELF `DT_NEEDED`，纯 Python 按魔数解析，不依赖 `otool`/`readelf`/`ldd`）：只对瘦身新增的悬空引用动手，能自动删的就删掉，必需的平台插件一旦悬空就直接失败。`prune()` 开头另加两道断言，保证清单失效时是硬失败而不是静默放过。

macOS 构建目录 66.9 MB → 46.9 MB。但**对用户有意义的是 CI 打出来的安装包**（macos-x64，同一条流水线前后对比）：

| | 改动前 | 改动后 |
| --- | --- | --- |
| 用户下载的 dmg | 77 MB | **47 MB**（−39%） |
| app 内覆盖层占盘 | 188 MB | **108 MB** |
| 覆盖层符号链接 | 0 | 0（Tauri 展平，见下） |
| Qt 框架 | 11 个 | 5 个 |
| `platforms/` 插件 | 4 个 | 1 个（`libqcocoa`） |

实测直接在挂载的 dmg 里启动覆盖层能正常起来（进程存活、stderr 空）。

**Verification** — 以下均为本机实际执行（macOS x86_64，PyInstaller 6.11.1 + PyQt5 5.15.11）。

| 命令 | 结果 |
| --- | --- |
| `python -m py_compile scripts/build-overlay.py` | PASS |
| `python scripts/build-overlay.py` | PASS：瘦身前 66.9 MB / 删掉 19.8 MB / 最终 47.1 MB；悬空校验「致命 0，可选插件 3」；架构校验 x86_64 |
| `du -sh src-tauri/binaries/screenshot_overlay` | PASS：47M，24 个符号链接 |
| 启动冒烟（后台起产物、4 s 后确认存活、kill） | PASS：进程存活，stdout 与 stderr 均空 |
| 逐个 dlopen（`libqcocoa` / `libqmacstyle` / `libqjpeg` / `QtWidgets.abi3.so` / `QtCore.abi3.so`，各自独立进程） | PASS 5/5 |
| 负面测试：`DROP_QT_MODULES_KEEP` 置空后重建 | PASS：被拦下并指名 `libqcocoa.dylib --@rpath/QtPrintSupport--> 缺失` |
| 两道布局断言的触发测试（旧布局 / 零命中） | PASS：都被拦下，信息点明原因与出路 |
| Windows 解析等价性 vs 旧 `PRUNE_FILES_WINDOWS`/`PRUNE_DIRS_WINDOWS` | PASS：16 文件 + 8 目录零缺失，新增 2 个同类模块，无重复 |
| Linux 解析 vs 真实 manylinux wheel 文件名 | PASS：11/11 命中，无重复无误伤 |
| Linux 近似 bundle 端到端 prune + drop + check | PASS：自动删掉 4 个（`libqtuiotouchplugin` / `libqsvgicon` / `libqsvg` / `libqvnc`），0 条残留悬空 |

CI（`gh workflow run Release`，run `37127401083`，GitHub master `657edf8`）——**四个平台第一次跑就抓到一处本机测不出的回归**：

| job | 结果 |
| --- | --- |
| windows-x64 | PASS |
| macos-arm64 | PASS |
| macos-x64 | PASS |
| linux-x64 | **FAIL** → 已修（见下），待复跑确认 |

Linux 的失败不在覆盖层构建（那一步 CI 打印的正是 `扫描 148 个二进制，新增悬空 4 条`，与本机预测一致），而在其后的 AppImage 打包：`linuxdeploy` 解析 AppDir 的 `DT_NEEDED` 时撞上被删的 `libQt5Svg.so.5` 直接中止。修法是 `drop_broken_referrers()`——把「被我们的精简删到加载不了」的文件一并删掉；本机重跑后 macOS 自动删 3 个、Linux 近似 bundle 自动删 4 个，均 0 条残留。

独立复评（另一个 agent，未参与实现）复核通过：T1–T7 逐条达标、0 条 critical；它自行复现了 FAT 解析结果与 `otool -L` 完全一致、ELF 的 `DT_NEEDED`/`RPATH` 正确、Windows 覆盖零缺失，以及 `libqcocoa` 的 `@rpath/QtPrintSupport` 确实解析到实存文件。

评审时的范围是 `a10d15d..6154fb7`。合入前 master 前进到 `ed90237`（`chore: 清掉脚本与打包链路里的冗余`，也改到了 `build()`），所以分支 rebase 到 `ed90237` 之后才落盘；唯一的冲突是 `build()` 的 `name` 形参——取 master 去掉形参简化，其余不动。rebase 后重跑了完整构建与启动冒烟，结果与上表一致。

**未验证 / 已确认**

- **Tauri 打包环节：已确认。** 覆盖层在构建目录里有 24 个符号链接，在 `MomentOCR.app` 里是 **0 个**——Tauri 会把它们展平成实体副本。所以「bundler 丢链接导致覆盖层起不来」这个风险不存在（展平后能从挂载的 dmg 里正常启动），而 `copytree(symlinks=True)` 对最终安装包体积也没有影响（收益全部来自精简清单）。之前把这一处的风险写成「可能让收益归零」是错的，已更正。
- **Windows 新增的两个删除项**（`Qt5WebSockets.dll` / `Qt5QmlWorkerScript.dll`）**没有 PE 校验兜底**——悬空引用校验跳过 PE。这两个与旧清单里已删的那些同类（由 `qwebgl.dll` 反向链接引入）；windows-x64 job 通过，但 NSIS/MSI 不解析依赖，所以真机运行仍没被单独验证。
- `_internal` 之外的主可执行文件不参与扫描（macOS 实测它只链系统库）。
- 解析器对损坏输入的健壮性没做（`_cstr` 在无 NUL 时抛 `ValueError`、FAT 头的 `nfat_arch` 是无界循环）。只在人为截断/伪造的二进制上触发，正常构建产物不会。
- 布局断言假定用的是 PyPI 版 PyQt5。本地用发行版（apt 等）PyQt5 的人会直接失败而不是静默不瘦身——这是有意的，错误信息里给了出路。

**Journey log**

1. **直接照搬 Windows 清单会发出一个起不来的 macOS 包。** 第一版按「macOS 就是 Windows 的路径换个名字」写，悬空校验当场指出 `libqcocoa.dylib --@rpath/QtPrintSupport--> 缺失`。先用 `otool -L` 确认不是弱链接，再在独立进程里 dlopen 复现 `Library not loaded: @rpath/QtPrintSupport`，才定下 `DROP_QT_MODULES_KEEP = {"Darwin": {"PrintSupport"}}`。校验器第一次运行就赚回了自己。
2. **「平台插件一律算致命」这个初版分级太粗**，被 `libqvnc.so` 打回来：它也在 `plugins/platforms/` 下，也链接 `libQt5Network`，Linux 构建会被自己的清单拦下。改成只把 `REQUIRED_PLATFORM_PLUGIN`（各平台唯一必需的那个）算致命。
3. **第一次的 Linux 端到端模拟不成立。** 我删的是整个 wheel，而真实 bundle 只含 PyInstaller 收进去的子集，于是 `libQt5Quick3D` 这类不在产物里的库也被算成悬空、报出 69 条假致命。改成先按 `_modules_info` 推出「实际会被收集的文件」再拼 bundle，才拿到可用结论。**模拟的边界必须和真实产物的边界对齐，否则结论全废。**
4. **`shutil.copytree()` 默认 `symlinks=False`。** macOS 上把 48 个链接展开成实体副本，构建目录 66.9 MB 变 133 MB；同一原因让 `dir_size()` 跟随链接把同一份二进制算好几遍，「瘦身前 133.2 MB」那个假数字就出自这里。只做 Windows 时两者都不会暴露。**但它其实不影响交付**——CI 证明 Tauri 打包时照样展平，所以这一步只是让中间目录与日志数字诚实，不是体积收益的来源；当时把它说成「差点让收益归零」是判断错了。
5. **本机验证不出的东西，只有真流水线能补——CI 一跑就现形了两处。** 第一版把「可选插件悬空」判成只提示不失败；这个分级在 Qt 语义上没错（Qt 确实只会跳过一个加载不了的插件），但漏掉了**打包器**那一层：`linuxdeploy` 会解析整个 AppDir 的 `DT_NEEDED`，撞上被删的 `libQt5Svg.so.5` 就直接中止。我在本地 mock 了 Linux 的近似 bundle、逐文件推演过依赖，都没能预先发现，因为本机没有 Rust、跑不了 `tauri build`。同一趟 CI 也顺带回答了本地无法回答的 Tauri 展平问题——**同一份检测结果，对「运行时」和「打包器」是两个结论，后者只能靠真流水线暴露。**
5. **悬空校验必须做「瘦身前后差集」。** Linux 侧基线就有 1025 条悬空（`$ORIGIN` 展开后落在 bundle 内的系统库名，如 `libc.so.6`）。不做差集全是假失败，校验形同虚设。

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

- **只对瘦身后新增的悬空引用报错**。瘦身前后各算一次悬空集合，只对差集报错。这样 PyInstaller 输出里本来就有的悬空引用（`@rpath` 指向未收集的库、ELF 里按 rpath 展开后落在 bundle 内的系统库名——CI 实测 Linux 侧基线就有 1025 条）不会造成假失败。
- **检测到就删掉，而不是只报告**。这一步最初写的是「分致命与可选两级，可选插件只提示」，CI 第一次跑就把这个设计否了：AppImage 的 **`linuxdeploy` 会解析整个 AppDir 的 `DT_NEEDED`，只要有解析不了的依赖就直接中止打包**——Linux job 挂在 `ERROR: Could not find dependency: libQt5Svg.so.5`（`imageformats/libqsvg.so`、`iconengines/libqsvgicon.so` 还引用着被删掉的 `libQt5Svg.so.5`）。而一个引用了已删文件的插件本来也加载不了，删掉它不会让任何还能用的东西失效。所以现在 `drop_broken_referrers()` 反复删掉这些引用方，直到没有新的悬空引用为止（`libqvnc.so` 这类可选平台插件也在里面）。

  唯一不能自动删的是**必需的平台插件和插件之外的二进制**（`is_load_bearing()`：Windows `qwindows` / macOS `libqcocoa` / Linux `libqxcb`）——那些一旦悬空说明清单本身写错了，`check_dangling()` 直接让构建失败。分级逻辑还在，只是从「输出分两级」变成了「哪些能自动删、哪些必须报错」。

### 符号链接：保留是对的，但对最终安装包没有影响

`shutil.copytree()` 默认 `symlinks=False`，会把符号链接展开成实体副本。macOS 上 PyInstaller 用链接把 `_internal/QtCore` 指到框架里的真身，展开后一份 Qt 二进制在产物里存三份，构建目录 66.9 MB 变 133 MB。所以拷贝改用 `symlinks=True`；配套地 `dir_size()` 也改成不跟随符号链接，否则同一份二进制被算好几遍，打印的体积比实际占盘大一倍。

**但 CI 实测证明 Tauri 打包时照样会把它展平**：构建目录里 24 个符号链接，`MomentOCR.app/Contents/Resources/binaries/screenshot_overlay/` 里是 **0 个**（改动前的 0 个是 `copytree` 展平的，改动后的 0 个只能是 Tauri 展平的）。所以这一步的价值在于构建目录诚实、日志数字不再虚高，**对用户下载到的安装包体积没有影响**——真正的体积收益全部来自精简清单本身（见 Report 里的 DMG 实测）。

### 边界

- 只动 `scripts/build-overlay.py`，不改 CI workflow、不改 `tauri.*.conf.json`、不改覆盖层 Python 脚本。
- 瘦身逻辑仍然是「打包后删文件」，不引入 PyInstaller spec/`TOC` 层的过滤。
- `prune()` 的两道布局断言（`PyQt5/Qt5` 必须是目录、解析结果至少命中一条）假定用的是 **PyPI 版 PyQt5**。本地用发行版（apt 等）装的 PyQt5 其 Qt 库不在 `site-packages`、会被 PyInstaller 平铺到 `_internal` 根下，这时会硬失败而不是静默不瘦身——有意为之，错误信息里给了出路。

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
- [x] T4: 加构建期悬空引用校验（Mach-O / ELF，纯 Python）— acceptance: 正常清单下构建没有残留悬空引用；瘦身前就存在的悬空引用（Linux 实测 1025 条）不报错；必需的平台插件悬空会让构建失败 (covers: S2; depends: T2, T3)
- [x] T5: 真机验证 macOS 产物 — acceptance: 瘦身后产物启动成功（进程存活、stderr 无输出），关键二进制逐个 dlopen 成功 (covers: S2; depends: T2, T4)
- [x] T6: 修 `copytree` 不保留符号链接导致的构建目录体积虚高（macOS 上 66.9 MB 被撑到 133 MB）— acceptance: 构建目录保留 24 个符号链接，`dir_size` 与 `du -sh` 一致 (covers: S2; depends: T2)
- [x] T7: 清单失效时不静默：布局不是 `PyQt5/Qt5`、或解析结果零命中时直接让构建失败 — acceptance: 造出旧布局 `PyQt5/Qt/lib` 与「目录在但零命中」两种情况都触发失败并给出可操作的缘由 (covers: S2; depends: T1)
- [ ] T8: 自动删掉被精简删到加载不了的文件（`drop_broken_referrers`），修 Linux 上 AppImage 打包失败 — acceptance: 本机 macOS 自动删 3 个、Linux 近似 bundle 自动删 4 个且 0 条残留；CI 的 linux-x64 job 转绿 (covers: S2; depends: T4)
- [ ] T9: 用真流水线确认交付形态 — acceptance: `gh workflow run Release` 四平台绿；macos-x64 的 dmg 从 77 MB 降到 47 MB；挂载 dmg 后覆盖层无符号链接（Tauri 展平）且能启动 (covers: S2; depends: T2, T6)
