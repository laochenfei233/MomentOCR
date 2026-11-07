; 安装/卸载前结束残留的 llama-server。
;
; 本地翻译的推理器从 resources\llama-runtime\ 启动，会把同目录的 ggml-*.dll
; 加载并锁住；如果它没随应用退出（强杀应用、崩溃，或旧版本没有退出清理），
; NSIS 覆盖安装写这些 DLL 时会报「无法打开要写入的文件」，安装卡死。
; 卸载同理：文件删不掉会留下半个组件。
;
; nsExec::Exec 把返回码压栈，必须 Pop 掉，否则 NSIS 的栈会失衡。
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /f /im llama-server.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /f /im llama-server.exe'
  Pop $0
!macroend
