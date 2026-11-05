---
type: fixed
breaking: false
audience: user
commits: 17a5057
---
截图定格后不点鼠标直接按 ESC 也能取消了：覆盖层现在是独立进程，之前抢不到键盘焦点，ESC 会漏回原来的应用，必须先在画面上点一下才生效；此外焦点落在「识别/取消」小工具栏上时按 ESC 同样会取消。
