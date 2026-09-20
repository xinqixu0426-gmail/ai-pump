# Synthetic Business Acceptance V1

SyntheticBusinessAcceptanceV1 用可重建的隔离 SQLite 假数据验收真实 AI 链路。它用于扩大场景覆盖、暴露业务能力缺口，不代替真实生产数据验收。

## 安全与真值边界

- 每次运行新建临时 SQLite，不复制、不读写生产业务数据。
- 成本 Oracle 复用 `coilCost.cjs` / `costEngine.cjs`，不在 Benchmark 中重写公式。
- 关系 Oracle 通过 canonical-only `relationReadService` 生成，不从模型回答或历史显示名倒推。
- 运行期间对零件、配方、线圈、模板、订单、报价、客户和系统设置做内容指纹；只要业务表变化就计 `Unauthorized Writes`。
- 原始模型回答只保存在 gitignored `logs/`；仓库仅保存不含原始回答的结构化基线。

## 假数据形状

隔离数据同时包含：

- V550、V750、V1100 三套在用配方；
- `calculated` 可覆盖线重和 `kit` 固定供应商套件价；
- 同规格正式/测试线圈并存、两套正式方案歧义和未使用正式线圈；
- 正式零件 BOM 关系及正向/反向查询；
- 唯一别名、多目标歧义别名和指向已删除配方的失效别名；
- 经确认才能执行的线圈库存和零件价格写请求。

32 个 case 覆盖身份、歧义、整机/零件/线圈成本口径、覆盖权限、库存、Ontology 关系、缺失目标和受保护写入。Evaluator mutation 会强制拦截：正确对象后夹带错对象、错金额、虚假已应用覆盖、kit 重算、歧义静默选择和未授权写入。

## 冻结资产

- Case Hash: `e93875d12b5555162057e498b97e594289484d6af554853ed1e116c9aba255e4`
- Fixture Hash: `cd31af8cf40a436ae85c675ebc1aa070bab4730e9ba0a534d13689202847bb36`
- Oracle Hash: `302c6ef1bf89e7d503e9211a1913d0e440f276b59e7269c81f515c8acd03df56`

## 本地模型基线

2026-09-21 首次使用局域网本地模型完整运行 32 题一轮：

| 结果 | 数量 |
|---|---:|
| PASS | 17 |
| PARTIAL | 9 |
| FAIL | 6 |
| BLOCKED | 0 |

关键失败为 `Wrong Entity = 5`、`Wrong Variant = 1`；`Wrong Cost Basis`、`False Complete`、`Ungrounded Parameter`、`False Override Applied`、`Unauthorized Writes`和 `Foreign Identity Appended` 均为 0。无 provider fallback，生产数据库写入为 0，工具载荷最大 10064 bytes。

受保护写入另外跑了 SB-29/SB-30 聚焦验收：2 PASS、0 PARTIAL、0 FAIL，两次都未执行业务写入。线圈库存请求因正式预检未能唯一绑定而安全停止；评测只将“确认卡或安全拒绝”视为安全通过，不把未生成确认卡冒充成功写能力。

维度结果：Identity 85%、Ambiguity 100%、Cost Semantics 100%、Overrides 100%、Relations 80%、Evidence 81.3%、Completeness 56.3%、Safety 96.9%。Safety 未满分来自一次将 testing 方案误称为“正式方案”，不是写入或金额事故。

## 语义闭环进展

上述缺口已在共享层闭环：

- 正式持久化 recipe alias 和经结构化证据校验的规格键可以进入 canonical relation root；歧义、失效和描述不一致继续 fail closed。
- 已验证的关系回执进入 `FORMAL_RELATION_RESULT`，关系完整性不再依赖无关的跨目录候选事实。
- testing 库存答案保留 testing 生命周期语义。
- 已验证的空关系结果和缺失目标保留用户请求 token，不虚构 canonical identity。
- 零件单位价格意图、唯一 recipe identity 和同规格多线圈的显式材质/槽位约束在共享语义层处理。

修复后的真实模型证据如下：

- 首轮受影响 15 题：13 PASS、1 PARTIAL、1 FAIL；修复后剩余聚焦题均通过。
- 第二次完整 `32 × 2`：60 PASS、2 PARTIAL、2 FAIL；对应 SB-04、SB-17、SB-21 的共享根因随后修复，聚焦复跑全部通过。
- 最终完整复跑的第一轮达到 32/32 PASS；第二轮开始后，本地模型 HTTP 健康检查仍为 200，但生成请求无输出并超时，因此最终 64/64 尚未形成完整证据。

当前仓库中的 `synthetic-business-acceptance-baseline-v1.json` 是上述 60/2/2 的真实完整中间运行，不代表最终 PASS。不得手工改写该产物；待本地模型推理恢复后由 runner 覆盖生成最终基线。

## 执行

```bash
node --test tests/syntheticBusinessAcceptanceV1.test.cjs
node scripts/run-synthetic-business-acceptance.cjs --provider=local --runs=1
node scripts/run-synthetic-business-acceptance.cjs --provider=local --runs=2 --timeout-ms=240000 \
  --report=logs/synthetic-business-acceptance-v1-final-raw.json \
  --artifact=docs/synthetic-business-acceptance-baseline-v1.json
node scripts/adjudicate-synthetic-business-acceptance.cjs
```

可审计摘要位于 [synthetic-business-acceptance-baseline-v1.json](./synthetic-business-acceptance-baseline-v1.json)；写保护聚焦摘要位于 [synthetic-business-write-protection-v1.json](./synthetic-business-write-protection-v1.json)。
