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
7. 表重建或数据回填前必须先生成 SQLite 一致性 `release` 备份并校验；备份元数据必须绑定 Git commit 和 Schema 版本。

## 当前版本

当前版本为 `58`：

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
| 29 | `management_action_lifecycle` | 保存管理事项当前生命周期及出现、消失、再次出现事件 |
| 30 | `factory_workflow_execution_history` | 保存 V8 工厂执行计划的尝试结果、错误、计划快照和复查结论 |
| 31 | `unified_factory_file_objects` | 建立 V9.1 统一原文件对象，回填知识资料和配方测试报告关联 |
| 32 | `runtime_system_settings` | 建立系统初始化运行配置表，普通参数与加密 API Key 独立于业务设置保存 |
| 33 | `factory_file_parsed_content` | 为统一文件保存 PDF 分页文本、结构化定位、解析错误和完成时间 |
| 34 | `factory_file_business_links` | 建立统一文件与客户、报价、配方、质量问题和知识资料的可追溯软删除关联 |
| 35 | `resolve_active_order_packaging_estimates` | 修复活动订单中可唯一映射到正式包装零件的历史估算项 |
| 36 | `order_factory_file_links` | 允许统一文件绑定订单，并以客户要求角色保存原始生产、包装和交付依据 |
| 37 | `order_requirement_summaries` | 保存订单客户要求的可编辑草稿、人工确认版本和各自来源文件 |
| 38 | `repair_order_requirement_summary_order_fk` | 修复第一版历史库升级时订单表重建造成的客户要求外键临时表指向 |
| 39 | `order_execution_records` | 保存订单生产前、生产中、生产后执行事实的时间线草稿、人工确认快照和依据文件 |
| 40 | `order_execution_evidence_file_role` | 为订单现场图片、质量记录和交付凭证增加独立 `execution_evidence` 文件关系角色 |
| 41 | `factory_ai_correction_rules` | 保存用户从 AI 回答反馈中明确确认的全局长期纠正规则 |
| 42 | `ai_feedback_regression_cases` | 将明确纠错转为可审核、可自动启停的确定性 AI 回归案例 |
| 43 | `api_command_operations` | 增加持久化业务命令回执，并为审计补齐 request、operation 和 capability 关联 |
| 44 | `allow_disabled_coil_scheme_status` | 将线圈方案状态约束与既有领域契约对齐，允许 `official/testing/disabled` |
| 45 | `accept_equivalent_cutting_evidence_wording` | 放宽切割泵壳证据回归中等价的不确定性表述 |
| 46 | `accept_clear_cutting_evidence_uncertainty` | 补充清晰的不确定性短语，避免安全回答被误判失败 |
| 47 | `restore_system_ai_evaluation_cases` | 恢复并校准 7 条内置系统 AI 发布回归用例；不修改用户反馈用例 |
| 48 | `data_aware_system_ai_evaluation_cases` | 测试报告前置数据不存在时核对安全的不可用说明，存在时继续执行严格内容和来源检查 |
| 49 | `formal_recipe_technical_file_ai_evaluation` | 测试报告类 AI 发布回归统一要求调用正式配方技术档案 API，不再依赖宽泛知识搜索 |
| 50 | `formal_coil_query_ai_evaluation` | 线圈方案 AI 发布回归统一要求调用正式实时线圈 Query API，不再把知识快照作为库存和成本事实 |
| 51 | `data_aware_formal_coil_ai_evaluation` | 目标线圈测试方案不存在时验收明确的不可用说明，存在时继续严格核对全部正式方案 |
| 52 | `accept_equivalent_complete_cable_phrasing` | 成品电缆回归接受“共同组成一条”“单一整体业务项”等等价正确表述，避免语义正确回答被固定措辞误判 |
| 53 | `accept_explicit_unconfirmed_cutting_evidence_phrasing` | 切割用途回归接受“系统未确认”这一明确不确定性表述，避免安全回答被固定措辞误判 |
| 54 | `disable_polluted_customer_count_feedback_regression` | 停用由污染客户数量反馈生成的“18个客户”回归，避免清理生产基础数据后被旧反馈用例反向阻断发布 |
| 55 | `accept_no_explicit_cutting_accessory_marking` | 切割用途回归接受“无明确标注”这一等价安全表述，避免正确说明无专用配件时被固定措辞误判 |
| 56 | `disable_non_core_system_ai_release_cases` | 停用客户报价展示和切割用途证据两条非核心系统 AI 发布回归，避免知识库/AI 抖动阻断基础业务部署 |
| 57 | `disable_system_ai_release_cases` | 停用全部系统 AI 发布回归；生产发布保留 API、测试、构建、启动备份和公网验收，知识问答回归不再作为硬门禁 |
| 58 | `quotation_attachment_summary_drafts` | 保存新建报价时由客户询价附件生成并经人工核对的摘要，以及最多 4 个来源文件引用；不改变正式报价字段 |

## 数据治理

- 铜价同步只更新铜价基数或计算成本发生变化的线圈，未变化记录不写库、不生成审计快照。
- `api_operations` 以 `actor_key + capability_id + idempotency_key` 唯一保存高风险命令请求哈希和成功回执，默认保留 90 天；幂等记录、业务变更、领域流水和强审计在同一 `BEGIN IMMEDIATE` 事务提交。相同键但请求哈希不同必须拒绝。
- `audit_log.request_id/operation_id/capability_id` 把一次 HTTP 请求、业务命令和各资源审计串联起来。未接入统一命令执行器的历史写入口仍使用尽力审计，不能宣称具备强审计回执。
- `coils.stock` 保存线圈转子成品套数，`coil_stock_movements` 保存手工调整和订单采购入库流水；库存不得为负数。
- `coils.scheme_status` 只允许 `official/testing/disabled`；`disabled` 表示停用历史方案，不删除库存追溯事实，也不参与正式方案选择。
- 线圈方案一旦库存大于 0 或产生过库存流水，规格俗称、定子直径、片数、材质和槽眼即冻结；后续只能调整价格、线重、绕组参数、状态等非身份字段。需要新身份时必须新建线圈方案，避免历史流水和订单引用被改名。
- `factory_ai_rules` 与一条 `ai_answer_feedback` 一一关联，只接收用户明确勾选的“内容错误”纠正；启用规则会进入派生知识，并按当前问题与业务领域相关性选择后加入 AI 系统上下文，停用后不再进入提示词或知识同步。规则不修改订单、库存、成本、配方等原始业务数据。
- `ai_evaluation_cases.source_feedback_id` 将一条明确纠错最多关联到一个回归案例。`review_status/confidence_score/generation_note/proposal_hash` 保存自动提取依据和审核状态；只有 `approved + enabled` 的案例进入无人值守检查。长期纠正规则停用时关联案例同步禁用，反馈和历史评测结果仍保留。
- 7 条 `source_type=system` 的内置 AI 发布回归用例属于代码版本化的发布基线。迁移 47 会在缺失时恢复，并校准为当前确定性规则；迁移 57 会统一停用系统 AI 回归，使知识问答评测不再作为生产部署硬门禁；`source_type=feedback` 的用户纠错案例不受影响。
- `NODE_ENV=test` 时 `api/db.cjs` 只打开 `PUMP_TEST_DATABASE_PATH` 指定的按进程临时 SQLite；`npm test` 自动创建并清理这些数据库。发布验证不会迁移或写入生产 `pump.db`，生产迁移只随 API 服务启动执行。
- `config.ai-factory-profile` 保存用户可编辑的工厂术语、偏好和操作习惯，最大 8000 字符；不可编辑核心规则和领域规则保存在代码中。历史 `config.ai-system-prompt` 首次迁移前备份为 `ai-system-prompt-legacy-backup`。
- `recipe_analysis_feedback.finding_snapshot_json.evidenceContext` 由服务端写入反馈时的配方、泵壳模板和时间，用于防止配方更换模板后旧证据错误转移；旧记录没有该字段时继续按当前模板兼容。
- `pump_shell_templates.shell_components_json` 的自由搭配计价项支持 `componentType=subassembly`。小套件父项仍绑定零件库“泵壳搭配”型号；一级 `subassemblyContents: [{ name, qty, referenceUnitPrice?, note? }]` 保存组成说明和可选非负参考单价。`referenceUnitPrice` 只用于页面查询、小计和差额比较，不建立子零件价格、正式成本或库存关系；旧记录缺少该字段时按“未填写”兼容，因此本功能不新增数据表或迁移。
- `factory_rule_candidates` 保留支持证据和审核状态，并记录 `support_count/special_case_count/ignored_count/confidence_score`；范围漂移证据保存在 `learning_evidence_json.drifted`，配方内容修改后的过期证据保存在 `learning_evidence_json.outdated`，两者都不计入支持数和置信度；`learning_hash` 与 `reviewed_learning_hash` 用于确定新证据出现后是否需要重新审核。
- `knowledge_embeddings` 是可重建的派生索引，使用 `entry_id + model` 唯一约束并通过外键级联删除；只有 `content_hash` 与当前 `knowledge_entries` 一致的向量才可参与检索。
- `knowledge_vector_sync_runs` 只记录派生向量任务结果，最多保留最近 200 次；记录失败不能反向破坏已生成向量。
- `management_action_lifecycles` 以稳定 `action_key` 保存首次出现、当前连续出现起点、消失时间和累计出现次数；状态只允许 `active/resolved`。
- `management_action_events` 追加保存 `appeared/resolved/reopened`，用于追溯事项反复发生；生命周期只记录检查结果变化，不替代原业务事实和人工处理记录。
- `factory_files` 按 SHA-256 唯一保存 PDF、Word、Excel、文本和图片原件；`parsed_text/parsed_json/parser_error/parsed_at` 保存 PDF 文字层与逐页定位、Word 正文及附属文字、Excel/CSV 的工作表/行列/单元格/公式/表格块，或图片与扫描 PDF 的 OCR 页码、文字框、置信度和只读技术参数候选，以及失败原因和完成时间。报价文件字段映射是从这些解析结果实时生成的只读草稿，不增加报价写入或复制一份解析表。`knowledge_documents.file_id` 与 `recipe_technical_files.file_id` 复用同一文件对象。AI 会话消息在 `metadata_json.attachments` 保存经过服务端校验的文件引用，聊天历史可继续预览和下载；被会话引用的文件不能直接删除。
- `factory_file_links` 保存文件与客户、报价、订单、配方、配方检查反馈、AI 回答反馈或知识资料的逻辑关联。订单客户原始资料使用 `customer_requirement`，现场图片、质量记录和交付凭证使用 `execution_evidence`。业务目标由归档服务按固定类型查询校验，不使用动态表名；同一有效文件、目标和关系角色唯一，解除关联使用 `deleted_at`，被有效关联的文件不能直接删除。归档到知识库时只创建或复用 `knowledge_documents` 引用，不复制 `file_blob`。
- `order_requirement_summaries` 对每张订单只保存一条当前记录。`draft_text/source_file_ids_json` 是可反复修改的工作草稿，`confirmed_text/confirmed_source_file_ids_json/confirmed_at` 是最后一次人工确认版本；知识同步只读取确认版本。确认后继续编辑草稿时，旧确认版本保持可检索，直到重新确认或明确撤销。
- `quotation_attachment_summaries` 对每张报价最多保存一条在新建报价表单中经人工核对的询价摘要。`source_file_ids_json` 只能引用本次报价保存的 `quotation_source` 附件且最多 4 个；摘要与报价、附件关联、持久化 operation 和强审计在 `quotations.create` 同一事务提交。建单后仅通过正式 Query 只读查看，不提供独立上传或编辑入口，也不自动进入知识库。
- `quotations.items_json` 的明细数量在报价阶段允许为 `null`；此时明细仍保存单位成本、出厂单价、BOM 和成本快照，但报价顶层 `total_cost/total_price` 同样为 `NULL`，表示总金额尚未形成而不是 0 元。客户确认后，最终数量在报价转订单预览和命令中提交并绑定预览哈希，不回写原报价的单价快照。
- `order_execution_records` 对同一订单保存多条时间线事实。当前 `phase/record_type/title/draft_text/occurred_at/source_file_ids_json` 与 `confirmed_*` 快照独立；知识同步只读取未删除且 `confirmed_text` 非空的记录。已确认记录必须先撤销确认才能软删除。
- `runtime_settings` 只保存系统初始化页白名单内的 AI 与知识检索运行参数，不参与工厂知识同步；API Key 通过 `JWT_SECRET` 派生密钥进行 AES-256-GCM 加密，接口不返回原文或密文。
- 文件上传必须在写库前完成大小、文件名、允许扩展名、真实内容签名和 UTF-8/Excel 结构检查；只有 `parser_status=parsed` 的 PDF 文字层或 OCR 文字可以进入 AI 上下文。OCR 无可靠文字时保存为 `metadata_only + ocrApplied=true`，不得推断原图参数。
- 审计日志默认保留 365 天；设置 `AUDIT_RETENTION_DAYS=0` 可禁用自动清理，其他值不得少于 30 天。
- 审计清理只在一次 SQLite 一致性备份成功后执行，确保被清理记录先进入备份。
- 数据库备份按 `daily/startup/release/safety` 分层保留；恢复前必须验证元数据、SHA-256、完整性、外键和核心表数量，并自动生成 safety 快照。
- 数据库迁移后的代码回滚必须恢复与目标 Git commit 绑定的数据库，禁止只回滚代码。
- `audit_log(created_at)`、`audit_log(table_name, record_id, created_at)` 和 `audit_log(operation_id)` 用于周期清理、资源追溯和命令追溯；`api_operations(expires_at/operation_id)` 用于回执清理与定位。

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
