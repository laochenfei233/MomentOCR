use anyhow::Result;
use std::io::Cursor;
use std::path::PathBuf;
use base64::Engine;

pub struct ScreenshotManager;

impl ScreenshotManager {
    pub fn image_to_base64(path: &str) -> Result<String> {
        let data = std::fs::read(path)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&data))
    }
}
