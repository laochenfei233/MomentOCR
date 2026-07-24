use anyhow::Result;
use screenshots::Screen;
use std::io::Cursor;
use std::path::PathBuf;
use chrono::Local;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// 全局存储最近一次截图路径
static LAST_SCREENSHOT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub struct ScreenshotManager;

impl ScreenshotManager {
    /// 全屏截图 - 高质量PNG
    pub fn capture_full_screen() -> Result<Vec<u8>> {
        let screens = Screen::all()?;
        let screen = screens.first()
            .ok_or_else(|| anyhow::anyhow!("No screen found"))?;
        let image = screen.capture()?;
        let mut buf = Cursor::new(Vec::new());
        // PNG格式，无损压缩
        image.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 从全屏截图中裁剪区域 - 无损
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

    /// 保存截图路径供覆盖窗口使用
    pub fn set_last_screenshot(path: String) {
        *LAST_SCREENSHOT.lock().unwrap() = Some(path);
    }

    /// 获取截图路径
    pub fn get_last_screenshot() -> Option<String> {
        LAST_SCREENSHOT.lock().unwrap().clone()
    }
}
