mod api;
mod local_engine;
mod screenshot;
mod overlay;
mod paddleocr;
mod rapidocr;
mod recognizer;

use screenshot::ScreenshotManager;
use overlay::{OverlayManager, OverlayResult};
use tauri::Emitter;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use chrono::Local;
use std::collections::HashMap;

#[tauri::command]
async fn start_screenshot_overlay(app: tauri::AppHandle) -> Result<String, String> {
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
    Ok("started".to_string())
}

#[tauri::command]
fn get_screenshot_base64() -> Result<String, String> {
    let path = ScreenshotManager::get_last_screenshot().ok_or("No screenshot")?;
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
fn copy_image_to_clipboard(_path: String) -> Result<(), String> { Ok(()) }

#[tauri::command]
async fn save_screenshot_dialog() -> Result<String, String> {
    let screenshot_path = ScreenshotManager::get_last_screenshot().ok_or("没有截图")?;
    let desktop = dirs::desktop_dir().ok_or("无法获取桌面路径")?;
    let save_path = desktop.join(format!("screenshot_{}.png", Local::now().format("%Y%m%d_%H%M%S")));
    std::fs::copy(&screenshot_path, &save_path).map_err(|e| e.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
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
    let r = tokio::task::spawn_blocking(move || paddleocr::recognize(&app, &image_path)).await;
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
fn remove_local_runtime(app: tauri::AppHandle) -> Result<String, String> {
    let freed = local_engine::remove(&app).map_err(|e| e.to_string())?;
    Ok(format!("已移除本地运行时，释放 {:.0} MB", freed as f64 / 1_048_576.0))
}

#[tauri::command]
async fn ocr_rapidocr(app: tauri::AppHandle, image_path: String) -> Result<String, String> {
    let r = tokio::task::spawn_blocking(move || rapidocr::recognize(&app, &image_path)).await;
    match r { Ok(Ok(t)) => Ok(t), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
async fn ocr_openai(api_key: String, image_path: String, model: String, max_tokens: u32) -> Result<String, String> {
    let b64 = ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_openai_vision(&api_key, &b64, &model, max_tokens).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_ollama(endpoint: String, model: String, image_path: String) -> Result<String, String> {
    let b64 = ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_ollama(&endpoint, &model, &b64).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_custom_vision(base_url: String, api_key: String, model: String, image_path: String, max_tokens: u32) -> Result<String, String> {
    let b64 = ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
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
    let b64 = ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
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
fn unregister_all_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    Ok(())
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_screenshot_overlay, get_screenshot_base64, copy_image_to_clipboard,
            save_screenshot_dialog, select_image_files, save_temp_files,
            ocr_paddleocr, ocr_rapidocr, get_local_components_status, install_local_component, remove_local_component,
            remove_local_runtime,
            ocr_openai, ocr_ollama, translate_google, translate_custom, translate_claude,
            ocr_custom_vision, ocr_claude, list_models, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, unregister_all_shortcuts
        ])
        .setup(|app| {
            use tauri::Manager;
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
