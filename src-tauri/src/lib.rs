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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            take_screenshot,
            take_screenshot_region
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
