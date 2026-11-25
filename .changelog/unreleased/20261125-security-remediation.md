---
type: fixed
breaking: false
audience: user
commits: d1fae9a af44c02 50675ac a96302e 0ac9cd1 a1fdfb2
---
安全修复（审计 run-1 全部 10 条）：本地引擎/推理器/模型与 CI 打包的下载全部加 sha256 校验；本地翻译通道加每启动随机 token 认证，不再复用无凭据的端口应答者；48 个应用命令接入 ACL 并按主窗/覆盖层/贴图三份能力清单授权；OCR 只能读会话图片或用户选择的文件；修复两处任意路径写；检查更新改用本地拼接的发布页 URL，镜像返回的链接不再驱动导航；截图临时文件统一进可清理目录。另含加固：CI action 固定 commit SHA、安装器按安装路径结束推理进程、release 启用 CSP/关闭 devtools 与 withGlobalTauri。
