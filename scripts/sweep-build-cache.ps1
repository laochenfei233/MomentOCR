# 清理 Cargo 构建缓存中超过指定天数未构建的产物（兜底，防止 target/ 无限膨胀）。
# 依赖 cargo-sweep：cargo install cargo-sweep
#
# 用法：
#   .\scripts\sweep-build-cache.ps1 -DryRun      # 只看会清理什么
#   .\scripts\sweep-build-cache.ps1              # 实际清理（默认 30 天）
#   .\scripts\sweep-build-cache.ps1 -Days 60     # 自定义天数

[CmdletBinding()]
param(
    [int]$Days = 30,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'MomentOCR'
$logPath = Join-Path $logDir 'sweep-build-cache.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log($message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Write-Host $line
    Add-Content -Path $logPath -Value $line
}

# cargo-sweep 内部会执行 `cargo metadata`，因此 cargo 与 cargo-sweep 都必须在 PATH 上。
# 计划任务的环境变量可能极简，这里显式补齐常见 Rust 工具链目录。
$rustBins = @()
if ($env:CARGO_HOME) { $rustBins += (Join-Path $env:CARGO_HOME 'bin') }
$rustBins += 'C:\Env\Rust\cargo\bin'
$rustBins += (Join-Path $env:USERPROFILE '.cargo\bin')
$rustBins = $rustBins | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$env:PATH = (@($rustBins) + $env:PATH) -join ';'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Log "中止：找不到 cargo，无法运行 cargo-sweep"
    exit 1
}
if (-not (Get-Command cargo-sweep -ErrorAction SilentlyContinue)) {
    Write-Log "中止：找不到 cargo-sweep，请先执行 cargo install cargo-sweep"
    exit 1
}

# 收集所有含 Cargo.toml 的 crate 目录：主仓库 + 各 worktree。
# cargo-sweep 只接受 crate 目录（内部要跑 cargo metadata），不能传仓库根目录。
$crates = @()
$mainCrate = Join-Path $repoRoot 'src-tauri'
if (Test-Path (Join-Path $mainCrate 'Cargo.toml')) { $crates += $mainCrate }

$worktreeRoot = Join-Path $repoRoot '.worktrees'
if (Test-Path $worktreeRoot) {
    $crates += Get-ChildItem $worktreeRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'src-tauri' } |
        Where-Object { Test-Path (Join-Path $_ 'Cargo.toml') }
}

$mode = if ($DryRun) { 'dry-run' } else { '实际清理' }
Write-Log "开始：$mode，阈值 $Days 天，共 $($crates.Count) 个 crate"

$sweepArgs = @('sweep', '--time', "$Days")
if ($DryRun) { $sweepArgs += '--dry-run' }

foreach ($crate in $crates) {
    $rel = $crate.Replace($repoRoot, '.').Replace('\', '/')
    $output = & cargo-sweep @sweepArgs $crate 2>&1
    Write-Log "$rel -> $($output -join ' ')"
}

Write-Log "结束"
