use anyhow::Result;
use screenshots::Screen;
use std::io::Cursor;
use std::path::PathBuf;
use chrono::Local;

pub struct ScreenshotManager;

impl ScreenshotManager {
    pub fn capture_full_screen() -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        let screen = screens.first().ok_or_else(|| anyhow::anyhow!("No screen found"))?;
        let image = screen.capture()?;
        let mut buf = Cursor::new(Vec::new());
        image.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        let screen = screens.first().ok_or_else(|| anyhow::anyhow!("No screen found"))?;
        let image = screen.capture_area(x, y, width, height)?;
        let mut buf = Cursor::new(Vec::new());
        image.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    pub fn save_to_file(data: &[u8], path: &PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, data)?;
        Ok(())
    }

    pub fn generate_temp_path(prefix: &str) -> PathBuf {
        let timestamp = Local::now().format("%Y%m%d_%H%M%S");
        let filename = format!("{}_{}.png", prefix, timestamp);
        std::env::temp_dir().join(filename)
    }
}
