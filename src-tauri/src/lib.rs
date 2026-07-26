mod api;
mod screenshot;
mod overlay;
mod paddleocr;
mod snipaste;

use screenshot::ScreenshotManager;
use overlay::{OverlayManager, OverlayResult};
use tauri::{Emitter, Manager};
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
async fn translate_google(text: String, target_lang: String) -> Result<String, String> {
    api::call_google_translate(&text, &target_lang).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn translate_ai(api_key: String, text: String, target_lang: String, model: String, provider: String) -> Result<String, String> {
    api::call_ai_translate(&api_key, &text, &target_lang, &model, &provider).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn translate_custom(base_url: String, api_key: String, model: String, text: String, target_lang: String) -> Result<String, String> {
    api::call_custom_translate(&base_url, &api_key, &model, &text, &target_lang).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn ocr_custom_vision(base_url: String, api_key: String, model: String, image_path: String, max_tokens: u32) -> Result<String, String> {
    let b64 = ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_custom_vision(&base_url, &api_key, &model, &b64, max_tokens).await.map_err(|e| e.to_string())
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

// ============ Snipaste 截图功能 ============

#[tauri::command]
async fn start_snipaste(app: tauri::AppHandle) -> Result<(), String> {
    let app_handle = app.clone();

    // 全屏截图
    let data = snipaste::SnipasteManager::capture_full_screen()
        .map_err(|e: anyhow::Error| e.to_string())?;

    // 保存到临时文件
    let path = snipaste::SnipasteManager::generate_temp_path("snipaste");
    snipaste::SnipasteManager::save_to_file(&data, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    snipaste::SnipasteManager::set_last_screenshot(path_str.clone());

    // 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 创建覆盖窗口
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let _overlay = WebviewWindowBuilder::new(
        &app,
        "snipaste-overlay",
        WebviewUrl::App("/snipaste-overlay".into())
    )
    .title("截图")
    .fullscreen(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn start_long_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    let app_handle = app.clone();

    // 清空之前的长截图路径
    snipaste::SnipasteManager::clear_long_screenshot_paths();

    // 全屏截图
    let data = snipaste::SnipasteManager::capture_full_screen()
        .map_err(|e: anyhow::Error| e.to_string())?;

    // 保存到临时文件
    let path = snipaste::SnipasteManager::generate_temp_path("longshot");
    snipaste::SnipasteManager::save_to_file(&data, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
    snipaste::SnipasteManager::set_last_screenshot(path_str.clone());

    // 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e: tauri::Error| e.to_string())?;
    }

    // 创建覆盖窗口（长截图模式）
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let _overlay = WebviewWindowBuilder::new(
        &app,
        "snipaste-overlay",
        WebviewUrl::App("/snipaste-overlay?mode=long".into())
    )
    .title("长截图")
    .fullscreen(true)
    .always_on_top(true)
    .decorations(false)
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
fn snipaste_capture_next() -> Result<String, String> {
    // 全屏截图
    let data = snipaste::SnipasteManager::capture_full_screen()
        .map_err(|e| e.to_string())?;
    
    // 保存到临时文件
    let path = snipaste::SnipasteManager::generate_temp_path("longshot");
    snipaste::SnipasteManager::save_to_file(&data, &path)
        .map_err(|e| e.to_string())?;
    
    let path_str = path.to_string_lossy().to_string();
    snipaste::SnipasteManager::add_long_screenshot_path(path_str.clone());
    
    Ok(path_str)
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
    // 保存到临时文件（完整的剪贴板实现需要将 PNG 转换为 DIB 格式）
    let temp_path = snipaste::SnipasteManager::generate_temp_path("clipboard");
    snipaste::SnipasteManager::save_to_file(&data, &temp_path)
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
fn snipaste_create_pin(image_data: String, _x: f64, _y: f64) -> Result<(), String> {
    // 保存图片到临时文件
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD.decode(&image_data)
        .map_err(|e| e.to_string())?;

    let path = snipaste::SnipasteManager::generate_temp_path("pin");
    snipaste::SnipasteManager::save_to_file(&data, &path)
        .map_err(|e: anyhow::Error| e.to_string())?;

    // 发送事件给前端创建贴图窗口
    // 这里需要通过前端来创建贴图窗口
    Ok(())
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_screenshot_overlay, get_screenshot_base64, copy_image_to_clipboard,
            save_screenshot_dialog, select_image_files, save_temp_files,
            ocr_paddleocr, check_paddleocr, install_paddleocr,
            ocr_openai, ocr_ollama, translate_google, translate_ai, translate_custom,
            ocr_custom_vision, set_autostart, get_autostart, clear_temp_cache,
            register_shortcuts, unregister_all_shortcuts,
            start_snipaste, start_long_screenshot, snipaste_crop_region,
            snipaste_stitch_screenshots, snipaste_capture_next, snipaste_save_screenshot,
            snipaste_copy_to_clipboard, snipaste_get_screenshot_base64,
            snipaste_create_pin, snipaste_finish
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
