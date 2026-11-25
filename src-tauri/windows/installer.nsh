; 安装/卸载前结束残留的 llama-server。
;
; 本地翻译的推理器从 resources\llama-runtime\ 启动，会把同目录的 ggml-*.dll
; 加载并锁住；如果它没随应用退出（强杀应用、崩溃，或旧版本没有退出清理），
; NSIS 覆盖安装写这些 DLL 时会报「无法打开要写入的文件」，安装卡死。
; 卸载同理：文件删不掉会留下半个组件。
;
; 只结束「本安装目录」下的 llama-server：按映像名的 taskkill 会误杀
; 其他用户会话/其他软件的同名进程（审计 run-1 加固项）。
; 用 Where-Object Path -eq 的简化语法，避免 $_ 写法与 NSIS 的 $ 变量转义打架。
;
; nsExec::Exec 把返回码压栈，必须 Pop 掉，否则 NSIS 的栈会失衡。
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'powershell -NoProfile -Command "Stop-Process -Force -ErrorAction SilentlyContinue -Id (Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object Path -eq \"$INSTDIR\resources\llama-runtime\llama-server.exe\").Id"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'powershell -NoProfile -Command "Stop-Process -Force -ErrorAction SilentlyContinue -Id (Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object Path -eq \"$INSTDIR\resources\llama-runtime\llama-server.exe\").Id"'
  Pop $0
!macroend
