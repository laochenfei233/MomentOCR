# -*- coding: utf-8 -*-
"""截图覆盖层选区的自测：离屏 Qt，不需要真实桌面，也不弹窗。

覆盖交互逻辑本身：
  · 默认模式松手出工具栏（不是直接识别）
  · 拉四角把手扩大选区后，「识别」裁出来的是新选区（不是松手时那个）
  · 拖选区内部平移
  · 工具栏跟随选区移动
  · 即时模式松手直接出结果、不弹工具栏
  · 小于 10×10 的选区两种模式都不出结果
  · ESC 取消

不覆盖：`main()` 里 `'--instant' in sys.argv` 那一行透传。它由 Rust 侧钉住
（src-tauri/src/overlay.rs 的 instant_flag_is_passed_to_overlay）——本脚本直接构造
ScreenshotOverlay，绕过了命令行解析。

放在顶层 scripts/ 而不是 src-tauri/scripts/：后者的 *.py 会被 tauri 的 bundle.resources
打进安装包，测试没必要跟着发布。

用法：python scripts/test-screenshot-overlay.py（退出码 0 = 全部通过）
"""

import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src-tauri" / "scripts"))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt5.QtCore import QEvent, QPoint, Qt  # noqa: E402
from PyQt5.QtGui import QColor, QKeyEvent, QMouseEvent, QPixmap  # noqa: E402
from PyQt5.QtWidgets import QApplication  # noqa: E402

import screenshot_overlay as overlay_mod  # noqa: E402

APP = QApplication.instance() or QApplication(sys.argv[:1])


class Capture:
    """收集一次交互期间的标准输出，并把临时文件导向一个干净目录。

    do_ocr 读 TEMP 决定裁剪结果落哪儿；不改的话测试会覆盖用户真实的
    %TEMP%/ocr_crop.png。
    """

    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="momentocr-overlay-test-")
        self.out = StringIO()
        self._old_temp = os.environ.get("TEMP")
        self._redirect = None

    def __enter__(self):
        os.environ["TEMP"] = self.tmp
        self._redirect = redirect_stdout(self.out)
        self._redirect.__enter__()
        return self

    def __exit__(self, *exc_info):
        self._redirect.__exit__(*exc_info)
        if self._old_temp is None:
            os.environ.pop("TEMP", None)
        else:
            os.environ["TEMP"] = self._old_temp
        return False

    @property
    def lines(self):
        return [line for line in self.out.getvalue().strip().splitlines() if line.strip()]

    def payload(self):
        assert len(self.lines) == 1, "应恰好输出一行 JSON，实际：%r" % (self.lines,)
        return json.loads(self.lines[0])


def make_overlay(instant=False):
    """造一个画布与窗口同尺寸的覆盖层：缩放系数恰好 1.0。

    这样裁切区域就等于选区本身，断言才能直接比数值；真机上物理像素和逻辑点是
    （可能是 2x）缩放关系，那种换算不适合当断言基准。
    """
    o = overlay_mod.ScreenshotOverlay(instant=instant)
    o.resize(800, 600)
    o.screenshot_pixmap = QPixmap(o.width(), o.height())
    o.screenshot_pixmap.fill(Qt.black)   # 固定底色，画出来的像素才可比
    assert o.screenshot_pixmap.width() > 0, "离屏平台下没拿到窗口尺寸"
    return o


def mouse_event(kind, x, y):
    return QMouseEvent(kind, QPoint(x, y), Qt.LeftButton, Qt.LeftButton, Qt.NoModifier)


def press(o, x, y):
    o.mousePressEvent(mouse_event(QEvent.MouseButtonPress, x, y))


def move(o, x, y):
    o.mouseMoveEvent(mouse_event(QEvent.MouseMove, x, y))


def release(o, x, y):
    o.mouseReleaseEvent(mouse_event(QEvent.MouseButtonRelease, x, y))


def drag(o, from_xy, to_xy):
    press(o, *from_xy)
    move(o, *to_xy)
    release(o, *to_xy)


def png_size(path):
    pixmap = QPixmap(path)
    assert not pixmap.isNull(), "裁剪结果没落盘：%s" % path
    return (pixmap.width(), pixmap.height())


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


@case
def test_no_selection_has_no_handles():
    o = make_overlay()
    assert o.hit_test(QPoint(10, 10)) is None


@case
def test_default_mode_shows_toolbar_instead_of_recognizing():
    o = make_overlay()
    with Capture() as cap:
        drag(o, (50, 50), (150, 150))
        assert cap.lines == [], "默认模式松手不该直接出结果：%r" % (cap.lines,)
    assert o.get_selection_rect() == (50, 50, 100, 100), o.get_selection_rect()
    assert o.toolbar is not None, "默认模式松手应弹出工具栏"


@case
def test_corner_drag_enlarges_and_crop_follows_the_new_selection():
    o = make_overlay()
    drag(o, (50, 50), (150, 150))
    assert o.toolbar is not None
    toolbar_before = o.toolbar.pos()

    assert o.hit_test(QPoint(150, 150)) == 'rb', o.hit_test(QPoint(150, 150))
    drag(o, (150, 150), (250, 250))

    assert o.get_selection_rect() == (50, 50, 200, 200), o.get_selection_rect()
    assert o.toolbar.pos() != toolbar_before, "工具栏应跟随选区移动"

    with Capture() as cap:
        o.do_ocr()
    payload = cap.payload()
    assert payload['action'] == 'ocr', payload
    assert png_size(payload['path']) == (200, 200), png_size(payload['path'])


@case
def test_drag_inside_moves_the_selection():
    o = make_overlay()
    drag(o, (100, 100), (200, 200))
    assert o.get_selection_rect() == (100, 100, 100, 100)

    assert o.hit_test(QPoint(150, 150)) == 'move', o.hit_test(QPoint(150, 150))
    drag(o, (150, 150), (160, 180))

    assert o.get_selection_rect() == (110, 130, 100, 100), o.get_selection_rect()


@case
def test_edge_drag_resizes_one_axis_only():
    o = make_overlay()
    drag(o, (100, 100), (200, 200))
    assert o.hit_test(QPoint(100, 150)) == 'l', o.hit_test(QPoint(100, 150))

    drag(o, (100, 150), (60, 150))
    # 只动了左边，高和上沿都不该变
    assert o.get_selection_rect() == (60, 100, 140, 100), o.get_selection_rect()


@case
def test_instant_mode_recognizes_on_release_without_toolbar():
    o = make_overlay(instant=True)
    with Capture() as cap:
        drag(o, (20, 20), (120, 120))
        payload = cap.payload()
    assert payload['action'] == 'ocr', payload
    assert o.toolbar is None, "即时模式不该弹工具栏"
    assert png_size(payload['path']) == (100, 100), png_size(payload['path'])


@case
def test_tiny_selection_does_nothing_in_either_mode():
    for instant in (False, True):
        o = make_overlay(instant=instant)
        with Capture() as cap:
            drag(o, (20, 20), (25, 25))
        assert cap.lines == [], "5×5 选区不该出结果：%r" % (cap.lines,)
        assert o.toolbar is None, instant
        assert o.get_selection_rect() is None, instant


@case
def test_paint_marks_the_handles_that_make_resizing_discoverable():
    """paintEvent 里那段画四角把手的代码没有别的入口，只能这样渲染出来看像素。"""
    o = make_overlay()
    drag(o, (50, 50), (150, 150))
    assert o.toolbar is not None

    canvas = QPixmap(o.width(), o.height())
    canvas.fill(Qt.black)
    o.render(canvas)
    with_toolbar = canvas.toImage().pixelColor(50, 50)

    # 同一个选区，把工具栏拿掉：把手就不该再画，角上只剩蓝色选框边
    o.toolbar.close()
    o.toolbar = None
    canvas2 = QPixmap(o.width(), o.height())
    canvas2.fill(Qt.black)
    o.render(canvas2)
    without_toolbar = canvas2.toImage().pixelColor(50, 50)

    assert with_toolbar == QColor(255, 255, 255), with_toolbar.name()
    assert without_toolbar != with_toolbar, "把手的绘制应由工具栏是否在决定"


@case
def test_degenerate_selection_is_refused_instead_of_cropping_the_whole_screen():
    """把左边把手拖到与右边重合：选区宽变成 0。

    QPixmap.copy 在宽/高为 0 时返回的是**整张画布**（实测），不拦住就会把整个虚拟
    桌面当成识别结果送出去。评审就是这么发现这条的。
    """
    o = make_overlay()
    drag(o, (50, 50), (250, 250))
    assert o.get_selection_rect() == (50, 50, 200, 200)

    assert o.hit_test(QPoint(50, 150)) == 'l', o.hit_test(QPoint(50, 150))
    drag(o, (50, 150), (250, 150))
    assert o.get_selection_rect() == (250, 50, 0, 200), o.get_selection_rect()

    with Capture() as cap:
        o.do_ocr()
    assert cap.lines == [], "零宽选区不该产出任何结果：%r" % (cap.lines,)


@case
def test_escape_cancels():
    o = make_overlay()
    with Capture() as cap:
        o.keyPressEvent(QKeyEvent(QEvent.KeyPress, Qt.Key_Escape, Qt.NoModifier))
    assert cap.payload() == {'action': 'cancel'}


def main():
    failed = 0
    for fn in CASES:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print("FAIL %s: %s: %s" % (fn.__name__, type(exc).__name__, exc))
        else:
            print("PASS %s" % fn.__name__)
    print("\n%d/%d 通过" % (len(CASES) - failed, len(CASES)))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
