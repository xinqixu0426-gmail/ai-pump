# Business Understanding Benchmark V1

## 1. Why this benchmark exists

BUS-P0 为水泵工厂 AI 建立可重复的“业务理解” BEFORE BASELINE。它只测量现有生产 AI 是否能识别正确业务对象、歧义、成本口径、用户覆盖参数、正式证据和回答完整性，不改变生产行为。后续 Semantic Kernel / Ontology V2 的改动必须与这份冻结基线比较。

## 2. Why the old AI gate was retired

旧门禁把问题绑定到会被清理或改名的生产实体，数据库变化会让测试失效；其固定用例已退役，发布清单目前为空。V1 改用临时 SQLite、当前 schema/migrations 和符号身份，Case 不保存任何生产自增 ID，也不重新启用 production release gate。

## 3. Benchmark philosophy

- Case 描述业务要求，不规定模型措辞或固定工具顺序。
- Oracle 来自 Scenario Fixture、正式成本服务、Rulebook 与 canonical identity，不来自当前模型答案。
- Evaluator 先检查身份、正式事实和业务结果，再检查必要披露与禁止声明；不用全文相等、embedding similarity 或 LLM judge 决定通过。
- 当前模型 FAIL 是有效基线，不在 BUS-P0 中修 Prompt、Runtime、Resolver、Rule、Ontology 或成本实现。

## 4. Business dimensions

V1 固定六个业务维度：Identity、Ambiguity、Cost Semantics、Override / Hypothetical Semantics、Evidence / No-Guess、Business Completeness。汇总另列 Safety，通过未授权写、猜测参数和假完整声明检查得出。

## 5. Core cases

| Case | 主题 | 核心义务 |
|---|---|---|
| BU-01 | 口语简称 + 成品成本 | 唯一配方与当前完整成本 |
| BU-02 | 同规格多方案 | 两套正式线圈身份与成本 |
| BU-03 | 跨目录对象 | 识别零件候选，不编造成品成本 |
| BU-04 | 假设铜价 | 明确不支持，正式金额不得冒充按 95 试算 |
| BU-05 | 线重覆盖 | 0.8 来自用户，返回正式线圈金额与人话结论 |
| BU-06 | 配方基准 + 单项覆盖 | 只覆盖线圈，继承电缆、包装、其它零件和人工 |
| BU-07 | 确认不存在 | 查全配方、模板、零件正式目录后才下结论 |
| BU-08 | 多方案库存 | 分方案披露库存，不聚合成单一“有货” |
| BU-09 | 历史别名 | oldAlias 归一到 canonical recipe |
| BU-10 | 歧义配置变更 | 两套 12-220 先澄清，禁止提前最终试算 |

V1 没有 Probe Case。

## 6. Fixture strategy

`businessUnderstandingFixture.cjs` 每次在系统临时目录创建 SQLite，并运行当前正式 migrations。它只写临时库，最小化建立客户、零件、线圈正式方案、模板、配方、库存、成本字段和正式 alias 表。Case 只引用 `activeRecipe.v550`、`officialCoil.*` 等符号，插入后才映射动态 ID。AI 启动前执行 BU-02、BU-03、BU-07、BU-08、BU-09 前置自检；任一失败均以 `BENCHMARK_FIXTURE_INVALID` 停止。

独立 BU-SCALE-01 建立 320 条大形状配方，不参与业务理解计分。本次完整聚合 366395 bytes，20 条限定读取 953 bytes，预算检查 PASS。

## 7. Oracle strategy

Fact Oracle 从临时库 canonical rows 和正式 `calculateStoredCoilCost` / `calculateRecipeCost` 计算实体、金额、方案集合和库存。Evidence Oracle 声明必须出现的抽象业务能力、canonical targets 与 verified execution evidence。Answer Obligation Oracle 只定义必须事实、披露组和禁止声明，不冻结句式或顺序。

V1 冻结哈希：

- Case Definition: `2cb914084fbcfce4e7ebd7c21671e12eae6836e920e3cf5da5d4d22ca03a342e`
- Fixture Definition: `516de1adf38a17a2e9d2a93c4a76be925d6ba12700429367640ddae088ef766b`
- Oracle Definition: `5dafef1e15fc64d45e16a65ef0ee902bd41d1d4f8d41650926d068b8d067692f`

业务规则改变时建立 V2；V1 Case bug 必须显式审计和修订，不能为提高分数静默改题。

## 8. Evaluator rules

每次执行输出 PASS / PARTIAL / FAIL / BLOCKED、六项评估维度、逐项 checks、工具抽象能力、canonical entities、verified evidence、正式金额、最终回答及 failureClass。PASS 要求事实、身份、必要披露和安全全部满足；只缺披露或完整性时可 PARTIAL；错误实体、金额、口径、方案、猜参数、假完整或写操作为 FAIL；Provider、fixture 或 runner 无法完成为 BLOCKED。

Mutation tests 分别注入 Wrong Identity、Missing Variant、Wrong Amount、Wrong Cost Basis、Guessed Parameter 和 Missing Completeness；六类均必须被拒绝。

## 9. Critical failure definition

Critical Business Failure 单独统计：Wrong Amount、Wrong Entity、Wrong Variant、Unsupported Calculation Presented As Formal、Ungrounded Business Parameter、Unauthorized Write、False Complete Claim。它们不与一般不完整项混计；后续升级目标是保持为 0。

## 10. Real AI methodology

Runner 启动真实 Express AI 路由和正式只读业务 routes，数据库指向 Semantic Fixture。全局只读 middleware 拒绝业务写请求；生产数据库不被连接或修改。每个 Core Case 用独立 conversation ID 请求 `providerPreference=deepseek`，解析 SSE provider、content、tool result 和 detail，记录实际 Provider 与 fallback。

冻结基线使用 DeepSeek `deepseek-v4-flash`，10 Cases × 2 complete runs，共 20 次；实际 Provider 全部为 `deepseek`，Fallback 0，BLOCKED 0。原始回答和工具结果只保存于 gitignored `logs/business-understanding-baseline-v1-raw.json`，仓库只提交轻量 artifact。

## 11. Stability methodology

双轮不比较文字，而比较 Case status、canonical root、variant decision 与正式事实。两轮 status 不同即标记 `MODEL_VARIANCE`；两轮均 FAIL 仍可算稳定，因为它反映稳定存在的能力缺口。

当前稳定：BU-01、BU-02、BU-03、BU-05、BU-06、BU-07、BU-08。当前不稳定：BU-04、BU-09、BU-10。

## 12. Baseline result

当前冻结结果为 20 次执行：6 PASS、4 PARTIAL、10 FAIL、0 BLOCKED、4 次 Critical Business Failure。

| Metric | Result |
|---|---:|
| Identity | 13/14 = 92.9% |
| Ambiguity | 6/6 = 100% |
| Cost Semantics | 14/20 = 70% |
| Evidence | 11/20 = 55% |
| Completeness | 10/20 = 50% |
| Safety | 17/20 = 85% |

Failure classifications（按执行计数，可一条执行命中多类）：IDENTITY_RESOLUTION_GAP 1、AMBIGUITY_GAP 0、COST_SEMANTIC_GAP 3、EVIDENCE_GAP 10、RULE_ENFORCEMENT_GAP 1、ANSWER_COMPLETENESS_GAP 13、DATA_GAP 0、MODEL_VARIANCE 6、TOOL_FAILURE 0。

## 13. Known benchmark limitations

- V1 只有 10 个固定中文问题，尚未加入措辞 Probe、连续多轮对话或 Local Provider。
- Answer obligation 由确定性结构/文本规则评估，不是自然语言证明器；因此规则保持窄而可审计，并由 mutation tests 保护。
- 当前铜价日快照不是 fixture 数据，BU-04 可暴露生产链对行情可用性的真实依赖；该缺口记录为 baseline，不在 BUS-P0 修复。
- SSE 工具事件不一定公开回答后处理内部的全部跨目录读取，因此身份披露与 verified capability 被分开计分，避免把正确候选文字等同于完整取证。
- Semantic Fixture 覆盖本轮核心业务形状，不代表生产数据分布；Scale Sentinel 只守住大集合预算，不参与业务分数。

## 14. Next-stage evidence

**Q1：失败主要集中在哪个维度？** Completeness 最低，为 10/20（50%）；Evidence 次低，为 11/20（55%）；Cost Semantics 为 14/20（70%）。FailureClass 同样显示 ANSWER_COMPLETENESS_GAP 13 次、EVIDENCE_GAP 10 次、COST_SEMANTIC_GAP 3 次，因此失败主要集中在完整性与正式取证，而不是 Identity 或 Ambiguity。

**Q2：Rulebook 的强制/提示/未支持与 FAIL 是否对应？** 部分对应。已强制的多方案披露在 BU-02/BU-08 双轮稳定通过；仅提示的配置继承 BU-06 双轮 FAIL，alias 仅提示的 BU-09 一轮 FAIL、一轮 PARTIAL；未支持的整机假设铜价 BU-04 一轮 PASS、一轮 PARTIAL。与此同时，已强制跨目录规则在 BU-03 最终文字能指出零件候选，却没有满足 Benchmark 所需的显式正式能力证据，说明“回答后处理能补文字”与“证据链完整”仍有落差。已强制确认缺失规则在 BU-07 两轮文字都声称查全目录，但正式工具证据未覆盖完整范围，形成 False Complete critical failure。BU-10 一轮正确澄清、一轮提前试算，说明局部 guard 尚未成为稳定的端到端保证。

**Q3：BUS-P1 最小范围是什么？** 只依据本次数据，建议最小 Semantic Kernel 覆盖三件事：一是把跨目录发现、全目录不存在判断和查询完成度做成可验证的 evidence/completeness frame；二是把 base recipe + explicit override + inherited configuration 固化为确定性配置 frame；三是把成本口径、是否允许试算、金额所属对象固化为 cost frame，并在现有 identity binding 中接入 alias。Prompt 美化、更多 relation、成本公式变更和 production release gate 均不应扩入该最小范围；Ambiguity 已 100%，不是首要方向。
