mod api;
mod screenshot;
mod overlay;

use overlay::{OverlayManager, OverlayResult};
use tauri::Emitter;

/// 启动截图覆盖窗口 - 异步，不阻塞主线程
#[tauri::command]
async fn start_screenshot_overlay(app: tauri::AppHandle) -> Result<String, String> {
    let app_handle = app.clone();
    
    tauri::async_runtime::spawn(async move {
        let manager = OverlayManager::new();
        
        let result = tokio::task::spawn_blocking(move || {
            manager.start_overlay()
        }).await;
        
        match result {
            Ok(Ok(OverlayResult::Ocr { path })) => {
                let _ = app_handle.emit("screenshot-cropped", path);
            }
            Ok(Ok(OverlayResult::Cancel)) => {
                let _ = app_handle.emit("screenshot-cancel", ());
            }
            Ok(Err(e)) => {
                let _ = app_handle.emit("screenshot-error", e.to_string());
            }
            Err(e) => {
                let _ = app_handle.emit("screenshot-error", e.to_string());
            }
        }
    });
    
    Ok("started".to_string())
}

#[tauri::command]
async fn ocr_openai(api_key: String, image_path: String, model: String, max_tokens: u32) -> Result<String, String> {
    let image_base64 = screenshot::ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    api::call_openai_vision(&api_key, &image_base64, &model, max_tokens).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ocr_ollama(endpoint: String, model: String, image_path: String) -> Result<String, String> {
    let image_base64 = screenshot::ScreenshotManager::image_to_base64(&image_path).map_err(|e| e.to_string())?;
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
            start_screenshot_overlay,
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
