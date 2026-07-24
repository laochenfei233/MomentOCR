use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
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
        // 获取Python脚本路径 - 从源代码目录查找
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .unwrap_or_else(|_| ".".to_string());
        
        let python_script = std::path::Path::new(&manifest_dir)
            .join("scripts")
            .join("screenshot_overlay.py")
            .to_string_lossy()
            .to_string();
        
        Self { python_script }
    }
    
    /// 启动覆盖窗口并等待结果
    pub fn start_overlay(&self, screenshot_path: Option<&str>) -> Result<OverlayResult> {
        let mut cmd = Command::new("python");
        cmd.arg(&self.python_script);
        
        if let Some(path) = screenshot_path {
            cmd.arg(path);
        }
        
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        
        let mut child = cmd.spawn()?;
        
        // 读取stdout获取结果
        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            
            // 解析JSON结果
            if let Ok(result) = serde_json::from_str::<serde_json::Value>(&line) {
                let action = result["action"].as_str().unwrap_or("");
                
                match action {
                    "ocr" => {
                        let path = result["path"].as_str().unwrap_or("").to_string();
                        let x = result["x"].as_i64().unwrap_or(0) as i32;
                        let y = result["y"].as_i64().unwrap_or(0) as i32;
                        let width = result["width"].as_u64().unwrap_or(0) as u32;
                        let height = result["height"].as_u64().unwrap_or(0) as u32;
                        
                        return Ok(OverlayResult::Ocr { path, x, y, width, height });
                    }
                    "cancel" => {
                        return Ok(OverlayResult::Cancel);
                    }
                    _ => {}
                }
            }
        }
        
        Ok(OverlayResult::Cancel)
    }
}

impl Default for OverlayManager {
    fn default() -> Self {
        Self::new()
    }
}
