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

/// 拖动后同步位置到状态表（hide/show 周期后恢复原位用）
pub fn update_pin_position(id: &str, x: i32, y: i32) {
    let mut map = PIN_IMAGES.lock().unwrap();
    if let Some(p) = map.get_mut(id) {
        p.x = x as f64;
        p.y = y as f64;
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

/// 捕获包含物理坐标点 (cx, cy) 的显示器，返回物理像素原始帧（未编码）。
/// 帧不编码：从按键到出图的路径上不做 PNG 编码（4K 一帧要几百毫秒），
/// 显示与裁剪都直接用原始像素，编码交给后台任务。
pub fn capture_monitor_containing(cx: f64, cy: f64) -> Result<screenshots::image::RgbaImage> {
    let screens = Screen::all()?;
    if screens.is_empty() {
        return Err(anyhow::anyhow!("找不到可用屏幕"));
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

    screen.capture()
}

/// 显示器几何：物理原点 (x, y)、物理尺寸 (宽, 高)、缩放系数
pub type MonitorGeometry = (i32, i32, u32, u32, f64);

/// 会话显示器（本轮截图流程锁定的显示器），长截图续拍用
static SESSION_MONITOR: Lazy<Mutex<Option<MonitorGeometry>>> =
    Lazy::new(|| Mutex::new(None));

pub fn set_session_monitor(x: i32, y: i32, width: u32, height: u32, scale: f64) {
    *SESSION_MONITOR.lock().unwrap() = Some((x, y, width, height, scale));
}

pub fn get_session_monitor() -> Option<MonitorGeometry> {
    *SESSION_MONITOR.lock().unwrap()
}

/// 捕获会话显示器（无会话时退回主屏）
pub fn capture_session_monitor() -> Result<screenshots::image::RgbaImage> {
    let (x, y, w, h, _) = get_session_monitor()
        .ok_or_else(|| anyhow::anyhow!("没有会话显示器记录"))?;
    // 用显示器中心点定位
    capture_monitor_containing(
        x as f64 + w as f64 / 2.0,
        y as f64 + h as f64 / 2.0,
    )
}

/// 会话中的每块显示器：几何 + 该屏定格 PNG 的临时路径（多屏会话每屏一条）
#[derive(Clone, serde::Serialize)]
pub struct SessionMonitor {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub path: String,
}

static SESSION_MONITORS: Lazy<Mutex<Vec<SessionMonitor>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

pub fn set_session_monitors(monitors: Vec<SessionMonitor>) {
    *SESSION_MONITORS.lock().unwrap() = monitors;
}

pub fn get_session_monitors() -> Vec<SessionMonitor> {
    SESSION_MONITORS.lock().unwrap().clone()
}

/// 后台编码完成后回填某屏的 PNG 落盘路径（历史回放/长截图续拍用）
pub fn set_session_monitor_path(index: usize, path: String) {
    if let Some(m) = SESSION_MONITORS.lock().unwrap().get_mut(index) {
        m.path = path;
    }
}

/// 会话原始帧（与 SESSION_MONITORS 同索引）。裁剪直接读它：
/// 用户框选可能在 PNG 落盘之前完成，等文件就会引入几百毫秒到数秒的延迟。
/// 会话原始帧条目（Arc 便于后台编码与裁剪共享同一块像素）
type FrameSlot = Option<std::sync::Arc<screenshots::image::RgbaImage>>;

static SESSION_FRAMES: Lazy<Mutex<Vec<FrameSlot>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn set_session_frames(frames: Vec<screenshots::image::RgbaImage>) {
    *SESSION_FRAMES.lock().unwrap() = frames
        .into_iter()
        .map(|f| Some(std::sync::Arc::new(f)))
        .collect();
}

/// 取某屏的原始帧（克隆 Arc，锁即刻释放）
pub fn session_frame(index: usize) -> Option<std::sync::Arc<screenshots::image::RgbaImage>> {
    SESSION_FRAMES
        .lock()
        .unwrap()
        .get(index)
        .and_then(|f| f.clone())
}

/// overlay 显示用的每屏 JPEG base64（后台编码完成后填充）
static DISPLAY_IMAGES: Lazy<Mutex<Vec<Option<String>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn set_display_image(index: usize, base64: String) {
    let mut images = DISPLAY_IMAGES.lock().unwrap();
    if images.len() <= index {
        images.resize(index + 1, None);
    }
    images[index] = Some(base64);
}

pub fn display_image(index: usize) -> Option<String> {
    DISPLAY_IMAGES
        .lock()
        .unwrap()
        .get(index)
        .and_then(|s| s.clone())
}

/// 显示用 JPEG（有损，但体积比 PNG 小一个数量级：4K 约 0.6–1 MB vs 8–15 MB）。
/// overlay 只是背景，画质损失不可见；OCR 仍走无损帧。
/// 用 jpeg-encoder（SIMD）而不是 image 自带的编码器：4K 单帧 240ms → 约 90ms。
pub fn encode_display_jpeg(frame: &screenshots::image::RgbaImage) -> Result<String> {
    use jpeg_encoder::{ColorType, Encoder};
    let mut buf = Vec::new();
    Encoder::new(&mut buf, 85)
        .encode(
            frame.as_raw(),
            frame.width() as u16,
            frame.height() as u16,
            ColorType::Rgba,
        )
        .map_err(|e| anyhow::anyhow!("JPEG 编码失败: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

/// 无损 PNG（OCR/历史/长截图的源），编码较慢，只在后台跑
pub fn encode_png(frame: &screenshots::image::RgbaImage) -> Result<Vec<u8>> {
    let mut buf = Cursor::new(Vec::new());
    frame.write_to(&mut buf, screenshots::image::ImageOutputFormat::Png)?;
    Ok(buf.into_inner())
}

/// 跨屏裁剪输出：临时文件路径 + base64（保存/复制/贴图直接用字节）
#[derive(serde::Serialize)]
pub struct CropOutput {
    pub path: String,
    pub base64: String,
}

/// 显示器几何（不抓屏）。建窗与抓屏要并行，所以先枚举、后抓：
/// 枚举只读 display_info，几毫秒；抓屏几百毫秒。
#[derive(Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// 枚举全部显示器的几何信息（不抓屏）
pub fn enumerate_monitors(app: &tauri::AppHandle) -> Result<Vec<MonitorInfo>> {
    let screens = Screen::all()?;
    if screens.is_empty() {
        return Err(anyhow::anyhow!("找不到可用屏幕"));
    }
    let tauri_monitors = app.available_monitors().unwrap_or_default();
    Ok(screens
        .iter()
        .map(|screen| {
            let d = &screen.display_info;
            let scale = tauri_monitors
                .iter()
                .find(|m| {
                    m.position().x == d.x
                        && m.position().y == d.y
                        && m.size().width == d.width
                        && m.size().height == d.height
                })
                .map(|m| m.scale_factor())
                .unwrap_or(d.scale_factor as f64);
            MonitorInfo {
                x: d.x,
                y: d.y,
                width: d.width,
                height: d.height,
                scale,
            }
        })
        .collect())
}

/// 抓全部显示器。
/// 串行而非并行：GDI 抓屏要从显存读回，两个线程同时 BitBlt 会互相抢显存带宽，
/// 实测并行反而比串行慢（315ms vs ~200ms），所以这里老老实实一块一块来。
pub fn capture_all_monitors(app: &tauri::AppHandle) -> Result<Vec<screenshots::image::RgbaImage>> {
    let count = enumerate_monitors(app)?.len();
    let mut frames = Vec::with_capacity(count);
    for i in 0..count {
        frames.push(capture_index(i)?);
    }
    Ok(frames)
}

/// 抓第 index 块屏
fn capture_index(index: usize) -> Result<screenshots::image::RgbaImage> {
    let screens = Screen::all()?;
    let screen = screens
        .get(index)
        .ok_or_else(|| anyhow::anyhow!("显示器列表发生变化"))?;
    screen.capture()
}

// ============ 跨屏选区会话 ============

/// 跨屏选区的共享状态：所有 overlay 窗口把全局物理坐标上报到 Rust，
/// 由 Rust 广播给每个窗口渲染。覆盖层铺满全部屏幕，拖拽期间的 move/up
/// 必然落在某个窗口上，因此不需要全局鼠标钩子。
#[derive(Clone, Default, serde::Serialize)]
pub struct SelectionState {
    pub dragging: bool,
    pub start: Option<(f64, f64)>,
    pub current: (f64, f64),
}

impl SelectionState {
    /// 归一化后的全局物理矩形 (x, y, w, h)；未开始拖拽时为 None
    pub fn rect(&self) -> Option<(f64, f64, f64, f64)> {
        let (sx, sy) = self.start?;
        let (cx, cy) = self.current;
        Some((
            sx.min(cx),
            sy.min(cy),
            (sx - cx).abs(),
            (sy - cy).abs(),
        ))
    }
}

static SELECTION: Lazy<Mutex<SelectionState>> = Lazy::new(|| Mutex::new(SelectionState::default()));

/// 当前会话是否为「松开即识别」模式（instant）
static SESSION_INSTANT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 最后一次用户活动时刻（空闲超时用）
static LAST_ACTIVITY: Lazy<Mutex<std::time::Instant>> =
    Lazy::new(|| Mutex::new(std::time::Instant::now()));

pub fn set_session_instant(instant: bool) {
    SESSION_INSTANT.store(instant, std::sync::atomic::Ordering::SeqCst);
}

pub fn is_session_instant() -> bool {
    SESSION_INSTANT.load(std::sync::atomic::Ordering::SeqCst)
}

pub fn touch_activity() {
    *LAST_ACTIVITY.lock().unwrap() = std::time::Instant::now();
}

pub fn activity_elapsed_secs() -> u64 {
    LAST_ACTIVITY.lock().unwrap().elapsed().as_secs()
}

pub fn selection_down(x: f64, y: f64) {
    *SELECTION.lock().unwrap() = SelectionState {
        dragging: true,
        start: Some((x, y)),
        current: (x, y),
    };
}

pub fn selection_move(x: f64, y: f64) {
    let mut s = SELECTION.lock().unwrap();
    if s.dragging {
        s.current = (x, y);
    }
}

pub fn selection_up() {
    SELECTION.lock().unwrap().dragging = false;
}

/// 清空选区（历史切换/贴图后继续框选等场景）
pub fn selection_clear() {
    *SELECTION.lock().unwrap() = SelectionState::default();
}

/// 单击吸附窗口：直接采纳完整矩形
pub fn selection_set_rect(x: f64, y: f64, w: f64, h: f64) {
    *SELECTION.lock().unwrap() = SelectionState {
        dragging: false,
        start: Some((x, y)),
        current: (x + w, y + h),
    };
}

pub fn selection_snapshot() -> SelectionState {
    SELECTION.lock().unwrap().clone()
}

/// 清空会话状态（显示器列表、选区、原始帧、显示图、instant 标记）
pub fn clear_session() {
    SESSION_MONITORS.lock().unwrap().clear();
    SESSION_FRAMES.lock().unwrap().clear();
    DISPLAY_IMAGES.lock().unwrap().clear();
    *SELECTION.lock().unwrap() = SelectionState::default();
    SESSION_INSTANT.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// 会话是否还在进行（显示器列表非空）。
/// overlay 窗口被外部关闭（Alt+F4）时用它区分「正常收尾中」和「会话仍活着」。
pub fn session_active() -> bool {
    !SESSION_MONITORS.lock().unwrap().is_empty()
}

/// 从会话原始帧中裁剪全局物理矩形（可跨屏）。
/// 各屏帧本就处于同一全局物理坐标系（screens crate 按物理像素逐屏捕获，
/// 显示器在虚拟桌面平铺），把每块屏的交集部分按「交集原点 − 选区原点」原样
/// 摆放即可 1:1 无缝重建选区内容，输出尺寸 = 选区全局物理尺寸。
/// 不做跨屏密度归一：密度差异是屏幕的真实像素密度，重采样反而引入失真。
pub fn crop_session_region(rect: (f64, f64, f64, f64)) -> Result<Vec<u8>> {
    use screenshots::image::{imageops, ImageOutputFormat, RgbaImage};

    let (rx, ry, rw, rh) = rect;
    if rw < 1.0 || rh < 1.0 {
        anyhow::bail!("选区太小");
    }
    let (rx, ry) = (rx.round() as i32, ry.round() as i32);
    let (rw, rh) = (rw.round().max(1.0) as u32, rh.round().max(1.0) as u32);

    let monitors = get_session_monitors();
    let mut canvas = RgbaImage::new(rw, rh);
    let mut painted = false;
    for (i, m) in monitors.iter().enumerate() {
        let ix = rx.max(m.x);
        let iy = ry.max(m.y);
        let ix2 = (rx + rw as i32).min(m.x + m.width as i32);
        let iy2 = (ry + rh as i32).min(m.y + m.height as i32);
        if ix2 <= ix || iy2 <= iy {
            continue;
        }
        let Some(frame) = session_frame(i) else { continue };
        let crop = imageops::crop_imm(
            frame.as_ref(),
            (ix - m.x) as u32,
            (iy - m.y) as u32,
            (ix2 - ix) as u32,
            (iy2 - iy) as u32,
        )
        .to_image();
        imageops::overlay(&mut canvas, &crop, (ix - rx) as i64, (iy - ry) as i64);
        painted = true;
    }
    if !painted {
        anyhow::bail!("选区不在任何屏幕内");
    }
    let mut buf = Cursor::new(Vec::new());
    canvas.write_to(&mut buf, ImageOutputFormat::Png)?;
    Ok(buf.into_inner())
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
            return Err(anyhow::anyhow!("没有可拼接的截图"));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_ring_keeps_last_10_and_steps_within_bounds() {
        for i in 0..12 {
            push_history(format!("/tmp/frame-{i}.png"));
        }
        // 只保留最近 10 张
        let last = history_step(0).unwrap();
        assert_eq!(last, "/tmp/frame-11.png");
        // 连续向前 9 步都在界内，不会越界到更早被挤出的帧
        let mut cur = last;
        for i in (2..11).rev() {
            cur = history_step(-1).unwrap();
            assert_eq!(cur, format!("/tmp/frame-{i}.png"));
        }
        // 到头后继续向前停在第一帧
        assert_eq!(history_step(-1).unwrap(), cur);
        // 重复 push 同一帧不产生重复项
        push_history(cur.clone());
        assert_eq!(history_step(0).unwrap(), cur);
    }
}
