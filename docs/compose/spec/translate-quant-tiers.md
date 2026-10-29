---
feature: translate-quant-tiers
status: delivered
updated: 2026-10-28
branch: feat/translate-quant-tiers
commits: 60129aa..a9d602d
worktree: .worktrees/translate-quant-tiers
---

# 本地翻译模型档位：默认轻量 IQ3_XXS，保留标准 Q4_K_M

## Report

**What was built** — 本地翻译（HY-MT）引入「模型精度」档位：默认 **轻量** = IQ3_XXS
（789 MB，实测内存约 1.1 GB），可选 **标准** = Q4_K_M（1081 MB，内存约 2.1 GB、
翻译最快）。安装面板未安装时显示档位下拉（附体积/内存提示），已安装时显示后端回报的
实际档位并提示换档需移除重装。已装档位按 `models/` 下的文件名判定，翻译始终用已装
那档的模型；换档安装会清掉另一档文件避免状态分叉。

**Verification** — `cargo test --lib` 18 passed（含档位 id 回环、按文件判定档位、
两档文件名互斥、缺省档最小）；`npm run build` PASS；**联网端到端真机通过**：缺省档
下载 IQ3_XXS → 自检翻译（「Hello, world.」→「大家好！」）→ 冷重启复翻 → 卸载释放
848 MB（Q4 档同流程为 1140 MB）。

**Journey log**
- **内存大头不是模型体积**：Q4_K_M 权重 1081 MB 却占 2.1 GB 内存（llama.cpp 对
  Q4_K 做 AVX2 重排，额外复制一份）；换 IQ3_XXS 后这部分消失，内存降 1 GB 远大于
  体积差 292 MB。选档位时看内存要实测，不能按文件大小推。
- **腾讯官方 1.25bit/2bit 压缩版不可用**：实测 `invalid ggml type 42` / tensor 读取
  失败——STQ1_0/Q2_0c 是自定义量化类型，对应 llama.cpp PR #22836 仍是 open 且为
  ARM NEON 内核。桌面 x86 走标准量化是唯一可行路。
- **Q2_K 被实测淘汰**：741 MB 体积最小，但口语句语义都翻错（「想砸键盘」→
  "worth considering not to use it at all"），不做成档位。
- ctx-size 4096→2048 只省约 130 MB、慢 20%，收益太小，未纳入。


## [S1] Problem

HY-MT 的 Q4_K_M（1081 MB）启动后实测占内存 2.1 GB——大头是 llama.cpp 对 Q4_K
权重的 AVX2 重排副本，不是模型体积本身。用户觉得占用太大。腾讯官方的 1.25bit/
2bit 压缩版实测无法加载（自定义量化类型 STQ1_0/Q2_0c，对应 llama.cpp PR #22836
未合并，且是 ARM NEON 专用）。

## [S2] Design

- **档位**（标准 llama.cpp 量化，现有 runtime 直接支持）：
  - 轻量 `light`：IQ3_XXS，826,831,648 字节（789 MB），实测内存 1.1 GB、质量几乎
    无损、速度 2~3 s。**默认档**。
  - 标准 `standard`：Q4_K_M，1,133,080_512 字节（1081 MB），测速最快但内存 2.1 GB。
  - Q2_K 实测质量明显退化（口语句语义错），不提供。
- **存储与识别**：两个档位落在 `models/` 下各自文件名；`status` 按「哪个 gguf
  文件存在」判定已装档位，`ComponentStatus.quant` 回传 id，前端展示当前档位。
- **安装**：`install_local_component` 增加可选 `quant` 参数（缺省 light），
  下载对应的文件与字节数校验。已安装时切换档位需移除重装（面板给出文案，
  不做自动重装——避免隐藏的大流量下载）。
- **翻译**：服务启动时用已装档位的模型文件；没有已装模型时报既有「请先安装」。
- **下载源**：轻量走 ModelScope（Mungert/HY-MT1.5-1.8B-GGUF）→ HuggingFace 回退。

## [S3] Scope

In scope: 档位常量与选择、安装参数、状态回传、面板档位下拉。
Out of scope: 自动按内存推荐档位、已装状态下一键换档（自动重下）、ctx-size 调优。

## Tasks

- [x] T1: Rust 档位模型（Quant 结构、urls/字节数、install 参数、status.quant）(depends: none)
- [x] T2: 前端面板档位下拉 + 已装档位展示 (depends: T1)
- [x] T3: 验证（cargo test + tsc）+ 片段 + spec 定稿 (depends: T2)

## [S4] Acceptance

- [x] 缺省安装下载 IQ3_XXS（826,831,648 字节）并完成自检
- [x] 选「标准」安装下载 Q4_K_M（1,133,080_512 字节）
- [x] `status.quant` 正确反映已装档位；未安装为空
- [x] 已安装时面板显示当前档位，切换提示需移除重装
- [x] 翻译使用已装档位模型（不因用户当前下拉而错配）
- [x] `cargo test`、`cargo check`、`npm run build` 通过
