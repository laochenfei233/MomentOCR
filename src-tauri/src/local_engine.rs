//! 本地组件的「隔离运行时」。
//!
//! 安装包里不带 Python，用户也不需要自己配环境：只有主动点「下载并安装」时，
//! 才把 embeddable Python + 需要的包装进应用自己的数据目录。全程不碰用户的全局
//! site-packages，卸载时删掉这个目录即可。
//!
//! 两个组件共用一个运行时，各自记录装了哪些文件（清单在 `state/<id>.json`），
//! 所以能精确移除单个组件、并算出它占了多少磁盘：
//!   · ocr        → rapidocr + onnxruntime（本地识别引擎，约 112 MB 下载 / 271 MB 磁盘）
//!   · screenshot → PyQt5（截图覆盖层，约 55 MB 下载 / 150 MB 磁盘）
//!
//! 装配步骤：
//!   1. 下载解释器：Windows 用 python.org 的 embeddable 包；macOS/Linux 没有 embeddable
//!      发行版，改用 python-build-standalone 的可重定位构建（归档按架构分 Intel / ARM）。
//!      两边都是国内主源 + 官方回退
//!   2. 解压到 `<root>/runtime`。unix 归档整棵都在 `python/` 下，剥掉这一层，落点与
//!      Windows 对齐（`runtime/python.exe` / `runtime/bin/python3`）
//!   3. 引导 pip/setuptools/wheel：直接把 wheel 解包进 `<root>/site`（unix 的 standalone
//!      自带 pip，但 setuptools/wheel 还是要补）。antlr4-python3-runtime（rapidocr→omegaconf
//!      的依赖）只有源码包，所以必须备好 setuptools 并关掉 pip 的构建隔离，否则装到一半会失败
//!   4. 让解释器认得私有 site 与应用脚本目录：Windows 写 `python3xx._pth`（embeddable 的
//!      路径配置，会让解释器进入隔离模式，此时 PYTHONPATH 被忽略、脚本所在目录也不会自动
//!      进 sys.path）；`._pth` 只在 Windows 生效，unix 改成往运行时自带的 site-packages
//!      里放一个 `.pth`，作用相同
//!   5. `pip install --target <root>/site <组件依赖>`
//!      （rapidocr 把 onnxruntime 当可选后端，不显式带上就会装上却没引擎可用）
//!   6. 自检：OCR 真识别一张现画的图、截图组件真起一个 offscreen 窗口，出结果才算装好
//!
//! Windows 走 embeddable + `._pth` 这条；macOS/Linux 走 standalone + `.pth` 这条。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// embeddable 解释器版本，`._pth` 文件名与 unix 的 site-packages 路径都由它推出
const PYTHON_VERSION: &str = "3.12.10";
/// python-build-standalone 的发布批次，这一批里带 cpython 3.12.10 的四种目标归档
#[cfg(any(not(windows), test))]
const STANDALONE_TAG: &str = "20250409";
/// standalone 归档的下载源：国内镜像（快）+ GitHub 官方回退
#[cfg(any(not(windows), test))]
const STANDALONE_SOURCES: [&str; 2] = [
    "https://mirror.nju.edu.cn/github-release/astral-sh/python-build-standalone",
    "https://github.com/astral-sh/python-build-standalone/releases/download",
];
/// 运行时归档在临时目录里的落盘名，扩展名决定用哪个解压器
#[cfg(windows)]
const RUNTIME_ARCHIVE: &str = "python-embed.zip";
#[cfg(not(windows))]
const RUNTIME_ARCHIVE: &str = "python-standalone.tar.gz";
/// pip 源：清华 → 阿里 → 官方
const PIP_INDEXES: [&str; 3] = [
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://pypi.org/simple",
];
/// 引导工具链：装 wheel 需要 pip，编译 antlr4 的源码包需要 setuptools + wheel
const BOOTSTRAP_PACKAGES: [&str; 3] = ["pip", "setuptools", "wheel"];
/// 共享的解释器 + 引导工具链的下载量估算（embeddable 约 11 MiB）
#[cfg(windows)]
pub const RUNTIME_DOWNLOAD_MB: u64 = 12;
/// 同上，按最大的一份 standalone 归档估（linux x86_64，约 63 MiB）
#[cfg(not(windows))]
pub const RUNTIME_DOWNLOAD_MB: u64 = 67;

pub const PROGRESS_EVENT: &str = "local-engine-progress";
/// 开发者本地覆盖解释器：设了就用它，跳过私有运行时
const PYTHON_OVERRIDE_ENV: &str = "MOMENTOCR_PYTHON";

/// 可独立安装的本地组件
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Component {
    /// 本地识别引擎
    Ocr,
    /// 截图覆盖层（PyQt5）
    Screenshot,
}

impl Component {
    pub fn id(self) -> &'static str {
        match self {
            Component::Ocr => "ocr",
            Component::Screenshot => "screenshot",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Component::Ocr => "本地识别引擎",
            Component::Screenshot => "截图组件",
        }
    }

    pub fn parse(id: &str) -> Result<Self> {
        match id {
            "ocr" => Ok(Component::Ocr),
            "screenshot" => Ok(Component::Screenshot),
            other => anyhow::bail!("未知的本地组件：{other}"),
        }
    }

    /// pip 要装的包
    fn packages(self) -> &'static [&'static str] {
        match self {
            // onnxruntime 不在 rapidocr 的依赖里，必须显式装
            Component::Ocr => &["rapidocr", "onnxruntime"],
            Component::Screenshot => &["PyQt5"],
        }
    }

    /// 判断「装没装」的标志物（相对 site 目录）
    fn marker(self) -> &'static str {
        match self {
            Component::Ocr => "rapidocr",
            Component::Screenshot => "PyQt5",
        }
    }

    /// 装完用什么脚本自检
    fn selftest(self) -> &'static str {
        match self {
            Component::Ocr => "ocr_selftest.py",
            Component::Screenshot => "screenshot_selftest.py",
        }
    }

    /// 界面上展示该组件版本的包名
    fn version_package(self) -> &'static str {
        match self {
            Component::Ocr => "rapidocr",
            Component::Screenshot => "PyQt5",
        }
    }

    /// 下载量估算（MB），仅用于界面提示
    pub fn download_mb(self) -> u64 {
        match self {
            Component::Ocr => 112,
            Component::Screenshot => 55,
        }
    }

    /// 磁盘占用估算（MB），仅用于界面提示
    pub fn disk_mb(self) -> u64 {
        match self {
            Component::Ocr => 271,
            Component::Screenshot => 150,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub stage: String,
    pub percent: u8,
    pub detail: String,
}

#[derive(Serialize)]
pub struct ComponentStatus {
    pub installed: bool,
    pub version: String,
    pub disk_bytes: u64,
    pub download_mb: u64,
    pub disk_mb: u64,
}

#[derive(Serialize)]
pub struct Status {
    /// 共享的解释器 + 引导工具链装好了吗（没装时首次还要多下约 12 MB）
    pub runtime_installed: bool,
    pub runtime_download_mb: u64,
    pub ocr: ComponentStatus,
    /// Windows 安装包随包自带覆盖层，这个组件就不必下载
    pub screenshot_bundled: bool,
    pub screenshot: ComponentStatus,
    pub runtime_bytes: u64,
}

/// 私有运行时的目录布局
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        let base = app
            .path()
            .app_local_data_dir()
            .context("无法定位应用数据目录")?;
        Ok(Self {
            root: base.join("local-engine"),
        })
    }

    /// 解释器所在目录
    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }

    pub fn python(&self) -> PathBuf {
        self.runtime().join(if cfg!(windows) { "python.exe" } else { "bin/python3" })
    }

    /// 第三方包安装目标（pip --target）
    pub fn site(&self) -> PathBuf {
        self.root.join("site")
    }

    /// 组件文件清单存放处
    fn state_dir(&self) -> PathBuf {
        self.root.join("state")
    }

    fn manifest(&self, component: Component) -> PathBuf {
        self.state_dir().join(format!("{}.json", component.id()))
    }

    /// 构建 pip 用的临时目录（编译源码包会在 CWD 留垃圾）
    pub fn scratch(&self) -> PathBuf {
        self.root.join("tmp")
    }

    /// 解释器的路径配置落点：Windows 是 runtime 下的 `._pth`，
    /// unix 是运行时自带 site-packages 里的 `.pth`
    fn pth_file(&self) -> PathBuf {
        #[cfg(windows)]
        {
            self.runtime().join(pth_name())
        }
        #[cfg(not(windows))]
        {
            self.runtime()
                .join("lib")
                .join(format!("python{}", version_minor()))
                .join("site-packages")
                .join("momentocr.pth")
        }
    }

    /// 解释器装好了吗
    pub fn installed(&self) -> bool {
        self.python().is_file()
    }

    /// 某个组件装好了吗
    pub fn has(&self, component: Component) -> bool {
        self.installed() && self.site().join(component.marker()).exists()
    }

    /// 运行时总占用
    pub fn size(&self) -> u64 {
        dir_size(&self.root)
    }
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

fn emit(app: &AppHandle, stage: &str, percent: u8, detail: &str) {
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            stage: stage.to_string(),
            percent,
            detail: detail.to_string(),
        },
    );
}

/// 一次脚本调用所需的解释器与脚本目录
pub struct PythonEnv {
    pub python: PathBuf,
    pub scripts_dir: PathBuf,
}

/// 该用哪个解释器跑某个组件的脚本。
///
/// `MOMENTOCR_PYTHON` 供开发时直连本机已有的 Python 环境；正式路径是私有运行时。
pub fn prepare(app: &AppHandle, component: Component) -> Result<PythonEnv> {
    let scripts_dir = super::overlay::scripts_dir()
        .context("找不到随应用分发的脚本，安装可能不完整")?;

    if let Ok(overridden) = std::env::var(PYTHON_OVERRIDE_ENV) {
        if !overridden.trim().is_empty() {
            return Ok(PythonEnv {
                python: PathBuf::from(overridden),
                scripts_dir,
            });
        }
    }

    let layout = Layout::resolve(app)?;
    if !layout.has(component) {
        anyhow::bail!(
            "{}尚未安装，请在「设置」里下载安装后再试",
            component.label()
        );
    }
    ensure_pth(&layout, &scripts_dir);
    Ok(PythonEnv {
        python: layout.python(),
        scripts_dir,
    })
}

/// 私有解释器（若已装），供截图覆盖层这类需要「有 Python 就行」的场景使用
pub fn private_python(app: &AppHandle, component: Component) -> Option<PathBuf> {
    let layout = Layout::resolve(app).ok()?;
    layout.has(component).then(|| layout.python())
}

pub fn status(app: &AppHandle) -> Status {
    let layout = Layout::resolve(app).ok();
    let versions = read_versions(app, &["rapidocr", "PyQt5"]);

    let component_status = |component: Component| {
        let installed = layout.as_ref().map(|l| l.has(component)).unwrap_or(false);
        ComponentStatus {
            installed,
            version: if installed {
                versions.get(component.version_package()).cloned().unwrap_or_default()
            } else {
                String::new()
            },
            disk_bytes: layout
                .as_ref()
                .map(|l| manifest_bytes(&l.manifest(component)))
                .unwrap_or(0),
            download_mb: component.download_mb(),
            disk_mb: component.disk_mb(),
        }
    };

    Status {
        runtime_installed: layout.as_ref().map(|l| l.installed()).unwrap_or(false),
        runtime_download_mb: RUNTIME_DOWNLOAD_MB,
        ocr: component_status(Component::Ocr),
        screenshot_bundled: super::overlay::bundled_overlay().is_some(),
        screenshot: component_status(Component::Screenshot),
        runtime_bytes: layout.as_ref().map(|l| l.size()).unwrap_or(0),
    }
}

/// 私有运行时的全局占用（用于「移除运行时」这类提示）
pub fn remove(app: &AppHandle) -> Result<u64> {
    let layout = Layout::resolve(app)?;
    if !layout.root.exists() {
        return Ok(0);
    }
    let freed = layout.size();
    std::fs::remove_dir_all(&layout.root)
        .with_context(|| format!("删除 {} 失败（可能仍被占用）", layout.root.display()))?;
    Ok(freed)
}

/// 只移除某个组件：按清单删它装的文件，一个组件都不剩时连运行时一起删。
pub fn remove_component(app: &AppHandle, component: Component) -> Result<(u64, bool)> {
    let layout = Layout::resolve(app)?;
    remove_component_into(&layout.root, component)
}

fn remove_component_into(root: &Path, component: Component) -> Result<(u64, bool)> {
    let layout = Layout {
        root: root.to_path_buf(),
    };
    let manifest = layout.manifest(component);
    let files = read_manifest(&manifest);

    let mut freed = 0u64;
    for relative in &files {
        let path = layout.site().join(relative);
        if let Ok(meta) = path.metadata() {
            freed += meta.len();
        }
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    let _ = std::fs::remove_file(&manifest);
    prune_empty_dirs(&layout.site());

    let others = [Component::Ocr, Component::Screenshot]
        .into_iter()
        .any(|other| other != component && layout.manifest(other).exists());
    let runtime_removed = if others {
        false
    } else {
        // 没有组件了，运行时（解释器 + 引导工具链）也一并清掉
        freed += dir_size(&layout.root);
        std::fs::remove_dir_all(&layout.root).is_ok()
    };
    Ok((freed, runtime_removed))
}

fn prune_empty_dirs(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            prune_empty_dirs(&path);
            let _ = std::fs::remove_dir(&path); // 非空会失败，正好跳过
        }
    }
}

fn read_manifest(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

fn manifest_bytes(path: &Path) -> u64 {
    let parent = path.parent().and_then(|p| p.parent());
    let Some(site) = parent.map(|p| p.join("site")) else {
        return 0;
    };
    read_manifest(path)
        .iter()
        .filter_map(|relative| site.join(relative).metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

/// 版本里的 `3.12` 段，用来拼 `python312._pth` / `lib/python3.12/site-packages`
fn version_minor() -> String {
    let mut parts = PYTHON_VERSION.split('.');
    let major = parts.next().unwrap_or("3");
    let minor = parts.next().unwrap_or("12");
    format!("{major}.{minor}")
}

/// `._pth` 的文件名跟着解释器版本走：3.12 → `python312._pth`
#[cfg(windows)]
fn pth_name() -> String {
    format!("python{}._pth", version_minor().replace('.', ""))
}

/// `._pth` 的内容：stdlib、自带目录、私有 site、应用脚本目录，最后开启 site 处理
#[cfg(windows)]
fn pth_content(_layout: &Layout, scripts_dir: &Path) -> String {
    format!(
        "python{}.zip\n.\n..\\site\n{}\nimport site\n",
        version_minor().replace('.', ""),
        scripts_dir.display()
    )
}

/// unix 的 `.pth` 只认「一行一个路径」，直接写绝对路径，不需要 `import site`
#[cfg(not(windows))]
fn pth_content(layout: &Layout, scripts_dir: &Path) -> String {
    format!("{}\n{}\n", layout.site().display(), scripts_dir.display())
}

/// 落盘路径配置。unix 上这个文件在运行时自带的 site-packages 里，得先确保父目录在。
fn write_pth(layout: &Layout, scripts_dir: &Path) -> std::io::Result<()> {
    let path = layout.pth_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, pth_content(layout, scripts_dir))
}

/// 让私有解释器认得「私有 site」与「应用脚本目录」。
///
/// Windows 的 `._pth` 会把解释器置于隔离模式：PYTHONPATH 被忽略、`python x.py` 也不会把
/// 脚本目录放进 sys.path；unix 没有 `._pth`，改用运行时自带 site-packages 里的 `.pth`
/// （PYTHONPATH 同样不参与，两边的路径都只能靠这个文件列出来）。应用换目录或升级后需要
/// 重写，因此每次识别前都对一次内容，不一致才落盘。
pub fn ensure_pth(layout: &Layout, scripts_dir: &Path) {
    if !layout.installed() {
        return;
    }
    let desired = pth_content(layout, scripts_dir);
    let current = std::fs::read_to_string(layout.pth_file()).unwrap_or_default();
    if normalize(&current) == normalize(&desired) {
        return;
    }
    let _ = write_pth(layout, scripts_dir);
}

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// 下载并装配某个组件。进度通过 `local-engine-progress` 事件上报。
pub async fn install(app: &AppHandle, component: Component, scripts_dir: &Path) -> Result<String> {
    let layout = Layout::resolve(app)?;
    let report = |stage: &str, percent: u8, detail: &str| emit(app, stage, percent, detail);
    let message = install_into(&layout.root, component, scripts_dir, &report).await?;
    Ok(message)
}

/// 装配逻辑本体：不依赖 Tauri，便于直接测试（见文件末尾的测试）
pub async fn install_into(
    root: &Path,
    component: Component,
    scripts_dir: &Path,
    progress: &(dyn Fn(&str, u8, &str) + Sync),
) -> Result<String> {
    let layout = Layout {
        root: root.to_path_buf(),
    };
    std::fs::create_dir_all(&layout.root)?;
    std::fs::create_dir_all(layout.site())?;
    std::fs::create_dir_all(layout.scratch())?;

    let client = reqwest::Client::builder()
        .user_agent("MomentOCR-local-engine")
        .build()?;

    // 1~4) 解释器与引导工具链：两个组件共用，装过就跳过
    if !layout.installed() {
        install_runtime(&layout, &client, scripts_dir, progress).await?;
    }

    // 5) 装组件依赖
    progress(
        "packages",
        20,
        &format!("正在安装{}（依赖较多，请稍等）…", component.label()),
    );
    let before = list_files(&layout.site());
    install_packages(&layout, component, progress)?;
    let added = list_files(&layout.site())
        .difference(&before)
        .cloned()
        .collect::<Vec<_>>();
    write_manifest(&layout.manifest(component), &added)?;

    // 6) 自检
    progress("selftest", 95, "正在自检…");
    let text = selftest(&layout.python(), &scripts_dir.join(component.selftest()))?;

    progress("done", 100, &format!("{}已就绪", component.label()));
    Ok(format!("{}已安装完成（自检：{}）", component.label(), text))
}

/// 私有运行时的下载源，按优先级排；调用方逐个试。
///
/// Windows 用 python.org 的 embeddable 包；macOS/Linux 没有 embeddable 发行版，
/// 用 python-build-standalone 的可重定位构建。
fn runtime_urls() -> Result<Vec<String>> {
    #[cfg(windows)]
    {
        Ok(vec![
            "https://mirrors.huaweicloud.com/python/3.12.10/python-3.12.10-embed-amd64.zip"
                .to_string(),
            "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip".to_string(),
        ])
    }

    #[cfg(not(windows))]
    {
        let target = standalone_target(std::env::consts::OS, std::env::consts::ARCH)?;
        Ok(standalone_urls(target).to_vec())
    }
}

/// 当前平台对应的 python-build-standalone 目标三元组。
#[cfg(any(not(windows), test))]
fn standalone_target(os: &str, arch: &str) -> Result<&'static str> {
    Ok(match (os, arch) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        _ => anyhow::bail!(
            "本地引擎暂不支持当前平台（{os}/{arch}）：\
             请自行装好 rapidocr，再用环境变量 MOMENTOCR_PYTHON 指向那个解释器"
        ),
    })
}

#[cfg(any(not(windows), test))]
fn standalone_urls(target: &str) -> [String; 2] {
    STANDALONE_SOURCES.map(|base| {
        format!("{base}/{STANDALONE_TAG}/cpython-{PYTHON_VERSION}+{STANDALONE_TAG}-{target}-install_only.tar.gz")
    })
}

async fn install_runtime(
    layout: &Layout,
    client: &reqwest::Client,
    scripts_dir: &Path,
    progress: &(dyn Fn(&str, u8, &str) + Sync),
) -> Result<()> {
    progress("python", 2, "正在下载 Python 运行时…");
    let archive = layout.scratch().join(RUNTIME_ARCHIVE);
    let mut last_error = None;
    for url in runtime_urls()? {
        match download(client, &url, &archive, |done, total| {
            let percent = if total > 0 { (done * 100 / total).min(100) as u8 } else { 0 };
            progress(
                "python",
                (percent / 10).min(9),
                &format!(
                    "正在下载 Python 运行时… {:.1} / {:.1} MB",
                    done as f64 / 1_048_576.0,
                    total as f64 / 1_048_576.0
                ),
            );
        })
        .await
        {
            Ok(()) => {
                last_error = None;
                break;
            }
            Err(err) => last_error = Some(err),
        }
    }
    if let Some(err) = last_error {
        anyhow::bail!("下载 Python 运行时失败：{err}");
    }

    progress("extract", 10, "正在解压运行时…");
    let dest = layout.runtime();
    std::fs::create_dir_all(&dest)?;
    let archive_for_extract = archive.clone();
    let dest_for_extract = dest.clone();
    tokio::task::spawn_blocking(move || {
        extract_runtime_archive(&archive_for_extract, &dest_for_extract)
    })
    .await??;
    // 解压完就没用了；unix 的归档有 60 多 MB，留着白占磁盘（引导用的 wheel 同理）
    let _ = std::fs::remove_file(&archive);

    progress("bootstrap", 14, "正在准备安装工具…");
    for name in BOOTSTRAP_PACKAGES {
        let (filename, url) = fetch_latest_wheel(client, name).await?;
        let path = layout.scratch().join(&filename);
        progress("bootstrap", 14, &format!("正在准备安装工具… {filename}"));
        download(client, &url, &path, |_, _| {}).await?;
        let site = layout.site();
        let path_for_extract = path.clone();
        tokio::task::spawn_blocking(move || extract_zip(&path_for_extract, &site)).await??;
        let _ = std::fs::remove_file(&path);
    }

    write_pth(layout, scripts_dir).context("写入运行时 path 配置失败")?;
    Ok(())
}

/// 记录本次安装新增的文件，方便按组件精确移除
fn write_manifest(path: &Path, files: &[String]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(files)?)?;
    Ok(())
}

/// site 目录下的所有文件（相对路径）
fn list_files(site: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut stack = vec![site.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => stack.push(path),
                Ok(_) => {
                    if let Ok(relative) = path.strip_prefix(site) {
                        out.insert(relative.to_string_lossy().replace('\\', "/"));
                    }
                }
                Err(_) => {}
            }
        }
    }
    out
}

/// 从 PyPI 镜像的 PEP 691 接口取最新一个纯 Python wheel：(文件名, 绝对地址)
async fn fetch_latest_wheel(client: &reqwest::Client, package: &str) -> Result<(String, String)> {
    let mut last_error = None;
    for index in PIP_INDEXES {
        let base = format!("{}/{}/", index.trim_end_matches('/'), package);
        let response = client
            .get(&base)
            .header("Accept", "application/vnd.pypi.simple.v1+json")
            .send()
            .await;
        let json: serde_json::Value = match response {
            Ok(resp) if resp.status().is_success() => match resp.json().await {
                Ok(json) => json,
                Err(err) => {
                    last_error = Some(err.to_string());
                    continue;
                }
            },
            Ok(resp) => {
                last_error = Some(format!("{index} 返回 {}", resp.status()));
                continue;
            }
            Err(err) => {
                last_error = Some(err.to_string());
                continue;
            }
        };

        let Some(files) = json["files"].as_array() else {
            continue;
        };
        let mut best: Option<((u64, u64, u64), String, String)> = None;
        for file in files {
            let Some(name) = file["filename"].as_str() else { continue };
            let Some(version) = pure_wheel_version(name, package) else { continue };
            let url = file["url"].as_str().unwrap_or_default();
            let absolute = if url.starts_with("http") {
                url.to_string()
            } else {
                match reqwest::Url::parse(&base).and_then(|b| b.join(url)) {
                    Ok(joined) => joined.to_string(),
                    Err(_) => continue,
                }
            };
            if best.as_ref().map(|(v, _, _)| *v < version).unwrap_or(true) {
                best = Some((version, name.to_string(), absolute));
            }
        }
        if let Some((_, name, url)) = best {
            return Ok((name, url));
        }
    }
    anyhow::bail!(
        "无法从镜像获取 {package} 的 wheel{}",
        last_error.map(|e| format!("（{e}）")).unwrap_or_default()
    )
}

/// 只接受 `pkg-1.2.3-py3-none-any.whl` 这种纯 Python wheel，顺带把版本解析成可比较的元组
fn pure_wheel_version(filename: &str, package: &str) -> Option<(u64, u64, u64)> {
    let rest = filename.strip_prefix(&format!("{package}-"))?;
    let version = rest.strip_suffix("-py3-none-any.whl")?;
    let mut parts = [0u64; 3];
    for (i, piece) in version.split('.').enumerate() {
        if i >= 3 || piece.is_empty() || !piece.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        parts[i] = piece.parse().ok()?;
    }
    Some((parts[0], parts[1], parts[2]))
}

fn install_packages(
    layout: &Layout,
    component: Component,
    progress: &(dyn Fn(&str, u8, &str) + Sync),
) -> Result<()> {
    let mut last_error = None;
    for index in PIP_INDEXES {
        progress(
            "packages",
            25,
            &format!("正在安装{}… 源：{index}", component.label()),
        );
        let mut command = std::process::Command::new(layout.python());
        command
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--target")
            .arg(layout.site())
            .arg("--upgrade")
            // antlr4-python3-runtime 只有源码包，构建隔离环境里没有 setuptools 会失败
            .arg("--no-build-isolation")
            .arg("--disable-pip-version-check")
            .arg("--progress-bar")
            .arg("off")
            .arg("-i")
            .arg(index)
            .args(component.packages())
            .current_dir(layout.scratch())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        hide_console(&mut command);

        let output = command.output()?;
        if output.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&output.stderr);
        let tail: String = detail
            .lines()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" / ");
        last_error = Some(tail);
    }
    anyhow::bail!(
        "安装{}失败：{}",
        component.label(),
        last_error.unwrap_or_else(|| "所有镜像源都不可用".to_string())
    )
}

/// 跑一段随应用分发的脚本，取回它打印的最后一行 JSON
fn run_json(python: &Path, script: &Path) -> Result<serde_json::Value> {
    let mut command = std::process::Command::new(python);
    command
        .arg(script)
        .env("PYTHONNOUSERSITE", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    hide_console(&mut command);

    let output = command
        .output()
        .with_context(|| format!("{} 无法启动", script.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout.lines().rev().find(|l| l.trim_start().starts_with('{')) else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.lines().rev().take(2).collect::<Vec<_>>().join(" / ");
        anyhow::bail!("脚本没有返回结果：{detail}");
    };
    serde_json::from_str(line.trim()).context("脚本返回的不是合法 JSON")
}

/// 装了也得能用：用私有解释器真跑一次，出结果才算成功
fn selftest(python: &Path, script: &Path) -> Result<String> {
    let json = run_json(python, script)?;
    if json["success"].as_bool().unwrap_or(false) {
        Ok(json["data"].as_str().unwrap_or_default().to_string())
    } else {
        anyhow::bail!("自检失败：{}", json["error"].as_str().unwrap_or("未知错误"))
    }
}

/// 私有运行时里各包的版本（一次调用问清所有包）
fn read_versions(app: &AppHandle, packages: &[&str]) -> std::collections::HashMap<String, String> {
    let Some(python) = Layout::resolve(app).ok().filter(|l| l.installed()) else {
        return Default::default();
    };
    let Some(scripts_dir) = super::overlay::scripts_dir() else {
        return Default::default();
    };
    let script = scripts_dir.join("ocr_engine_info.py");

    let mut command = std::process::Command::new(python.python());
    command
        .arg(&script)
        .args(packages)
        .env("PYTHONNOUSERSITE", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console(&mut command);

    let Ok(output) = command.output() else {
        return Default::default();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .and_then(|line| serde_json::from_str(line.trim()).ok())
        .unwrap_or_default()
}

fn hide_console(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<()> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("请求 {url} 失败"))?
        .error_for_status()
        .with_context(|| format!("{url} 返回错误状态"))?;
    let total = response.content_length().unwrap_or(0);

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = tokio::fs::File::create(dest).await?;
    let mut stream = response.bytes_stream();
    let mut done = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        on_progress(done, total);
    }
    file.flush().await?;
    Ok(())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)
        .with_context(|| format!("打开 {} 失败", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).context("压缩包无法解析")?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let target = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

/// 解压运行时归档：Windows 是 zip，unix 是 tar.gz
fn extract_runtime_archive(archive: &Path, dest: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        extract_zip(archive, dest)
    }
    #[cfg(not(windows))]
    {
        extract_tar_gz(archive, dest)
    }
}

/// 解压 python-build-standalone 的 `install_only` 归档。
///
/// 归档整棵都在 `python/` 下，剥掉这一层，解释器才落到 `<root>/runtime/bin/python3`，
/// 与 Windows 的 embeddable 布局对齐（`runtime/python.exe`）。`bin/python3` 是指向
/// `python3.12` 的软链接，交给 `entry.unpack` 按原样重建。
#[cfg(any(not(windows), test))]
fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)
        .with_context(|| format!("打开 {} 失败", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    // 不留权限位的话 bin/python3.12 会丢掉可执行位，解释器就起不来
    tar.set_preserve_permissions(true);
    tar.set_overwrite(true);

    let mut extracted = 0usize;
    for entry in tar.entries().context("压缩包无法解析")? {
        let mut entry = entry?;
        let relative = {
            let path = entry.path()?;
            stripped_relative(&path)
        };
        let Some(relative) = relative else { continue };
        let target = dest.join(relative);
        // unpack 不建父目录，得自己来（zip 那套也是这么做的）
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry.unpack(&target)?;
        extracted += 1;
    }
    if extracted == 0 {
        // 一条都没解出来说明归档结构变了；静默成功会让后面「解释器不存在」更难查
        anyhow::bail!("运行时归档结构与预期不符：里面没有 python/ 目录");
    }
    Ok(())
}

/// 取条目在 `python/` 之下的相对路径；越出解压目录的条目返回 `None`
/// （与 zip 那套用 `enclosed_name` 是同一个用意）。
#[cfg(any(not(windows), test))]
fn stripped_relative(path: &Path) -> Option<PathBuf> {
    let relative = path.strip_prefix("python").ok()?;
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(relative.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真装一遍再真跑一次：需要联网（约 55-170 MB 下载），所以默认忽略。
    /// 跑法：cargo test --lib installs_component -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn installs_component_and_selftests() {
        let component = match std::env::var("MOMENTOCR_TEST_COMPONENT") {
            Ok(id) => Component::parse(&id).expect("组件名不对"),
            Err(_) => Component::Screenshot,
        };
        let root = std::env::temp_dir().join(format!("momentocr-{}-test", component.id()));
        let _ = std::fs::remove_dir_all(&root);
        let scripts = crate::overlay::scripts_dir().expect("找不到脚本目录");

        let message = install_into(
            &root,
            component,
            &scripts,
            &|stage, percent, detail| println!("[{stage} {percent}%] {detail}"),
        )
        .await
        .expect("装配失败");
        println!("安装结果: {message}");

        let layout = Layout { root: root.clone() };
        assert!(layout.has(component), "组件标志物不存在");
        // 下载的归档与引导 wheel 都该在解压后删掉，别几十 MB 的东西赖在临时目录里
        let leftovers = std::fs::read_dir(layout.scratch())
            .map(|entries| entries.flatten().count())
            .unwrap_or(0);
        assert_eq!(leftovers, 0, "临时目录里还留着下载的文件");
        assert!(
            !read_manifest(&layout.manifest(component)).is_empty(),
            "没有记录组件装了哪些文件"
        );

        // 按清单移除，确认能干净卸载（目录也要清掉，否则组件会被判定为还装着）
        let (freed, _runtime_removed) = remove_component_into(&root, component).expect("移除失败");
        println!("按清单释放 {:.1} MB", freed as f64 / 1_048_576.0);
        assert!(freed > 0, "没有释放任何空间");
        assert!(!layout.has(component), "移除后组件标志物还在");
    }

    /// 目标三元组与归档地址：写错就是整条装配线跑不通，而且只有到真机才暴露
    #[test]
    fn standalone_urls_match_each_target() {
        assert_eq!(
            standalone_target("macos", "aarch64").unwrap(),
            "aarch64-apple-darwin"
        );
        assert_eq!(
            standalone_target("macos", "x86_64").unwrap(),
            "x86_64-apple-darwin"
        );
        assert_eq!(
            standalone_target("linux", "aarch64").unwrap(),
            "aarch64-unknown-linux-gnu"
        );
        assert_eq!(
            standalone_target("linux", "x86_64").unwrap(),
            "x86_64-unknown-linux-gnu"
        );
        // 表里没有的平台要给出可操作的提示，而不是拼一个必然 404 的地址
        let err = standalone_target("freebsd", "x86_64").unwrap_err().to_string();
        assert!(err.contains("MOMENTOCR_PYTHON"), "{err}");

        let urls = standalone_urls("aarch64-apple-darwin");
        for url in &urls {
            assert!(url.starts_with("https://"), "{url}");
            assert!(
                url.ends_with(&format!(
                    "/{STANDALONE_TAG}/cpython-{PYTHON_VERSION}+{STANDALONE_TAG}\
                     -aarch64-apple-darwin-install_only.tar.gz"
                )),
                "{url}"
            );
        }
        assert!(
            urls[0].starts_with("https://mirror.nju.edu.cn/github-release/astral-sh/python-build-standalone"),
            "{}",
            urls[0]
        );
        assert!(
            urls[1].starts_with(
                "https://github.com/astral-sh/python-build-standalone/releases/download"
            ),
            "{}",
            urls[1]
        );
    }

    /// 归档条目都带 `python/` 前缀，剥掉后才对齐 `runtime/bin/python3` 的布局
    #[test]
    fn strips_python_prefix_and_rejects_escapes() {
        let stripped = |p: &str| stripped_relative(Path::new(p));

        assert_eq!(
            stripped("python/bin/python3").unwrap(),
            Path::new("bin/python3")
        );
        assert_eq!(
            stripped("python/lib/python3.12/site-packages/README.txt").unwrap(),
            Path::new("lib/python3.12/site-packages/README.txt")
        );
        // 归档里 `python/` 这一级本身也要能落到 runtime 目录上
        assert_eq!(stripped("python").unwrap(), Path::new(""));

        assert!(stripped("python/../escape").is_none(), "带 .. 的条目要丢掉");
        assert!(stripped("/etc/passwd").is_none(), "绝对路径要丢掉");
        assert!(stripped("other-root/bin/python3").is_none(), "前缀对不上");
    }

    /// 造一个带 `python/` 前缀的 tar.gz 真跑一遍解压，确认落点与权限位
    #[test]
    fn extracts_tar_gz_into_runtime_layout() {
        let dir = std::env::temp_dir().join("momentocr-tar-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let archive = dir.join("runtime.tar.gz");
        let file = std::fs::File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, body, mode) in [
            ("python/bin/python3.12", "#!/bin/sh\n", 0o775u32),
            ("python/lib/python3.12/site-packages/README.txt", "hi\n", 0o644),
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
        extract_tar_gz(&archive, &dest).unwrap();

        assert!(dest.join("bin/python3.12").is_file());
        assert!(dest.join("lib/python3.12/site-packages/README.txt").is_file());
        assert_eq!(
            std::fs::read_to_string(dest.join("bin/python3.12")).unwrap(),
            "#!/bin/sh\n"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 归档结构变了要立刻报错，别静默解出 0 个文件
    #[test]
    fn rejects_archive_without_python_prefix() {
        let dir = std::env::temp_dir().join("momentocr-tar-bad-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let archive = dir.join("runtime.tar.gz");
        let file = std::fs::File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o644);
        header.set_path("cpython/bin/python3").unwrap();
        header.set_cksum();
        builder.append(&header, "abc".as_bytes()).unwrap();
        builder.into_inner().unwrap().finish().unwrap();

        let err = extract_tar_gz(&archive, &dir.join("runtime"))
            .unwrap_err()
            .to_string();
        assert!(err.contains("python/"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
