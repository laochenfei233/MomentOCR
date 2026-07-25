"""
须臾OCR 截图覆盖窗口 - PyQt5实现
Python自己截图+显示+选区+裁剪，一步到位
"""

import sys
import json
import os
from PyQt5.QtWidgets import QApplication, QWidget, QPushButton, QHBoxLayout
from PyQt5.QtCore import Qt, QPoint, QRect
from PyQt5.QtGui import QPainter, QColor, QPixmap, QPen


class ScreenshotOverlay(QWidget):
    def __init__(self):
        super().__init__()
        
        # 无边框 + 置顶 + 不在任务栏
        self.setWindowFlags(
            Qt.FramelessWindowHint |
            Qt.WindowStaysOnTopHint |
            Qt.Tool
        )
        
        # 获取屏幕尺寸并设置全屏
        screen = QApplication.primaryScreen()
        self.setGeometry(screen.geometry())
        
        # 用Qt原生API截取屏幕（最快）
        self.screenshot_pixmap = screen.grabWindow(0)
        
        # 选区状态
        self.selection_start = None
        self.selection_end = None
        self.is_selecting = False
        self.toolbar = None
        
        self.setMouseTracking(True)
    
    def paintEvent(self, event):
        painter = QPainter(self)
        
        # 绘制截图
        painter.drawPixmap(0, 0, self.screenshot_pixmap)
        
        # 绘制半透明遮罩
        painter.setBrush(QColor(0, 0, 0, 80))
        painter.setPen(Qt.NoPen)
        painter.drawRect(0, 0, self.width(), self.height())
        
        # 绘制选区
        if self.selection_start and self.selection_end:
            rect = self.get_selection_rect()
            if rect:
                x, y, w, h = rect
                
                # 清除选区内遮罩（显示原始截图）
                painter.setCompositionMode(QPainter.CompositionMode_Clear)
                painter.drawRect(x, y, w, h)
                painter.setCompositionMode(QPainter.CompositionMode_SourceOver)
                
                # 绘制选区边框
                pen = QPen(QColor(0, 122, 255), 2)
                painter.setPen(pen)
                painter.setBrush(Qt.NoBrush)
                painter.drawRect(x, y, w, h)
                
                # 尺寸标签
                painter.setPen(QColor(255, 255, 255))
                painter.drawText(x + w // 2 - 30, y - 8, f"{w} x {h}")
        
        # 提示文字
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
    
    def show_toolbar(self, rect):
        x, y, w, h = rect
        
        if self.toolbar:
            self.toolbar.close()
        
        self.toolbar = QWidget()
        self.toolbar.setWindowFlags(
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.toolbar.setFixedSize(130, 36)
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
        
        toolbar_x = x + w // 2 - 65
        toolbar_y = y + h + 8
        self.toolbar.move(toolbar_x, toolbar_y)
        self.toolbar.show()
    
    def do_ocr(self, rect):
        x, y, w, h = rect
        
        # 裁剪选区
        cropped = self.screenshot_pixmap.copy(x, y, w, h)
        
        # 保存裁剪结果
        temp_path = os.path.join(os.environ.get('TEMP', '/tmp'), 'ocr_crop.png')
        cropped.save(temp_path, 'PNG')
        
        # 输出JSON结果
        result = {'action': 'ocr', 'path': temp_path}
        print(json.dumps(result))
        sys.stdout.flush()
        
        # 退出
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
    app = QApplication(sys.argv)
    overlay = ScreenshotOverlay()
    overlay.show()
    app.exec_()


if __name__ == '__main__':
    main()
