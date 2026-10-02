//! OCR 脚本的统一调用层。
//!
//! 脚本跑在「本地引擎的隔离运行时」里（见 local_engine.rs）：应用不带 Python，
//! 用户也不用配环境；没装本地引擎时这里会给出可操作的提示。

use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};

use anyhow::Result;
use tauri::AppHandle;

/// 只保留文本尾部。子进程的报错动辄整屏堆栈，全量回传前端反而是噪音。
fn tail(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count <= limit {
        return trimmed.to_string();
    }
    trimmed.chars().skip(count - limit).collect()
}

/// 运行识别脚本并返回识别出的文本。
///
/// stdout 只认以 `{` 开头的行：引擎的日志/告警走的是 stderr，但万一混进 stdout
/// 也不会被当成识别结果。stderr 用独立线程读干净——管道写满会把子进程卡死，
/// 出错时这段内容还是唯一的线索。
pub fn run_script(app: &AppHandle, script_name: &str, image_path: &str) -> Result<String> {
    let env = super::local_engine::prepare(app, super::local_engine::Component::Ocr)?;
    let script_path = env.scripts_dir.join(script_name);

    let mut cmd = Command::new(&env.python);
    cmd.arg(&script_path);
    cmd.arg(image_path);
    cmd.current_dir(&env.scripts_dir);
    // 只用私有 site，不读用户的 site-packages
    cmd.env("PYTHONNOUSERSITE", "1");
    // 结果由 Rust 侧按 UTF-8 逐行解析，固定编码避免被本地代码页改写
    cmd.env("PYTHONUTF8", "1");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("无法读取 {} 的输出", script_name))?;
    let stderr = child.stderr.take();

    let stderr_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut pipe) = stderr {
            let _ = pipe.read_to_string(&mut buf);
        }
        buf
    });

    let mut payload = String::new();
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        let candidate = line.trim();
        if candidate.starts_with('{') {
            payload = candidate.to_string();
            break;
        }
    }

    let _ = child.wait();
    let stderr_text = stderr_reader.join().unwrap_or_default();

    if payload.is_empty() {
        let detail = tail(&stderr_text, 400);
        return Err(anyhow::anyhow!(
            "识别脚本没有返回结果{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!("：{}", detail)
            }
        ));
    }

    let json: serde_json::Value = serde_json::from_str(&payload)?;
    if json["success"].as_bool().unwrap_or(false) {
        return Ok(json["data"].as_str().unwrap_or("").to_string());
    }
    Err(anyhow::anyhow!(
        "{}",
        json["error"].as_str().unwrap_or("识别失败")
    ))
}
