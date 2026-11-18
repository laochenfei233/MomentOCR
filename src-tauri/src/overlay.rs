use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Tauri 资源目录（安装版随包发布的脚本位于其下），启动时注入。
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// 在候选根目录下查找某个相对路径。
///
/// 解析顺序全部基于运行时位置，不依赖任何硬编码的本地绝对路径：
/// 1. Tauri 资源目录（安装版首选，跨平台由 Tauri 提供正确位置）；
/// 2. 可执行文件所在目录及其上溯 4 层
///    —— 安装版命中 `<安装目录>/…`，开发版从 `src-tauri/target/<profile>/`
///    上溯到 `src-tauri/`；
/// 3. `CARGO_MANIFEST_DIR`（`cargo run` 启动时存在）；
/// 4. 当前工作目录（含 `src-tauri/` 前缀，`npm run tauri dev` 时命中）。
fn search_relative(relative: &str) -> Option<PathBuf> {
    if let Some(dir) = RESOURCE_DIR.get() {
        let candidate = dir.join(relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        let mut dir = exe_path.parent();
        for _ in 0..4 {
            let Some(current) = dir else { break };
            let candidate = current.join(relative);
            if candidate.is_file() {
                return Some(candidate);
            }
            dir = current.parent();
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = Path::new(&manifest_dir).join(relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    for base in ["", "src-tauri/"] {
        let candidate = Path::new(&format!("{base}{relative}")).to_path_buf();
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// 随应用分发的脚本目录。
///
/// 本地引擎的解释器要把这个目录写进 `._pth`（隔离模式下脚本目录不会自动进 sys.path），
/// 所以这里由已知脚本反推目录。
pub fn scripts_dir() -> Option<PathBuf> {
    for marker in ["rapidocr_recognize.py", "ocr_text.py"] {
        if let Some(path) = search_relative(&format!("scripts/{marker}")) {
            if let Some(dir) = path.parent() {
                return Some(dir.to_path_buf());
            }
        }
    }
    None
}
