"""
须臾OCR 截图覆盖窗口 - PyQt5实现
支持多显示器截图
"""

import sys
import json
import os
from PyQt5.QtWidgets import QApplication, QWidget, QPushButton, QHBoxLayout
from PyQt5.QtCore import Qt, QPoint, QRect
from PyQt5.QtGui import QPainter, QColor, QPixmap, QPen


def capture_desktop(app, virtual_geometry):
    """逐屏抓取并拼成一张覆盖整个虚拟桌面的位图。

    为什么不一次抓整个虚拟桌面：一块屏一个缩放系数（内建 Retina 2x + 外接 1080p 1x
    很常见），而 grabWindow 一次只给一块屏、一个系数，跨屏的矩形在各平台上含义也不一致。
    逐屏拿到「该屏自己的系数」后，统一按最大的那个系数铺到同一张画布上，最清晰的那块屏
    就不会被降采样；系数不同的屏在这个环节被重采样，位置仍然准确。

    单屏时等价于原来的「一次抓整块屏」。
    """
    shots = []
    scale = 1.0

    for screen in app.screens():
        geo = screen.geometry()
        if geo.width() <= 0 or geo.height() <= 0:
            continue

        pixmap = screen.grabWindow(0, geo.x(), geo.y(), geo.width(), geo.height())
        if pixmap.isNull():
            continue

        # 「物理像素 / 逻辑点」的比例由返回尺寸反推，不读 devicePixelRatio
        # （并非所有平台/版本都会设这个值）。顺带把返回尺寸不是整数倍的情况挡在外面，
        # 免得把一块屏的内容错铺到另一块屏上。
        ratio = pixmap.width() / geo.width()
        if abs(ratio - round(ratio)) > 0.01 or not 1 <= round(ratio) <= 4:
            continue

        shots.append((geo, pixmap))
        scale = max(scale, ratio)

    if not shots:
        return QPixmap()

    canvas = QPixmap(
        int(round(virtual_geometry.width() * scale)),
        int(round(virtual_geometry.height() * scale)),
    )
    canvas.fill(Qt.black)

    painter = QPainter(canvas)
    for geo, pixmap in shots:
        # 位图自带的比例先抹平：下面一律按「整张像素 → 目标矩形」显式缩放，
        # 否则位图自己的 devicePixelRatio 会和这里的缩放叠乘
        pixmap.setDevicePixelRatio(1.0)
        painter.drawPixmap(
            QRect(
                int(round((geo.x() - virtual_geometry.x()) * scale)),
                int(round((geo.y() - virtual_geometry.y()) * scale)),
                int(round(geo.width() * scale)),
                int(round(geo.height() * scale)),
            ),
            pixmap,
        )
    painter.end()

    return canvas


MENUBAR_WINDOW_LEVEL = 25

# 覆盖层与工具栏的窗口层级。
#
# Qt 的 WindowStaysOnTopHint 只给到 floating 层，实测 layer=8，而程序坞是 20、菜单栏是 25
# —— 系统 UI 全都在上面。后果是「冻结画面」根本冻不住它们：屏幕上那一条程序坞是活的，
# 鼠标按在它上面时事件直接进程序坞、到不了覆盖层（想框选程序坞那一带连拖都起不了）。
# 抬到系统 UI 之上，才是「整屏定格 → 选区域」该有的样子，和系统自带截图工具一致；
# 定格画面里本来就拍到了程序坞和菜单栏（CGDisplayCreateImageForRect 两者都含），
# 所以抬上去之后看不出差别，只是它们变成了画面的一部分。
#
# 工具栏必须比覆盖层更高：它是独立的顶层窗口，低了会被覆盖层整个盖住（连按钮都看不见）。
OVERLAY_WINDOW_LEVEL = MENUBAR_WINDOW_LEVEL + 1
TOOLBAR_WINDOW_LEVEL = OVERLAY_WINDOW_LEVEL + 1


def mac_objc():
    """拿到 libobjc（objc_getClass / sel_registerName / objc_msgSend 的签名已配好）。

    非 macOS 或任何一步失败都返回 None，调用方静默放过：这些是外观上的锦上添花，
    坏了也不能影响截图本身。

    注意：macOS 11 起系统库都在 dyld 共享缓存里，os.path.exists 对这些路径返回 False，
    但 CDLL 仍能按路径打开 —— 所以别拿 os.path.exists 做前置判断；也不要用
    ctypes.util.find_library，实测它在本机返回 None（那样这段就静默失效了）。
    """
    if sys.platform != 'darwin':
        return None
    try:
        import ctypes

        objc = None
        for path in ('/usr/lib/libobjc.A.dylib', '/usr/lib/libobjc.dylib'):
            try:
                objc = ctypes.CDLL(path)
                break
            except OSError:
                continue
        if objc is None:
            return None

        # NSApplication / NSWindow 在 AppKit 里；先确保 AppKit 已加载，objc_getClass 才找得到
        for path in ('/System/Library/Frameworks/AppKit.framework/AppKit',
                     '/System/Library/Frameworks/Foundation.framework/Foundation'):
            try:
                ctypes.CDLL(path)
            except OSError:
                pass

        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        objc.objc_msgSend.restype = ctypes.c_void_p
        return objc
    except Exception:
        return None


def objc_send(objc, receiver, selector, *args):
    """调用一个 Objective-C 方法。objc_msgSend 是可变参数的，签名不能只配一次。

    argtypes 一旦设过就会一直是那个样子：前一个调用如果把签名配成三参数，
    后面所有两参数的调用都会 TypeError。所以这里每次按实参个数重建——
    这层包装存在的唯一理由就是别让签名在函数之间串味。
    """
    import ctypes

    argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    for arg in args:
        argtypes.append(ctypes.c_long if isinstance(arg, int) else ctypes.c_void_p)
    objc.objc_msgSend.argtypes = argtypes
    objc.objc_msgSend.restype = ctypes.c_void_p
    return objc.objc_msgSend(receiver, selector, *args)


def set_window_level(widget, level):
    """把窗口抬到指定层级（见 OVERLAY_WINDOW_LEVEL）。只能在 show() 之后调。

    取 NSWindow 的路径：Qt5 的 winId() 是 NSView*，还要再 [view window]；
    万一以后 winId() 直接给 NSWindow，那次 [window] 返回 NULL，就退回用它自己。
    """
    objc = mac_objc()
    if objc is None:
        return
    try:
        import ctypes

        handle = ctypes.c_void_p(int(widget.winId()))
        ns_window = objc_send(objc, handle, objc.sel_registerName(b'window')) or handle
        objc_send(objc, ns_window, objc.sel_registerName(b'setLevel:'), level)
    except Exception:
        pass


def hide_from_dock():
    """让覆盖层以「附件（accessory）」身份运行：不在 Dock 里露图标，也不占菜单栏。

    macOS 上 PyInstaller 打出来的是普通可执行文件（build-overlay.py 只给 Windows 加了
    --noconsole），没有 .app 外壳也就没有 Info.plist 里的 LSUIElement，于是弹窗时 Dock 会
    冒出一个通用黑色图标、还会把前台抢走。这里直接把 NSApplication 的 activation policy
    改成 Accessory —— 对「随包二进制」和「私有/系统 Python 跑脚本」两条路径都生效，
    不像改 .app 那样要动产物布局和查找路径。

    但这一步只够管住「运行期间」：真正把名字写进 Dock 的是**启动瞬间**。Qt 的 cocoa 插件
    在 QApplication 构造时会调用 TransformProcessType 把进程变成前台应用，系统当场就把它
    当成一个独立 App 记进 Dock 的「最近使用」，此后再改 policy 也只是撤掉图标，那条记录
    留在 plist 里不走（黑底 exec 图标，看着就像弹了个终端）。所以 main() 里还要用
    QT_MAC_DISABLE_FOREGROUND_APPLICATION_TRANSFORM 从源头拦住这次转变。

    用 ctypes 直接调 Objective-C 而不是 PyObjC：随包运行时里没有 PyObjC
    （PyInstaller 只打进被 import 的模块）。任何一步失败都静默放过：宁可外观不变，
    也不能让这段可选优化把截图弄坏（失败处理在 mac_objc 里）。
    """
    if sys.platform != 'darwin':
        return
    objc = mac_objc()
    if objc is None:
        return
    try:
        nsapp = objc_send(objc, objc.objc_getClass(b'NSApplication'),
                          objc.sel_registerName(b'sharedApplication'))
        if not nsapp:
            return

        # NSApplicationActivationPolicyAccessory = 1（Regular = 0，Prohibited = 2）。
        # 必须在 QApplication 建好之后再设：Qt 自己会在初始化时把它设成 Regular。
        objc_send(objc, nsapp, objc.sel_registerName(b'setActivationPolicy:'), 1)
    except Exception:
        pass


class ScreenshotOverlay(QWidget):
    TOOLBAR_W = 130
    TOOLBAR_H = 36
    GAP = 8

    def __init__(self):
        super().__init__()
        
        self.setWindowFlags(
            Qt.FramelessWindowHint |
            Qt.WindowStaysOnTopHint |
            Qt.Tool
        )
        
        # 获取所有屏幕的虚拟桌面区域
        app = QApplication.instance()
        screens = app.screens()
        
        # 计算所有屏幕的总区域（虚拟桌面）
        virtual_geometry = screens[0].virtualGeometry()
        for screen in screens[1:]:
            virtual_geometry = virtual_geometry.united(screen.virtualGeometry())
        
        # 设置窗口覆盖整个虚拟桌面
        self.setGeometry(virtual_geometry)
        
        # 截取整个虚拟桌面（所有屏幕）
        self.screenshot_pixmap = capture_desktop(app, virtual_geometry)
        
        # 选区状态
        self.selection_start = None
        self.selection_end = None
        self.is_selecting = False
        self.toolbar = None
        
        self.setMouseTracking(True)
    
    def paintEvent(self, event):
        painter = QPainter(self)
        
        # 1. 绘制截图（所有屏幕）
        #    显式铺满窗口的逻辑矩形：画布是物理像素，按 (0, 0) 原尺寸画会只露出左上角一块。
        #    铺满之后，to_pixmap_rect 正好是这一步的逆运算 —— 裁出来的就是看到的
        painter.drawPixmap(self.rect(), self.screenshot_pixmap)
        
        # 2. 绘制半透明遮罩
        painter.setBrush(QColor(0, 0, 0, 80))
        painter.setPen(Qt.NoPen)
        painter.drawRect(0, 0, self.width(), self.height())
        
        # 3. 选区内重新绘制截图
        if self.selection_start and self.selection_end:
            rect = self.get_selection_rect()
            if rect:
                x, y, w, h = rect
                
                # 重新绘制选区内的截图
                # 目标矩形用逻辑坐标，源矩形换算成画布像素，与上面铺满整张图保持一致
                sx, sy, sw, sh = self.to_pixmap_rect(x, y, w, h)
                if sw > 0 and sh > 0:
                    painter.drawPixmap(x, y, w, h, self.screenshot_pixmap, sx, sy, sw, sh)
                
                # 选区边框
                pen = QPen(QColor(0, 122, 255), 2)
                painter.setPen(pen)
                painter.setBrush(Qt.NoBrush)
                painter.drawRect(x, y, w, h)
                
                # 尺寸标签
                painter.setPen(QColor(255, 255, 255))
                painter.drawText(x + w // 2 - 30, y - 8, f"{w} x {h}")
        
        # 4. 提示文字
        if not self.is_selecting and not self.selection_start:
            painter.setPen(QColor(255, 255, 255))
            painter.drawText(self.width() // 2 - 120, self.height() // 2, "拖拽选择要识别的区域 · ESC 取消")
        
        painter.end()
    
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            if self.toolbar:
                self.toolbar.close()
                self.toolbar = None
            self.is_selecting = True
            self.selection_start = QPoint(event.x(), event.y())
            self.selection_end = QPoint(event.x(), event.y())
            self.update()
    
    def mouseMoveEvent(self, event):
        if self.is_selecting:
            self.selection_end = QPoint(event.x(), event.y())
            self.update()
    
    def mouseReleaseEvent(self, event):
        if event.button() == Qt.LeftButton and self.is_selecting:
            self.is_selecting = False
            rect = self.get_selection_rect()
            if rect and rect[2] > 10 and rect[3] > 10:
                self.show_toolbar(rect)
            else:
                self.selection_start = None
                self.selection_end = None
                self.update()
    
    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.cancel()
    
    def get_selection_rect(self):
        if not self.selection_start or not self.selection_end:
            return None
        x = min(self.selection_start.x(), self.selection_end.x())
        y = min(self.selection_start.y(), self.selection_end.y())
        w = abs(self.selection_end.x() - self.selection_start.x())
        h = abs(self.selection_end.y() - self.selection_start.y())
        return (x, y, w, h)

    def to_pixmap_rect(self, x, y, w, h):
        """逻辑坐标（窗口 / 鼠标事件）→ 位图像素矩形 (x, y, w, h)。

        分母用窗口的**实际**逻辑尺寸，而不是 __init__ 里 setGeometry 请求的尺寸：系统可能
        对无边框置顶窗口做约束（macOS 上不让盖住菜单栏就是常见一种），那种情况下二者不等，
        只有按实际尺寸换算才能保证「裁出来的 = 覆盖层里看到的」。也因此必须用时计算，
        不能缓存在 __init__ 里 —— show() 之前读到的还没被约束。
        """
        scale_x = self.screenshot_pixmap.width() / self.width() if self.width() else 1.0
        scale_y = self.screenshot_pixmap.height() / self.height() if self.height() else 1.0

        sx = int(round(x * scale_x))
        sy = int(round(y * scale_y))
        sw = int(round(w * scale_x))
        sh = int(round(h * scale_y))

        # 夹回位图范围：换算取整后越界 1px，copy / 取源矩形会带出透明（黑）边
        sx = max(0, min(sx, self.screenshot_pixmap.width()))
        sy = max(0, min(sy, self.screenshot_pixmap.height()))
        sw = max(0, min(sw, self.screenshot_pixmap.width() - sx))
        sh = max(0, min(sh, self.screenshot_pixmap.height() - sy))
        return (sx, sy, sw, sh)
    
    def toolbar_position(self, rect):
        """工具栏该落到哪儿（屏幕坐标）：优先贴选区下沿，下沿容不下就翻到上沿。

        边界必须按「选区所在那块屏的可用区域」算，不能拿覆盖层窗口比：覆盖层横跨所有
        显示器，self.height() 是整个虚拟桌面的高度，主屏底部的选区据此会以为下面还有半屏，
        工具栏就被放到隔壁显示器上；可用区域还扣掉了菜单栏和程序坞，工具栏才不会压在那上面。
        """
        x, y, w, h = rect
        app = QApplication.instance()
        center = self.mapToGlobal(QPoint(x + w // 2, y + h // 2))
        screen = next(
            (s for s in app.screens() if s.geometry().contains(center)),
            app.primaryScreen(),
        )
        area = screen.availableGeometry()

        # 横向以选区中心对齐，再夹回可用区域：贴边的选区不至于把工具栏顶出屏幕
        gx = max(
            area.left(),
            min(center.x() - self.TOOLBAR_W // 2, area.right() - self.TOOLBAR_W + 1),
        )

        # 纵向：下沿外侧优先；下沿放不下就翻到上沿外侧；选区占满整屏时贴着可用区域顶部
        top = self.mapToGlobal(QPoint(x, y))
        gy = top.y() + h + self.GAP
        if gy + self.TOOLBAR_H > area.bottom() + 1:
            gy = top.y() - self.TOOLBAR_H - self.GAP
        return QPoint(gx, max(area.top(), gy))

    def show_toolbar(self, rect):
        if self.toolbar:
            self.toolbar.close()
        
        self.toolbar = QWidget()
        self.toolbar.setWindowFlags(
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.toolbar.setFixedSize(self.TOOLBAR_W, self.TOOLBAR_H)
        self.toolbar.setStyleSheet("background: white; border-radius: 6px;")
        
        layout = QHBoxLayout(self.toolbar)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)
        
        ocr_btn = QPushButton("识别")
        ocr_btn.setFixedSize(56, 28)
        ocr_btn.setStyleSheet("""
            QPushButton { background: #007AFF; color: white; border: none; border-radius: 4px; font-size: 12px; }
            QPushButton:hover { background: #0066DD; }
        """)
        ocr_btn.clicked.connect(lambda: self.do_ocr(rect))
        
        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedSize(56, 28)
        cancel_btn.setStyleSheet("""
            QPushButton { background: #F0F0F0; color: #333; border: none; border-radius: 4px; font-size: 12px; }
            QPushButton:hover { background: #E0E0E0; }
        """)
        cancel_btn.clicked.connect(self.cancel)
        
        layout.addWidget(ocr_btn)
        layout.addWidget(cancel_btn)
        
        # 工具栏位置
        self.toolbar.move(self.toolbar_position(rect))
        self.toolbar.show()
        # 工具栏是独立顶层窗口，得比覆盖层更高，否则会被定格画面整个盖住
        set_window_level(self.toolbar, TOOLBAR_WINDOW_LEVEL)
    
    def do_ocr(self, rect):
        x, y, w, h = rect
        
        # 裁剪选区：坐标要换算成位图像素，否则截到的是错位且只有一半大小的区域
        sx, sy, sw, sh = self.to_pixmap_rect(x, y, w, h)
        cropped = self.screenshot_pixmap.copy(sx, sy, sw, sh)
        
        # 保存裁剪结果
        temp_path = os.path.join(os.environ.get('TEMP', '/tmp'), 'ocr_crop.png')
        cropped.save(temp_path, 'PNG')
        
        # 输出JSON结果
        result = {'action': 'ocr', 'path': temp_path}
        print(json.dumps(result))
        sys.stdout.flush()
        
        QApplication.quit()
    
    def cancel(self):
        result = {'action': 'cancel'}
        print(json.dumps(result))
        sys.stdout.flush()
        QApplication.quit()
    
    def closeEvent(self, event):
        if self.toolbar:
            self.toolbar.close()
        event.accept()


def main():
    # macOS：拦住 Qt 把本进程变成「前台应用」的那次转变（Qt 在 QApplication 构造时做）。
    # 变过一次，系统就把它记进 Dock 的「最近使用」，之后每次截图都冒出一条
    # screenshot_overlay（黑底 exec 图标），关掉覆盖层也不消失。必须在 QApplication 之前
    # 设置：转变一旦发生，ctypes 里那次 setActivationPolicy 只能撤图标，撤不掉已写进
    # Dock plist 的记录。
    if sys.platform == 'darwin':
        os.environ.setdefault('QT_MAC_DISABLE_FOREGROUND_APPLICATION_TRANSFORM', '1')

    app = QApplication(sys.argv)
    hide_from_dock()
    overlay = ScreenshotOverlay()
    overlay.show()
    # 截图先定格（__init__ 里抓的），再抬到系统 UI 之上：顺序反过来没影响，
    # 但抬层级要在 show() 之后，窗口还没创建时 winId() 拿不到 NSWindow。
    set_window_level(overlay, OVERLAY_WINDOW_LEVEL)
    app.exec_()


if __name__ == '__main__':
    main()
