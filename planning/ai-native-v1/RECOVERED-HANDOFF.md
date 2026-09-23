# AI Native V1 — 执行上下文恢复记录（RECOVERED HANDOFF）

> **⚠ 本文件不是执行权威（仅历史恢复记录）。**
> 自 Supervisor 验收 N72-R01 起，执行权威为 `EXECUTION_AUTHORITY = CANONICAL_PLAN`，
> 权威来源为 `planning/ai-native-v1/AI-native实施总计划.md`（commit `6150edf`）。
> 本文件只记录“计划包曾一度看似丢失、经 Git 逐字节恢复”的过程，不得用作路线图或阶段依据。
> N7.2 的正式证据与切片记录见 `implementation/N7.2/`。

**状态：** `CANONICAL_PLAN_RECOVERED = YES`（见下节）。本文件**不是** canonical plan 的替代品。
**执行权威：** `EXECUTION_AUTHORITY = CANONICAL_PLAN`

---

## 1. 为什么会有这个文件

接手环境最初报告：`planning/ai-native-v1/` 可能没有进入 Git，同步仓库后看不到该目录。

**实际结论：原 canonical planning 文件包完整存在于 Git 历史中，已经按原文件恢复，没有由模型重写。**

恢复来源：

| 项 | 值 |
|---|---|
| `CANONICAL_PLAN_RECOVERED` | **YES** |
| `CANONICAL_PLAN_SOURCE` | `origin/ai-native/v1`（本地同步分支 `ai-native/v1`） |
| `CANONICAL_PLAN_SOURCE_COMMIT` | `6150edfb8851d89dcd5e1e8d2a0ca22aaf6e533a`（`ai-native(N7.1): add reversible owner trial gate`） |
| 同内容亦存在于 accepted baseline | `3b685b166af6cd35959e8767011dd683f388acd2`（N7.1 accepted tip） |
| canonical 总计划路径 | `planning/ai-native-v1/AI-native实施总计划.md` |
| canonical N7.2 定义位置 | `planning/ai-native-v1/05-分阶段实施.md` 第 225–231 行 |
| 恢复文件数 | 229 |
| 恢复方式 | `git archive 6150edf planning/ai-native-v1` → 解包到工作区（不 restore/checkout 覆盖工作区） |

恢复保真性证据：恢复后 `git status --short` 对该目录只显示 `?? planning/`，即 Git **没有报告任何内容差异**，说明工作区文件与 `6150edf` 树逐字节一致（含 `core.autocrlf=true` 的正常检出规范化）。

---

## 2. 这台机器上的 Git 事实（必须记录，否则后续会误判）

当前主工作区并不是 accepted baseline：

| 项 | 值 |
|---|---|
| 主工作区路径 | `C:\Users\Dan\Documents\水泵订单及生产管理系统` |
| 主工作区分支 | `master` |
| 主工作区 HEAD | `e244bd75b2e896083a452eede9d6fe0684a6d264` |
| `master` 是否包含 `3b685b16…` | **否** |
| `git merge-base master origin/ai-native/v1` | **空**（两条历史**不相交**） |
| `master` 独有提交数 | 736 |
| `origin/ai-native/v1` 独有提交数 | 36 |
| 主工作区 `planning/` | `master` 上不存在 |

因此 N7.2 **不能**在主工作区执行：N4–N7.1 的 Native 实现（`aiNativeRolloutPolicy.cjs`、`aiNativeQualityGate.cjs`、`aiTaskControllerV2.cjs`、`scripts/run-ai-native-*` 等）只存在于 `ai-native/v1` 历史中。

**处理方式（不破坏用户工作区）：**

1. 未执行任何 `git reset` / `git restore` / destructive `checkout` / `rebase` / `clean`；
2. 未切换主工作区分支；
3. 用 `git worktree add` 在独立目录建立 N7.2 执行工作区：

| 项 | 值 |
|---|---|
| N7.2 工作区 | `C:\Users\Dan\Documents\pump-ai-native-v1` |
| N7.2 分支 | `ai-native/v1-n7.2`（从 `3b685b16…` 新建） |
| N7.2 HEAD 起点 | `3b685b166af6cd35959e8767011dd683f388acd2` |

4. 主工作区 `git status --short` 在整个过程中保持**干净（0 项）**，用户 stash 三条均未被触碰：`USER_DIRTY_PRESERVED = YES`。

---

## 3. 本文件不做什么

- 本文件**不是** canonical plan，不替代 `AI-native实施总计划.md`；
- 不新增任何 N7.2 之外的路线图，不推测 N7.3/N8；
- 不允许把本文件静默升级为 canonical plan。若将来 canonical plan 丢失，只能按上表来源 commit 重新恢复。

---

## 4. 已确认的 N7.2 执行权威（来自 canonical 文件原文，非本文件重写）

canonical `05-分阶段实施.md` N7.2 原文要点：

- **前置：** N7.1 试点证据满足对应切片的退出门槛。
- **动作：** 用既有 legacy witness 与冗余矩阵逐项证明新的责任覆盖；每次只迁移一个职责切片，如 Native 成本比较的跨目录/多方案后处理，不整组删除 Money Guard 或 Legacy 逻辑。先移除重复执行，再确认无调用方，最后才删除代码。
- **退出：** 用户可感知用例不退化，关键安全突变仍拒绝，provider 调用与答案重复无回升，Legacy/OUT_OF_SCOPE 保护仍完整。无法证明冗余就保留并标明唯一作用范围，不为了少文件删除真实能力。

与本轮 Supervisor 指令核对结果：**两者一致，无冲突**，故按 canonical 内容执行，未做两计划融合。

---

## 5. 既有 legacy witness / 冗余矩阵（canonical 要求复用，不是新建）

| 资产 | 路径 | 说明 |
|---|---|---|
| LegacyRedundancyMatrixV1 | `docs/legacy-redundancy-matrix-v1.json` | 已冻结，SHA-256 `800524e7…3741a` |
| LegacyWitnessCorpusV1 | `tests/fixtures/legacy-witness-corpus-v1.json` | 已冻结，SHA-256 `30045b77…0f05` |
| Legacy 冗余审计 | `docs/legacy-redundancy-audit-v1.md` | BUS-P6，结论：无组件可全局删除 |
| test-only harness | `tests/helpers/legacyRedundancyHarness.cjs` | 组合既有公开函数，逐个 bypass |

该矩阵覆盖的是 **AI 回答保护层**（Money Guard / Cross Catalog / Coil Variant / Rulebook / coil→recipe repair），
与本轮 N7.2 切片（**Native 任务内成本比较责任的重复执行**）是不同责任面，因此本轮在其之外补充 N7.2 专属矩阵与 witness，未修改上述冻结资产。
