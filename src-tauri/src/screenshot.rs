use anyhow::Result;
use screenshots::Screen;
use std::io::Cursor;
use std::path::PathBuf;
use chrono::Local;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static LAST_SCREENSHOT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub struct ScreenshotManager;

impl ScreenshotManager {
    /// 多屏幕全屏截图
    pub fn capture_full_screen() -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        if screens.is_empty() {
            return Err(anyhow::anyhow!("No screen found"));
        }
        
        if screens.len() == 1 {
            let img = screens[0].capture()?;
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
            return Ok(buf.into_inner());
        }
        
        let mut images: Vec<(Vec<u8>, u32, u32)> = Vec::new();
        let mut total_width: u32 = 0;
        let mut max_height: u32 = 0;
        
        for screen in &screens {
            let img = screen.capture()?;
            let info = &screen.display_info;
            total_width += info.width;
            if info.height > max_height {
                max_height = info.height;
            }
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
            images.push((buf.into_inner(), info.width, info.height));
        }
        
        use screenshots::image::io::Reader;
        let mut canvas = screenshots::image::ImageBuffer::new(total_width, max_height);
        let mut x_offset: u32 = 0;
        
        for (img_data, w, h) in &images {
            let img = Reader::new(Cursor::new(img_data)).with_guessed_format()?.decode()?;
            let dynamic = img.to_rgba8();
            for y in 0..*h {
                for x in 0..*w {
                    canvas.put_pixel(x + x_offset, y, *dynamic.get_pixel(x, y));
                }
            }
            x_offset += w;
        }
        
        let mut buf = Cursor::new(Vec::new());
        canvas.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    pub fn crop_region(data: &[u8], x: u32, y: u32, width: u32, height: u32) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;
        let img = Reader::new(Cursor::new(data)).with_guessed_format()?.decode()?;
        let cropped = img.crop_imm(x, y, width, height);
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
        let timestamp = Local::now().format("%Y%m%d_%H%M%S%3f");
        std::env::temp_dir().join(format!("{}_{}.png", prefix, timestamp))
    }

    pub fn set_last_screenshot(path: String) {
        *LAST_SCREENSHOT.lock().unwrap() = Some(path);
    }

    pub fn get_last_screenshot() -> Option<String> {
        LAST_SCREENSHOT.lock().unwrap().clone()
    }
}
