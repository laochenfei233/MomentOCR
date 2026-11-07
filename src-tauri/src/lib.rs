mod api;
mod local_engine;
mod overlay;
mod recognizer;
mod translate_engine;
mod snipaste;

use overlay::{OverlayManager, OverlayResult};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use chrono::Local;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// 常驻行为的开关。设置在渲染进程的 localStorage 里，但「关闭窗口」和「点托盘」
/// 都发生在原生侧，跨 IPC 回读前端状态又要处理前端未就绪的情况，所以镜像一份。
///
/// `instant_recognize` 同理：截图覆盖层是独立子进程，三条入口（界面按钮 / 全局快捷键 /
/// 托盘菜单）里托盘那条完全不过前端，模式只能在原生侧读。
struct AppState {
    close_to_tray: AtomicBool,
    show_on_tray_click: AtomicBool,
    /// 截图模式：框选松开鼠标直接识别（不显示工具栏）
    instant_recognize: AtomicBool,
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
            // 与设置项默认值（现在的模式）对齐
            instant_recognize: AtomicBool::new(false),
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

fn run_screenshot_overlay(app: &tauri::AppHandle) {
    let instant = app.state::<AppState>().instant_recognize.load(Ordering::SeqCst);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = OverlayManager::new(&app_handle, instant);
        let result = tokio::task::spawn_blocking(move || manager.start_overlay()).await;
        match result {
            Ok(Ok(OverlayResult::Ocr { path })) => { let _ = app_handle.emit("screenshot-cropped", path); }
            Ok(Ok(OverlayResult::Cancel)) => { let _ = app_handle.emit("screenshot-cancel", ()); }
            Ok(Err(e)) => { let _ = app_handle.emit("screenshot-error", e.to_string()); }
            Err(e) => { let _ = app_handle.emit("screenshot-error", e.to_string()); }
        }
    });
}

#[tauri::command]
async fn start_screenshot_overlay(app: tauri::AppHandle) -> Result<String, String> {
    run_screenshot_overlay(&app);
    Ok("started".to_string())
}

#[tauri::command]
fn set_tray_behavior(app: tauri::AppHandle, close_to_tray: bool, show_on_click: bool) {
    let state = app.state::<AppState>();
    state.close_to_tray.store(close_to_tray, Ordering::SeqCst);
    state.show_on_tray_click.store(show_on_click, Ordering::SeqCst);
}

/// 截图模式由前端推过来并镜像在原生侧（见 AppState 的说明）。
#[tauri::command]
fn set_screenshot_mode(app: tauri::AppHandle, instant: bool) {
    app.state::<AppState>()
        .instant_recognize
        .store(instant, Ordering::SeqCst);
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
            "screenshot" => run_screenshot_overlay(app),
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

    let registrations: Vec<ShortcutRegistration> = entries
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

    // Alt+P：为所有贴图关闭鼠标穿透（穿透后窗口自身收不到输入，必须有全局恢复入口）
    if let Ok(alt_p) = "Alt+P".parse::<Shortcut>() {
        let handle = app_handle.clone();
        let _ = app_handle.global_shortcut().on_shortcut(alt_p, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                for (label, win) in handle.webview_windows() {
                    if label.starts_with("pin-") {
                        let _ = win.set_ignore_cursor_events(false);
                    }
                }
            }
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

#[tauri::command]
async fn start_snipaste(app: tauri::AppHandle) -> Result<(), String> {
    // 全屏截图（光标所在显示器，物理像素）
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let cap = snipaste::capture_monitor_containing(cursor.x, cursor.y)
        .map_err(|e: anyhow::Error| e.to_string())?;
    snipaste::set_session_monitor(cap.x, cap.y, cap.width, cap.height, cap.scale);

    // 保存到临时文件
    let path = snipaste::SnipasteManager::generate_temp_path("snipaste");
    snipaste::SnipasteManager::save_to_file(&cap.png, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    snipaste::SnipasteManager::set_last_screenshot(path_str.clone());
    snipaste::push_history(path_str.clone());

    // 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 创建覆盖窗口：精确覆盖捕获的显示器（逻辑坐标 = 物理/scale），避免 fullscreen 落错屏
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let _overlay = WebviewWindowBuilder::new(
        &app,
        "snipaste-overlay",
        WebviewUrl::App("/snipaste-overlay".into())
    )
    .title("截图")
    .position(cap.x as f64 / cap.scale, cap.y as f64 / cap.scale)
    .inner_size(cap.width as f64 / cap.scale, cap.height as f64 / cap.scale)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .always_on_top(true)
    .shadow(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn start_long_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // 清空之前的长截图路径
    snipaste::SnipasteManager::clear_long_screenshot_paths();

    // 全屏截图（光标所在显示器）
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let cap = snipaste::capture_monitor_containing(cursor.x, cursor.y)
        .map_err(|e: anyhow::Error| e.to_string())?;
    snipaste::set_session_monitor(cap.x, cap.y, cap.width, cap.height, cap.scale);

    // 保存到临时文件
    let path = snipaste::SnipasteManager::generate_temp_path("longshot");
    snipaste::SnipasteManager::save_to_file(&cap.png, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
    snipaste::SnipasteManager::set_last_screenshot(path_str.clone());
    snipaste::push_history(path_str.clone());

    // 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 创建覆盖窗口（长截图模式，与 start_snipaste 同款几何）
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let _overlay = WebviewWindowBuilder::new(
        &app,
        "snipaste-overlay",
        WebviewUrl::App("/snipaste-overlay?mode=long".into())
    )
    .title("长截图")
    .position(cap.x as f64 / cap.scale, cap.y as f64 / cap.scale)
    .inner_size(cap.width as f64 / cap.scale, cap.height as f64 / cap.scale)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .always_on_top(true)
    .shadow(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn snipaste_crop_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let screenshot_path = snipaste::SnipasteManager::get_last_screenshot()
        .ok_or("No screenshot available")?;
    
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
fn snipaste_capture_next(app: tauri::AppHandle) -> Result<String, String> {
    // 隐藏覆盖窗口，避免把 overlay 自己拍进去
    let overlay = app.get_webview_window("snipaste-overlay");
    if let Some(w) = &overlay {
        w.hide().map_err(|e| e.to_string())?;
    }
    std::thread::sleep(std::time::Duration::from_millis(150));

    // 捕获会话显示器（长截图锁定同一块屏）
    let result = (|| -> Result<String, String> {
        let cap = snipaste::capture_session_monitor()
            .map_err(|e: anyhow::Error| e.to_string())?;
        let path = snipaste::SnipasteManager::generate_temp_path("longshot");
        snipaste::SnipasteManager::save_to_file(&cap.png, &path)
            .map_err(|e: anyhow::Error| e.to_string())?;
        let path_str = path.to_string_lossy().to_string();
        snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
        snipaste::SnipasteManager::set_last_screenshot(path_str.clone());
        Ok(path_str)
    })();

    // 恢复覆盖窗口
    if let Some(w) = &overlay {
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
        .ok_or("No screenshot")?;
    snipaste::SnipasteManager::image_to_base64(&path)
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
fn snipaste_create_pin(
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

    // 用会话显示器把 overlay 的 CSS 坐标换算成全局物理坐标（贴图 1:1 显示物理像素）
    let (mx, my, _, _, scale) = snipaste::get_session_monitor()
        .ok_or("No session monitor")?;
    let px = mx as f64 + (x * scale).round();
    let py = my as f64 + (y * scale).round();
    let pw = ((width * scale).round().max(40.0)) as u32;
    let ph = ((height * scale).round().max(40.0)) as u32;

    let id = snipaste::next_pin_id();
    let label = format!("pin-{}", id);
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
    use tauri::{PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindowBuilder};
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("/".into()))
        .title("贴图")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    win.set_position(Position::Physical(PhysicalPosition::new(px as i32, py as i32)))
        .map_err(|e| e.to_string())?;
    win.set_size(Size::Physical(PhysicalSize::new(pw, ph)))
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();

    Ok(())
}

#[tauri::command]
fn snipaste_get_pin_image(label: String) -> Result<snipaste::PinData, String> {
    snipaste::get_pin(&label).ok_or_else(|| "Pin not found".to_string())
}

#[tauri::command]
fn snipaste_list_pins() -> Vec<(String, snipaste::PinData)> {
    snipaste::list_pins()
}

#[tauri::command]
fn snipaste_set_pin_visible(app: tauri::AppHandle, label: String, visible: bool) -> Result<(), String> {
    snipaste::set_pin_visible(&label, visible).ok_or_else(|| "Pin not found".to_string())?;
    if let Some(win) = app.get_webview_window(&label) {
        if visible {
            win.show().map_err(|e| e.to_string())?;
        } else {
            win.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn snipaste_close_pin(app: tauri::AppHandle, label: String) -> Result<(), String> {
    snipaste::remove_pin(&label).ok_or_else(|| "Pin not found".to_string())?;
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn snipaste_toggle_mouse_through(app: tauri::AppHandle, label: String, enable: bool) -> Result<(), String> {
    let win = app.get_webview_window(&label).ok_or("Pin window not found")?;
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
        .ok_or("No screenshot history")?;
    snipaste::SnipasteManager::set_last_screenshot(path.clone());
    snipaste::SnipasteManager::image_to_base64(&path)
        .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
fn snipaste_finish(app: tauri::AppHandle) -> Result<(), String> {
    // 关闭覆盖窗口
    if let Some(overlay) = app.get_webview_window("snipaste-overlay") {
        overlay.close().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 显示主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e: tauri::Error| e.to_string())?;
        main_window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }

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
            start_screenshot_overlay, select_image_files, save_temp_files,
            ocr_paddleocr, ocr_rapidocr, get_local_components_status, install_local_component, remove_local_component,
            ocr_openai, ocr_ollama, translate_google, translate_custom, translate_claude, translate_hymt,
            ocr_custom_vision, ocr_claude, list_models, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, set_tray_behavior, set_screenshot_mode, focus_main_window, quit_app,
            start_snipaste, start_long_screenshot, snipaste_crop_region,
            snipaste_stitch_screenshots, snipaste_capture_next, snipaste_save_screenshot,
            snipaste_copy_to_clipboard, snipaste_get_screenshot_base64,
            snipaste_create_pin, snipaste_finish, snipaste_get_pin_image,
            snipaste_list_pins, snipaste_set_pin_visible, snipaste_close_pin,
            snipaste_toggle_mouse_through, snipaste_detect_window, snipaste_history_step
        ])
        .on_window_event(|window, event| {
            // 贴图窗口被用户关闭时同步清理状态表
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label();
                if label.starts_with("pin-") {
                    snipaste::remove_pin(label);
                }
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
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // 退出时收掉本地翻译的 llama-server 子进程，别让它变成孤儿进程继续占内存
            if let tauri::RunEvent::Exit = event {
                let _ = translate_engine::shutdown();
            }
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
