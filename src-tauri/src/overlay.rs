use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::time::Duration;
use anyhow::Result;

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
        // 尝试1: 硬编码路径（开发环境）
        let hardcoded = "C:\\Users\\chenfei\\Documents\\GitHub\\MomentOCR\\src-tauri\\scripts\\screenshot_overlay.py";
        if std::path::Path::new(hardcoded).exists() {
            return hardcoded.to_string();
        }
        
        // 尝试2: CARGO_MANIFEST_DIR
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let path = std::path::Path::new(&manifest_dir)
                .join("scripts")
                .join("screenshot_overlay.py");
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }
        
        // 尝试3: 可执行文件目录
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let path = exe_dir.join("scripts").join("screenshot_overlay.py");
                if path.exists() {
                    return path.to_string_lossy().to_string();
                }
            }
        }
        
        "screenshot_overlay.py".to_string()
    }
    
    pub fn start_overlay(&self) -> Result<OverlayResult> {
        let mut cmd = Command::new("python");
        cmd.arg(&self.python_script);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());
        
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
