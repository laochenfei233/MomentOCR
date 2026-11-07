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

/// 贴图窗口数据表：id -> 数据（base64 图像 + 初始几何），供 pin 窗口启动后取回
#[derive(Clone, serde::Serialize)]
pub struct PinData {
    pub image_data: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

static PIN_IMAGES: Lazy<Mutex<std::collections::HashMap<String, PinData>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

static PIN_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn next_pin_id() -> u64 {
    PIN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

pub fn insert_pin(id: &str, data: PinData) {
    PIN_IMAGES.lock().unwrap().insert(id.to_string(), data);
}

pub fn get_pin(id: &str) -> Option<PinData> {
    PIN_IMAGES.lock().unwrap().get(id).cloned()
}

pub fn set_pin_visible(id: &str, visible: bool) -> Option<PinData> {
    let mut map = PIN_IMAGES.lock().unwrap();
    if let Some(p) = map.get_mut(id) {
        p.visible = visible;
        Some(p.clone())
    } else {
        None
    }
}

pub fn list_pins() -> Vec<(String, PinData)> {
    PIN_IMAGES
        .lock()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

pub fn remove_pin(id: &str) -> Option<PinData> {
    PIN_IMAGES.lock().unwrap().remove(id)
}

/// 单显示器捕获结果（物理像素图像 + 显示器几何）
pub struct MonitorCapture {
    pub png: Vec<u8>,
    pub scale: f64,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 捕获包含物理坐标点 (cx, cy) 的显示器
pub fn capture_monitor_containing(cx: f64, cy: f64) -> Result<MonitorCapture> {
    let screens = Screen::all()?;
    if screens.is_empty() {
        return Err(anyhow::anyhow!("No screen found"));
    }

    let screen = screens
        .iter()
        .find(|s| {
            let d = &s.display_info;
            cx >= d.x as f64
                && cx < (d.x + d.width as i32) as f64
                && cy >= d.y as f64
                && cy < (d.y + d.height as i32) as f64
        })
        .unwrap_or_else(|| screens.first().unwrap());

    let img = screen.capture()?;
    let d = &screen.display_info;
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
    Ok(MonitorCapture {
        png: buf.into_inner(),
        scale: d.scale_factor as f64,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
    })
}

/// 会话显示器（本轮截图流程锁定的显示器），长截图续拍用
static SESSION_MONITOR: Lazy<Mutex<Option<(i32, i32, u32, u32, f64)>>> =
    Lazy::new(|| Mutex::new(None));

pub fn set_session_monitor(x: i32, y: i32, width: u32, height: u32, scale: f64) {
    *SESSION_MONITOR.lock().unwrap() = Some((x, y, width, height, scale));
}

pub fn get_session_monitor() -> Option<(i32, i32, u32, u32, f64)> {
    *SESSION_MONITOR.lock().unwrap()
}

/// 捕获会话显示器（无会话时退回主屏）
pub fn capture_session_monitor() -> Result<MonitorCapture> {
    let (x, y, w, h, _) = get_session_monitor()
        .ok_or_else(|| anyhow::anyhow!("No session monitor"))?;
    // 用显示器中心点定位
    capture_monitor_containing(
        x as f64 + w as f64 / 2.0,
        y as f64 + h as f64 / 2.0,
    )
}

/// 截图历史环形缓冲（最近 10 张），供 overlay 历史回放
static HISTORY: Lazy<Mutex<std::collections::VecDeque<String>>> =
    Lazy::new(|| Mutex::new(std::collections::VecDeque::new()));
static HISTORY_INDEX: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(-1);

pub fn push_history(path: String) {
    let mut q = HISTORY.lock().unwrap();
    if q.back().map(|b| b == &path).unwrap_or(false) {
        HISTORY_INDEX.store(q.len() as isize - 1, std::sync::atomic::Ordering::Relaxed);
        return;
    }
    q.push_back(path);
    while q.len() > 10 {
        q.pop_front();
    }
    HISTORY_INDEX.store(q.len() as isize - 1, std::sync::atomic::Ordering::Relaxed);
}

/// 在历史中前后移动 delta 步，返回该帧路径
pub fn history_step(delta: isize) -> Option<String> {
    let q = HISTORY.lock().unwrap();
    if q.is_empty() {
        return None;
    }
    let len = q.len() as isize;
    let cur = HISTORY_INDEX.load(std::sync::atomic::Ordering::Relaxed);
    let next = (cur + delta).clamp(0, len - 1);
    HISTORY_INDEX.store(next, std::sync::atomic::Ordering::Relaxed);
    q.get(next as usize).cloned()
}

/// 窗口检测结果（物理坐标矩形）
#[derive(Clone, serde::Serialize)]
pub struct DetectRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 检测物理坐标点下的可见窗口（DWM 扩展边界，窗口级）
#[cfg(windows)]
pub fn detect_window_at(cx: i32, cy: i32) -> anyhow::Result<Option<DetectRect>> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE,
        WS_EX_TOOLWINDOW,
    };

    struct Ctx {
        cx: i32,
        cy: i32,
        self_pid: u32,
        result: Option<DetectRect>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut Ctx);
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if ex_style & (WS_EX_TOOLWINDOW.0 as isize) != 0 {
                return BOOL(1);
            }
            let mut pid = 0u32;
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == ctx.self_pid {
                return BOOL(1);
            }
            // cloaked（UWP 挂起等不可见窗口）跳过
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
            {
                return BOOL(1);
            }
            let mut rect = RECT::default();
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
            .is_err()
            {
                return BOOL(1);
            }
            // Z 序首个包含光标的窗口即最上层可见窗口
            if ctx.result.is_none()
                && ctx.cx >= rect.left
                && ctx.cx < rect.right
                && ctx.cy >= rect.top
                && ctx.cy < rect.bottom
            {
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                if w > 0 && h > 0 {
                    ctx.result = Some(DetectRect { x: rect.left, y: rect.top, width: w, height: h });
                }
            }
        }
        BOOL(1)
    }

    let mut ctx = Ctx {
        cx,
        cy,
        self_pid: std::process::id(),
        result: None,
    };
    unsafe {
        EnumWindows(Some(enum_proc), LPARAM(&mut ctx as *mut Ctx as isize))
            .map_err(|e| anyhow::anyhow!("EnumWindows failed: {e}"))?;
    }
    Ok(ctx.result)
}

#[cfg(not(windows))]
pub fn detect_window_at(_cx: i32, _cy: i32) -> anyhow::Result<Option<DetectRect>> {
    Ok(None)
}

pub struct SnipasteManager;

impl SnipasteManager {
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
