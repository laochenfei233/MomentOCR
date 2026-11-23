---
type: fixed
breaking: false
audience: user
commits: ac52eb6
---
截图时偶尔会把「须臾OCR」主窗口半透明地拍进冻结帧：hide 与 DWM 桌面合成存在竞态，托盘入口的 hide 还会排队到主线程、晚于抓屏生效。现在抓屏前先对主窗口做 DWM cloak 并等待合成落地，主窗口不再出现在截图里。
