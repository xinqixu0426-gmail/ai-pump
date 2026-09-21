# 生产 AI 对话验收（2026-09-20）

> 数据来源：Mac Mini 生产库 `pump.db` 的 `ai_conversations` / `ai_conversation_messages`（**只读打开**）。
> 验收对象：最近 4 段真实会话、共 28 组问答（c57 2 组、c58 10 组、c59 7 组、c60 9 组）。
> 判定基线：同一生产库的业务事实 + 正式引擎（`POST /api/recipes/:id/cost-preview`、`build_recipe_bom_draft`）
> 在同一提交 `78de920` 上重新计算的结果。可复跑脚本见文末。

## 0. 结论

- **多数回答在生产事实上是准确的**：规格-片数 ↔ 方案编码 ↔ 线圈成本 ↔ 零件价格 ↔ 包装角色等
  数字全部与生产库/正式引擎一致；
- **但发现 1 类真实缺陷（"算对了却报错了"）和 1 类可用性缺陷**，都能用对话自身的 `metadata_json` 工具回执复现；
- 生产中 **ontology 路由仍然关闭**（`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED` 未设置），
  因此本次验收测的是**已上线生产链路**的行为，不是 Gate B 那条路由。

## 1. 数字核对：与生产事实一致的部分（已验证）

| 会话 | 问题 | 答案 | 生产事实 | 判定 |
|---|---|---|---|---|
| c60 | 12-120 成本 | 99.79 元 / COIL-0001 钢带小眼 | coil 1 cost 99.79062 | ✅ |
| c60 | 12-140 成本 | 116.99 元 / COIL-0002 | coil 2 cost 116.99186 | ✅ |
| c60 | 12-220 | 2 套：COIL-0006 钢带小眼 166.97；COIL-0010 冷轧国标眼 196.17 | coil 6 = 166.9728、coil 10 = 196.1669 | ✅ |
| c59 | 12-120 / 12-220 线圈成本 | 99.79 / 166.97 | 同上 | ✅ |
| c58 | 12-120 / 12-220 线圈成本 | 99.79 / 166.97，含方案编码、线重、铜基价、库存 0 | 与 coils 表逐字段一致 | ✅ |
| c57 | 轴承-202 / 203 单价 | 1.2 / 1.6 元，供应商万佳轴承，库存 0 | parts 目录价一致 | ✅ |
| c57 | 机械密封-14\*28\*38 | 1.9 元，你我发油封，库存 0 | parts 目录价一致 | ✅ |
| c58/c59/c60 | 配方列表 | 「共 1 条」（V550） | **当时正确**：配方 13（V750）创建于 `2026-09-20T02:37:44Z`，晚于这几段对话 | ✅ |
| c60 | 12-220 歧义 | 不猜，要求确认材质/槽眼 | 12-220 确有 2 套正式方案 | ✅ |
| c58 | V550 当前成本 | 268.00（物料 247 + 人工 21），并注明与档案保存成本 266.74 差 1.26 | 两套口径都存在，且差额被明确披露 | ✅ |
| c59 | 最近 5 个订单 | 返回 0 条并说明「不代表系统内绝对没有订单」 | 生产仅 1 张订单且创建于对话之后 | ✅ |
| c58 | 「使用 12-120 线圈做的配方有哪些」 | V550 一个，并声明 `complete=true` 无未确认旧引用 | 反查集合完整 | ✅ |

## 2. 真实缺陷

### D1（严重·「算对了却报错了」）c60 `m359`
- **问**：把配方 V550大脚板-2寸-经典款的线圈从 12-120 换成 12-140，成本是多少
- **答**：`线圈覆盖为 12-120 … 正式试算的当前完整成本为 266.74 元。` —— 覆盖项写成 **12-120**（用户要的是 12-140），
  金额是**基准**而非换线圈后的成本。
- **同一轮工具回执**：`preview_recipe_cost{coilId:1,coilSheets:120}` → 266.74；
  `preview_recipe_cost{coilId:2,coilSheets:140}` 连续 3 次失败 `AI_RESOURCE_QUERY_NOT_A_NAME`；
  `build_recipe_bom_draft{baseRecipeId:12, coilId:2, coilSheets:140}` → **成功，当前总成本 285.80**。
- **正确值**：本会话用同一正式引擎复算 `POST /api/recipes/12/cost-preview {coilId:2,coilSpec:"12",coilSheets:140}`
  → **285.80**（与 c58 `m321` 完全一致）。
- **性质**：引擎算出了 285.80，最终答案却报了较早的 266.74 与旧覆盖项。这属于「已取得正式结果却未采用」，
  也是 `AGENTS.md` §10.19「不得静默删除正式结果」要防的方向。

### D2（同类）c58 `m321`
- 同一问法，答案表格里 BOM 草稿行给的是 **285.8**（正确），但把失败调用与重复调用混在同一轮；
  该轮另有 `recipeName:"12-120换成12-140"`、`shellModel:"12-120换成12-140"` 这类整句当正式字段的调用。
  结论数值正确，**过程不可复核性偏高**（同一轮 8 次调用、含 3 次同参数重复）。

### D3（可用性·证据门过严）c60 `m365`
- **问**：换成 12-140 重新算
- **答**：`已核实：…COIL_SCHEME_COST… 仍缺少正式证据：RECIPE_CANONICAL_IDENTITY、RECIPE_BASE_CONFIGURATION，本轮不能给出完整结论。`
- **同一轮工具回执**：`get_all_recipes{keyword:"12-140"}` → 0 条；
  `search_coils{12,140}` → COIL-0002；`preview_recipe_cost{recipeName:"V550大脚板-2寸-经典款", useRecipeBaseline:true, overrides:{coilId:2,…}}`
  → **成功，285.80**。
- **性质**：上一轮（`m363`）已经算过同一条 12-220 覆盖；本轮也已经拿到 285.80，却以下游「事实证据」缺失为由拒绝给出任何数字。
  对用户的观感是「刚才算得出来，现在算不出来」。
- **须注意**：该轮 `metadata_json` 里**没有**记录「已核实/缺失」两份事实清单的判定依据，所以我只能证明结果被丢弃，
  不能证明那两个 fact 当时是否真的缺失 —— 这一点需要看 `factCapabilityRegistry` 的判定日志才能定性。

### D4（接口使用方式）整句自然语言被当作正式字段（9 处）
`preview_recipe_cost.recipeName` / `build_recipe_bom_draft.shellModel` 收到 `12-120换成12-140`、
`V550大脚板-2寸-经典款的线圈从12-120换成12-140`、`550的重新核算` 等整句（c58 `m321`/`m329`、c60 `m353`/`m359`）。
工具侧守住了（返回 `AI_RESOURCE_QUERY_NOT_A_NAME`，未把它当名称），但同一轮里被重复尝试多次才改用 `baseRecipeId`，
既浪费轮次也让回答过程难以复核。

## 3. 未能复核的部分（明确声明）

- `ai_answer_feedback` 表为空、`ai_evaluation_results` 为空，**没有既有的用户反馈或评测结果**可以对照；
- 会话 `metadata_json` 只记录 toolCalls/toolResults/provider/metrics，**不记录**事实门（fact gate）的逐项判定，
  因此 D3 只能证明「结果被丢弃」，不能证明「当时那两个 fact 是否真的缺失」；
- 本次只覆盖最近 4 段会话（生产共 60 段、365 条消息），其余会话未读。

## 4. 复跑方式

```bash
# 1) 从生产库导出会话与事实（在 Mac Mini 上，只读）
node .prod-ai-export.cjs > /tmp/prod-ai.json      # 需 LIMIT=<n>
node .prod-facts.cjs     > /tmp/prod-facts.json   # 需在 cwd=生产仓库、且 sqlite 可读

# 2) 数字核对（答案 vs 生产事实）
node scripts/verify-ai-conversation-acceptance.cjs .prod-ai.json .prod-facts.json

# 3) 答案 vs 本轮工具回执（STALE / UNSOURCED / NL_AS_IDENTIFIER / REPEATED_CALL）
node scripts/verify-ai-answer-vs-receipts.cjs .prod-ai.json
```

报告产物：`logs/ai-conversation-acceptance.json`、`logs/ai-answer-vs-receipts.json`。

> 检查器在首轮曾产生 4 处误报（金额在 `data[]` 行内、完整配方名被当成自然语言），已在脚本内修正并注明判据，
> 避免把「工具本来就算对」的情形误判成缺陷。
