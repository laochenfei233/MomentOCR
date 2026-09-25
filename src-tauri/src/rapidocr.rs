use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use anyhow::Result;

/// RapidOCR 识别
pub fn recognize(image_path: &str) -> Result<String> {
    let script_path = super::overlay::find_script("rapidocr_recognize.py");

    let mut cmd = Command::new("python");
    cmd.arg(&script_path);
    cmd.arg(image_path);
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
        return Err(anyhow::anyhow!("RapidOCR returned empty result"));
    }

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

/// 检查RapidOCR是否已安装（rapidocr_onnxruntime 或 rapidocr）
pub fn check_installed() -> bool {
    let mut cmd = Command::new("python");
    cmd.arg("-c");
    cmd.arg("try:\n import rapidocr_onnxruntime\nexcept ImportError:\n import rapidocr\nprint('installed')");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if let Ok(child) = cmd.spawn() {
        if let Ok(output) = child.wait_with_output() {
            return String::from_utf8_lossy(&output.stdout).contains("installed");
        }
    }
    false
}

/// 安装RapidOCR
pub fn install() -> Result<String> {
    let mut cmd = Command::new("pip");
    cmd.arg("install");
    cmd.arg("rapidocr_onnxruntime");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let child = cmd.spawn()?;
    let output = child.wait_with_output()?;

    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        Ok("RapidOCR安装成功".to_string())
    } else {
        Err(anyhow::anyhow!("安装失败: {}", stderr))
    }
}
