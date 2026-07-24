mod api;
mod screenshot;
mod overlay;

use screenshot::ScreenshotManager;
use overlay::{OverlayManager, OverlayResult};
use tauri::Emitter;

/// 截图并返回 base64
#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let data = ScreenshotManager::capture_full_screen()
        .map_err(|e| e.to_string())?;
    
    let path = ScreenshotManager::generate_temp_path("screenshot");
    ScreenshotManager::save_to_file(&data, &path)
        .map_err(|e| e.to_string())?;
    ScreenshotManager::set_last_screenshot(path.to_string_lossy().to_string());
    
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// 启动截图覆盖窗口 - 同步调用，Python窗口显示时主线程阻塞但用户在操作Python窗口
#[tauri::command]
fn start_screenshot_overlay() -> Result<String, String> {
    let manager = OverlayManager::new();
    
    // 1. 截图
    let data = ScreenshotManager::capture_full_screen()
        .map_err(|e| e.to_string())?;
    let path = ScreenshotManager::generate_temp_path("screenshot");
    ScreenshotManager::save_to_file(&data, &path)
        .map_err(|e| e.to_string())?;
    ScreenshotManager::set_last_screenshot(path.to_string_lossy().to_string());
    
    // 2. 启动Python覆盖窗口（同步，阻塞直到用户操作完成）
    match manager.start_overlay(Some(path.to_string_lossy().as_ref())) {
        Ok(OverlayResult::Ocr { path: _, x, y, width, height }) => {
            // 3. 裁剪选区
            let screenshot_path = ScreenshotManager::get_last_screenshot()
                .ok_or("No screenshot available")?;
            let data = std::fs::read(&screenshot_path).map_err(|e| e.to_string())?;
            let cropped = ScreenshotManager::crop_region(&data, x as u32, y as u32, width, height)
                .map_err(|e| e.to_string())?;
            let crop_path = ScreenshotManager::generate_temp_path("crop");
            ScreenshotManager::save_to_file(&cropped, &crop_path).map_err(|e| e.to_string())?;
            Ok(crop_path.to_string_lossy().to_string())
        }
        Ok(OverlayResult::Cancel) => {
            Err("Cancelled".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 裁剪选区并返回路径
#[tauri::command]
fn crop_screenshot(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let screenshot_path = ScreenshotManager::get_last_screenshot()
        .ok_or("No screenshot available")?;
    let data = std::fs::read(&screenshot_path).map_err(|e| e.to_string())?;
    let cropped = ScreenshotManager::crop_region(&data, x, y, width, height)
        .map_err(|e| e.to_string())?;
    let crop_path = ScreenshotManager::generate_temp_path("crop");
    ScreenshotManager::save_to_file(&cropped, &crop_path).map_err(|e| e.to_string())?;
    Ok(crop_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn ocr_openai(api_key: String, image_path: String, model: String, max_tokens: u32) -> Result<String, String> {
    let image_base64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_openai_vision(&api_key, &image_base64, &model, max_tokens).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ocr_ollama(endpoint: String, model: String, image_path: String) -> Result<String, String> {
    let image_base64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_ollama(&endpoint, &model, &image_base64).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn translate_google(text: String, target_lang: String) -> Result<String, String> {
    api::call_google_translate(&text, &target_lang).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn translate_ai(api_key: String, text: String, target_lang: String, model: String, provider: String) -> Result<String, String> {
    api::call_ai_translate(&api_key, &text, &target_lang, &model, &provider).await.map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_screen, start_screenshot_overlay, crop_screenshot,
            ocr_openai, ocr_ollama, translate_google, translate_ai
        ])
        .setup(|app| {
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyQ);
            let app_handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(shortcut, move |_, _, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    let _ = app_handle.emit("screenshot-triggered", ());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
