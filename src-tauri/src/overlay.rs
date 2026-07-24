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
        // 使用硬编码路径，确保运行时能找到脚本
        let python_script = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf().join("scripts").join("screenshot_overlay.py")))
            .unwrap_or_else(|| {
                // 回退到源代码目录
                let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
                std::path::Path::new(&manifest_dir).join("scripts").join("screenshot_overlay.py")
            })
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
        
        // 不要管道stderr，让它输出到控制台以便调试
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());
        
        let mut child = cmd.spawn()?;
        
        // 读取stdout获取结果
        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        
        let mut result = Ok(OverlayResult::Cancel);
        
        // 设置超时时间（60秒）
        let timeout = Duration::from_secs(60);
        let start = std::time::Instant::now();
        
        for line in reader.lines() {
            // 检查超时
            if start.elapsed() > timeout {
                break;
            }
            
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            
            // 解析JSON结果
            if let Ok(json_result) = serde_json::from_str::<serde_json::Value>(&line) {
                let action = json_result["action"].as_str().unwrap_or("");
                
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
        
        // 强制终止进程
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
