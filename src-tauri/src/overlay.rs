use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use anyhow::Result;

/// 查找脚本文件路径。
///
/// 解析顺序全部基于运行时位置，不依赖任何硬编码的本地绝对路径：
/// 1. 可执行文件所在目录及其上溯 4 层内的 `scripts/`
///    —— 安装版命中 `<安装目录>/scripts/`，开发版从 `src-tauri/target/<profile>/`
///    上溯到 `src-tauri/scripts/`；
/// 2. `CARGO_MANIFEST_DIR`（`cargo run` 启动时存在）；
/// 3. 当前工作目录下的 `scripts/` 与 `src-tauri/scripts/`。
///
/// 均未命中时返回原始文件名，交由调用方（由 Python 在当前工作目录查找）。
pub fn find_script(filename: &str) -> String {
    search_script(filename)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string())
}

fn search_script(filename: &str) -> Option<PathBuf> {
    // 1) 可执行文件目录及上溯若干层
    if let Ok(exe_path) = std::env::current_exe() {
        let mut dir = exe_path.parent();
        for _ in 0..4 {
            let Some(current) = dir else { break };
            let candidate = current.join("scripts").join(filename);
            if candidate.is_file() {
                return Some(candidate);
            }
            dir = current.parent();
        }
    }

    // 2) cargo 运行环境
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = Path::new(&manifest_dir).join("scripts").join(filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 3) 当前工作目录
    for base in ["scripts", "src-tauri/scripts"] {
        let candidate = Path::new(base).join(filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

pub struct OverlayManager {
    python_script: String,
}

#[derive(Debug, Clone)]
pub enum OverlayResult {
    Ocr { path: String },
    Cancel,
}

impl OverlayManager {
    pub fn new() -> Self {
        let python_script = Self::find_python_script();
        Self { python_script }
    }
    
    fn find_python_script() -> String {
        super::overlay::find_script("screenshot_overlay.py")
    }
    
    pub fn start_overlay(&self) -> Result<OverlayResult> {
        let mut cmd = Command::new("python");
        cmd.arg(&self.python_script);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        
        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        
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
        result
    }
}

impl Default for OverlayManager {
    fn default() -> Self {
        Self::new()
    }
}
