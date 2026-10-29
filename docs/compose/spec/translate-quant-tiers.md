---
feature: translate-quant-tiers
status: in-progress
updated: 2026-10-28
branch: feat/translate-quant-tiers
commits: 60129aa..(head 待填)
worktree: .worktrees/translate-quant-tiers
---

# 本地翻译模型档位：默认轻量 IQ3_XXS，保留标准 Q4_K_M

## Report

（交付时填写）

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

- [ ] T1: Rust 档位模型（Quant 结构、urls/字节数、install 参数、status.quant）(depends: none)
- [ ] T2: 前端面板档位下拉 + 已装档位展示 (depends: T1)
- [ ] T3: 验证（cargo test + tsc）+ 片段 + spec 定稿 (depends: T2)

## [S4] Acceptance

- [ ] 缺省安装下载 IQ3_XXS（826,831,648 字节）并完成自检
- [ ] 选「标准」安装下载 Q4_K_M（1,133,080_512 字节）
- [ ] `status.quant` 正确反映已装档位；未安装为空
- [ ] 已安装时面板显示当前档位，切换提示需移除重装
- [ ] 翻译使用已装档位模型（不因用户当前下拉而错配）
- [ ] `cargo test`、`cargo check`、`npm run build` 通过
