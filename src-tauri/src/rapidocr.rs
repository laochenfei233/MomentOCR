//! RapidOCR 本地识别引擎（脚本：scripts/rapidocr_recognize.py）。

use anyhow::Result;
use tauri::AppHandle;

/// RapidOCR 识别
pub fn recognize(app: &AppHandle, image_path: &str) -> Result<String> {
    super::recognizer::run_script(app, "rapidocr_recognize.py", image_path)
}
