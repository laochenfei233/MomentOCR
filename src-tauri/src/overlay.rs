use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::Result;

/// Tauri 资源目录（安装版随包发布的脚本与二进制位于其下），启动时注入。
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// 随包分发的截图覆盖层：自带 Python 运行时的 PyQt5 程序。
/// 由 `scripts/build-overlay.py` 生成，由 tauri.conf.json 的 bundle.resources 随包发布。
#[cfg(windows)]
const OVERLAY_BINARY: &str = "binaries/screenshot_overlay/screenshot_overlay.exe";
#[cfg(not(windows))]
const OVERLAY_BINARY: &str = "binaries/screenshot_overlay/screenshot_overlay";

/// 随包覆盖层是否存在（Windows 安装包自带，所以截图组件不必再下载）
pub fn bundled_overlay() -> Option<PathBuf> {
    search_relative(OVERLAY_BINARY)
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

/// 查找随应用分发的脚本路径；找不到时返回原始文件名，交由调用方（Python 在当前工作目录查找）。
pub fn find_script(filename: &str) -> String {
    search_relative(&format!("scripts/{filename}"))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string())
}

/// 随应用分发的脚本目录。
///
/// 本地引擎的解释器要把这个目录写进 `._pth`（隔离模式下脚本目录不会自动进 sys.path），
/// 所以这里由已知脚本反推目录。
pub fn scripts_dir() -> Option<PathBuf> {
    for marker in ["rapidocr_recognize.py", "ocr_text.py", "screenshot_overlay.py"] {
        if let Some(path) = search_relative(&format!("scripts/{marker}")) {
            if let Some(dir) = path.parent() {
                return Some(dir.to_path_buf());
            }
        }
    }
    None
}

/// 覆盖层怎么启动：
/// 1. 随包的自带运行时程序（Windows 安装包自带，零下载）；
/// 2. 应用私有运行时里的 PyQt5（mac/Linux 按需装配，不碰系统环境）；
/// 3. 系统 Python 跑脚本（开发机兜底）。
enum OverlayTarget {
    Bundled(PathBuf),
    PrivatePython { python: PathBuf, script: PathBuf },
    SystemPython(String),
}

/// unix 上补可执行位：随包资源经 AppImage/deb 打包后个别情况下会丢权限位
#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mode = meta.permissions().mode();
        if mode & 0o111 == 0 {
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | 0o755));
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

/// 截图组件缺失时的可操作提示
pub const MISSING_HINT: &str =
    "截图组件尚未安装，请在「设置 → 截图」里点「下载并安装」（约 55 MB，装进应用自己的目录）";

pub struct OverlayManager {
    target: OverlayTarget,
    /// 框选松开鼠标直接识别（不显示工具栏）。传给覆盖层进程 —— 它读不到 webview 的 localStorage。
    instant: bool,
}

#[derive(Debug, Clone)]
pub enum OverlayResult {
    Ocr { path: String },
    Cancel,
}

impl OverlayManager {
    pub fn new(app: &tauri::AppHandle, instant: bool) -> Self {
        if let Some(program) = bundled_overlay() {
            return Self {
                target: OverlayTarget::Bundled(program),
                instant,
            };
        }

        if let Some(python) =
            crate::local_engine::private_python(app, crate::local_engine::Component::Screenshot)
        {
            let script = search_relative("scripts/screenshot_overlay.py")
                .unwrap_or_else(|| PathBuf::from("screenshot_overlay.py"));
            return Self {
                target: OverlayTarget::PrivatePython { python, script },
                instant,
            };
        }

        Self {
            target: OverlayTarget::SystemPython(find_script("screenshot_overlay.py")),
            instant,
        }
    }

    fn configure(&self) -> Command {
        let mut cmd = match &self.target {
            OverlayTarget::Bundled(program) => {
                ensure_executable(program);
                Command::new(program)
            }
            OverlayTarget::PrivatePython { python, script } => {
                let mut cmd = Command::new(python);
                cmd.arg(script);
                // 只用私有 site，不读用户的 site-packages
                cmd.env("PYTHONNOUSERSITE", "1");
                cmd.env("PYTHONUTF8", "1");
                cmd
            }
            OverlayTarget::SystemPython(script) => {
                let mut cmd = Command::new("python");
                cmd.arg(script);
                cmd
            }
        };
        if self.instant {
            cmd.arg("--instant");
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd
    }

    pub fn start_overlay(&self) -> Result<OverlayResult> {
        let mut cmd = self.configure();
        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take();
        let reader = BufReader::new(stdout);

        let stderr_reader = std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = String::new();
            if let Some(mut pipe) = stderr {
                let _ = pipe.read_to_string(&mut buf);
            }
            buf
        });

        let mut result = Ok(OverlayResult::Cancel);
        let timeout = Duration::from_secs(120);
        let start = std::time::Instant::now();

        for line in reader.lines() {
            if start.elapsed() > timeout {
                break;
            }

            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json_result) = serde_json::from_str::<serde_json::Value>(&line) {
                let action = json_result["action"].as_str().unwrap_or("");

                match action {
                    "ocr" => {
                        let path = json_result["path"].as_str().unwrap_or("").to_string();
                        result = Ok(OverlayResult::Ocr { path });
                        break;
                    }
                    "cancel" => {
                        result = Ok(OverlayResult::Cancel);
                        break;
                    }
                    _ => {}
                }
            }
        }

        let _ = child.wait();
        let stderr_text = stderr_reader.join().unwrap_or_default();

        // 系统 Python 缺 PyQt5 时报错很难懂，这里换成可操作的提示
        if matches!(self.target, OverlayTarget::SystemPython(_))
            && (stderr_text.contains("PyQt5") || stderr_text.contains("No module named"))
        {
            return Err(anyhow::anyhow!(MISSING_HINT));
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一个覆盖层管理器（不碰真实可执行文件查找），取出它会传给子进程的参数。
    fn overlay_args(instant: bool) -> Vec<String> {
        OverlayManager {
            target: OverlayTarget::SystemPython("screenshot_overlay.py".to_string()),
            instant,
        }
        .configure()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect()
    }

    /// `--instant` 是 Rust 和覆盖层进程之间唯一的模式约定（Python 侧读
    /// `'--instant' in sys.argv`）。这条钉住「前端设置 → 覆盖层命令行」这一段：
    /// 名字写错、忘了透传，都会在这里失败，而 Python 侧的自测覆盖不到它。
    #[test]
    fn instant_flag_is_passed_to_overlay() {
        assert!(overlay_args(true).iter().any(|arg| arg == "--instant"));
        assert!(!overlay_args(false).iter().any(|arg| arg == "--instant"));
    }

    /// 安装版把覆盖层放在 <安装目录>/binaries/screenshot_overlay/ 下
    /// （见 tauri.conf.json 的 bundle.resources 与 NSIS 脚本里的 $INSTDIR 路径），
    /// 这里造一份同样的目录结构，确认查找逻辑能命中。
    #[test]
    fn finds_bundled_overlay_in_resource_dir() {
        let root = std::env::temp_dir().join("momentocr-overlay-search-test");
        let nested = root.join("binaries").join("screenshot_overlay");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(
            nested.join(if cfg!(windows) {
                "screenshot_overlay.exe"
            } else {
                "screenshot_overlay"
            }),
            b"fake",
        )
        .unwrap();

        set_resource_dir(root.clone());

        let found = bundled_overlay().expect("应能在资源目录里找到覆盖层");
        assert_eq!(found.parent(), Some(nested.as_path()));

        let _ = std::fs::remove_dir_all(&root);
    }
}
