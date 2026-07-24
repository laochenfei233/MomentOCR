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
    /// 多屏幕全屏截图 - 拼接所有屏幕
    pub fn capture_full_screen() -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        
        if screens.is_empty() {
            return Err(anyhow::anyhow!("No screen found"));
        }
        
        // 如果只有一个屏幕，直接截图
        if screens.len() == 1 {
            let img = screens[0].capture()?;
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
            return Ok(buf.into_inner());
        }
        
        // 多个屏幕：逐个截图，最后拼接
        let mut images: Vec<Vec<u8>> = Vec::new();
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
            images.push(buf.into_inner());
        }
        
        // 使用 image crate 拼接
        use screenshots::image::io::Reader;
        use std::io::Cursor;
        
        let mut canvas = screenshots::image::ImageBuffer::new(total_width, max_height);
        let mut x_offset: u32 = 0;
        
        for img_data in &images {
            let img = Reader::new(Cursor::new(img_data))
                .with_guessed_format()?
                .decode()?;
            
            let dynamic = img.to_rgba8();
            let (w, h) = dynamic.dimensions();
            
            for y in 0..h {
                for x in 0..w {
                    let pixel = dynamic.get_pixel(x, y);
                    canvas.put_pixel(x + x_offset, y, *pixel);
                }
            }
            
            x_offset += w;
        }
        
        let mut buf = Cursor::new(Vec::new());
        canvas.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 从全屏截图中裁剪区域
    pub fn crop_region(
        full_screen_data: &[u8],
        x: u32, y: u32,
        width: u32, height: u32
    ) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;
        
        let img = Reader::new(Cursor::new(full_screen_data))
            .with_guessed_format()?
            .decode()?;
        
        let cropped = img.crop_imm(x, y, width, height);
        let mut buf = Cursor::new(Vec::new());
        cropped.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 保存到文件
    pub fn save_to_file(data: &[u8], path: &PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, data)?;
        Ok(())
    }

    /// 生成临时文件路径
    pub fn generate_temp_path(prefix: &str) -> PathBuf {
        let timestamp = Local::now().format("%Y%m%d_%H%M%S%3f");
        let filename = format!("{}_{}.png", prefix, timestamp);
        std::env::temp_dir().join(filename)
    }

    /// 保存截图路径
    pub fn set_last_screenshot(path: String) {
        *LAST_SCREENSHOT.lock().unwrap() = Some(path);
    }

    /// 获取截图路径
    pub fn get_last_screenshot() -> Option<String> {
        LAST_SCREENSHOT.lock().unwrap().clone()
    }
}
