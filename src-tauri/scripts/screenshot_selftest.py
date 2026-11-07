"""
须臾OCR - 截图组件自检

装完得确认 PyQt5 真能起来。用 offscreen 平台插件创建窗口，不依赖显示器，
所以 CI 和服务器上也能跑（截图本身才需要真实桌面）。

输出一行 JSON。
"""

import json
import os
import sys

import ocr_text


def main():
    ocr_text.configure_stdout()
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    try:
        from PyQt5.QtCore import QT_VERSION_STR
        from PyQt5.QtWidgets import QApplication, QWidget

        app = QApplication.instance() or QApplication(sys.argv)
        widget = QWidget()
        widget.resize(120, 80)
        widget.show()
        app.processEvents()

        from importlib.metadata import version

        print(json.dumps({
            "success": True,
            "data": "PyQt5 {} / Qt {}".format(version("PyQt5"), QT_VERSION_STR),
        }, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"success": False, "error": "{}: {}".format(type(exc).__name__, exc)},
                         ensure_ascii=False))


if __name__ == "__main__":
    main()
