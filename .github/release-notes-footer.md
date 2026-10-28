
## 下载

| 平台 | 文件 |
| --- | --- |
| Windows | `MomentOCR_*_x64-setup.exe`（NSIS，默认安装到 Program Files）/ `MomentOCR_*_x64_zh-CN.msi` |
| macOS | `.dmg`（Apple Silicon 与 Intel 各一个） |
| Linux | `.AppImage` / `.deb` / `.rpm` |

**两种安装包**：文件名带 `-local-inference` 的变体把 llama.cpp 推理器内置在安装包里
（安装包更大，首次启用本地翻译少下载约 23 MB）；标准版按需在设置里下载推理器。
两者软件本体完全一致（应用名、安装位置相同，可直接互相覆盖安装），二选一即可。

> macOS 安装包未做代码签名，首次打开需在「系统设置 → 隐私与安全性」中点击「仍要打开」。
