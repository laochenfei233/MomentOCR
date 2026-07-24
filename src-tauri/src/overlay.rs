use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::time::Duration;
use anyhow::Result;

/// 截图覆盖窗口管理器
pub struct OverlayManager {
    python_script: String,
}

/// 从覆盖窗口返回的结果
#[derive(Debug, Clone)]
pub enum OverlayResult {
    Ocr { path: String, x: i32, y: i32, width: u32, height: u32 },
    Cancel,
}

impl OverlayManager {
    /// 创建新的覆盖窗口管理器
    pub fn new() -> Self {
        // 尝试多种路径找到Python脚本
        let python_script = Self::find_python_script();
        eprintln!("[OverlayManager] Python script path: {}", python_script);
        Self { python_script }
    }
    
    /// 查找Python脚本路径
    fn find_python_script() -> String {
        // 尝试1: CARGO_MANIFEST_DIR
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let path = std::path::Path::new(&manifest_dir)
                .join("scripts")
                .join("screenshot_overlay.py");
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }
        
        // 尝试2: 当前可执行文件目录
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                // 尝试 target/debug/scripts
                let path = exe_dir.join("scripts").join("screenshot_overlay.py");
                if path.exists() {
                    return path.to_string_lossy().to_string();
                }
                // 尝试 src-tauri/scripts (相对于target/debug)
                let path = exe_dir.parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("src-tauri").join("scripts").join("screenshot_overlay.py"));
                if let Some(p) = path {
                    if p.exists() {
                        return p.to_string_lossy().to_string();
                    }
                }
            }
        }
        
        // 尝试3: 硬编码路径
        let hardcoded = "C:\\Users\\chenfei\\Documents\\GitHub\\MomentOCR\\src-tauri\\scripts\\screenshot_overlay.py";
        if std::path::Path::new(hardcoded).exists() {
            return hardcoded.to_string();
        }
        
        // 默认路径
        "scripts/screenshot_overlay.py".to_string()
    }
    
    /// 启动覆盖窗口并等待结果
    pub fn start_overlay(&self, screenshot_path: Option<&str>) -> Result<OverlayResult> {
        eprintln!("[OverlayManager] Starting overlay with script: {}", self.python_script);
        
        let mut cmd = Command::new("python");
        cmd.arg(&self.python_script);
        
        if let Some(path) = screenshot_path {
            cmd.arg(path);
        }
        
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());
        
        eprintln!("[OverlayManager] Spawning Python process...");
        let mut child = cmd.spawn()?;
        eprintln!("[OverlayManager] Python process spawned with PID: {}", child.id());
        
        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        
        let mut result = Ok(OverlayResult::Cancel);
        let timeout = Duration::from_secs(60);
        let start = std::time::Instant::now();
        
        eprintln!("[OverlayManager] Waiting for Python output...");
        for line in reader.lines() {
            if start.elapsed() > timeout {
                eprintln!("[OverlayManager] Timeout waiting for Python output");
                break;
            }
            
            let line = line?;
            eprintln!("[OverlayManager] Got line: {}", line);
            
            if line.trim().is_empty() {
                continue;
            }
            
            if let Ok(json_result) = serde_json::from_str::<serde_json::Value>(&line) {
                let action = json_result["action"].as_str().unwrap_or("");
                eprintln!("[OverlayManager] Action: {}", action);
                
                match action {
                    "ocr" => {
                        let path = json_result["path"].as_str().unwrap_or("").to_string();
                        let x = json_result["x"].as_i64().unwrap_or(0) as i32;
                        let y = json_result["y"].as_i64().unwrap_or(0) as i32;
                        let width = json_result["width"].as_u64().unwrap_or(0) as u32;
                        let height = json_result["height"].as_u64().unwrap_or(0) as u32;
                        
                        result = Ok(OverlayResult::Ocr { path, x, y, width, height });
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
        
        let _ = child.kill();
        let _ = child.wait();
        
        result
    }
}

impl Default for OverlayManager {
    fn default() -> Self {
        Self::new()
    }
}
