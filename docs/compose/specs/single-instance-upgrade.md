---
feature: single-instance-upgrade
status: delivered
updated: 2026-11-06
branch: feat/single-instance-upgrade
commits: 889f9e4..56b1eb0
---

# tauri-plugin-single-instance 升级（根治任务栏幽灵图标/启动竞态）

## Report

**What was built** — Cargo.lock 全图升级（约 160 包）：tauri-plugin-single-instance 2.4.5 → 2.5.5（含上游 #3704/#3645 等启动竞态修复，根治任务栏幽灵图标的竞态路径）、tauri 2.11.5 → 2.12.5、tauri-build 2.7.4、wry 0.57.1、tray-icon 收敛为单版本 0.25.1、windows-sys 0.60 → 0.61。tauri 2.12 重新生成的 ACL schema 一并同步。无任何源码改动（Cargo.toml 宽松 `"2"` 声明不变）。changelog 片段已写（建议下一版本 0.3.3）。

**Verification** —
- `cargo tree`：single-instance 2.5.5 / tauri 2.12.5，直接依赖 17 项全在锁，585 包经 ustc 索引核对无 yanked — PASS
- `cargo clippy --all-targets`：3 条警告与 master 基线逐一相同（local_engine.rs:602、translate_engine.rs:286/500）— PASS 无新增
- `cargo fmt --check`：api.rs:9 一处 diff，master 同样存在 — PRE-EXISTING
- `cargo test`：19 通过 0 失败 2 忽略，基线一致 — PASS
- S4.2 第二实例退出：debug 213ms / release 54ms，exit 0，第一实例主窗口（须臾OCR）无扰动 — PASS
- S4.3 启动竞态：双进程同启 4/4 轮恰好存活一个，败者无残留 — PASS
- release 构建：MSI + NSIS 安装包产出 — PASS
- S4.4 安装版真机冒烟（截图→框选→OCR、托盘、快捷键、退出收 llama-server）— **待用户执行**

**Journey log** —
- 排查进程时 `tasklist /FI "IMAGENAME eq MomentOCR.exe"` 查不到东西——二进制实际名是 `moment-ocr.exe`（Cargo 包名），productName 只作用于安装包；验收前用 `Get-Process moment-ocr` 按实际名确认环境。
- debug exe 无 vite 服务时 webview 空白，但 single-instance 的进程级行为（互斥、第二实例退出、竞态）完整可测；窗口标题/前台表现要用 release exe 验。
- master 工作区长期挂着的 Cargo.toml 本地改动被 worktree 干净检出天然隔离，全程未混入分支。
- spec 初稿写 tray-icon 在 base 锁"0.24.1/0.24.2 并存"，实测 base 仅 0.24.1 单版本（升级后为 0.25.1），已订正；"收敛"目标仍达成。
- `cargo fmt --check` 在 master 与本分支同样失败（api.rs:9），属既有基线，本任务不顺手修。

## [S1] Problem

用户报告任务栏随机出现第二个与应用一模一样的图标，几秒后消失。2026-11-06 调查结论：

1. **启动竞态（本升级要根治的）**：`tauri-plugin-single-instance` 2.4.5 的 Windows 实现
   （`platform_impl/windows.rs`）里，第二实例若观察到 `ERROR_ALREADY_EXISTS` 但
   `FindWindowW` 还没找到第一实例的消息窗口（两进程同时启动时的窗口空档），会**静默跌落
   成第二个完整实例**：自己的托盘、窗口、任务栏按钮全部照建，与第一实例并存。
   图标顶的是同一个 exe 图标，与"第二个图标一模一样"吻合。
2. **已当场处理的部分**：注册表 HKCU Run 键曾有两条残留（`MomentOCR` 与变体实验期的
   `MomentOCR-local-inference`）同时指向同一 exe，每次开机必然制造一次上述竞态窗口。
   陈旧条目已于 2026-11-06 删除；此缓解与代码升级互不替代，升级后竞态路径本身关闭。
3. 上游 2026-10 已修（2.5.x 系列）：#3704 处理 Windows 启动竞态并确保第二实例退出、
   #3645 限制第二实例等待、#3686 参数分隔符不再依赖 `|`、#3644 非 Unicode 参数透传、
   #3482 在 cleanup_before_exit 释放锁。当前锁定的 2.4.5 均不含（已读源码核实，
   仅含 2026-09 的 #3592 AllowSetForegroundWindow）。

## [S2] Design

### S2.1 目标版本

| crate | 当前（Cargo.lock） | 目标 | 依据 |
|---|---|---|---|
| tauri-plugin-single-instance | 2.4.5 | **2.5.5** | 含全部上述竞态修复；2.5.x 最终稳定版；3.0.0-alpha.3 不采纳 |
| tauri | 2.11.5 | **≥ 2.12**（2.12.5） | 2.5.5 声明 `tauri ^2.12`，硬性下限 |
| tauri-build | （2.x） | ≥ 2.7.x | 与 tauri 2.12 同代，cargo 自行解析 |
| 其余 tauri-plugin-* / wry / 传递依赖 | 锁定值 | latest compatible | 随 `cargo update` 一并刷新（见 S2.3） |

约束来源（ustc 镜像索引实测）：single-instance 2.5.5 依赖
`tauri ^2.12`、`tauri-plugin-deep-link ^2.6.3`、`windows-sys ^0.61`；
其余依赖（semver/serde/serde_json/thiserror/tokio/tracing/zbus）与 2.4.5 要求一致。

### S2.2 升级方式

Cargo.toml 的声明全部是宽松 `"2"`，无需改动版本号；升级只发生在 Cargo.lock。
步骤：

1. 新建分支 `feat/single-instance-upgrade`（基于最新 master）。
2. `cargo update`（全图刷新，一次性），确认 Cargo.lock 中出现
   single-instance 2.5.5、tauri ≥ 2.12。
3. 审阅 Cargo.lock diff：重点关注 wry（0.55 → 0.57+，WebView2 行为面）、
   windows-sys 0.60 → 0.61、tauri-runtime-wry/tauri-utils 同步、
   tray-icon 升级后收敛为单版本（实测 base 仅 0.24.1，升级后 0.25.1）。
4. 预期一次性 diff 规模：约 160 个包（2026-11-06 实测：全图落后索引 161 个包）。
   **接受这个规模**，不做"只动一个包"的手术式手改——tauri ^2.12 的硬依赖决定了
   级联不可避免，手改 lockfile 只会把同一改动拆成不可审计的碎片。

### S2.3 已知风险与对策

- **wry 小版本跨级（0.55→0.57）**：主回归面是 WebView2 渲染与 IPC。对策：S4 全量验收。
- **Cargo.lock 裁剪坑**（记忆已知）：worktree 操作会裁剪 lockfile 并拦 ff 合并；
  Cargo.lock 的变更必须独立成一个 commit。
- **rustc**：2.5.5 MSRV 1.90，本机 1.98.1，满足。
- **镜像**：ustc 索引已含全部目标版本（2026-11-06 实测），GitHub Actions 走 crates.io 不受影响。

## [S3] Scope

- In scope：Cargo.lock 全图刷新到上述目标；S4 验收全流程；changelog 片段。
- Out of scope：
  - tauri-plugin-single-instance 3.0（alpha）；
  - Cargo.toml 声明方式重构（宽松 `"2"` 保留）；
  - 幽灵图标监视（后台监视器在 2026-11-06 独立运行，结论另行归档）；
  - 其他功能开发。

## Tasks

- [x] T1: 新建分支 `feat/single-instance-upgrade`（depends: none）
- [x] T2: `cargo update`，核对 Cargo.lock 达到 S2.1 目标版本（depends: T1）
- [x] T3: 审阅 Cargo.lock diff，确认无 yanked 包、tray-icon 版本收敛、无异常移除（depends: T2）
- [x] T4: `cargo clippy --all-targets` 无新增警告；`cargo fmt --check`；`cargo test` 19 通过 0 失败（基线 2026-11-06）（depends: T2）
- [x] T5: 双实例行为验收（见 S4.2/S4.3），dev 构建即可（depends: T4）
- [x] T6: release 构建跑通安装包（MSI + NSIS）（depends: T4）
- [x] T7: changelog 片段（用户可见：修复开机偶现第二个图标）（depends: T5/T6）
- [x] T8: 按 compose-next 完成评审与 Finalize（depends: T7）
- [ ] T9: 安装版真机冒烟——用户执行：安装包覆盖安装后截图 → 框选 → OCR → 结果入窗全链路，托盘唤出、全局快捷键、退出收 llama-server（depends: T6）

## [S4] Acceptance

### S4.1 依赖到位

- `cargo tree -p tauri-plugin-single-instance` 显示 2.5.5，且 `cargo tree -p tauri` ≥ 2.12；
- `cargo build` 成功。

### S4.2 第二实例退出

- 应用运行中，手动再次启动 exe：第二进程 ≤ 2 秒退出，第一实例主窗口置前；
  任务栏不出现第二个按钮，托盘不出现第二个图标。

### S4.3 启动竞态

- 模拟开机双拉起（两个进程间隔 < 100ms 启动）：恰好存活一个实例，
  败者无窗口、无托盘、无任务栏残留。

### S4.4 回归

- `cargo test` 19 通过 0 失败（2 ignored 为既有基线）；
- 安装版真机：截图 → 框选 → OCR → 结果入窗 全链路正常；
- 托盘点击唤出、全局快捷键、退出收 llama-server 子进程，均正常。
