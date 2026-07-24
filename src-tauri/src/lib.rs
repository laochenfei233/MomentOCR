mod api;
mod screenshot;

use screenshot::ScreenshotManager;

#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    let data = ScreenshotManager::capture_full_screen().map_err(|e| e.to_string())?;
    let path = ScreenshotManager::generate_temp_path("screenshot");
    ScreenshotManager::save_to_file(&data, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn take_screenshot_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let data = ScreenshotManager::capture_region(x, y, width, height).map_err(|e| e.to_string())?;
    let path = ScreenshotManager::generate_temp_path("screenshot_region");
    ScreenshotManager::save_to_file(&data, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn ocr_openai(api_key: String, image_path: String, model: String, max_tokens: u32) -> Result<String, String> {
    let image_base64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    let result = api::call_openai_vision(&api_key, &image_base64, &model, max_tokens)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn ocr_ollama(endpoint: String, model: String, image_path: String) -> Result<String, String> {
    let image_base64 = api::image_to_base64(&image_path).map_err(|e| e.to_string())?;
    let result = api::call_ollama(&endpoint, &model, &image_base64)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn translate_google(text: String, target_lang: String) -> Result<String, String> {
    let result = api::call_google_translate(&text, &target_lang)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn translate_ai(api_key: String, text: String, target_lang: String, model: String, provider: String) -> Result<String, String> {
    let result = api::call_ai_translate(&api_key, &text, &target_lang, &model, &provider)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            take_screenshot,
            take_screenshot_region,
            ocr_openai,
            ocr_ollama,
            translate_google,
            translate_ai
        ])
        .setup(|app| {
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyQ);
            let app_handle = app.handle().clone();

            app.global_shortcut().register(
                shortcut,
                move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        // Trigger screenshot
                        let _ = app_handle.emit("screenshot-triggered", ());
                    }
                },
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
