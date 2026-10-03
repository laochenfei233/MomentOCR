mod api;
mod local_engine;
mod overlay;
mod recognizer;

use overlay::{OverlayManager, OverlayResult};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// 常驻行为的开关。设置在渲染进程的 localStorage 里，但「关闭窗口」和「点托盘」
/// 都发生在原生侧，跨 IPC 回读前端状态又要处理前端未就绪的情况，所以镜像一份。
struct AppState {
    close_to_tray: AtomicBool,
    show_on_tray_click: AtomicBool,
    /// 正在主动退出。置位后关闭请求不再被拦成「驻留托盘」，
    /// 否则「退出」会被自己的拦截吃掉，软件再也关不掉。
    quitting: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            // 与设置项的默认值（最小化到托盘）对齐：前端还没同步设置就点关闭时，
            // 行为不该和设置里显示的反着来
            close_to_tray: AtomicBool::new(true),
            show_on_tray_click: AtomicBool::new(true),
            quitting: AtomicBool::new(false),
        }
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
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = OverlayManager::new(&app_handle);
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
async fn install_local_component(app: tauri::AppHandle, component: String) -> Result<String, String> {
    let component = local_engine::Component::parse(&component).map_err(|e| e.to_string())?;
    let scripts_dir = overlay::scripts_dir().ok_or("找不到随应用分发的脚本")?;
    local_engine::install(&app, component, &scripts_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_local_component(app: tauri::AppHandle, component: String) -> Result<String, String> {
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

    entries
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
        .collect()
}

#[tauri::command]
fn clear_temp_cache() -> Result<String, String> {
    use std::fs;
    let t = std::env::temp_dir().join("moment_ocr");
    if t.exists() { fs::remove_dir_all(&t).map_err(|e| e.to_string())?; }
    fs::create_dir_all(&t).map_err(|e| e.to_string())?;
    Ok("已清除临时缓存".to_string())
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
            if state.close_to_tray.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_screenshot_overlay, select_image_files, save_temp_files,
            ocr_paddleocr, ocr_rapidocr, get_local_components_status, install_local_component, remove_local_component,
            ocr_openai, ocr_ollama, translate_google, translate_custom, translate_claude,
            ocr_custom_vision, ocr_claude, list_models, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, set_tray_behavior, quit_app
        ])
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
