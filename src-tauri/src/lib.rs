mod api;
#[cfg(windows)]
mod dxgi_capture;
mod local_engine;
mod overlay;
mod recognizer;
mod translate_engine;
mod snipaste;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use chrono::Local;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use once_cell::sync::Lazy;

/// 常驻行为的开关。设置在渲染进程的 localStorage 里，但「关闭窗口」和「点托盘」
/// 都发生在原生侧，跨 IPC 回读前端状态又要处理前端未就绪的情况，所以镜像一份。
struct AppState {
    close_to_tray: AtomicBool,
    show_on_tray_click: AtomicBool,
    /// 正在主动退出。置位后关闭请求不再被拦成「驻留托盘」，
    /// 否则「退出」会被自己的拦截吃掉，软件再也关不掉。
    quitting: AtomicBool,
    /// 启动时 exe 的修改时间。升级安装会替换磁盘上的 exe，随后安装器
    /// （MSI 的 Restart Manager 会发 WM_CLOSE）等我们退出。此时若仍按
    /// 「缩到托盘」处理，安装器等不到进程结束就强杀，托盘图标来不及注销，
    /// 通知区域里就会留下一个点一下就消失的幽灵图标。
    exe_mtime: Option<std::time::SystemTime>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            // 与设置项的默认值（最小化到托盘）对齐：前端还没同步设置就点关闭时，
            // 行为不该和设置里显示的反着来
            close_to_tray: AtomicBool::new(true),
            show_on_tray_click: AtomicBool::new(true),
            quitting: AtomicBool::new(false),
            exe_mtime: current_exe_mtime(),
        }
    }
}

fn current_exe_mtime() -> Option<std::time::SystemTime> {
    std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
}

/// 磁盘上的 exe 是否已被升级安装替换（修改时间晚于本进程启动时）
fn upgraded_on_disk(started: Option<std::time::SystemTime>) -> bool {
    is_newer(started, current_exe_mtime())
}

fn is_newer(started: Option<std::time::SystemTime>, now: Option<std::time::SystemTime>) -> bool {
    match (started, now) {
        (Some(started), Some(now)) => now > started,
        _ => false,
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 真退出。不能靠关窗口：`Window::close()` 同样会走一遍 CloseRequested，
/// 会再被驻留逻辑拦下来，变成点了「退出」却什么都没发生。
fn exit_now(app: &tauri::AppHandle) {
    app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn set_tray_behavior(app: tauri::AppHandle, close_to_tray: bool, show_on_click: bool) {
    let state = app.state::<AppState>();
    state.close_to_tray.store(close_to_tray, Ordering::SeqCst);
    state.show_on_tray_click.store(show_on_click, Ordering::SeqCst);
}

/// macOS 可选不驻留 Dock（后台驻留）：把进程切到 UIElement，Dock 与 Cmd+Tab
/// 都不再出现，只剩菜单栏托盘。设置存在前端 localStorage，由前端推送；
/// 其他平台没有 Dock 这个概念，空操作。
#[tauri::command]
fn set_dock_hidden(app: tauri::AppHandle, hidden: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(!hidden);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, hidden);
}

/// 把主窗口显示、取消最小化并置顶夺焦点。
///
/// 前端只调 `getCurrentWindow().show()` 的话，缩到托盘的最小化窗口不会回到前台，
/// 用户就看不到这次识别的结果。这里复用托盘那条路径已经在用的 show_main_window()。
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    exit_now(&app);
}

/// 托盘图标。它是「关掉窗口后软件还在」的唯一可见凭证：没有它，
/// 隐藏窗口就等于软件凭空消失，快捷键虽然还活着但用户没法把它叫回来。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let screenshot = MenuItem::with_id(app, "screenshot", "截图识别", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&screenshot, &show, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("须臾OCR")
        .menu(&menu)
        // 左键留给「点一下就能截图」，默认弹菜单会把单击动作吃掉
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "screenshot" => {
                // 托盘回调在主线程，抓屏+PNG 编码放异步任务，别冻结事件循环；
                // 托盘入口不过前端，直接起 instant 会话（框选松开即识别）
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_overlay_session(&handle, SnipasteMode::Instant) {
                        let _ = handle.emit("snipaste-error", e);
                    }
                });
            }
            "show" => show_main_window(app),
            "quit" => exit_now(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if app.state::<AppState>().show_on_tray_click.load(Ordering::SeqCst) {
                    show_main_window(app);
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn select_image_files() -> Result<Vec<String>, String> {
    let paths = rfd::FileDialog::new()
        .add_filter("图片文件", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .set_title("选择图片文件")
        .pick_files()
        .ok_or("用户取消选择")?;
    Ok(paths.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
fn save_temp_files(file_names: Vec<String>, file_data: Vec<Vec<u8>>) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    let temp_dir = std::env::temp_dir().join("moment_ocr");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    for (name, data) in file_names.iter().zip(file_data.iter()) {
        let path = temp_dir.join(name);
        std::fs::write(&path, data).map_err(|e| e.to_string())?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(paths)
}

#[tauri::command]
async fn ocr_paddleocr(app: tauri::AppHandle, image_path: String) -> Result<String, String> {
    let r = tokio::task::spawn_blocking(move || {
        recognizer::run_script(&app, "paddleocr_recognize.py", &image_path)
    }).await;
    match r { Ok(Ok(t)) => Ok(t), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}

/// 本地组件的状态：各自的版本、占用，以及截图组件是否可以省掉（Windows 随包自带）
#[tauri::command]
fn get_local_components_status(app: tauri::AppHandle) -> local_engine::Status {
    local_engine::status(&app)
}

#[tauri::command]
async fn install_local_component(
    app: tauri::AppHandle,
    component: String,
    quant: Option<String>,
) -> Result<String, String> {
    // 本地翻译不走 Python 运行时，装配线完全独立
    if component == "translate" {
        return translate_engine::install(&app, quant.as_deref())
            .await
            .map_err(|e| e.to_string());
    }
    let component = local_engine::Component::parse(&component).map_err(|e| e.to_string())?;
    let scripts_dir = overlay::scripts_dir().ok_or("找不到随应用分发的脚本")?;
    local_engine::install(&app, component, &scripts_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_local_component(app: tauri::AppHandle, component: String) -> Result<String, String> {
    if component == "translate" {
        return translate_engine::remove(&app).map_err(|e| e.to_string());
    }
    let component = local_engine::Component::parse(&component).map_err(|e| e.to_string())?;
    let (freed, runtime_removed) =
        local_engine::remove_component(&app, component).map_err(|e| e.to_string())?;
    Ok(if runtime_removed {
        format!(
            "已移除{}，并清理了不再需要的运行时，共释放 {:.0} MB",
            component.label(),
            freed as f64 / 1_048_576.0
        )
    } else {
        format!(
            "已移除{}，释放 {:.0} MB",
            component.label(),
            freed as f64 / 1_048_576.0
        )
    })
}

#[tauri::command]
async fn ocr_rapidocr(app: tauri::AppHandle, image_path: String) -> Result<String, String> {
    let r = tokio::task::spawn_blocking(move || {
        recognizer::run_script(&app, "rapidocr_recognize.py", &image_path)
    }).await;
    match r { Ok(Ok(t)) => Ok(t), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
async fn ocr_openai(api_key: String, image_path: String, model: String, max_tokens: u32) -> Result<String, String> {
    let b64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_openai_vision(&api_key, &b64, &model, max_tokens).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_ollama(endpoint: String, model: String, image_path: String) -> Result<String, String> {
    let b64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_ollama(&endpoint, &model, &b64).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_custom_vision(base_url: String, api_key: String, model: String, image_path: String, max_tokens: u32) -> Result<String, String> {
    let b64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_custom_vision(&base_url, &api_key, &model, &b64, max_tokens).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn translate_google(text: String, target_lang: String) -> Result<String, String> {
    api::call_google_translate(&text, &target_lang).await.map_err(|e| e.to_string())
}

/// 本地翻译（HY-MT1.5-1.8B）：目标语言用设置里的中文名（中文/英文/日文/韩文）
#[tauri::command]
async fn translate_hymt(app: tauri::AppHandle, text: String, target_lang: String) -> Result<String, String> {
    translate_engine::translate(&app, &text, &target_lang)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn translate_claude(base_url: String, api_key: String, model: String, text: String, target_lang: String) -> Result<String, String> {
    api::call_claude_translate(&base_url, &api_key, &model, &text, &target_lang).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn list_models(base_url: String, api_key: String, provider: String) -> Result<Vec<String>, String> {
    api::list_models(&base_url, &api_key, &provider).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_claude(base_url: String, api_key: String, model: String, image_path: String, max_tokens: u32) -> Result<String, String> {
    let b64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_claude_vision(&base_url, &api_key, &model, &b64, max_tokens).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn translate_custom(base_url: String, api_key: String, model: String, text: String, target_lang: String) -> Result<String, String> {
    api::call_custom_translate(&base_url, &api_key, &model, &text, &target_lang).await.map_err(|e| e.to_string())
}
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    let am = app.autolaunch();
    if !enable {
        return am.disable().map_err(|e| e.to_string());
    }

    am.enable().map_err(|e| e.to_string())?;
    // 回读确认：写注册表可能被安全软件拦下，静默失败会让用户以为设好了
    if !am.is_enabled().unwrap_or(false) {
        return Err("开机自启没有写入系统，可能被杀毒软件拦截，请检查启动项".to_string());
    }
    Ok(())
}
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool { app.autolaunch().is_enabled().unwrap_or(false) }

/// 单条快捷键的注册结果。前端据此告诉用户「这个组合已经被其他软件占了」，
/// 而不是悄无声息地什么都没发生。
#[derive(serde::Serialize)]
struct ShortcutRegistration {
    action: String,
    ok: bool,
    error: Option<String>,
}

#[tauri::command]
fn register_shortcuts(app: tauri::AppHandle, shortcuts: HashMap<String, String>) -> Vec<ShortcutRegistration> {
    let app_handle = app.clone();
    let _ = app_handle.global_shortcut().unregister_all();

    // 空串 = 用户禁用了这条快捷键，不注册，把按键交还给其他软件
    let mut entries: Vec<(String, String)> = shortcuts
        .into_iter()
        .filter(|(_, combo)| !combo.trim().is_empty())
        .collect();
    entries.sort();

    let mut registrations: Vec<ShortcutRegistration> = entries
        .into_iter()
        .map(|(action, combo)| match combo.parse::<Shortcut>() {
            Ok(shortcut) => {
                let action_owned = action.clone();
                let handle = app_handle.clone();
                let registered = app_handle.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = handle.emit("global-shortcut-triggered", serde_json::json!({ "action": action_owned }));
                    }
                });
                match registered {
                    Ok(()) => ShortcutRegistration { action, ok: true, error: None },
                    // 逐条注册：某一条被别的软件占用时，其余快捷键照常生效
                    Err(e) => ShortcutRegistration {
                        action,
                        ok: false,
                        error: Some(format!("已被其他软件占用，请换一个组合（{}）", e)),
                    },
                }
            }
            Err(e) => ShortcutRegistration {
                action,
                ok: false,
                error: Some(format!("组合无法解析：{}", e)),
            },
        })
        .collect();

    // Alt+P：为所有贴图关闭鼠标穿透（穿透后窗口自身收不到输入，必须有全局恢复入口）。
    // 注册失败要报给前端：用户若把 Alt+P 让给了别的软件，穿透贴图会失联，不能静默。
    if let Ok(alt_p) = "Alt+P".parse::<Shortcut>() {
        let handle = app_handle.clone();
        let registered = app_handle.global_shortcut().on_shortcut(alt_p, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                for (label, win) in handle.webview_windows() {
                    if label.starts_with("pin-") {
                        let _ = win.set_ignore_cursor_events(false);
                    }
                }
            }
        });
        registrations.push(match registered {
            Ok(()) => ShortcutRegistration { action: "snipaste-pin-through-release".to_string(), ok: true, error: None },
            Err(e) => ShortcutRegistration {
                action: "snipaste-pin-through-release".to_string(),
                ok: false,
                error: Some(format!("Alt+P 已被其他软件占用，开启鼠标穿透的贴图将无法用快捷键恢复（{}）", e)),
            },
        });
    }

    registrations
}

#[tauri::command]
fn clear_temp_cache() -> Result<String, String> {
    use std::fs;
    let t = std::env::temp_dir().join("moment_ocr");
    if t.exists() { fs::remove_dir_all(&t).map_err(|e| e.to_string())?; }
    fs::create_dir_all(&t).map_err(|e| e.to_string())?;
    Ok("已清除临时缓存".to_string())
}

// ============ Snipaste 截图功能 ============

/// overlay 窗口 label 前缀：每屏一个窗口 `snipaste-overlay-{i}`
const OVERLAY_PREFIX: &str = "snipaste-overlay";

/// 空闲超时：覆盖层开了这么久没有任何指针活动就自动取消，
/// 防止「开着截图层过夜」把整块屏幕锁死
const OVERLAY_IDLE_TIMEOUT_SECS: u64 = 120;

/// 会话代次：会话结束/取消时递增，让上一轮的空闲计时任务自行退出
static SESSION_SEQ: AtomicU64 = AtomicU64::new(0);

/// 会话互斥：抓屏 + 建窗要几百毫秒，期间第二次热键不能并发再起一轮
static SESSION_LOCK: AtomicBool = AtomicBool::new(false);

/// 当前会话模式（0=无 1=instant 2=toolbar 3=long）。前端挂载时查它对齐状态：
/// 预创建窗口可能错过 session-reset 事件。
static SESSION_MODE: AtomicU8 = AtomicU8::new(0);

fn mode_code(mode: SnipasteMode) -> u8 {
    match mode {
        SnipasteMode::Instant => 1,
        SnipasteMode::Toolbar => 2,
        SnipasteMode::Long => 3,
    }
}

/// 前端挂载/重连时查询会话快照（弥补事件可能早于监听注册的竞态）
#[tauri::command]
fn snipaste_session_snapshot() -> serde_json::Value {
    let mode = match SESSION_MODE.load(Ordering::SeqCst) {
        1 => Some("instant"),
        2 => Some("toolbar"),
        3 => Some("long"),
        _ => None,
    };
    serde_json::json!({ "active": snipaste::session_active(), "mode": mode })
}

#[derive(Clone, Copy, PartialEq)]
enum SnipasteMode {
    /// 框选松开即识别（原 PyQt 覆盖层的 --instant）
    Instant,
    /// 工具栏模式（标注/保存/贴图/识别）
    Toolbar,
    /// 长截图（锁光标屏续拍）
    Long,
}

impl SnipasteMode {
    fn url_param(self) -> &'static str {
        match self {
            SnipasteMode::Instant => "instant",
            SnipasteMode::Toolbar => "toolbar",
            SnipasteMode::Long => "long",
        }
    }
}

fn overlay_windows(app: &tauri::AppHandle) -> Vec<tauri::WebviewWindow> {
    let mut wins: Vec<tauri::WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(OVERLAY_PREFIX))
        .map(|(_, w)| w)
        .collect();
    wins.sort_by_key(|w| w.label().to_string());
    wins
}

/// 上一轮覆盖窗口还在时先关掉（热键连按等场景），否则 build 会因 label 冲突失败
fn close_stale_overlays(app: &tauri::AppHandle) {
    for w in overlay_windows(app) {
        let _ = w.close();
    }
}

/// 已建好窗口对应的显示器几何指纹（x, y, w, h）。
/// 会话复用的前提：窗口数与几何都没变；显示器增删/改分辨率就重建。
/// 显示器几何指纹：(x, y, width, height)
type LayoutFingerprint = Vec<(i32, i32, u32, u32)>;

static LAID_OUT_LAYOUT: Lazy<Mutex<LayoutFingerprint>> = Lazy::new(|| Mutex::new(Vec::new()));

fn layout_of(monitors: &[snipaste::MonitorInfo]) -> LayoutFingerprint {
    monitors
        .iter()
        .map(|m| (m.x, m.y, m.width, m.height))
        .collect()
}

/// 预创建覆盖层窗口（隐藏）。
/// WebView2 实例创建是固定成本（每窗约 200ms，且必须走主线程无法并行），
/// 按键后再建窗就把这 200–400ms 直接加在用户等待上。提前建好、只 hide 不 close，
/// 按键时就只剩「抓屏 + show」。
fn prepare_overlay_windows(app: &tauri::AppHandle) -> Result<(), String> {
    if !overlay_windows(app).is_empty() {
        return Ok(());
    }
    let monitors =
        snipaste::enumerate_monitors(app).map_err(|e: anyhow::Error| e.to_string())?;
    for (i, m) in monitors.iter().enumerate() {
        build_overlay_window(app, i, m)?;
    }
    *LAID_OUT_LAYOUT.lock().unwrap() = layout_of(&monitors);
    Ok(())
}

/// 让窗口与本次会话的显示器布局对齐：能复用就复用（保留已加载的页面），
/// 不能就关掉重建。返回是否走了复用路径。
fn ensure_overlay_windows(
    app: &tauri::AppHandle,
    monitors: &[snipaste::MonitorInfo],
) -> Result<bool, String> {
    let layout = layout_of(monitors);
    let reusable = overlay_windows(app).len() == monitors.len()
        && *LAID_OUT_LAYOUT.lock().unwrap() == layout;
    if reusable {
        return Ok(true);
    }
    close_stale_overlays(app);
    for (i, m) in monitors.iter().enumerate() {
        build_overlay_window(app, i, m)?;
    }
    *LAID_OUT_LAYOUT.lock().unwrap() = layout;
    Ok(false)
}

/// 统一 show 所有覆盖窗口（同一时刻出现，消除逐窗冒出来的时间差）
fn show_overlay_windows(
    app: &tauri::AppHandle,
    cursor_index: usize,
    monitors: &[snipaste::MonitorInfo],
    t0: Option<std::time::Instant>,
) {
    let wins = overlay_windows(app);
    for w in &wins {
        let _ = w.show();
        if let Some(t0) = t0 {
            timing_log(t0, &format!("show {}", w.label()));
        }
    }
    // 键盘焦点（ESC）只给光标屏那一块；focus 可能触发一次合成等待，
    // 放到后台 30ms 后再做，不挡出罩
    if let Some(w) = wins.get(cursor_index) {
        let w = w.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            let _ = w.set_focus();
        });
    }
    verify_overlay_geometry(app, monitors.to_vec());
}

/// show 之后复查覆盖窗口几何：macOS 的 set_inner_size 是异步投递到主线程的，
/// 预创建 + 隐藏的窗口在个别情况下会停在旧尺寸（表现为覆盖层只盖住屏幕上一条）。
/// 这里等一拍再读一次，不一致就重设；复查结果一律落盘，用来区分是「窗口不对」
/// 还是「窗口对了但页面视口不对」。
fn verify_overlay_geometry(app: &tauri::AppHandle, monitors: Vec<snipaste::MonitorInfo>) {
    use tauri::{PhysicalPosition, PhysicalSize, Position, Size};
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        for (i, m) in monitors.iter().enumerate() {
            let label = format!("{OVERLAY_PREFIX}-{i}");
            let Some(w) = app.get_webview_window(&label) else {
                geom_log(&format!("verify {label}: window missing"));
                continue;
            };
            let pos = w.outer_position().ok();
            let size = w.inner_size().ok();
            let scale = w.scale_factor().ok();
            geom_log(&format!(
                "verify {label}: want=({},{} {}x{}) got={pos:?} {size:?} scale={scale:?}",
                m.x, m.y, m.width, m.height
            ));
            if size
                .map(|s| (s.width, s.height) != (m.width, m.height))
                .unwrap_or(true)
            {
                let _ = w.set_size(Size::Physical(PhysicalSize::new(m.width, m.height)));
                geom_log(&format!("verify {label}: size re-applied"));
            }
            if pos.map(|p| (p.x, p.y) != (m.x, m.y)).unwrap_or(true) {
                let _ = w.set_position(Position::Physical(PhysicalPosition::new(m.x, m.y)));
                geom_log(&format!("verify {label}: position re-applied"));
            }
        }
    });
}

/// 收尾兜底：任何退出路径都要把主窗口还回来（build 失败等异常场景）
fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

/// 无装饰窗口落位 + 定尺寸。顺序按平台反着来：
/// - macOS：AppKit 的 setContentSize 以左下角为锚点，先定位再放大，窗口会向上长到屏幕外；
/// - Windows：先定位会触发 WM_DPICHANGED 让系统按目标屏 DPI 缩放窗口，尺寸必须最后落。
fn place_window(
    win: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> tauri::Result<()> {
    use tauri::{PhysicalPosition, PhysicalSize, Position, Size};
    #[cfg(target_os = "macos")]
    {
        win.set_size(Size::Physical(PhysicalSize::new(width, height)))?;
        win.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        win.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
        win.set_size(Size::Physical(PhysicalSize::new(width, height)))?;
    }
    Ok(())
}

/// 单屏 overlay 窗口创建：先隐藏创建、物理坐标落位后再显示。
/// builder 的逻辑 position 在混合 DPI 多屏下会被 tao 逐屏试探换算而落错显示器，
/// 所以与贴图窗口一样用 Physical 精确落位。
fn build_overlay_window(
    app: &tauri::AppHandle,
    index: usize,
    m: &snipaste::MonitorInfo,
) -> Result<tauri::WebviewWindow, String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = format!("{OVERLAY_PREFIX}-{index}");
    // 只把显示器几何写进 URL（会话模式走事件，窗口因此可跨模式复用）
    let url = WebviewUrl::App(
        format!(
            "/snipaste-overlay?m={index}&mx={}&my={}&mscale={}",
            m.x, m.y, m.scale
        )
        .into(),
    );
    let logical_w = m.width as f64 / if m.scale > 0.0 { m.scale } else { 1.0 };
    let logical_h = m.height as f64 / if m.scale > 0.0 { m.scale } else { 1.0 };
    let win = WebviewWindowBuilder::new(app, &label, url)
        .title("截图")
        // 建窗时就带上真实尺寸：默认 800x600 的窗口即使随后被 set_size 纠正，
        // macOS 上 set_inner_size 是异步投递的，可能出现「先以小窗出罩」的窗口
        .inner_size(logical_w, logical_h)
        .visible(false)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    // 落位顺序按平台（见 place_window）：macOS 先 size 后 position，Windows 反过来
    place_window(&win, m.x, m.y, m.width, m.height).map_err(|e| e.to_string())?;
    geom_log(&format!(
        "build {label}: want=({},{} {}x{} scale={}) got={:?} {:?} {:?}",
        m.x,
        m.y,
        m.width,
        m.height,
        m.scale,
        win.outer_position().ok(),
        win.inner_size().ok(),
        win.scale_factor().ok()
    ));
    #[cfg(target_os = "macos")]
    mac_overlay_chrome(&win);
    // 显式隐藏：builder 的 visible(false) 在部分 Windows 环境下不生效，
    // 窗口会以「可见但无内容」的形式留在桌面上（预创建后尤其明显）
    let _ = win.hide();
    Ok(win)
}

/// macOS：把 overlay 抬到菜单栏之上并加入所有 Space。
/// tao 的 always_on_top 只是 floating 层，盖不住 level 24 的菜单栏，
/// 也进不了全屏 App 的 Space——旧 PyQt 覆盖层用同样的常量（25）解决。
#[cfg(target_os = "macos")]
fn mac_overlay_chrome(win: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    // NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0
    // NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    let Ok(ptr) = win.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    // SAFETY: ptr 是 tao 持有的 NSWindow，这里只调两个不改引用计数的 setter
    unsafe {
        let window: &AnyObject = &*(ptr as *const AnyObject);
        // NSWindowLevel 25 > NSMainMenuWindowLevel(24)
        let _: () = msg_send![window, setLevel: 25.0_f64];
        let _: () = msg_send![window, setCollectionBehavior: (CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY)];
    }
}

/// macOS 屏幕录制权限预检（CoreGraphics，10.15+）。权限记在主 App bundle 身上，
/// 主进程抓屏直接命中授权；helper 时代整屏黑图的根因就是抓屏进程没有这个授权。
#[cfg(target_os = "macos")]
fn preflight_screen_capture() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        // Boolean CGPreflightScreenCaptureAccess(void)
        fn CGPreflightScreenCaptureAccess() -> u8;
    }
    unsafe { CGPreflightScreenCaptureAccess() != 0 }
}

/// 结束本轮会话：清状态、隐藏全部 overlay（窗口保留复用）、还主窗口。
/// 窗口都活在主进程内，不存在子进程孤儿问题；这里同时递增会话代次
/// 让空闲计时任务退出、放开会话互斥锁。
fn teardown_session(app: &tauri::AppHandle) {
    snipaste::clear_session();
    SESSION_SEQ.fetch_add(1, Ordering::SeqCst);
    SESSION_LOCK.store(false, Ordering::SeqCst);
    SESSION_MODE.store(0, Ordering::SeqCst);
    // 只隐藏不关闭：WebView2 实例留着，下一轮按热键时省掉 200–400ms 的建窗成本
    for w in overlay_windows(app) {
        let _ = w.hide();
    }
    restore_main_window(app);
}

/// 用户取消（ESC/空白单击/超时）：比收尾多一个 cancel 事件给主窗口
fn cancel_session(app: &tauri::AppHandle) {
    teardown_session(app);
    let _ = app.emit("snipaste-cancel", ());
}

/// 会话空闲计时：每 5s 查一次，超时自动取消；新会话开始后代次不符即退出
fn start_idle_timeout(app: &tauri::AppHandle) {
    let handle = app.clone();
    let seq = SESSION_SEQ.load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            if SESSION_SEQ.load(Ordering::SeqCst) != seq {
                return;
            }
            if snipaste::activity_elapsed_secs() >= OVERLAY_IDLE_TIMEOUT_SECS {
                cancel_session(&handle);
                return;
            }
        }
    });
}

/// 截图会话入口：抓屏（普通/识别模式抓全部屏支持跨屏拖选，长截图锁光标屏）→
/// 每屏建一个覆盖窗口
fn start_overlay_session(app: &tauri::AppHandle, mode: SnipasteMode) -> Result<(), String> {
    // 重入守卫：抓屏+建窗要几百毫秒，期间再按热键直接忽略（等第一轮把窗口建出来），
    // 否则两轮并发写会话状态、互相关窗口
    if SESSION_LOCK
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("截图会话已在进行中".to_string());
    }
    let result = start_overlay_session_inner(app, mode);
    if result.is_err() {
        // 失败路径就地放锁（成功路径由 teardown_session 放锁）
        SESSION_LOCK.store(false, Ordering::SeqCst);
    }
    result
}

/// 诊断计时：把关键阶段耗时追加到 %TEMP%/momentocr-timing.log。
/// GUI 进程没有 stderr，出罩延迟这类问题只能落盘取证；每轮 4 行，代价可忽略。
fn timing_log(t0: std::time::Instant, stage: &str) {
    use std::io::Write;
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("momentocr-timing.log"))
    else {
        return;
    };
    let _ = writeln!(f, "{:>6} ms  {}", t0.elapsed().as_millis(), stage);
}

/// 诊断几何：显示器/覆盖窗口/前端视口三者对不上时，只能落盘取证。
/// 追加到 %TEMP%/momentocr-overlay-geom.log（macOS 上就是 $TMPDIR）。
fn geom_log(msg: &str) {
    use std::io::Write;
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("momentocr-overlay-geom.log"))
    else {
        return;
    };
    let _ = writeln!(f, "{msg}");
}

/// 抓本次会话的帧（长截图锁光标屏，其余全部屏）。Windows 上走 DXGI，约 40ms。
fn capture_session_frames(
    app: &tauri::AppHandle,
    mode: SnipasteMode,
    t0: std::time::Instant,
) -> Option<Vec<snipaste::Frame>> {
    let frames = if mode == SnipasteMode::Long {
        match snipaste::capture_session_monitor(app) {
            Ok(frame) => vec![frame],
            Err(_) => return None,
        }
    } else {
        match snipaste::capture_all_monitors(app) {
            Ok(frames) => frames,
            Err(_) => return None,
        }
    };
    timing_log(t0, "capture done");
    geom_log(&format!(
        "frames: {:?}",
        frames.iter().map(|f| (f.width, f.height)).collect::<Vec<_>>()
    ));
    Some(frames)
}

fn start_overlay_session_inner(app: &tauri::AppHandle, mode: SnipasteMode) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    snipaste::clear_session();
    snipaste::touch_activity();

    #[cfg(target_os = "macos")]
    if !preflight_screen_capture() {
        let _ = app.emit(
            "snipaste-error",
            "需要「屏幕录制」权限：请到 系统设置 → 隐私与安全性 → 屏幕录制 勾选 MomentOCR 后重试"
                .to_string(),
        );
        return Err("screen capture permission not granted".to_string());
    }

    let cursor = app.cursor_position().map_err(|e| e.to_string())?;

    // 1) 先只枚举显示器几何（几毫秒）：建窗与抓屏因此可以并行，
    //    窗口不必等抓屏/编码，抓屏也不必等建窗。
    let infos: Vec<snipaste::MonitorInfo> = if mode == SnipasteMode::Long {
        // 长截图锁光标所在屏
        snipaste::SnipasteManager::clear_long_screenshot_paths();
        let all = snipaste::enumerate_monitors(app).map_err(|e: anyhow::Error| e.to_string())?;
        let target = all
            .iter()
            .find(|m| {
                cursor.x >= m.x as f64
                    && cursor.x < (m.x + m.width as i32) as f64
                    && cursor.y >= m.y as f64
                    && cursor.y < (m.y + m.height as i32) as f64
            })
            .or_else(|| all.first())
            .cloned()
            .ok_or_else(|| "找不到可用屏幕".to_string())?;
        snipaste::set_session_monitor(target.x, target.y, target.width, target.height, target.scale);
        vec![target]
    } else {
        snipaste::enumerate_monitors(app).map_err(|e: anyhow::Error| e.to_string())?
    };

    geom_log(&format!(
        "session start: cursor=({:.0},{:.0}) monitors={:?} screens={:?}",
        cursor.x,
        cursor.y,
        infos
            .iter()
            .map(|m| (m.x, m.y, m.width, m.height, m.scale))
            .collect::<Vec<_>>(),
        snipaste::screen_infos()
    ));

    let monitors: Vec<snipaste::SessionMonitor> = infos
        .iter()
        .map(|m| snipaste::SessionMonitor {
            x: m.x,
            y: m.y,
            width: m.width,
            height: m.height,
            scale: m.scale,
            // 路径由后台编码完成后再回填
            path: String::new(),
        })
        .collect();

    let cursor_index = monitors
        .iter()
        .position(|m| {
            cursor.x >= m.x as f64
                && cursor.x < (m.x + m.width as i32) as f64
                && cursor.y >= m.y as f64
                && cursor.y < (m.y + m.height as i32) as f64
        })
        .unwrap_or(0);

    snipaste::set_session_monitors(monitors);
    snipaste::set_session_instant(mode == SnipasteMode::Instant);
    SESSION_MODE.store(mode_code(mode), Ordering::SeqCst);

    // 隐藏主窗口（必须在抓屏前完成，别把自己拍进去）
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 2) 对齐窗口：预创建的窗口几何与本次一致就直接复用（页面已加载好），
    //    否则重建。两种情况下窗口此刻都是隐藏的。
    if let Err(e) = ensure_overlay_windows(app, &infos) {
        teardown_session(app);
        return Err(e);
    }

    // 3) 抓屏 + show 同步做（调用线程就是主线程）：
    //    DXGI 抓屏约 40ms，show 约 20ms；走 async 命令再 run_on_main_thread 派发
    //    会多排 80–100ms 的队，直接同步反而快。
    //    必须先抓屏再 show，否则会把覆盖层自己拍进冻结画面。
    let Some(frames) = capture_session_frames(app, mode, t0) else {
        teardown_session(app);
        return Err("抓屏失败".to_string());
    };
    snipaste::set_session_frames(frames.clone());
    show_overlay_windows(app, cursor_index, &infos, Some(t0));
    timing_log(t0, "windows shown");
    let _ = app.emit(
        "snipaste-session-reset",
        serde_json::json!({ "mode": mode.url_param(), "cursorIndex": cursor_index }),
    );

    // 4) 编码放后台（JPEG 显示图 ~60ms、PNG 落盘更慢，都不该挡出罩）
    let seq = SESSION_SEQ.load(Ordering::SeqCst);
    let app_enc = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        encode_frames(&app_enc, frames, cursor_index, mode, seq, t0);
    });

    start_idle_timeout(app);
    Ok(())
}

/// 会话定格帧的编码：显示图（JPEG）优先，无损 PNG 落盘随后；每屏一个线程并行。
/// 裁剪不依赖 PNG（crop_session_region 直接读内存帧），所以落盘慢不影响识别。
fn encode_frames(
    app: &tauri::AppHandle,
    frames: Vec<snipaste::Frame>,
    cursor_index: usize,
    mode: SnipasteMode,
    seq: u64,
    t0: std::time::Instant,
) {
    std::thread::scope(|scope| {
        for (i, frame) in frames.into_iter().enumerate() {
            let app = app.clone();
            scope.spawn(move || {
                let stale = || SESSION_SEQ.load(Ordering::SeqCst) != seq;

                // 1) 显示图：JPEG 编码快、体积小一个数量级，前端等的就是它
                if let Ok(b64) = snipaste::encode_display_jpeg(&frame) {
                    if stale() {
                        return;
                    }
                    timing_log(t0, &format!("display jpeg ready (screen {i}, {} KB)", b64.len() / 1024));
                    snipaste::set_display_image(i, b64);
                    let _ = app.emit("snipaste-frame-ready", i);
                }

                // 2) 无损 PNG 落盘（OCR 与历史回放/长截图续拍用）
                if stale() {
                    return;
                }
                if let Ok(png) = snipaste::encode_png(&frame) {
                    if stale() {
                        return;
                    }
                    let path = snipaste::SnipasteManager::generate_temp_path("snipaste");
                    if snipaste::SnipasteManager::save_to_file(&png, &path).is_ok() {
                        timing_log(t0, &format!("png saved (screen {i})"));
                        let path_str = path.to_string_lossy().to_string();
                        if mode == SnipasteMode::Long {
                            snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
                        }
                        snipaste::set_session_monitor_path(i, path_str.clone());
                        if i == cursor_index {
                            snipaste::SnipasteManager::set_last_screenshot(path_str.clone());
                            snipaste::push_history(path_str);
                        }
                    }
                }
            });
        }
    });
}

/// instant 模式松开鼠标：裁剪 → 通知前端识别 → 收尾
fn finish_instant_ocr(app: &tauri::AppHandle, rect: (f64, f64, f64, f64)) -> Result<(), String> {
    let png = snipaste::crop_session_region(rect).map_err(|e: anyhow::Error| e.to_string())?;
    let path = snipaste::SnipasteManager::generate_temp_path("crop");
    snipaste::SnipasteManager::save_to_file(&png, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;
    let payload = serde_json::json!({ "path": path.to_string_lossy() });
    teardown_session(app);
    let _ = app.emit("snipaste-ocr", payload);
    Ok(())
}

#[tauri::command]
fn start_snipaste(app: tauri::AppHandle, mode: Option<String>) -> Result<(), String> {
    let mode = match mode.as_deref() {
        Some("instant") => SnipasteMode::Instant,
        Some("long") => SnipasteMode::Long,
        _ => SnipasteMode::Toolbar,
    };
    // 失败统一广播给主窗口（App.tsx 的 snipaste-error 监听负责让用户看见），
    // 别让热键这类不过工具栏的入口静默失败
    if let Err(e) = start_overlay_session(&app, mode) {
        let _ = app.emit("snipaste-error", e.clone());
        return Err(e);
    }
    Ok(())
}

/// 兼容既有前端入口：长截图独立命令
#[tauri::command]
fn start_long_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    if let Err(e) = start_overlay_session(&app, SnipasteMode::Long) {
        let _ = app.emit("snipaste-error", e.clone());
        return Err(e);
    }
    Ok(())
}

/// 各 overlay 窗口加载自己那块屏的显示图（JPEG，编码在后台进行）。
/// 未就绪时返回 Err，前端短暂重试——窗口因此不必等编码就能出现。
#[tauri::command]
fn snipaste_get_monitor_display_base64(index: usize) -> Result<String, String> {
    snipaste::display_image(index).ok_or_else(|| "not ready".to_string())
}

/// 会话显示器列表（前端判断选区是否跨屏用）
#[tauri::command]
fn snipaste_get_monitors() -> Vec<snipaste::SessionMonitor> {
    snipaste::get_session_monitors()
}

/// overlay 窗口上报自己的视口/图片尺寸（诊断用）：窗口正确但画面只占一角时，
/// 靠这行区分是 webview 视口没跟上还是前端缩放问题。
#[tauri::command]
fn snipaste_report_viewport(payload: String) {
    geom_log(&format!("viewport: {payload}"));
}

/// overlay 窗口上报指针事件（全局物理坐标）。Rust 是选区状态的唯一事实源，
/// 每次变更广播给所有 overlay 窗口渲染。
#[tauri::command]
fn snipaste_select_event(
    app: tauri::AppHandle,
    kind: String,
    x: f64,
    y: f64,
    w: Option<f64>,
    h: Option<f64>,
) -> Result<(), String> {
    snipaste::touch_activity();
    match kind.as_str() {
        "down" => snipaste::selection_down(x, y),
        "move" => snipaste::selection_move(x, y),
        // 单击吸附窗口：窗口侧把检测到的完整矩形直接采纳
        "adopt" => snipaste::selection_set_rect(x, y, w.unwrap_or(0.0), h.unwrap_or(0.0)),
        "up" => snipaste::selection_up(),
        // 历史切换/贴图后继续框选：只清选区，会话保留
        "clear" => snipaste::selection_clear(),
        _ => return Ok(()),
    }
    let state = snipaste::selection_snapshot();

    if kind == "up" || kind == "adopt" {
        match state.rect() {
            Some(rect) if snipaste::is_session_instant() => {
                // instant 模式：松开即识别；空白处小于 10×10 的单击视为取消
                return if rect.2 >= 10.0 && rect.3 >= 10.0 {
                    finish_instant_ocr(&app, rect)
                } else if kind == "adopt" {
                    // 检测到的窗口再小也是合法选区
                    finish_instant_ocr(&app, rect)
                } else {
                    cancel_session(&app);
                    Ok(())
                };
            }
            Some(_) => {
                // 工具栏模式：最终态广播，各窗口据此判断工具栏归属
                let _ = app.emit("snipaste-selection", state);
            }
            None => {
                if snipaste::is_session_instant() {
                    cancel_session(&app);
                }
            }
        }
        return Ok(());
    }
    let _ = app.emit("snipaste-selection", state);
    Ok(())
}

/// 跨屏选区矩形（全局物理像素）
#[derive(serde::Deserialize)]
struct CropRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 跨屏裁剪：全局物理矩形 → 拼合 PNG（落盘 + base64）。
/// OCR 恒走它；保存/复制/贴图在选区跨屏时也走它（该场景无法带窗口局部标注）。
#[tauri::command]
fn snipaste_crop_session(rect: CropRect) -> Result<snipaste::CropOutput, String> {
    use base64::Engine;
    let png = snipaste::crop_session_region((rect.x, rect.y, rect.width, rect.height))
        .map_err(|e: anyhow::Error| e.to_string())?;
    let path = snipaste::SnipasteManager::generate_temp_path("crop");
    snipaste::SnipasteManager::save_to_file(&png, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;
    Ok(snipaste::CropOutput {
        path: path.to_string_lossy().to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(&png),
    })
}

/// 用户取消（ESC 等）
#[tauri::command]
fn snipaste_cancel(app: tauri::AppHandle) -> Result<(), String> {
    cancel_session(&app);
    Ok(())
}

#[tauri::command]
fn snipaste_crop_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let screenshot_path = snipaste::SnipasteManager::get_last_screenshot()
        .ok_or("没有可用截图")?;
    
    let data = std::fs::read(&screenshot_path)
        .map_err(|e| e.to_string())?;
    
    let cropped = snipaste::SnipasteManager::crop_region(&data, x, y, width, height)
        .map_err(|e| e.to_string())?;
    
    let crop_path = snipaste::SnipasteManager::generate_temp_path("crop");
    snipaste::SnipasteManager::save_to_file(&cropped, &crop_path)
        .map_err(|e| e.to_string())?;
    
    Ok(crop_path.to_string_lossy().to_string())
}

#[tauri::command]
fn snipaste_stitch_screenshots() -> Result<String, String> {
    let paths = snipaste::SnipasteManager::get_long_screenshot_paths();
    if paths.is_empty() {
        return Err("No screenshots to stitch".to_string());
    }
    
    let stitched = snipaste::SnipasteManager::stitch_screenshots(&paths)
        .map_err(|e| e.to_string())?;
    
    let stitch_path = snipaste::SnipasteManager::generate_temp_path("stitched");
    snipaste::SnipasteManager::save_to_file(&stitched, &stitch_path)
        .map_err(|e| e.to_string())?;
    
    Ok(stitch_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn snipaste_capture_next(app: tauri::AppHandle) -> Result<String, String> {
    // 隐藏覆盖窗口，避免把 overlay 自己拍进去
    let overlays = overlay_windows(&app);
    for w in &overlays {
        w.hide().map_err(|e| e.to_string())?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // 捕获会话显示器（长截图锁定同一块屏）
    let result = (|| -> Result<String, String> {
        let cap = snipaste::capture_session_monitor(&app)
            .map_err(|e: anyhow::Error| e.to_string())?;
        // 长截图是手动步进流程，同步编码一帧的耗时可接受
        let png = snipaste::encode_png(&cap)
            .map_err(|e: anyhow::Error| e.to_string())?;
        let path = snipaste::SnipasteManager::generate_temp_path("longshot");
        snipaste::SnipasteManager::save_to_file(&png, &path)
            .map_err(|e: anyhow::Error| e.to_string())?;
        let path_str = path.to_string_lossy().to_string();
        snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
        snipaste::SnipasteManager::set_last_screenshot(path_str.clone());
        snipaste::push_history(path_str.clone());
        Ok(path_str)
    })();

    // 恢复覆盖窗口
    for w in &overlays {
        let _ = w.show();
        let _ = w.set_focus();
    }
    result
}

#[tauri::command]
fn snipaste_save_screenshot(data: Vec<u8>, path: Option<String>) -> Result<String, String> {
    let save_path = if let Some(p) = path {
        std::path::PathBuf::from(p)
    } else {
        let desktop = dirs::desktop_dir().ok_or("无法获取桌面路径")?;
        desktop.join(format!("screenshot_{}.png", Local::now().format("%Y%m%d_%H%M%S")))
    };
    
    snipaste::SnipasteManager::save_to_file(&data, &save_path)
        .map_err(|e| e.to_string())?;
    
    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
fn snipaste_copy_to_clipboard(data: Vec<u8>) -> Result<(), String> {
    let img = screenshots::image::load_from_memory(&data).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn snipaste_get_screenshot_base64() -> Result<String, String> {
    let path = snipaste::SnipasteManager::get_last_screenshot()
        .ok_or("没有可用截图")?;
    snipaste::SnipasteManager::image_to_base64(&path)
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
async fn snipaste_create_pin(
    app: tauri::AppHandle,
    image_data: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| e.to_string())?;

    let path = snipaste::SnipasteManager::generate_temp_path("pin");
    snipaste::SnipasteManager::save_to_file(&data, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    // 前端传来的已是全局物理矩形（贴图 1:1 显示物理像素；跨屏选区时图像为 Rust 拼合图）
    let px = x.round();
    let py = y.round();
    let pw = (width.round().max(40.0)) as u32;
    let ph = (height.round().max(40.0)) as u32;

    let id = snipaste::next_pin_id();
    let label = format!("pin-{}", id);
    eprintln!("[create_pin] phys=({px},{py},{pw},{ph}) label={label}");
    snipaste::insert_pin(
        &label,
        snipaste::PinData {
            image_data,
            x: px,
            y: py,
            width: pw as f64,
            height: ph as f64,
            visible: true,
        },
    );

    // 贴图窗口：无装饰、置顶、不进任务栏；先隐藏创建，物理坐标落位后再显示
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("/".into()))
        .title("贴图")
        .visible(false)
        .decorations(false)
        // resizable(false) 与无装饰组合下 tao/WebView2 的 set_size 会原生崩溃，保持默认可改尺寸
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .build();
    if let Err(ref e) = built { eprintln!("[create_pin] build failed: {e}"); }
    let win = built.map_err(|e| e.to_string())?;
    // 落位顺序按平台（见 place_window）：macOS 先 size 后 position，Windows 反过来
    if let Err(e) = place_window(&win, px as i32, py as i32, pw, ph) {
        eprintln!("[create_pin] place failed: {e}");
        let _ = win.close();
        return Err(e.to_string());
    }
    if let Err(e) = win.show() {
        eprintln!("[create_pin] show failed: {e}");
        let _ = win.close();
        return Err(e.to_string());
    }
    let _ = win.set_focus();
    eprintln!("[create_pin] ok label={label}");
    Ok(())
}

#[tauri::command]
fn snipaste_get_pin_image(label: String) -> Result<snipaste::PinData, String> {
    snipaste::get_pin(&label).ok_or_else(|| "贴图不存在".to_string())
}

#[tauri::command]
fn snipaste_list_pins() -> Vec<(String, snipaste::PinData)> {
    snipaste::list_pins()
}

#[tauri::command]
fn snipaste_set_pin_visible(app: tauri::AppHandle, label: String, visible: bool) -> Result<(), String> {
    let pin = snipaste::set_pin_visible(&label, visible).ok_or_else(|| "贴图不存在".to_string())?;
    if let Some(win) = app.get_webview_window(&label) {
        if visible {
            win.show().map_err(|e| e.to_string())?;
            // hide/show 周期后 Windows 不保留原位置，按状态表恢复
            use tauri::{PhysicalPosition, Position};
            let _ = win.set_position(Position::Physical(PhysicalPosition::new(pin.x as i32, pin.y as i32)));
        } else {
            win.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn snipaste_close_pin(app: tauri::AppHandle, label: String) -> Result<(), String> {
    snipaste::remove_pin(&label).ok_or_else(|| "贴图不存在".to_string())?;
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn snipaste_toggle_mouse_through(app: tauri::AppHandle, label: String, enable: bool) -> Result<(), String> {
    let win = app.get_webview_window(&label).ok_or("找不到贴图窗口")?;
    win.set_ignore_cursor_events(enable).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn snipaste_detect_window(x: f64, y: f64) -> Result<Option<snipaste::DetectRect>, String> {
    snipaste::detect_window_at(x as i32, y as i32)
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
fn snipaste_history_step(delta: i32) -> Result<String, String> {
    let path = snipaste::history_step(delta as isize)
        .ok_or("没有截图历史")?;
    snipaste::SnipasteManager::set_last_screenshot(path.clone());
    snipaste::SnipasteManager::image_to_base64(&path)
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
fn snipaste_finish(app: tauri::AppHandle) -> Result<(), String> {
    // OCR/保存/复制等动作完成后由前端调用：统一走会话收尾
    teardown_session(&app);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // 必须最先注册：重复启动在这一步就被挡回去，不会走到抢全局快捷键那步
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else { return };
            // 截图覆盖层是临时窗口，关掉它就该关掉，不要拦
            if window.label() != "main" { return; }
            let state = window.app_handle().state::<AppState>();
            if state.quitting.load(Ordering::SeqCst) { return; }
            // 升级安装器在等我们退出：走正常退出，让托盘图标被注销
            if upgraded_on_disk(state.exe_mtime) {
                exit_now(window.app_handle());
                return;
            }
            if state.close_to_tray.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_image_files, save_temp_files,
            ocr_paddleocr, ocr_rapidocr, get_local_components_status, install_local_component, remove_local_component,
            ocr_openai, ocr_ollama, translate_google, translate_custom, translate_claude, translate_hymt,
            ocr_custom_vision, ocr_claude, list_models, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, set_tray_behavior, set_dock_hidden,
            focus_main_window, quit_app,
            start_snipaste, start_long_screenshot, snipaste_crop_region,
            snipaste_stitch_screenshots, snipaste_capture_next, snipaste_save_screenshot,
            snipaste_copy_to_clipboard, snipaste_get_screenshot_base64,
            snipaste_create_pin, snipaste_finish, snipaste_get_pin_image,
            snipaste_list_pins, snipaste_set_pin_visible, snipaste_close_pin,
            snipaste_toggle_mouse_through, snipaste_detect_window, snipaste_history_step,
            snipaste_get_monitor_display_base64, snipaste_get_monitors, snipaste_select_event,
            snipaste_session_snapshot, snipaste_report_viewport,
            snipaste_crop_session, snipaste_cancel
        ])
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            if label.starts_with("pin-") {
                match event {
                    // 贴图窗口被用户关闭时同步清理状态表
                    tauri::WindowEvent::Destroyed => {
                        snipaste::remove_pin(&label);
                    }
                    // 拖动后记录新位置，隐藏再显示才能回到原位
                    tauri::WindowEvent::Moved(tauri::PhysicalPosition::<i32> { x, y }) => {
                        snipaste::update_pin_position(&label, *x, *y);
                    }
                    _ => {}
                }
                return;
            }
            // overlay 被 Alt+F4 等外部方式关掉时，会话还活着就整体取消，
            // 别让主窗口一直藏着等 120s 空闲兜底（正常收尾先清状态再关窗，不会进到这里）
            if label.starts_with(OVERLAY_PREFIX)
                && matches!(event, tauri::WindowEvent::Destroyed)
                && snipaste::session_active()
            {
                cancel_session(window.app_handle());
            }
        })
        .setup(|app| {
            // 注入资源目录：安装版把 OCR/截图脚本随包发布到此处（见 tauri.conf.json 的 bundle.resources）
            if let Ok(resource_dir) = app.path().resource_dir() {
                overlay::set_resource_dir(resource_dir);
            }
            for p in &["icons/icon.png", "src-tauri/icons/icon.png", "../src-tauri/icons/icon.png"] {
                if let Ok(img) = tauri::image::Image::from_path(p) {
                    if let Some(w) = app.get_webview_window("main") { let _ = w.set_icon(img); }
                    break;
                }
            }
            setup_tray(app)?;

            // 启动后延迟预创建覆盖层窗口（隐藏）。WebView2 实例创建 ~200ms/窗且
            // 必须走主线程，按键后再建就白等这 200–400ms；提前建好让截图秒开。
            // 延迟几秒避开启动高峰；用户已经截过图则 prepare 自己跳过。
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                // 抓屏后端预热（D3D11 设备创建 200–500ms，放后台线程别卡 UI）
                let cap_handle = handle.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = snipaste::prepare_capture_backend(&cap_handle) {
                        eprintln!("[capture] DXGI 预热失败，将回退 GDI: {e}");
                    }
                })
                .await;
                // 覆盖层窗口预创建（必须主线程）
                let inner = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = prepare_overlay_windows(&inner);
                });
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                // 退出时收掉本地翻译的 llama-server 子进程，别让它变成孤儿进程继续占内存
                let _ = translate_engine::shutdown();
                // 截图覆盖层窗口虽在主进程内、会随进程消失，这里显式关一遍兜底
                for w in overlay_windows(app) {
                    let _ = w.close();
                }
            }
            // macOS：关窗只是隐藏、进程还在，Dock/Launchpad 再点不会起第二个进程，
            // 只会发 Reopen 事件（单实例插件的聚焦回调依赖第二进程通知，接不住）。
            // 没这个分支窗口一直藏着，看起来就像点了没反应。
            // has_visible_windows: false 同时覆盖「已隐藏」和「最小化」两种情况；
            // 变体本身 cfg(macos) 门控（tauri app.rs），非 macOS 构建走 _ 分支。
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows: false, .. } => {
                show_main_window(app);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    /// 升级安装替换 exe 后，关闭请求必须放行成「退出」，否则安装器强杀会留下幽灵托盘图标。
    /// 只认「磁盘 exe 比本进程启动时更新」这一种情况，避免把普通关闭也变成退出。
    #[test]
    fn detects_upgrade_only_when_exe_is_newer() {
        let started = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert!(!is_newer(Some(started), Some(started)));
        assert!(is_newer(Some(started), Some(started + Duration::from_secs(1))));
        assert!(!is_newer(Some(started), None));
        assert!(!is_newer(None, Some(started)));
    }
}
