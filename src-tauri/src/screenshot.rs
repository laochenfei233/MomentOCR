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

    /// 从已有的全屏截图中裁剪区域
    pub fn crop_region(full_screen_data: &[u8], x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;
        use std::io::Cursor;
        
        let img = Reader::new(Cursor::new(full_screen_data))
            .with_guessed_format()?
            .decode()?;
        
        let cropped = img.crop_imm(x as u32, y as u32, width, height);
        let mut buf = Cursor::new(Vec::new());
        cropped.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
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
