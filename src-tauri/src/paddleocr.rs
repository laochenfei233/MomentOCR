use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use anyhow::Result;

/// PaddleOCR 识别
pub fn recognize(image_path: &str) -> Result<String> {
    let script_path = super::overlay::find_script("paddleocr_recognize.py");
    
    let mut cmd = Command::new("python");
    cmd.arg(&script_path);
    cmd.arg(image_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::inherit());
    
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    
    let mut result = String::new();
    for line in reader.lines() {
        let line = line?;
        if !line.trim().is_empty() {
            result = line;
            break;
        }
    }
    
    let _ = child.wait();
    
    if result.is_empty() {
        return Err(anyhow::anyhow!("PaddleOCR returned empty result"));
    }
    
    // 解析JSON，提取识别文字
    if let Ok(json_result) = serde_json::from_str::<serde_json::Value>(&result) {
        let success = json_result["success"].as_bool().unwrap_or(false);
        let data = json_result["data"].as_str().unwrap_or("");
        let error = json_result["error"].as_str().unwrap_or("");
        
        if success {
            return Ok(data.to_string());
        } else {
            return Err(anyhow::anyhow!("{}", error));
        }
    }
    
    Ok(result)
}

/// 检查PaddleOCR是否已安装
pub fn check_installed() -> bool {
    let mut cmd = Command::new("python");
    cmd.arg("-c");
    cmd.arg("import paddleocr; print('installed')");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    
    if let Ok(child) = cmd.spawn() {
        if let Ok(output) = child.wait_with_output() {
            return String::from_utf8_lossy(&output.stdout).contains("installed");
        }
    }
    false
}

/// 安装PaddleOCR
pub fn install() -> Result<String> {
    let mut cmd = Command::new("pip");
    cmd.arg("install");
    cmd.arg("paddlepaddle");
    cmd.arg("paddleocr");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    
    let child = cmd.spawn()?;
    let output = child.wait_with_output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    if output.status.success() {
        Ok("PaddleOCR安装成功".to_string())
    } else {
        Err(anyhow::anyhow!("安装失败: {}", stderr))
    }
}
