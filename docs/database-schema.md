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

当前版本为 `18`：

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

## 数据治理

- 铜价同步只更新铜价基数或计算成本发生变化的线圈，未变化记录不写库、不生成审计快照。
- `coils.stock` 保存线圈转子成品套数，`coil_stock_movements` 保存手工调整和订单采购入库流水；库存不得为负数。
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
