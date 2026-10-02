//! PaddleOCR 本地识别引擎（脚本：scripts/paddleocr_recognize.py）。
//!
//! 应用内置的本地引擎只装 RapidOCR；PaddleOCR 体积大（paddlepaddle 就 290 MB 起），
//! 不随应用下载。它只在用户自备的 Python 环境里可用（见 MOMENTOCR_PYTHON 覆盖）。

use anyhow::Result;
use tauri::AppHandle;

/// PaddleOCR 识别
pub fn recognize(app: &AppHandle, image_path: &str) -> Result<String> {
    super::recognizer::run_script(app, "paddleocr_recognize.py", image_path)
}
