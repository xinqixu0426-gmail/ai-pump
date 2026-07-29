# 数据库 Schema 与迁移

## 权威来源

- 最终表结构：`api/database/schema.cjs`
- 版本化迁移：`api/database/migrations.cjs`
- 运行数据库：项目根目录 `pump.db`

`api/db.cjs` 只负责打开数据库、设置 WAL/外键并调用 `runMigrations(db)`，不再散落执行 `ALTER TABLE`。

## 迁移规则

1. 每个迁移使用单调递增的整数版本号。
2. 已在任何环境应用的迁移不得修改；新变化必须追加新版本。
3. 每个迁移在独立的 `BEGIN IMMEDIATE` 事务内执行。
4. `schema_migrations` 保存版本、名称、校验和和应用时间。
5. 已应用迁移的名称或校验和与代码不一致时，应用拒绝启动。
6. `PRAGMA user_version` 与当前最高迁移版本保持一致。
7. 表重建或数据回填前必须先生成 SQLite 一致性备份并校验。

## 当前版本

当前版本为 `28`：

| 版本 | 名称 | 作用 |
|---|---|---|
| 1 | `canonical_tables_and_legacy_columns` | 创建最终表结构，为第一版数据库补齐历史新增列 |
| 2 | `legacy_data_backfills` | 回填包装、长螺丝、订单状态和线圈领域数据 |
| 3 | `canonicalize_orders_and_coils` | 统一订单默认状态并为历史线圈表补齐外键 |
| 4 | `canonical_indexes_and_fts` | 创建权威索引和知识库 FTS |
| 5 | `core_constraints_and_foreign_keys` | 重建核心表，补齐业务外键、状态/枚举 CHECK 和非负数约束 |
| 6 | `repair_packaging_snapshot_semantics` | 修正历史包装材料及角色，并用原快照单价重建成本明细 |
| 7 | `operational_and_audit_indexes` | 增加活动数据、关系字段和审计日志查询索引 |
| 8 | `recipe_analysis_feedback` | 保存配方智能检查的人工处理反馈 |
| 9 | `factory_rule_candidates` | 保存候选、批准和拒绝的工厂规则 |
| 10 | `ai_answer_feedback` | 保存 AI 回答反馈 |
| 11 | `ai_answer_feedback_diagnosis_retest` | 增加回答诊断和复测字段 |
| 12 | `ai_knowledge_regression_suite` | 增加知识库回归用例和运行结果 |
| 13-17 | 知识回归规则修订 | 修订测试报告、线圈和成品电缆的回归语义 |
| 18 | `add_coil_inventory_ledger` | 为正式线圈方案增加成品库存，并建立可追溯库存流水 |
| 19 | `factory_rule_learning_evidence` | 为候选规则增加确认、特殊情况、忽略、置信度、证据指纹和复核状态 |
| 20 | `factory_rule_lifecycle_events` | 保存工厂规则候选、审核、失效和恢复的不可覆盖生命周期事件 |
| 21 | `knowledge_sync_run_history` | 保存知识同步模式、结果、变更统计、耗时和错误原因 |
| 22 | `knowledge_external_documents` | 保存独立工厂资料、解析状态、提取文本和可选原文件 |
| 23 | `knowledge_vector_storage` | 保存按知识条目和 embedding 模型唯一的本地向量、维度及内容哈希 |
| 24 | `knowledge_vector_sync_history` | 保存向量同步模型、维度、增删改跳过失败统计、待处理数量和耗时 |
| 25 | `cutting_shell_evidence_regression` | 增加切割用途必须采用明确来源的 AI 回归案例 |
| 26 | `strengthen_cutting_shell_regression` | 补充切割泵壳、长螺丝和刀片业务语义约束 |
| 27 | `accept_equivalent_regression_phrasing` | 允许等价安全表述并保持错误结论禁用词 |
| 28 | `align_cutting_regression_with_rule_authority` | 将切割用途回归来源对齐到正式业务规则知识 |

## 数据治理

- 铜价同步只更新铜价基数或计算成本发生变化的线圈，未变化记录不写库、不生成审计快照。
- `coils.stock` 保存线圈转子成品套数，`coil_stock_movements` 保存手工调整和订单采购入库流水；库存不得为负数。
- `recipe_analysis_feedback.finding_snapshot_json.evidenceContext` 由服务端写入反馈时的配方、泵壳模板和时间，用于防止配方更换模板后旧证据错误转移；旧记录没有该字段时继续按当前模板兼容。
- `factory_rule_candidates` 保留支持证据和审核状态，并记录 `support_count/special_case_count/ignored_count/confidence_score`；范围漂移证据保存在 `learning_evidence_json.drifted`，配方内容修改后的过期证据保存在 `learning_evidence_json.outdated`，两者都不计入支持数和置信度；`learning_hash` 与 `reviewed_learning_hash` 用于确定新证据出现后是否需要重新审核。
- `knowledge_embeddings` 是可重建的派生索引，使用 `entry_id + model` 唯一约束并通过外键级联删除；只有 `content_hash` 与当前 `knowledge_entries` 一致的向量才可参与检索。
- `knowledge_vector_sync_runs` 只记录派生向量任务结果，最多保留最近 200 次；记录失败不能反向破坏已生成向量。
- 审计日志默认保留 365 天；设置 `AUDIT_RETENTION_DAYS=0` 可禁用自动清理，其他值不得少于 30 天。
- 审计清理只在一次 SQLite 一致性备份成功后执行，确保被清理记录先进入备份。
- `audit_log(created_at)` 和 `audit_log(table_name, record_id, created_at)` 用于周期清理和记录追溯。

## 验收

`tests/databaseMigrations.test.cjs` 必须验证：

- 空库可以从版本 0 初始化到当前版本；
- 重复执行迁移没有副作用；
- 第一版历史库升级后的列、默认值、外键、CHECK 和索引与空库一致；
- 数据回填结果正确；
- 迁移校验和被修改时拒绝继续运行；
- `integrity_check` 和 `foreign_key_check` 通过。

发布前仍需执行：

```powershell
npm test
npm run build
```
