"""
截图覆盖窗口 - 使用PyQt5实现全屏透明窗口
类似Snipaste/天若OCR的截图体验
"""

import sys
import json
import os
from PyQt5.QtWidgets import QApplication, QWidget, QPushButton, QVBoxLayout
from PyQt5.QtCore import Qt, QRect, QPoint
from PyQt5.QtGui import QPainter, QColor, QPixmap, QCursor
from PIL import Image
import mss

class ScreenshotOverlay(QWidget):
    def __init__(self, image_path=None):
        super().__init__()
        
        # 设置全屏透明窗口
        self.setWindowFlags(
            Qt.FramelessWindowHint |  # 无边框
            Qt.WindowStaysOnTopHint |  # 置顶
            Qt.Tool  # 不在任务栏显示
        )
        self.setAttribute(Qt.WA_TranslucentBackground)  # 透明背景
        
        # 获取屏幕尺寸
        screen = QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        self.setGeometry(screen_geometry)
        
        # 截图数据
        self.screenshot_pixmap = None
        self.load_screenshot(image_path)
        
        # 选择区域
        self.selection_start = None
        self.selection_end = None
        self.is_selecting = False
        
        # 工具栏
        self.toolbar = None
        
        # 设置鼠标追踪
        self.setMouseTracking(True)
        
    def load_screenshot(self, image_path=None):
        """加载截图"""
        if image_path and os.path.exists(image_path):
            self.screenshot_pixmap = QPixmap(image_path)
        else:
            # 截取全屏
            with mss.MSS() as sct:
                monitor = sct.monitors[1]  # 主屏幕
                screenshot = sct.grab(monitor)
                
                # 转换为PIL图像
                img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
                
                # 保存到临时文件
                temp_path = os.path.join(os.environ.get('TEMP', '/tmp'), 'temp_screenshot.png')
                img.save(temp_path, 'PNG')
                
                # 加载为QPixmap
                self.screenshot_pixmap = QPixmap(temp_path)
    
    def paintEvent(self, event):
        """绘制事件"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 绘制截图
        if self.screenshot_pixmap:
            painter.drawPixmap(0, 0, self.screenshot_pixmap)
        
        # 绘制半透明遮罩
        painter.setBrush(QColor(0, 0, 0, 77))  # 30%透明度
        painter.setPen(Qt.NoPen)
        painter.drawRect(0, 0, self.width(), self.height())
        
        # 绘制选区
        if self.selection_start and self.selection_end:
            rect = self.get_selection_rect()
            if rect:
                x, y, w, h = rect
                
                # 清除选区内的遮罩
                painter.setCompositionMode(QPainter.CompositionMode_Clear)
                painter.drawRect(x, y, w, h)
                painter.setCompositionMode(QPainter.CompositionMode_SourceOver)
                
                # 绘制选区边框
                painter.setBrush(Qt.NoBrush)
                painter.setPen(QColor(0, 122, 255))  # 蓝色边框
                painter.drawRect(x, y, w, h)
                
                # 绘制尺寸标签
                size_text = f"{w} × {h}"
                painter.setPen(QColor(255, 255, 255))
                painter.drawText(x + w // 2, y - 10, size_text)
        
        painter.end()
    
    def mousePressEvent(self, event):
        """鼠标按下"""
        if event.button() == Qt.LeftButton:
            self.is_selecting = True
            self.selection_start = QPoint(event.x(), event.y())
            self.selection_end = QPoint(event.x(), event.y())
            self.update()
    
    def mouseMoveEvent(self, event):
        """鼠标移动"""
        if self.is_selecting:
            self.selection_end = QPoint(event.x(), event.y())
            self.update()
    
    def mouseReleaseEvent(self, event):
        """鼠标释放"""
        if event.button() == Qt.LeftButton and self.is_selecting:
            self.is_selecting = False
            self.selection_end = QPoint(event.x(), event.y())
            
            rect = self.get_selection_rect()
            if rect and rect[2] > 10 and rect[3] > 10:
                # 显示工具栏
                self.show_toolbar(rect)
            else:
                # 选区太小，取消
                self.cancel()
    
    def get_selection_rect(self):
        """获取选择区域"""
        if not self.selection_start or not self.selection_end:
            return None
        
        x = min(self.selection_start.x(), self.selection_end.x())
        y = min(self.selection_start.y(), self.selection_end.y())
        w = abs(self.selection_end.x() - self.selection_start.x())
        h = abs(self.selection_end.y() - self.selection_start.y())
        
        return (x, y, w, h)
    
    def show_toolbar(self, rect):
        """在选区下方显示工具栏"""
        x, y, w, h = rect
        
        # 创建工具栏窗口
        self.toolbar = QWidget()
        self.toolbar.setWindowFlags(
            Qt.FramelessWindowHint | 
            Qt.WindowStaysOnTopHint |
            Qt.Tool
        )
        self.toolbar.setFixedSize(120, 36)
        
        # 工具栏布局
        layout = QVBoxLayout(self.toolbar)
        layout.setContentsMargins(4, 4, 4, 4)
        
        # 按钮容器
        btn_layout = QVBoxLayout()
        
        # 识别按钮
        ocr_btn = QPushButton("识别")
        ocr_btn.setFixedSize(52, 28)
        ocr_btn.setStyleSheet("""
            QPushButton {
                background-color: #007AFF;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 11px;
            }
            QPushButton:hover {
                background-color: #0066DD;
            }
        """)
        ocr_btn.clicked.connect(lambda: self.do_ocr(rect))
        btn_layout.addWidget(ocr_btn)
        
        # 取消按钮
        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedSize(52, 28)
        cancel_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0F0F0;
                color: #333;
                border: none;
                border-radius: 4px;
                font-size: 11px;
            }
            QPushButton:hover {
                background-color: #E0E0E0;
            }
        """)
        cancel_btn.clicked.connect(self.cancel)
        btn_layout.addWidget(cancel_btn)
        
        layout.addLayout(btn_layout)
        
        # 设置工具栏位置
        toolbar_x = x + w // 2 - 60
        toolbar_y = y + h + 10
        self.toolbar.move(toolbar_x, toolbar_y)
        self.toolbar.show()
    
    def do_ocr(self, rect):
        """执行OCR识别"""
        x, y, w, h = rect
        
        # 裁剪选区
        cropped = self.screenshot_pixmap.copy(x, y, w, h)
        
        # 保存到临时文件
        temp_path = os.path.join(os.environ.get('TEMP', '/tmp'), 'ocr_crop.png')
        cropped.save(temp_path, 'PNG')
        
        # 输出结果到stdout（供Tauri读取）
        result = {
            'action': 'ocr',
            'path': temp_path,
            'x': x,
            'y': y,
            'width': w,
            'height': h
        }
        print(json.dumps(result))
        sys.stdout.flush()
        
        # 关闭窗口并退出
        self.close()
        QApplication.quit()
    
    def cancel(self):
        """取消"""
        result = {'action': 'cancel'}
        print(json.dumps(result))
        sys.stdout.flush()
        self.close()
        QApplication.quit()
    
    def closeEvent(self, event):
        """关闭事件"""
        if self.toolbar:
            self.toolbar.close()
        event.accept()

def main():
    """主函数"""
    app = QApplication(sys.argv)
    
    # 从命令行参数获取截图路径
    image_path = sys.argv[1] if len(sys.argv) > 1 else None
    
    # 创建并显示覆盖窗口
    overlay = ScreenshotOverlay(image_path)
    overlay.show()
    
    sys.exit(app.exec_())

if __name__ == '__main__':
    main()
