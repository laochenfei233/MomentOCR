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

/// 模型档位。都是标准 llama.cpp 量化，现有 runtime 直接支持；
/// 腾讯官方的 1.25bit/2bit 压缩版用自定义量化类型（STQ1_0/Q2_0c），
/// 对应 llama.cpp PR 未合并且是 ARM 专用内核，桌面跑不了，故不提供。
///
/// 实测（同机同组句子）：Q4_K_M 启动占内存 2.1 GB（大头是 AVX2 权重重排副本），
/// IQ3_XXS 仅 1.1 GB、翻译质量几乎无差、速度慢约一半；Q2_K 质量明显退化不提供。
pub struct Quant {
    pub id: &'static str,
    /// 界面上的一句话说明（体积与内存差异是选它的唯一理由）
    pub label: &'static str,
    pub gguf_name: &'static str,
    /// 装完按字节数校验（下载截断/镜像损坏会直接报错）
    pub bytes: u64,
    /// ModelScope 国内直连 → HuggingFace 回退
    pub urls: &'static [&'static str],
    pub download_mb: u64,
}

const QUANT_LIGHT: Quant = Quant {
    id: "light",
    label: "轻量：内存约 1.1 GB、翻译稍慢",
    gguf_name: "HY-MT1.5-1.8B-iq3_xxs.gguf",
    bytes: 826_831_648,
    urls: &[
        "https://modelscope.cn/models/Mungert/HY-MT1.5-1.8B-GGUF/resolve/master/HY-MT1.5-1.8B-iq3_xxs.gguf",
        "https://huggingface.co/Mungert/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-iq3_xxs.gguf",
    ],
    download_mb: 789,
};

const QUANT_STANDARD: Quant = Quant {
    id: "standard",
    label: "标准：内存约 2.1 GB、翻译最快",
    gguf_name: "HY-MT1.5-1.8B-Q4_K_M.gguf",
    bytes: 1_133_080_512,
    urls: &[
        "https://modelscope.cn/models/Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF/resolve/master/HY-MT1.5-1.8B-Q4_K_M.gguf",
        "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-Q4_K_M.gguf",
    ],
    download_mb: 1081,
};

pub const QUANTS: [&Quant; 2] = [&QUANT_LIGHT, &QUANT_STANDARD];
/// 缺省用轻量档：内存占用是用户最先感知到的成本
const DEFAULT_QUANT: &Quant = &QUANT_LIGHT;

fn quant_by_id(id: &str) -> &'static Quant {
    QUANTS
        .iter()
        .copied()
        .find(|q| q.id == id)
        .unwrap_or(DEFAULT_QUANT)
}

/// llama-server 的可执行名（Windows 带 .exe）
const SERVER_BIN: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

/// 推理器的体积估算（官方包约 12–24 MB，解压后约 60 MB）
const RUNTIME_DOWNLOAD_MB: u64 = 24;
const RUNTIME_DISK_MB: u64 = 60;

/// `-local-inference` 变体把 llama.cpp 打进了安装包资源；tauri 按资源在
/// src-tauri 下的相对路径原样安装，所以装好的布局是 `<资源目录>/resources/llama-runtime`
const BUNDLED_RELATIVES: [&str; 2] = ["resources/llama-runtime", "llama-runtime"];

/// 探测安装包内置的推理器。基目录依次是：资源目录、exe 相对路径向上三级
/// （安装版资源与 exe 同级，开发期 target/debug 向上能到 src-tauri）、
/// CARGO_MANIFEST_DIR（测试/编译期）；每个基目录下找两种相对布局。
fn bundled_runtime(resource_hint: Option<&Path>) -> Option<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(hint) = resource_hint {
        bases.push(hint.to_path_buf());
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|d| d.to_path_buf());
        for _ in 0..3 {
            let Some(current) = dir else { break };
            dir = current.parent().map(|d| d.to_path_buf());
            bases.push(current);
        }
    }
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        bases.push(PathBuf::from(manifest));
    }
    bases
        .iter()
        .flat_map(|base| BUNDLED_RELATIVES.map(|relative| base.join(relative)))
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
    fn gguf(&self, quant: &Quant) -> PathBuf {
        self.models().join(quant.gguf_name)
    }

    /// 已装的档位：models/ 下哪个文件在就是哪个（两档在同名互斥，不会并存）
    fn installed_quant(&self) -> Option<&'static Quant> {
        QUANTS
            .iter()
            .copied()
            .find(|q| self.gguf(q).is_file())
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
    let quant = layout.as_ref().and_then(|l| l.installed_quant());
    let has_server = layout.as_ref().map(|l| find_server(&l.runtime()).is_some()).unwrap_or(false) || bundled;
    let installed = quant.is_some() && has_server;
    // 未安装时按缺省档位报体积；已装则按实际那档
    let effective = quant.unwrap_or(DEFAULT_QUANT);
    // bundled 时推理器不占应用数据、也不必下载，估算只按模型计
    crate::local_engine::ComponentStatus {
        installed,
        version: if installed { format!("HY-MT1.5-1.8B（{}）", effective.label) } else { String::new() },
        quant: quant.map(|q| q.id.to_string()).unwrap_or_default(),
        disk_bytes: layout.as_ref().map(|l| l.size()).unwrap_or(0),
        download_mb: effective.download_mb + if bundled { 0 } else { RUNTIME_DOWNLOAD_MB },
        disk_mb: effective.download_mb + if bundled { 0 } else { RUNTIME_DISK_MB },
    }
}

/// 下载并装配。进度走 `local-engine-progress` 事件，与 OCR/截图组件共用一个监听器。
/// `quant` 是用户在面板上选的档位（未知值回落到缺省轻量档）。
pub async fn install(app: &AppHandle, quant: Option<&str>) -> Result<String> {
    let root = resolve_root(app)?;
    let hint = app.path().resource_dir().ok();
    install_into(
        &root,
        hint.as_deref(),
        quant_by_id(quant.unwrap_or_default()),
        &|stage, percent, detail| emit(app, stage, percent, detail),
    )
    .await
}

/// 装配逻辑本体：不依赖 Tauri，便于直接测试（见文件末尾的联网集成测试）。
/// `resource_hint` 是安装包资源目录，供探测内置推理器（-local-inference 变体）。
pub async fn install_into(
    root: &Path,
    resource_hint: Option<&Path>,
    quant: &'static Quant,
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

    // 1) 模型（大头）：两源逐个试，装完校验字节数
    if layout.gguf(quant).is_file() {
        report("model", 10, "模型已存在，跳过下载");
    } else {
        let dest = layout.gguf(quant);
        let partial = layout.models().join(format!("{}.part", quant.gguf_name));
        let mut last_error = None;
        for url in quant.urls {
            report(
                "model",
                10,
                &format!("正在下载翻译模型（约 {} MB）…", quant.download_mb),
            );
            let result = crate::local_engine::download(&client, url, &partial, |done, total| {
                let percent = if total > 0 { done * 100 / total } else { 0 };
                report(
                    "model",
                    (10 + percent * 70 / 100).min(80) as u8,
                    &format!(
                        "正在下载翻译模型… {:.0} / {:.0} MB",
                        done as f64 / 1_048_576.0,
                        total as f64 / 1_048_576.0
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
        if bytes != quant.bytes {
            let _ = std::fs::remove_file(&partial);
            anyhow::bail!(
                "模型文件大小不符（{bytes} / {} 字节），下载可能被截断，请重试",
                quant.bytes
            );
        }
        std::fs::rename(&partial, &dest)?;
        // 两档在同目录下互斥：换档时清掉另一档，避免 status 与磁盘各说各话
        for other in QUANTS.iter().copied().filter(|q| q.id != quant.id) {
            let _ = std::fs::remove_file(layout.gguf(other));
        }
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

    // 3) 自检：装了就得能翻——真起一次服务、译一句、再收掉
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

/// 移除组件。`local-translate/` 目录被本组件独占，整目录删除即可；
/// 不依赖清单——清单在「装了一半/跨版本共享应用数据」时会缺失或过期，
/// 按清单删会静默变成 0 字节假移除（真机踩过）。服务在跑先收掉。
pub fn remove(app: &AppHandle) -> Result<String> {
    let root = resolve_root(app)?;
    remove_into(&root)
}

pub fn remove_into(root: &Path) -> Result<String> {
    let _ = shutdown();
    if !root.exists() {
        anyhow::bail!("本地翻译尚未安装");
    }
    let freed = crate::local_engine::dir_size(root);
    std::fs::remove_dir_all(root)
        .with_context(|| format!("删除 {} 失败", root.display()))?;
    Ok(format!("已移除本地翻译组件，释放 {:.0} MB", freed as f64 / 1_048_576.0))
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
    // 用已装档位的模型：翻译不能因为面板上选的是另一档就找不到文件
    let Some(quant) = layout.installed_quant() else {
        anyhow::bail!("翻译模型尚未下载，请先在设置里安装本地翻译组件");
    };
    let gguf = layout.gguf(quant);

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

        let message = install_into(&root, None, DEFAULT_QUANT, &|stage, percent, detail| {
            println!("[{stage} {percent}%] {detail}")
        })
        .await
        .expect("装配失败");
        println!("安装结果: {message}");

        let layout = Layout { root: root.clone() };
        assert_eq!(layout.installed_quant().map(|q| q.id), Some(DEFAULT_QUANT.id), "缺省档位没装上");
        assert!(find_server(&layout.runtime()).is_some(), "推理器缺失");

        // 装配线的自检结束后服务已被收掉，这里验证冷重启 + 常驻复用路径也能翻
        let client = ensure_server(&layout, None, &|_, _, _| {})
            .await
            .expect("服务未就绪");
        let out = do_chat(&client, "Hello, world!", "中文")
            .await
            .expect("翻译失败");
        println!("冷重启后译文: {out}");
        assert!(!out.trim().is_empty());

        // 整目录移除，确认能干净卸载（含 root 目录本身）
        let message = remove_into(&root).expect("移除失败");
        println!("移除结果: {message}");
        assert!(layout.installed_quant().is_none(), "移除后模型还在");
        assert!(!root.exists(), "移除后目录还在");
    }

    /// 回归（真机踩过）：装了一半的旧版本留下模型文件但没写清单时，
    /// 按清单移除会静默变成「释放 0 MB」的假移除，状态永远卡在已安装、
    /// 没有下载按钮。整目录删除后必须真实释放并回到未安装。
    #[test]
    fn removes_whole_dir_even_without_manifest() {
        let root = std::env::temp_dir().join("momentocr-remove-no-manifest-test");
        let _ = std::fs::remove_dir_all(&root);
        let gguf = root.join("models").join(DEFAULT_QUANT.gguf_name);
        std::fs::create_dir_all(gguf.parent().unwrap()).unwrap();
        // 2 MB：释放量按 MB 取整显示，太小的假文件会显示「释放 0 MB」干扰断言
        std::fs::write(&gguf, vec![0u8; 2 * 1024 * 1024]).unwrap();
        // 半截下载的归档这类杂质也要一并清掉
        std::fs::write(root.join("llama-b11932-bin-win-cpu-x64.zip"), b"junk").unwrap();

        let message = remove_into(&root).expect("移除失败");
        assert!(message.contains("MB"), "{message}");
        assert!(!message.contains("释放 0 MB"), "不能是假移除：{message}");
        assert!(!root.exists(), "移除后目录还在");

        // 未安装时移除要明确报错，而不是假装成功
        assert!(remove_into(&root).is_err());

        let _ = std::fs::remove_dir_all(&root);
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

    /// 下载源与产物名要对得上：路径拼错 404 只有装机时才炸。
    /// 档位还要覆盖「两个档都配置了源与字节数」与「缺省档最小（用户最省钱）」。
    #[test]
    fn download_urls_contain_asset_and_gguf_name() {
        for url in llama_urls().unwrap() {
            assert!(url.contains(LLAMA_TAG));
            assert!(url.contains(llama_asset().unwrap()));
        }
        // 代理源的格式是「代理域名 + 完整原始 URL」，少拼 scheme 就是 404
        let proxied = &llama_urls().unwrap()[0];
        assert!(proxied.starts_with("https://gh-proxy.com/https://github.com/"), "{proxied}");

        for quant in QUANTS {
            assert!(!quant.urls.is_empty(), "{} 没有下载源", quant.id);
            for url in quant.urls {
                assert!(url.ends_with(quant.gguf_name), "{url}");
                assert!(url.starts_with("https://"), "{url}");
            }
            assert!(quant.bytes > 500 * 1024 * 1024, "{} 字节数不合常理", quant.id);
        }
        assert_eq!(DEFAULT_QUANT.id, "light", "缺省档应是省内存的轻量档");
        let smallest = QUANTS.iter().map(|q| q.bytes).min().unwrap();
        assert_eq!(DEFAULT_QUANT.bytes, smallest, "缺省档应是最小的那个");
        // 两档文件名必须不同，否则 installed_quant 会互相误判
        assert_ne!(QUANT_LIGHT.gguf_name, QUANT_STANDARD.gguf_name);
    }

    /// 档位解析：未知/空 id 回落到缺省，正常 id 精确命中
    #[test]
    fn quant_ids_round_trip() {
        assert_eq!(quant_by_id("light").id, "light");
        assert_eq!(quant_by_id("standard").id, "standard");
        assert_eq!(quant_by_id("").id, DEFAULT_QUANT.id);
        assert_eq!(quant_by_id("q2_k").id, DEFAULT_QUANT.id, "不存在的档位不能当合法值");
    }

    /// 已装档位按文件存在判断：写入哪档的 gguf 就报哪档
    #[test]
    fn installed_quant_follows_present_file() {
        let root = std::env::temp_dir().join("momentocr-quant-detect-test");
        let _ = std::fs::remove_dir_all(&root);
        let layout = Layout { root: root.clone() };
        std::fs::create_dir_all(layout.models()).unwrap();
        assert!(layout.installed_quant().is_none(), "空目录不该报已装");

        std::fs::write(layout.gguf(&QUANT_STANDARD), b"x").unwrap();
        assert_eq!(layout.installed_quant().map(|q| q.id), Some("standard"));

        std::fs::write(layout.gguf(&QUANT_LIGHT), b"x").unwrap();
        std::fs::remove_file(layout.gguf(&QUANT_STANDARD)).unwrap();
        assert_eq!(layout.installed_quant().map(|q| q.id), Some("light"));

        let _ = std::fs::remove_dir_all(&root);
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
    fn gguf_sizes_are_the_pinned_quants() {
        assert_eq!(QUANT_LIGHT.bytes, 826_831_648);
        assert_eq!(QUANT_LIGHT.gguf_name, "HY-MT1.5-1.8B-iq3_xxs.gguf");
        assert_eq!(QUANT_STANDARD.bytes, 1_133_080_512);
        assert_eq!(QUANT_STANDARD.gguf_name, "HY-MT1.5-1.8B-Q4_K_M.gguf");
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

    /// 回归：安装版里 tauri 按相对路径把资源装到 <资源目录>/resources/llama-runtime，
    /// 探测只找裸 llama-runtime 时会漏掉，用户就会被误导去联网下载推理器
    #[test]
    fn bundled_runtime_found_under_installed_resource_layout() {
        let dir = std::env::temp_dir().join("momentocr-bundled-installed-layout-test");
        let _ = std::fs::remove_dir_all(&dir);
        let fake = dir.join("resources").join("llama-runtime");
        std::fs::create_dir_all(&fake).unwrap();
        std::fs::write(fake.join(SERVER_BIN), b"x").unwrap();

        let found = bundled_runtime(Some(&dir)).expect("应按安装版布局探测到内置推理器");
        assert!(find_server(&found).is_some());

        // 裸 llama-runtime 布局（手工摆放）也要能命中
        let flat = dir.join("llama-runtime");
        std::fs::create_dir_all(&flat).unwrap();
        std::fs::write(flat.join(SERVER_BIN), b"x").unwrap();
        assert!(bundled_runtime(Some(&dir)).is_some());

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
