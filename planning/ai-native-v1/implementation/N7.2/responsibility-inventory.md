# N7.2 责任清单（Responsibility Inventory）

**执行权威：** `CANONICAL_PLAN`（`planning/ai-native-v1/AI-native实施总计划.md`，来源 commit `6150edf`）
**注意：** `RECOVERED-HANDOFF.md` 仅保留为迁机恢复的历史记录，**不再是**执行权威。

**切片范围：** canonical N7.2 明示示例切片「Native 成本比较的跨目录/多方案后处理」及其直接相邻责任面。

**统计口径（严格按 canonical 要求）：** 以**职责**为单位，不以文件为单位。同一个 `.cjs` 文件在本清单里可能只对应一个职责，也可能完全不出现在待退休候选中。

**前置事实（决定了本轮能做什么）：**

| 事实 | 值 | 影响 |
|---|---|---|
| `AI_NATIVE_MODE` 默认 | `off` | Legacy 路径当前仍是全局正式权威，任何 Legacy 责任都不能因“Native 有替代”而物理删除 |
| `OWNER_TRIAL_ACTUALLY_STARTED` | `NO` | 没有真实 owner 试点流量，Native 责任只有隔离证据 |
| `AI_NATIVE_WRITE_ENABLED` | `false` | 两个切片均不涉及写路径 |
| 是否触及写路径 | 否 | 无 PREPARE/EXECUTE、operationId、幂等、回执变化 |

---

## 0. canonical 切片次序的如实结论

**canonical 没有规定 N7.2 的切片清单或次序。** 全仓检索恢复的 canonical 包，`N7.2` 只出现在同一小节的两处副本（`05-分阶段实施.md:225` 与 `AI-native实施总计划.md:1500`）及其 N7.3 的前置引用中。canonical 提供的是：

- 一个明示示例切片：**Native成本比较的跨目录/多方案后处理**（已由 N72-R01 完成）；
- 切片选择规则：**每次只迁移一个职责切片**；**无法证明冗余就保留并标明唯一作用范围**；
- 执行顺序规则：**先移除重复执行 → 再确认无调用方 → 最后才删除代码**。

因此：`CANONICAL_NEXT_SLICE_CONFIRMED = NO`。R08 不是 canonical 写定的下一片；它是执行端按上述规则筛出的**唯一候选**，并由 Supervisor 在 R01 验收中指令执行。本文件如实区分「canonical 定义的规则」与「执行端的切片选择」。

---

## 1. 职责表

| RESPONSIBILITY_ID | LEGACY_OWNER | NATIVE_OWNER | CURRENT_AUTHORITY | DUPLICATE_EXECUTION_RISK | CLASSIFICATION | RETIREMENT_ELIGIBLE |
|---|---|---|---|---|---|---|
| N72-R01 同任务内正式基线情景成本 | Legacy 前台 Runtime（off/shadow） | Controller `CURRENT_COST` | LEGACY（全局）；owner 内已去重 | **已消除** | 去重前 `DUPLICATE_EXECUTION` → 去重后 `FALLBACK` | 否（off 仍需要） |
| N72-R02 资料档案配置核对 | 无对应实现 | `recordSourceConfigurationComparisons` | NATIVE_ONLY | 无 | `AUTHORITATIVE` | 否 |
| N72-R03 配置情景比较 | 无对应实现 | Controller 共享尾段 | NATIVE_ONLY | 无 | `AUTHORITATIVE` | 否 |
| N72-R04 单台毛利试算 | 无对应实现 | Controller `PROFITABILITY` | NATIVE_ONLY | 无 | `AUTHORITATIVE` | 否 |
| N72-R05 虚拟齐料情景复用 | 无对应实现 | Controller `INVENTORY_QUERY` | NATIVE_ONLY | 无（服务层进程内复用） | `AUTHORITATIVE` | 否 |
| N72-R06 正式业务基础设施 | 不适用 | 不适用（只调用） | SHARED_FORMAL_INFRASTRUCTURE | 无 | `SHARED_INFRASTRUCTURE` | 否（禁止当 Legacy 删） |
| N72-R07 Legacy 配方价差比较 | `costQueries.getRecipeDifference` | 不使用 | LEGACY | 无（不同口径能力） | `AUTHORITATIVE` | 否 |
| N72-R08 Native 适配层 `preview_recipe_cost` 投影责任 | 不适用 | 适配层 `CANONICAL_PROJECTORS` | 在 Native 任务路径中不可达 | 无 | `DEAD` → 本轮已删除 | **是（已删除）** |
| N72-R09 AI 回答保护层（BUS-P6 五组） | 见已冻结矩阵 | 不适用 | LEGACY | 无 | `PARTIALLY_REDUNDANT` / `REQUIRED_SAFETY`（本轮不变） | 否 |

---

## 2. 已完成切片 N72-R01（Supervisor 已验收）

| 字段 | 值 |
|---|---|
| `SLICE_STATUS` | **PASS（accepted，commit `a47d2d91b6cf16504f4e516c15f919c41c608e1b`）** |
| `LEGACY_RESPONSIBILITY` | 同一任务内“正式基线情景成本（CURRENT_REBUILT）”只由正式能力重建一次 |
| `NATIVE_REPLACEMENT` | 复用已接受的 `preview_profitability` 回执内 `scenarioContext.scenarios[0]`，指针 `/data/scenarioContext/scenarios/0/cost/currentTotalCost` |
| `CURRENT_AUTHORITY` | 全局 `LEGACY`（默认 off）；owner 任务内该责任由 Native 执行且已去重 |
| `EXIT_THRESHOLD` | ①正式调用数下降且无残留重复 ②用户可感知结论与事实口径不变 ③不完整正式成本仍 fail-closed ④写能力 0 ⑤off/shadow/owner/rollback 契约不变 ⑥全仓门禁重跑全绿 |
| `MEASURED` | 正式能力调用 **2 → 1**；`toolCalls` **6 → 5**；分类 `DUPLICATE_EXECUTION → FALLBACK` |
| `WITNESS_SENSITIVITY` | 回退生产实现后 **6/8 FAIL**，恢复后 **8/8 PASS**（两次执行一致） |
| `LEGACY_CODE_PHYSICALLY_DELETED` | NO（刻意保留，off 仍需要） |

### 为什么它第一个做

1. canonical N7.2 直接点名该切片（“如 Native 成本比较的跨目录/多方案后处理”），不是模型自选。
2. 它是**纯只读**责任：不触及 `PREPARE_CHANGE` / `EXECUTE_CHANGE`、operationId、幂等、回执与对账，风险面最小。
3. 仓库内已有同类去重的先例（结构化路径 N4.2C 已实现同一复用），改法是**沿用既有架构而不是新增架构**。
4. 重复执行可被确定性观测（同一任务内同一情景键的正式调用次数），不依赖自然语言相似度或真实模型。
5. 不需要删除任何 Legacy 代码，天然满足“off 仍需要 Legacy”的约束。

---

## 3. 本轮切片 N72-R08（Native 适配层 preview_recipe_cost 投影责任退出）

| 字段 | 值 |
|---|---|
| `SELECTED_SLICE` | N72-R08 |
| `GLOBAL_SYMBOL_OR_DESCRIPTOR` | `preview_recipe_cost` |
| `RESPONSIBILITY_SPECIFIC_ENTRYPOINT` | `api/services/aiTaskCapabilityAdapterV2.cjs` 的 `CANONICAL_PROJECTORS.preview_recipe_cost` |
| `SELECTED_RESPONSIBILITY` | Native 任务适配层「把 `preview_recipe_cost` 的单配方当前重建成本结果投影为 canonical recipe 实体」这一小块责任 |
| `LEGACY_RESPONSIBILITY` | 不适用（被退出的这一小块只存在于 Native 适配层） |
| `NATIVE_RESPONSIBILITY` | 同上；已删除 |
| `CURRENT_AUTHORITY` | `NONE_IN_NATIVE_TASK_PATH` |
| `EXIT_THRESHOLD` | ①全局描述符必须保留（Legacy/off/MCP/共享需要）②仅删除责任特定的不可达入口 ③静态与动态可执行调用方归零 ④off/shadow/owner/rollback/MCP 行为不变 ⑤不得改动共享正式业务服务 ⑥不得制造重复执行问题 ⑦全仓门禁重跑全绿 |
| `STATIC_EXECUTABLE_CALLERS_BEFORE / AFTER` | 1（该键自身，经 `projectCanonicalEntities` 以 `receipt.toolName` 索引）/ **0** |
| `DYNAMIC_EXECUTABLE_CALLERS_BEFORE / AFTER` | 0 / 0 |
| `CLASSIFICATION_BEFORE / AFTER` | `DEAD` / `DEAD_REMOVED` |
| `NATIVE_SPECIFIC_WIRING_REMOVED` | YES（1 个投影键 + 配套注释，-3 行） |
| `GLOBAL_LEGACY_DESCRIPTOR_REMOVED` | **NO（刻意保留）** |
| `DUPLICATE_EXECUTION_BEFORE / AFTER` | 无重复执行（本切片不是去重切片，如实记录，未制造问题） |

### 责任边界为什么必须窄于符号名

`preview_recipe_cost` 这个符号被**多个不同 surface** 复用：

| Surface | 是否本切片责任 | 处置 |
|---|---|---|
| Native 任务适配层 `CANONICAL_PROJECTORS` | **是** | 已删除（不可达） |
| 共享能力注册表 `api/capabilities/registry.cjs` | 否 | 保留（适配层自身也依赖它按名查找） |
| Legacy 工具面 `api/routes/ai/tools.cjs` + 执行器 | 否 | 保留（off/shadow 权威路径） |
| MCP 读取目录 `api/mcp/catalog.cjs` | 否 | 保留（canonical 未要求退役 MCP 责任） |
| Legacy 语义/影响边界、prompt、发布门禁 | 否 | 保留 |

**若按符号名整体退役，会破坏 off 模式、MCP 读取能力与发布门禁——canonical 明确禁止。**

### 不可达性证明（决定能否删除的关键）

1. `projectCanonicalEntities` 只由 `bindSubject` 调用，并以 `receipt.toolName` 为索引。
2. `createTaskCapabilityAdapterV2` 的**唯一生产消费者**是 `aiTaskControllerV2.cjs`（全仓仅此一处）。
3. 控制器实际执行的工具名为固定 12 个（`compare_recipe_scenarios` / `get_all_recipes` / `get_factory_knowledge_detail` / `get_order_knowledge_package` / `get_recipe_technical_files` / `preview_profitability` / `preview_virtual_readiness` / `search_coils` / `search_customer_history` / `search_customers` / `search_factory_knowledge` / `search_parts`）——**不含** `preview_recipe_cost`。
4. 控制器调用 `bindSubject` 时只传 `get_all_recipes` / `search_customers` / `search_coils`。
5. Native 模型工具面 `AI_NATIVE_TOOLS_V2` 只含 3 个工具，Native 规划器无法选择该工具。
6. 即使被调用也会失败：`projectCanonicalEntities` 会因 `receipt.toolName !== toolName` 抛 `CANONICAL_PROJECTION_RECEIPT_TOOL_MISMATCH`。
7. 测试侧从未触发该键：全仓无任何断言引用 `CANONICAL_PROJECTORS`；`tests/aiTaskCapabilityAdapterV2.test.cjs` 中该工具的用例走的是 `buildCapabilityDescriptorV2` / `validateRequest` / `executeCapability` 机制测试，均不经过 `projectCanonicalEntities`。

### 引用计数口径

| 指标 | 值 |
|---|---|
| `RAW_REFERENCE_COUNT` | **274**（98 个文件） |
| `EXECUTABLE_OCCURRENCE_COUNT` | **207** |
| 差值 67 的解释 | 全部是注释、文档散文、规划文档与测试期望字符串中的提及；不构成调用方 |
| 与 R01 记录的“约 177 处”的差异 | R01 的统计集合更窄（`api`/`scripts`/`tests`）；本轮按 SPEC 要求做全仓口径，故为 274。**两者都不是调用方数量。** |

分类明细与逐项 `CALLER/MODE/PURPOSE/AUTHORITY/CAN_REMOVE/REASON` 见 `legacy-redundancy-matrix.json` 的 `N72-R08.referenceClassification`。

---

## 4. 明确判定为“不构成重复执行”的证据

| 判定 | 证据 |
|---|---|
| N72-R05 虚拟齐料**不是**第二次比较 | `virtualReadinessPreview.cjs` 经 `normalizeScenarioCompareInput` 在**服务进程内**复用比较逻辑，不产生额外 HTTP 正式调用；N4.2C 已有 `compare_recipe_scenarios === 0` 的回归锁定 |
| N72-R07 与 Native 比较**不是**同一责任 | `/api/cost/recipe-difference` 回答“两个配方之间的价差”，Native 回答“同一配方同一读取集合下的情景差额”，口径与业务问题不同 |
| N72-R08 那一小块投影**是** dead，但全局符号**不是** | 见第 3 节不可达性证明与 surface 表 |
| `costQueries.cjs` 的 `replacement: 'preview_recipe_cost'` | 这是 `full_calculate` 的正式兼容提示（`deprecatedTool` → `replacement`），属 Legacy 正式能力声明，不是冗余 |

---

## 5. 本轮未做（明确留白，不虚报）

- 未执行 N7.2 的其他切片（canonical：“每次只迁移一个职责切片”）。
- 未创建 N7.3/N8 路线图，未推测后续阶段名称。
- 未启用任何生产开关，未改生产 env，未 push，未 deploy，未合并 master，未合并/拣选回 `ai-native/v1`。
- 未修改 BUS-P6 已冻结的 `docs/legacy-redundancy-matrix-v1.json` 与 `tests/fixtures/legacy-witness-corpus-v1.json`。
- 未重写已恢复的 canonical plan。
- 未留下任何 mutation（敏感性实验后已 `git stash pop` 恢复实现）。
