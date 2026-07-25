mod api;
mod screenshot;
mod overlay;
mod paddleocr;

use screenshot::ScreenshotManager;
use overlay::{OverlayManager, OverlayResult};
use tauri::Emitter;
use chrono::Local;

/// 启动截图覆盖窗口
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

/// 获取截图 base64（供前端使用）
#[tauri::command]
fn get_screenshot_base64() -> Result<String, String> {
    let path = ScreenshotManager::get_last_screenshot()
        .ok_or_else(|| "No screenshot available".to_string())?;
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// 复制图片到剪贴板
#[tauri::command]
fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    let _data = std::fs::read(&path).map_err(|e| e.to_string())?;
    // 暂时返回成功
    Ok(())
}

/// 保存截图对话框
#[tauri::command]
async fn save_screenshot_dialog() -> Result<String, String> {
    // 简单实现：保存到桌面
    let screenshot_path = ScreenshotManager::get_last_screenshot()
        .ok_or("没有截图")?;
    
    let desktop = dirs::desktop_dir().ok_or("无法获取桌面路径")?;
    let save_path = desktop.join(format!("screenshot_{}.png", 
        Local::now().format("%Y%m%d_%H%M%S")));
    
    std::fs::copy(&screenshot_path, &save_path).map_err(|e| e.to_string())?;
    
    Ok(save_path.to_string_lossy().to_string())
}

/// OCR识别 - PaddleOCR
#[tauri::command]
async fn ocr_paddleocr(image_path: String) -> Result<String, String> {
    let result = tokio::task::spawn_blocking(move || {
        paddleocr::recognize(&image_path)
    }).await;
    
    match result {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// 检查PaddleOCR是否已安装
#[tauri::command]
fn check_paddleocr() -> bool {
    paddleocr::check_installed()
}

/// 安装PaddleOCR
#[tauri::command]
async fn install_paddleocr() -> Result<String, String> {
    let result = tokio::task::spawn_blocking(|| {
        paddleocr::install()
    }).await;
    
    match result {
        Ok(Ok(msg)) => Ok(msg),
        Ok(Err(e)) => Err(e.to_string()),
        Err(e) => Err(e.to_string()),
    }
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
            get_screenshot_base64,
            copy_image_to_clipboard,
            save_screenshot_dialog,
            ocr_paddleocr, check_paddleocr, install_paddleocr,
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
