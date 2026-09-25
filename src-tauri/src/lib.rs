mod api;
mod screenshot;
mod overlay;
mod paddleocr;
mod rapidocr;

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
        let manager = OverlayManager::new();
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
async fn ocr_paddleocr(image_path: String) -> Result<String, String> {
    let r = tokio::task::spawn_blocking(move || paddleocr::recognize(&image_path)).await;
    match r { Ok(Ok(t)) => Ok(t), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
fn check_paddleocr() -> bool { paddleocr::check_installed() }
#[tauri::command]
async fn install_paddleocr() -> Result<String, String> {
    let r = tokio::task::spawn_blocking(|| paddleocr::install()).await;
    match r { Ok(Ok(m)) => Ok(m), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
async fn ocr_rapidocr(image_path: String) -> Result<String, String> {
    let r = tokio::task::spawn_blocking(move || rapidocr::recognize(&image_path)).await;
    match r { Ok(Ok(t)) => Ok(t), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
fn check_rapidocr() -> bool { rapidocr::check_installed() }
#[tauri::command]
async fn install_rapidocr() -> Result<String, String> {
    let r = tokio::task::spawn_blocking(|| rapidocr::install()).await;
    match r { Ok(Ok(m)) => Ok(m), Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()) }
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
    if enable { am.enable().map_err(|e| e.to_string()) } else { am.disable().map_err(|e| e.to_string()) }
}
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool { app.autolaunch().is_enabled().unwrap_or(false) }
#[tauri::command]
fn register_shortcuts(app: tauri::AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String> {
    let app_handle = app.clone();
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;

    // Parse all shortcuts first — if any is invalid, fail without registering anything
    let parsed: Vec<(String, Shortcut)> = shortcuts.iter().map(|(action, shortcut_str)| {
        let shortcut: Shortcut = shortcut_str.parse().map_err(|e| {
            format!("Invalid shortcut '{}' for action '{}': {}", shortcut_str, action, e)
        })?;
        Ok((action.clone(), shortcut))
    }).collect::<Result<Vec<_>, String>>()?;

    // Register all, rollback on failure
    for (action, shortcut) in &parsed {
        let action_owned = action.clone();
        let handle = app_handle.clone();
        let action_for_err = action_owned.clone();
        app.global_shortcut().on_shortcut(shortcut.clone(), move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = handle.emit("global-shortcut-triggered", serde_json::json!({ "action": action_owned }));
            }
        }).map_err(|e| {
            // Rollback: unregister everything
            let _ = app_handle.global_shortcut().unregister_all();
            format!("Failed to register shortcut for '{}': {}", action_for_err, e)
        })?;
    }

    Ok(())
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
            ocr_paddleocr, check_paddleocr, install_paddleocr,
            ocr_rapidocr, check_rapidocr, install_rapidocr,
            ocr_openai, ocr_ollama, translate_google, translate_custom, translate_claude,
            ocr_custom_vision, ocr_claude, list_models, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, unregister_all_shortcuts
        ])
        .setup(|app| {
            use tauri::Manager;
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
