---
feature: translate-target-switcher
status: delivered
updated: 2026-10-28
branch: feat/translate-target-switcher
commits: b18b0c9..984cec5
worktree: .worktrees/translate-target-switcher
---

# 目标语言：主界面快速切换 + 扩充到 10 种

## Report

**What was built** — 主界面译文区的「→ 语言」徽标改为同款样式的下拉，即选即换目标
语言（写入 `language.translateTarget`，与 设置 → 常规 的选择器共用同一 store 键，
两处实时同步）；目标语言从 4 种扩到 10 种（新增法/德/俄/西/葡/阿拉伯）。列表与
Google 码表收拢进 `src/utils/languages.ts` 单一来源，取代散在 Settings 与 App 的
两份内联副本；HY-MT/大模型链路继续用中文名进提示词，Google 走码表。OcrResult 改为
直连 settings store（与 ScreenshotTool/Settings 一致），删除了 App 传入的
translationTarget prop。

**Verification** — `npm run build`（tsc + vite）PASS；`cargo check --lib` PASS；
独立评审 subagent 按验收清单逐条核对全部 PASS（含两布局共用、快捷键路径取新值、
受控 select 语义、prop 删除无残留），评审发现的两处过时文案已修复（96cbd4c）。

**Journey log**
- 评审 subagent 这次派发成功（此前连续撞并发限额）——逐条 PASS 判定外加主动
  omission-hunting，抓到两处 diff 之外的过时枚举文案，独立评审的价值实打实。


## [S1] Problem

翻译目标语言只能在 设置 → 常规 里改（且只有中/英/日/韩四项）；想换语言翻译一次就要
进设置翻一圈，高频使用很别扭。HY-MT 本身支持 33 语，列表远可以更长。

## [S2] Design

- **语言单一事实来源**：新建 `src/utils/languages.ts`，导出 `TRANSLATE_TARGETS`
  （10 项中文名）与 `GOOGLE_TARGET_CODES`（中文名 → Google 语言码）。现在列表散在
  Settings 的 options 与 App 的 targetCodeMap 两处，收拢成一处。
- **快速切换入口**：OcrResult 译文区的 `→ 中文` 标签改成同款样式的小下拉，改动
  直接写入 `language.translateTarget`（与设置项共用同一个 store 键，两处自然同步）。
  OcrResult 目前是纯 props 组件，但 ScreenshotTool/Settings 都直连 store，跟随
  现有风格改为直连 store，顺带删掉 App 传的 translationTarget prop（删除优于增改）。
- **语言列表**：中文、英文、日文、韩文、法文、德文、俄文、西班牙文、葡萄牙文、
  阿拉伯文。HY-MT（33 语）与大模型直接用中文名进提示词（现有行为不变）；
  Google 用新增的码表映射。
- 设置 → 常规的选择器保留，options 换成同一常量。

## [S3] Scope

In scope: languages.ts、OcrResult 下拉、Settings/App 引用同一常量。
Out of scope: 源语言选择（各引擎均自动检测）、设置里加自定义语言输入。

## Tasks

- [x] T1: languages.ts + App/Settings 收拢到常量 (depends: none)
- [x] T2: OcrResult 译文标签改下拉（直连 store）+ 删多余 prop (depends: T1)
- [x] T3: 验证 + 片段 + spec 定稿 (depends: T2)

## [S4] Acceptance

- [x] 主界面译文区可下拉切换目标语言，切换后立即翻译生效（下次点翻译用新语言）
- [x] 设置 → 常规的「翻译目标」与主界面切换共享同一状态（一处换、两处同步）
- [x] 10 种语言在 Google 翻译与 HY-MT/大模型两条链路都可用（码表/提示词各走各的）
- [x] `npm run build` 通过（tsc 全量类型检查）
