use anyhow::Result;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use screenshots::Screen;
use chrono::Local;
use base64::Engine;

static LAST_SCREENSHOT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static LONG_SCREENSHOT_PATHS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub struct SnipasteManager;

impl SnipasteManager {
    /// 全屏截图 - 高质量PNG
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
        
        // 多屏幕拼接
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

    /// 从全屏截图中裁剪区域
    pub fn crop_region(data: &[u8], x: u32, y: u32, width: u32, height: u32) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;
        let img = Reader::new(Cursor::new(data)).with_guessed_format()?.decode()?;
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
        std::env::temp_dir().join(format!("{}_{}.png", prefix, timestamp))
    }

    /// 保存截图路径
    pub fn set_last_screenshot(path: String) {
        *LAST_SCREENSHOT.lock().unwrap() = Some(path);
    }

    /// 获取截图路径
    pub fn get_last_screenshot() -> Option<String> {
        LAST_SCREENSHOT.lock().unwrap().clone()
    }

    /// 图片转 base64
    pub fn image_to_base64(path: &str) -> Result<String> {
        let data = std::fs::read(path)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&data))
    }

    /// 添加长截图路径
    pub fn add_long_screenshot_path(path: String) {
        LONG_SCREENSHOT_PATHS.lock().unwrap().push(path);
    }

    /// 获取所有长截图路径
    pub fn get_long_screenshot_paths() -> Vec<String> {
        LONG_SCREENSHOT_PATHS.lock().unwrap().clone()
    }

    /// 清空长截图路径
    pub fn clear_long_screenshot_paths() {
        LONG_SCREENSHOT_PATHS.lock().unwrap().clear();
    }

    /// 拼接多张截图（垂直拼接，带重叠检测）
    pub fn stitch_screenshots(paths: &[String]) -> Result<Vec<u8>> {
        use screenshots::image::io::Reader;

        if paths.is_empty() {
            return Err(anyhow::anyhow!("No screenshots to stitch"));
        }

        if paths.len() == 1 {
            // 只有一张图片，直接返回
            return std::fs::read(&paths[0]).map_err(|e| e.into());
        }

        // 加载第一张图片
        let first_data = std::fs::read(&paths[0])?;
        let first_img = Reader::new(Cursor::new(first_data)).with_guessed_format()?.decode()?.to_rgba8();
        let mut result = first_img;
        let mut max_width = result.width();

        // 依次拼接后续图片
        for path in &paths[1..] {
            let data = std::fs::read(path)?;
            let new_img = Reader::new(Cursor::new(data)).with_guessed_format()?.decode()?.to_rgba8();

            if new_img.width() > max_width {
                max_width = new_img.width();
            }

            // 检测重叠区域
            let overlap = Self::find_overlap_rgba(&result, &new_img, 10);

            // 计算新图片需要拼接的高度（减去重叠部分）
            let new_height = new_img.height().saturating_sub(overlap);
            if new_height == 0 {
                continue; // 完全重叠，跳过
            }

            // 创建新的画布
            let total_height = result.height() + new_height;
            let mut canvas = screenshots::image::ImageBuffer::new(max_width, total_height);

            // 复制旧图片
            for y in 0..result.height() {
                for x in 0..result.width() {
                    canvas.put_pixel(x, y, *result.get_pixel(x, y));
                }
            }

            // 拼接新图片（跳过重叠部分）
            for y in overlap..new_img.height() {
                for x in 0..new_img.width() {
                    canvas.put_pixel(x, result.height() + y - overlap, *new_img.get_pixel(x, y));
                }
            }

            result = canvas;
        }

        let mut buf = Cursor::new(Vec::new());
        result.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
        Ok(buf.into_inner())
    }

    /// 检测两张 RGBA 图片的重叠区域（优化版本）
    fn find_overlap_rgba(old_img: &screenshots::image::RgbaImage, new_img: &screenshots::image::RgbaImage, tolerance: u8) -> u32 {
        let old_height = old_img.height();
        let new_height = new_img.height();
        let width = std::cmp::min(old_img.width(), new_img.width());

        // 从新图顶部向下扫描，找到与旧图底部匹配的行
        // 限制搜索范围为图片高度的 50%
        let search_limit = std::cmp::min(old_height, new_height) / 2;

        for offset in 0..search_limit {
            let old_y = old_height - 1 - offset;
            let new_y = offset;

            let mut match_count = 0;
            let mut total_pixels = 0;

            // 每隔 4 个像素采样，提高性能
            for x in (0..width).step_by(4) {
                let old_pixel = old_img.get_pixel(x, old_y);
                let new_pixel = new_img.get_pixel(x, new_y);

                let r_diff = (old_pixel[0] as i32 - new_pixel[0] as i32).unsigned_abs() as u8;
                let g_diff = (old_pixel[1] as i32 - new_pixel[1] as i32).unsigned_abs() as u8;
                let b_diff = (old_pixel[2] as i32 - new_pixel[2] as i32).unsigned_abs() as u8;
                let a_diff = (old_pixel[3] as i32 - new_pixel[3] as i32).unsigned_abs() as u8;

                if r_diff <= tolerance && g_diff <= tolerance && b_diff <= tolerance && a_diff <= tolerance {
                    match_count += 1;
                }
                total_pixels += 1;
            }

            let match_ratio = match_count as f64 / total_pixels as f64;
            if match_ratio >= 0.90 {
                // 找到重叠，返回重叠高度（偏移量 + 1）
                return offset + 1;
            }
        }

        0 // 没有找到重叠
    }

    /// 检测两张图片的重叠区域
    pub fn find_overlap(old_img_data: &[u8], new_img_data: &[u8], tolerance: u8) -> Result<u32> {
        use screenshots::image::io::Reader;
        
        let old_img = Reader::new(Cursor::new(old_img_data)).with_guessed_format()?.decode()?.to_rgba8();
        let new_img = Reader::new(Cursor::new(new_img_data)).with_guessed_format()?.decode()?.to_rgba8();
        
        let old_height = old_img.height();
        let new_height = new_img.height();
        let width = std::cmp::min(old_img.width(), new_img.width());
        
        // 从新图顶部向下扫描，找到与旧图底部匹配的行
        for offset in 0..std::cmp::min(old_height, new_height) {
            let old_y = old_height - 1 - offset;
            let new_y = offset;
            
            let mut match_count = 0;
            let mut total_pixels = 0;
            
            for x in 0..width {
                let old_pixel = old_img.get_pixel(x, old_y);
                let new_pixel = new_img.get_pixel(x, new_y);
                
                let r_diff = (old_pixel[0] as i32 - new_pixel[0] as i32).unsigned_abs() as u8;
                let g_diff = (old_pixel[1] as i32 - new_pixel[1] as i32).unsigned_abs() as u8;
                let b_diff = (old_pixel[2] as i32 - new_pixel[2] as i32).unsigned_abs() as u8;
                let a_diff = (old_pixel[3] as i32 - new_pixel[3] as i32).unsigned_abs() as u8;
                
                if r_diff <= tolerance && g_diff <= tolerance && b_diff <= tolerance && a_diff <= tolerance {
                    match_count += 1;
                }
                total_pixels += 1;
            }
            
            let match_ratio = match_count as f64 / total_pixels as f64;
            if match_ratio >= 0.95 {
                return Ok(offset as u32);
            }
        }
        
        Ok(0) // 没有找到重叠
    }
}

impl Default for SnipasteManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SnipasteManager {
    pub fn new() -> Self {
        Self
    }
}
