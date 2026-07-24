mod api;
mod screenshot;

use screenshot::ScreenshotManager;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Emitter};

/// 启动截图流程
#[tauri::command]
async fn start_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // 1. 全屏截图
    let data = ScreenshotManager::capture_full_screen()
        .map_err(|e| e.to_string())?;
    
    // 2. 保存到临时文件
    let path = ScreenshotManager::generate_temp_path("screenshot");
    ScreenshotManager::save_to_file(&data, &path)
        .map_err(|e| e.to_string())?;
    
    let path_str = path.to_string_lossy().to_string();
    ScreenshotManager::set_last_screenshot(path_str);
    
    // 3. 隐藏主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.hide().map_err(|e| e.to_string())?;
    }
    
    // 4. 创建覆盖窗口
    let _overlay = WebviewWindowBuilder::new(
        &app,
        "screenshot-overlay",
        WebviewUrl::App("/screenshot-overlay".into())
    )
    .title("截图")
    .fullscreen(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 获取截图的 base64 数据
#[tauri::command]
fn get_screenshot_base64() -> Result<String, String> {
    let path = ScreenshotManager::get_last_screenshot()
        .ok_or_else(|| "No screenshot available".to_string())?;
    
    let data = std::fs::read(&path)
        .map_err(|e| e.to_string())?;
    
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// 裁剪选区并返回 base64
#[tauri::command]
fn crop_screenshot_base64(
    x: u32, y: u32,
    width: u32, height: u32
) -> Result<String, String> {
    let screenshot_path = ScreenshotManager::get_last_screenshot()
        .ok_or("No screenshot available")?;
    
    let data = std::fs::read(&screenshot_path)
        .map_err(|e| e.to_string())?;
    
    let cropped = ScreenshotManager::crop_region(&data, x, y, width, height)
        .map_err(|e| e.to_string())?;
    
    // 保存裁剪结果
    let crop_path = ScreenshotManager::generate_temp_path("crop");
    ScreenshotManager::save_to_file(&cropped, &crop_path)
        .map_err(|e| e.to_string())?;
    
    Ok(crop_path.to_string_lossy().to_string())
}

/// 关闭覆盖窗口，恢复主窗口
#[tauri::command]
async fn finish_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("screenshot-overlay") {
        overlay.close().map_err(|e| e.to_string())?;
    }
    
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e| e.to_string())?;
        main_window.set_focus().map_err(|e| e.to_string())?;
    }
    
    Ok(())
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_screenshot,
            get_screenshot_base64,
            crop_screenshot_base64,
            finish_screenshot,
            ocr_openai,
            ocr_ollama,
            translate_google,
            translate_ai
        ])
        .setup(|app| {
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::KeyQ
            );
            let app_handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(
                shortcut,
                move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app_handle.emit("screenshot-triggered", ());
                    }
                }
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
