fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().permissions_path_pattern(
                "C:/Users/chenfei/Documents/GitHub/MomentOCR/.worktrees/security-remediation/src-tauri/permissions/**/*.toml",
            ),
        ),
    )
    .expect("failed to run tauri-build");
}
