//! 本地翻译组件：腾讯 HY-MT1.5-1.8B 经 llama.cpp 离线运行。
//!
//! 与 `local_engine` 的 Python 组件不同，这条链路不需要解释器：
//!   · 推理器 = llama.cpp 官方预编译 CPU 版（固定 b11932，晚于混元架构的支持，
//!     GGUF 开箱即用），按平台从 GitHub Releases 取对应压缩包，约 12–24 MB
//!   · 模型 = `tencent/HY-MT1.5-1.8B-GGUF` 的 Q4_K_M（1,133,080,512 字节），
//!     ModelScope（国内直连快）→ HuggingFace（回退）
//!
//! 目录布局（`<app_local_data>/local-translate/`）：
//!   runtime/   llama.cpp 解压产物（llama-server 在里面，启动时按名字查找，
//!              不依赖归档内部目录叫什么）
//!   models/    GGUF 模型文件
//!   state/translate.json   文件清单（相对 root），按清单精确卸载
//!
//! 服务用 `llama-server` 的 OpenAI 兼容接口（127.0.0.1:48731）。翻译前探活
//! `/health`，没起就 spawn 并轮询；进程句柄存在 static 里，应用退出时统一
//! `shutdown()` 收掉，不留孤儿进程。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

/// llama.cpp 版本固定，换版本要连带确认 GGUF 兼容与各平台产物名
const LLAMA_TAG: &str = "b11932";
/// 官方 GGUF 的 Q4_K_M 量化，装完按字节数校验（下载截断/镜像损坏会直接报错）
const GGUF_BYTES: u64 = 1_133_080_512;
/// llama-server 监听端口。固定值：冲突时提示用户即可，不值得做成配置项
const PORT: u16 = 48731;

/// 按平台选 llama.cpp 的 release 产物名（CPU 版足够跑 1.8B）
fn llama_asset_for(os: &str, arch: &str) -> Result<&'static str> {
    Ok(match (os, arch) {
        ("windows", "x86_64") => "llama-b11932-bin-win-cpu-x64.zip",
        ("windows", "aarch64") => "llama-b11932-bin-win-cpu-arm64.zip",
        ("macos", "aarch64") => "llama-b11932-bin-macos-arm64.tar.gz",
        ("macos", "x86_64") => "llama-b11932-bin-macos-x64.tar.gz",
        ("linux", "x86_64") => "llama-b11932-bin-ubuntu-x64.tar.gz",
        ("linux", "aarch64") => "llama-b11932-bin-ubuntu-arm64.tar.gz",
        (os, arch) => anyhow::bail!("本地翻译暂不支持当前平台（{os}/{arch}）"),
    })
}

fn llama_asset() -> Result<&'static str> {
    llama_asset_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn llama_urls() -> Result<Vec<String>> {
    let asset = llama_asset()?;
    // release 资产的 CDN 在国内直连不通（api.github.com 通但下载会失败），先走
    // gh 代理（格式：代理域名后面拼完整原始 URL），官方地址保留作回退
    let path = format!("https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/{asset}");
    Ok(vec![
        format!("https://gh-proxy.com/{path}"),
        format!("https://ghproxy.net/{path}"),
        path,
    ])
}

/// 模型下载源：ModelScope 国内直连 → HuggingFace 回退
fn gguf_urls() -> Vec<String> {
    vec![
        "https://modelscope.cn/models/Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF/resolve/master/HY-MT1.5-1.8B-Q4_K_M.gguf".to_string(),
        "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-Q4_K_M.gguf".to_string(),
    ]
}

const GGUF_NAME: &str = "HY-MT1.5-1.8B-Q4_K_M.gguf";
/// llama-server 的可执行名（Windows 带 .exe）
const SERVER_BIN: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

/// 界面展示用的体积估算（模型 1080.6 MiB；推理器官方包约 12–24 MB，解压后约 60 MB）
const MODEL_MB: u64 = 1081;
const RUNTIME_DOWNLOAD_MB: u64 = 24;
const RUNTIME_DISK_MB: u64 = 60;

/// `-local-inference` 变体把 llama.cpp 打进了资源目录的 llama-runtime/ 下
const BUNDLED_DIR: &str = "llama-runtime";

/// 探测安装包内置的推理器。依次找：资源目录、exe 相对路径向上三级
/// （安装版资源与 exe 同级，开发期 target/debug 向上能到 src-tauri）、
/// CARGO_MANIFEST_DIR（测试/编译期）。
fn bundled_runtime(resource_hint: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(hint) = resource_hint {
        candidates.push(hint.join(BUNDLED_DIR));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|d| d.to_path_buf());
        for _ in 0..3 {
            let Some(current) = dir else { break };
            candidates.push(current.join(BUNDLED_DIR));
            dir = current.parent().map(|d| d.to_path_buf());
        }
    }
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let base = PathBuf::from(manifest);
        candidates.push(base.join("resources").join(BUNDLED_DIR));
        candidates.push(base.join(BUNDLED_DIR));
    }
    candidates
        .into_iter()
        .find(|dir| find_server(dir).is_some())
}

/// 组件根目录，与 local_engine 的 local-engine/ 平级
fn resolve_root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()
        .context("无法定位应用数据目录")?
        .join("local-translate"))
}

struct Layout {
    root: PathBuf,
}

impl Layout {
    fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }
    fn models(&self) -> PathBuf {
        self.root.join("models")
    }
    fn gguf(&self) -> PathBuf {
        self.models().join(GGUF_NAME)
    }
    fn manifest(&self) -> PathBuf {
        self.root.join("state").join("translate.json")
    }

    fn installed(&self) -> bool {
        find_server(&self.runtime()).is_some() && self.gguf().is_file()
    }

    fn size(&self) -> u64 {
        crate::local_engine::dir_size(&self.root)
    }
}

/// 在 runtime/ 下按名字找 llama-server（不依赖归档解出来的目录名）
fn find_server(runtime: &Path) -> Option<PathBuf> {
    let mut stack = vec![runtime.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(path);
            } else if path.file_name().map(|n| n == SERVER_BIN).unwrap_or(false) {
                return Some(path);
            }
        }
    }
    None
}

fn emit(app: &AppHandle, stage: &str, percent: u8, detail: &str) {
    let _ = app.emit(
        crate::local_engine::PROGRESS_EVENT,
        crate::local_engine::Progress {
            stage: stage.to_string(),
            percent,
            detail: detail.to_string(),
        },
    );
}

/// -local-inference 变体是否内置了推理器（Status 展示与下载估算用）
pub fn runtime_bundled(app: &AppHandle) -> bool {
    bundled_runtime(app.path().resource_dir().ok().as_deref()).is_some()
}

/// 设置页展示用的组件状态（与 local_engine::ComponentStatus 同形）
pub fn status(app: &AppHandle) -> crate::local_engine::ComponentStatus {
    let layout = resolve_root(app).map(|root| Layout { root }).ok();
    let bundled = runtime_bundled(app);
    let has_model = layout.as_ref().map(|l| l.gguf().is_file()).unwrap_or(false);
    let has_server = layout.as_ref().map(|l| find_server(&l.runtime()).is_some()).unwrap_or(false) || bundled;
    let installed = has_model && has_server;
    // bundled 时推理器不占应用数据、也不必下载，估算只按模型计
    crate::local_engine::ComponentStatus {
        installed,
        version: if installed { "HY-MT1.5-1.8B（Q4_K_M）".to_string() } else { String::new() },
        disk_bytes: layout.as_ref().map(|l| l.size()).unwrap_or(0),
        download_mb: MODEL_MB + if bundled { 0 } else { RUNTIME_DOWNLOAD_MB },
        disk_mb: MODEL_MB + if bundled { 0 } else { RUNTIME_DISK_MB },
    }
}

/// 记录本次安装写入的文件（相对 root），卸载时按清单删
fn write_manifest(layout: &Layout, files: &[String]) -> Result<()> {
    let path = layout.manifest();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(files)?)?;
    Ok(())
}

fn read_manifest(layout: &Layout) -> Vec<String> {
    std::fs::read_to_string(layout.manifest())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// 下载并装配。进度走 `local-engine-progress` 事件，与 OCR/截图组件共用一个监听器。
pub async fn install(app: &AppHandle) -> Result<String> {
    let root = resolve_root(app)?;
    let hint = app.path().resource_dir().ok();
    install_into(&root, hint.as_deref(), &|stage, percent, detail| {
        emit(app, stage, percent, detail)
    })
    .await
}

/// 装配逻辑本体：不依赖 Tauri，便于直接测试（见文件末尾的联网集成测试）。
/// `resource_hint` 是安装包资源目录，供探测内置推理器（-local-inference 变体）。
pub async fn install_into(
    root: &Path,
    resource_hint: Option<&Path>,
    progress: &(dyn Fn(&str, u8, &str) + Sync),
) -> Result<String> {
    let layout = Layout { root: root.to_path_buf() };
    std::fs::create_dir_all(layout.runtime())?;
    std::fs::create_dir_all(layout.models())?;
    let client = reqwest::Client::builder()
        .user_agent("MomentOCR-local-translate")
        .build()?;
    let report = |stage: &str, percent: u8, detail: &str| progress(stage, percent, detail);
    let bundled = bundled_runtime(resource_hint);

    let mut files: Vec<String> = vec![];

    // 1) 模型（大头，1.1 GB）：两源逐个试，装完校验字节数
    if layout.gguf().is_file() {
        report("model", 10, "模型已存在，跳过下载");
        files.push(format!("models/{GGUF_NAME}"));
    } else {
        let dest = layout.gguf();
        let partial = layout.models().join(format!("{GGUF_NAME}.part"));
        let mut last_error = None;
        for url in gguf_urls() {
            report("model", 10, "正在下载翻译模型（约 1.1 GB）…");
            let result = crate::local_engine::download(&client, &url, &partial, |done, total| {
                let percent = if total > 0 { done * 100 / total } else { 0 };
                report(
                    "model",
                    (10 + percent * 70 / 100).min(80) as u8,
                    &format!(
                        "正在下载翻译模型… {:.1} / {:.1} GB",
                        done as f64 / 1_073_741_824.0,
                        total as f64 / 1_073_741_824.0
                    ),
                );
            })
            .await;
            match result {
                Ok(()) => {
                    last_error = None;
                    break;
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&partial);
                    last_error = Some(err);
                }
            }
        }
        if let Some(err) = last_error {
            anyhow::bail!("下载翻译模型失败：{err}");
        }
        // 精确字节数校验：GGUF 截断时 llama.cpp 只会在加载时报错，提前拦下来好排查
        let bytes = partial.metadata().map(|m| m.len()).unwrap_or(0);
        if bytes != GGUF_BYTES {
            let _ = std::fs::remove_file(&partial);
            anyhow::bail!("模型文件大小不符（{bytes} / {GGUF_BYTES} 字节），下载可能被截断，请重试");
        }
        std::fs::rename(&partial, &dest)?;
        files.push(format!("models/{GGUF_NAME}"));
    }

    // 2) 推理器（约 12–24 MB）：变体安装包已内置时跳过；解压到 runtime/，解完删压缩包
    if find_server(&layout.runtime()).is_some() {
        report("runtime", 85, "推理器已存在，跳过下载");
    } else if bundled.is_some() {
        report("runtime", 85, "使用安装包内置的推理器");
    } else {
        let archive_name = llama_asset()?.to_string();
        let archive = layout.root.join(&archive_name);
        let mut last_error = None;
        for url in llama_urls()? {
            report("runtime", 85, "正在下载推理器（llama.cpp）…");
            let result =
                crate::local_engine::download(&client, &url, &archive, |_, _| {}).await;
            match result {
                Ok(()) => {
                    last_error = None;
                    break;
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&archive);
                    last_error = Some(err);
                }
            }
        }
    if let Some(err) = last_error {
        anyhow::bail!("下载推理器失败：{err:#}");
    }
        report("runtime", 88, "正在解压推理器…");
        let runtime = layout.runtime();
        let archive_for_extract = archive.clone();
        tokio::task::spawn_blocking(move || {
            #[cfg(windows)]
            {
                crate::local_engine::extract_zip(&archive_for_extract, &runtime)
            }
            #[cfg(not(windows))]
            {
                extract_tar_gz_flat(&archive_for_extract, &runtime)
            }
        })
        .await
        .map_err(|e| anyhow::anyhow!("解压任务失败：{e}"))??;
        let _ = std::fs::remove_file(&archive);
        if find_server(&layout.runtime()).is_none() {
            anyhow::bail!("推理器归档结构与预期不符：没找到 {SERVER_BIN}");
        }
    }

    // 3) 清单：把 root 下现有文件全记下来（模型 + 解压产物）
    files = list_files(&layout.root);
    write_manifest(&layout, &files)?;

    // 4) 自检：装了就得能翻——真起一次服务、译一句、再收掉
    report("selftest", 95, "正在自检（首次加载模型约需数十秒）…");
    let text = ensure_server(&layout, bundled.as_deref(), &report).await?;
    let sample = do_chat(&text, "你好，世界", "英文").await;
    let _ = shutdown();
    match sample {
        Ok(out) if !out.trim().is_empty() => {
            report("done", 100, "本地翻译已就绪");
            Ok(format!("本地翻译已安装完成（自检译文：{}）", out.trim()))
        }
        Ok(_) => anyhow::bail!("自检失败：模型返回为空"),
        Err(e) => anyhow::bail!("自检失败：{e}"),
    }
}

/// unix 的 llama.cpp 归档整棵在 `llama-b*-bin-*/` 下，直接解到 runtime/ 即可
/// （启动时按名字找 llama-server，无需剥前缀）。
#[cfg(any(not(windows), test))]
fn extract_tar_gz_flat(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)
        .with_context(|| format!("打开 {} 失败", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    // 不留权限位的话 llama-server 会丢可执行位
    tar.set_preserve_permissions(true);
    tar.set_overwrite(true);
    let mut extracted = 0usize;
    for entry in tar.entries().context("压缩包无法解析")? {
        let mut entry = entry?;
        let relative = {
            let path = entry.path()?;
            // 拒绝绝对路径与越出解压目录的 `..` 条目（与 zip 那套 enclosed_name 同一用意）
            if path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                continue;
            }
            path.to_path_buf()
        };
        let target = dest.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry.unpack(&target)?;
        extracted += 1;
    }
    if extracted == 0 {
        anyhow::bail!("推理器归档结构与预期不符：解出 0 个文件");
    }
    Ok(())
}

/// root 下的所有文件（相对路径）
fn list_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(path);
            } else if let Ok(relative) = path.strip_prefix(root) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    out
}

/// 按清单移除；服务在跑先收掉
pub fn remove(app: &AppHandle) -> Result<String> {
    let root = resolve_root(app)?;
    remove_into(&root)
}

pub fn remove_into(root: &Path) -> Result<String> {
    let layout = Layout { root: root.to_path_buf() };
    let _ = shutdown();
    let files = read_manifest(&layout);
    if files.is_empty() && !layout.root.exists() {
        anyhow::bail!("本地翻译尚未安装");
    }
    let mut freed = 0u64;
    for relative in &files {
        let path = root.join(relative);
        if let Ok(meta) = path.metadata() {
            freed += meta.len();
        }
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    let _ = std::fs::remove_file(layout.manifest());
    prune_empty_dirs(&root);
    // 剩个空壳也一并删掉（清单缺失时兜底）
    if dir_is_empty(&root) {
        let extra = crate::local_engine::dir_size(&root);
        let _ = std::fs::remove_dir_all(&root);
        freed += extra;
    }
    Ok(format!("已移除本地翻译组件，释放 {:.0} MB", freed as f64 / 1_048_576.0))
}

fn prune_empty_dirs(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            prune_empty_dirs(&path);
            let _ = std::fs::remove_dir(&path); // 非空会失败，正好跳过
        }
    }
}

fn dir_is_empty(dir: &Path) -> bool {
    std::fs::read_dir(dir).map(|mut d| d.next().is_none()).unwrap_or(true)
}

// ===== llama-server 进程管理 =====

struct ServerHandle {
    child: std::process::Child,
    /// 句柄所属布局的 root，自检后 shutdown 用不到，留作扩展
    #[allow(dead_code)]
    root: PathBuf,
}

/// 常驻服务句柄。Mutex::new 是 const 的，可以直接放 static。
static SERVER: Mutex<Option<ServerHandle>> = Mutex::new(None);

/// 本机直连，绝不走用户配置的系统代理（不然 localhost 请求会被代理吞掉）
fn localhost_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("localhost client 构建失败")
}

async fn healthy(client: &reqwest::Client) -> bool {
    matches!(
        client
            .get(format!("http://127.0.0.1:{PORT}/health"))
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    )
}

/// 确保服务在跑：探活，没起就 spawn 并轮询到就绪（模型加载可能要几十秒）。
/// 推理器优先用应用数据里已下载的，其次用安装包内置的。返回请求用的客户端。
async fn ensure_server(
    layout: &Layout,
    bundled: Option<&Path>,
    report: &(dyn Fn(&str, u8, &str) + Sync),
) -> Result<reqwest::Client> {
    let client = localhost_client();
    if healthy(&client).await {
        return Ok(client);
    }

    let server = find_server(&layout.runtime())
        .or_else(|| bundled.and_then(|dir| find_server(dir)))
        .context("未找到 llama-server，请先在设置里安装本地翻译组件")?;
    let gguf = layout.gguf();
    if !gguf.is_file() {
        anyhow::bail!("翻译模型尚未下载，请先在设置里安装本地翻译组件");
    }

    {
        // 并发调用时可能别人已经起了：先看句柄，再放手探活（MutexGuard 不能跨 await）
        let already = {
            let guard = SERVER.lock().unwrap();
            guard.is_some()
        };
        if already && healthy(&client).await {
            return Ok(client);
        }
        let mut command = std::process::Command::new(&server);
        command
            .arg("-m")
            .arg(&gguf)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(PORT.to_string())
            .arg("--ctx-size")
            .arg("4096")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .current_dir(server.parent().unwrap_or(Path::new(".")));
        crate::local_engine::hide_console(&mut command);
        let child = command
            .spawn()
            .with_context(|| format!("启动 {} 失败", server.display()))?;
        let mut guard = SERVER.lock().unwrap();
        if let Some(mut stale) = guard.take() {
            // 有旧句柄但服务不健康：进程多半已死，收掉防止句柄泄漏
            let _ = stale.child.kill();
            let _ = stale.child.wait();
        }
        *guard = Some(ServerHandle { child, root: layout.root.clone() });
    }

    // 轮询到就绪；上限 90 秒（冷启动从磁盘读 1.1 GB 模型在机械盘上会更慢）
    report("server", 0, "正在启动本地翻译服务…");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    loop {
        if healthy(&client).await {
            return Ok(client);
        }
        if std::time::Instant::now() > deadline {
            let _ = shutdown();
            anyhow::bail!("本地翻译服务启动超时，请重试或查看日志");
        }
        // 子进程退了还等就没意义（参数错、端口被占都会立刻退出）
        {
            let mut guard = SERVER.lock().unwrap();
            if let Some(handle) = guard.as_mut() {
                if let Ok(Some(_)) = handle.child.try_wait() {
                    *guard = None;
                    anyhow::bail!("本地翻译服务启动失败（进程已退出），请确认端口 {PORT} 未被占用");
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// 收掉常驻服务（应用退出与自检结束都会调）
pub fn shutdown() -> Result<()> {
    let mut guard = SERVER.lock().unwrap();
    if let Some(mut handle) = guard.take() {
        let _ = handle.child.kill();
        let _ = handle.child.wait();
    }
    Ok(())
}

/// HY-MT 官方推荐的基础翻译指令（不带术语表/思维链等扩展）
fn translation_prompt(target_lang: &str, text: &str) -> String {
    format!("把下面的文本翻译成{target_lang}，不要额外解释。\n\n{text}")
}

async fn do_chat(client: &reqwest::Client, text: &str, target_lang: &str) -> Result<String> {
    let body = serde_json::json!({
        "model": "hy-mt",
        "messages": [{ "role": "user", "content": translation_prompt(target_lang, text) }],
        "temperature": 0.1,
        "stream": false,
    });

    let response = client
        .post(format!("http://127.0.0.1:{PORT}/v1/chat/completions"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;
    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMessage,
    }
    #[derive(Deserialize)]
    struct ChoiceMessage {
        content: String,
    }
    #[derive(Deserialize)]
    struct ChatResponse {
        choices: Vec<Choice>,
    }

    let parsed: ChatResponse = serde_json::from_str(&response_text).map_err(|e| {
        anyhow::anyhow!("解析本地翻译响应失败: {e}. Response: {response_text}")
    })?;
    parsed
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow::anyhow!("本地翻译返回为空"))
}

/// 翻译一条文本。服务没起会先拉起来；应用退出时由 `shutdown()` 统一收进程。
pub async fn translate(app: &AppHandle, text: &str, target_lang: &str) -> Result<String> {
    let root = resolve_root(app)?;
    let layout = Layout { root };
    // 冷启动要加载 1.1 GB 模型，进度发到事件里，界面至少能看到「正在启动」
    let report = |stage: &str, percent: u8, detail: &str| emit(app, stage, percent, detail);
    let bundled = bundled_runtime(app.path().resource_dir().ok().as_deref());
    let client = ensure_server(&layout, bundled.as_deref(), &report).await?;
    let out = do_chat(&client, text, target_lang).await?;
    if out.trim().is_empty() {
        anyhow::bail!("本地翻译返回为空");
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真装一遍再真翻一次：需要联网（约 1.1 GB 下载），所以默认忽略。
    /// 跑法：cargo test --lib installs_translation -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn installs_translation_and_selftests() {
        let root = std::env::temp_dir().join("momentocr-translate-test");
        let _ = std::fs::remove_dir_all(&root);

        let message = install_into(&root, None, &|stage, percent, detail| {
            println!("[{stage} {percent}%] {detail}")
        })
        .await
        .expect("装配失败");
        println!("安装结果: {message}");

        let layout = Layout { root: root.clone() };
        assert!(layout.installed(), "推理器或模型缺失");
        assert!(!read_manifest(&layout).is_empty(), "没有记录组件清单");

        // 装配线的自检结束后服务已被收掉，这里验证冷重启 + 常驻复用路径也能翻
        let client = ensure_server(&layout, None, &|_, _, _| {})
            .await
            .expect("服务未就绪");
        let out = do_chat(&client, "Hello, world!", "中文")
            .await
            .expect("翻译失败");
        println!("冷重启后译文: {out}");
        assert!(!out.trim().is_empty());

        // 按清单移除，确认能干净卸载（含 root 目录本身）
        let message = remove_into(&root).expect("移除失败");
        println!("移除结果: {message}");
        assert!(!layout.installed(), "移除后组件标志物还在");
        assert!(!root.exists(), "移除后目录还在");
    }

    /// 平台产物名写错就是整条装配线跑不通，而且只有到真机才暴露
    #[test]
    fn llama_assets_match_each_platform() {
        let cases = [
            (("windows", "x86_64"), "llama-b11932-bin-win-cpu-x64.zip"),
            (("windows", "aarch64"), "llama-b11932-bin-win-cpu-arm64.zip"),
            (("macos", "aarch64"), "llama-b11932-bin-macos-arm64.tar.gz"),
            (("macos", "x86_64"), "llama-b11932-bin-macos-x64.tar.gz"),
            (("linux", "x86_64"), "llama-b11932-bin-ubuntu-x64.tar.gz"),
            (("linux", "aarch64"), "llama-b11932-bin-ubuntu-arm64.tar.gz"),
        ];
        for ((os, arch), expected) in cases {
            assert_eq!(llama_asset_for(os, arch).unwrap(), expected);
        }
        assert!(llama_asset_for("freebsd", "x86_64").is_err());
    }

    /// 下载源与产物名要对得上：路径拼错 404 只有装机时才炸
    #[test]
    fn download_urls_contain_asset_and_gguf_name() {
        for url in llama_urls().unwrap() {
            assert!(url.contains(LLAMA_TAG));
            assert!(url.contains(llama_asset().unwrap()));
        }
        // 代理源的格式是「代理域名 + 完整原始 URL」，少拼 scheme 就是 404
        let proxied = &llama_urls().unwrap()[0];
        assert!(proxied.starts_with("https://gh-proxy.com/https://github.com/"), "{proxied}");
        for url in gguf_urls() {
            assert!(url.ends_with(GGUF_NAME), "{url}");
            assert!(url.starts_with("https://"), "{url}");
        }
    }

    /// 造一个带构建号目录的 tar.gz 真跑一遍解压，确认 llama-server 落点与可执行位
    #[test]
    fn extracts_tar_gz_flat_into_runtime() {
        let dir = std::env::temp_dir().join("momentocr-llama-tar-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let archive = dir.join("llama.tar.gz");
        let file = std::fs::File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, body, mode) in [
            (format!("llama-b11932-bin-win-cpu-x64/{SERVER_BIN}"), "#!/bin/sh\n".to_string(), 0o775u32),
            ("llama-b11932-bin-win-cpu-x64/llama.dll".to_string(), "bin".to_string(), 0o644),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(mode);
            header.set_path(name).unwrap();
            header.set_cksum();
            builder.append(&header, body.as_bytes()).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();

        let dest = dir.join("runtime");
        extract_tar_gz_flat(&archive, &dest).unwrap();
        let server = dest.join("llama-b11932-bin-win-cpu-x64").join(SERVER_BIN);
        assert!(server.is_file());
        assert_eq!(find_server(&dest).unwrap(), server);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 官方模型换版要显式动这里，字节数校验才有意义
    #[test]
    fn gguf_size_is_the_pinned_quant() {
        assert_eq!(GGUF_BYTES, 1_133_080_512);
        assert_eq!(GGUF_NAME, "HY-MT1.5-1.8B-Q4_K_M.gguf");
    }

    /// 按名字找 llama-server，不依赖解压出来的目录叫什么
    #[test]
    fn finds_server_regardless_of_dir_name() {
        let dir = std::env::temp_dir().join("momentocr-find-server-test");
        let _ = std::fs::remove_dir_all(&dir);
        let nested = dir.join("runtime").join("llama-b11932-bin-whatever");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(find_server(&dir.join("runtime")).is_none());

        std::fs::write(nested.join(SERVER_BIN), b"x").unwrap();
        assert!(find_server(&dir.join("runtime")).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 内置推理器探测：CARGO_MANIFEST_DIR 下的 resources/llama-runtime/ 命中
    #[test]
    fn bundled_runtime_found_via_manifest_probe() {
        let dir = std::env::temp_dir().join("momentocr-bundled-probe-test");
        let _ = std::fs::remove_dir_all(&dir);
        let fake = dir.join("resources").join("llama-runtime");
        std::fs::create_dir_all(&fake).unwrap();

        // 探测失败不该 panic；命中前不误报
        std::env::set_var("CARGO_MANIFEST_DIR", &dir);
        assert!(bundled_runtime(None).is_none());

        std::fs::write(fake.join(SERVER_BIN), b"x").unwrap();
        let found = bundled_runtime(None).expect("应探测到内置推理器");
        assert!(find_server(&found).is_some());

        std::env::remove_var("CARGO_MANIFEST_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// bundled 回退的优先级：runtime/ 为空但内置目录有 llama-server 时，
    /// ensure_server 的报错应推进到「模型未下载」；无内置时才报「未找到 llama-server」。
    /// find_server 只认文件名，假文件即可驱动到该分支，无需真模型。
    #[tokio::test]
    async fn bundled_server_takes_precedence_over_missing_runtime() {
        let client = localhost_client();
        if healthy(&client).await {
            // 本机 48731 恰好有服务在跑（比如应用正开着）时探活直接通过，无法走该分支
            eprintln!("跳过：48731 已有服务在监听");
            return;
        }

        let root = std::env::temp_dir().join("momentocr-bundled-precedence-test");
        let _ = std::fs::remove_dir_all(&root);
        let layout = Layout { root: root.clone() };
        std::fs::create_dir_all(layout.models()).unwrap();

        let bundled = root.join("sim-bundled");
        std::fs::create_dir_all(bundled.join("llama-b11932-bin-sim")).unwrap();
        std::fs::write(bundled.join("llama-b11932-bin-sim").join(SERVER_BIN), b"x").unwrap();

        let err = ensure_server(&layout, Some(&bundled), &|_, _, _| {})
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("模型尚未下载"), "{err}");

        let err = ensure_server(&layout, None, &|_, _, _| {})
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("未找到 llama-server"), "{err}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 指令格式是给模型看的契约，写死了才好回归
    #[test]
    fn prompt_keeps_target_language_and_text() {
        let p = translation_prompt("英文", "你好");
        assert_eq!(p, "把下面的文本翻译成英文，不要额外解释。\n\n你好");
    }
}
