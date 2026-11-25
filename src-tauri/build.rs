fn main() {
    // 默认就会解析 src-tauri/permissions/**/* 生成应用命令 ACL（__app-acl__），
    // 运行时按窗口能力清单鉴权（审计 run-1: app-commands-without-acl-permissions）。
    tauri_build::build()
}
