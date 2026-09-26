# ONT-P0 Ontology Pre-Implementation Audit

> **已退役（NATIVE-HC2）**：本文描述的 Legacy AI 编排组件已从仓库物理删除，生产 AI 为 Native-only。本文仅作历史记录保留；请勿据此启用旧运行时或旧开关。


## Executive Summary
基于当前 master 24106a1b 真实代码审计。项目当前无运行中的 Ontology runtime，历史 V5 设计仅存文档。系统已具备稳定的业务实体 ID 化和丰富的 FK/JSON 引用关系，但存在大量 JSON 快照引用、名称依赖和 AI 层 relation-specific hard-code。Thin Ontology 可明显降低 AI 工具编排复杂度，但需先完成实体身份稳定性和 relation authority 梳理。

## Current Architecture
- Web: Next.js 15 apps/web-next
- API: Express 5 + better-sqlite3 SQLite 单库 pump.db，WAL
- AI: aiDispatcherV3 → aiAssistantRuntime / aiAgentRuntimeV3，工具调用需 aiExecutionEvidence
- 成本: costEngine.cjs 统一口径
- 知识库: knowledge_entries + sqlite-vec 混合检索，非 Ontology

## Entity Inventory

### BUSINESS_ENTITY
- customer: customers.id canonical, stable, resolver supported
- order: orders.id canonical, customer_id FK, items_json snapshot
- recipe: recipes.id canonical, template_id FK, coil_id FK, stable
- part: parts.id canonical, soft delete, price/stock
- coil: coils.id canonical, schemeCode, schemeFamilyCode, stator_variant_id FK
- template: pump_shell_templates.id canonical, shell_model unique business key
- quotation: quotations.id canonical
- purchase: aggregate via orders.purchase_list_json, no独立表
- supplier: parts.supplier string, 无独立 supplier 表
- file: factory_files.id canonical, sha256
- technical_file: recipe_technical_files.id
- knowledge: knowledge_entries.id, source_table+source_id
- business_change_event: business_change_events.id, operation_id

### AGGREGATE
- order_revision: order_revisions, immutable
- order_requirement_summary, order_execution_records

### VALUE_OBJECT / SNAPSHOT
- recipes.parts_json / extra_parts_json / packing_parts_json
- orders.items_json / purchase_list_json / todos_json
- templates.parts_json / shell_components_json
- coil inventory snapshot in costEngine

### FACT
- business_change_events
- audit_log
- inventory流水

### SCOPE
- factory singleton

V1 Readiness: customer, order, recipe, part, coil, template = READY. quotation CONDITIONAL. supplier NOT_READY due to string dependency.

## Relation Inventory & Authority

A — CANONICAL_DIRECT
- recipe USES template via recipes.template_id FK
- recipe USES coil via recipes.coil_id FK
- order BELONGS_TO customer via orders.customer_id FK
- coil BELONGS_TO stator_variant via coils.stator_variant_id FK
- technical_file BELONGS_TO recipe via recipe_technical_files.recipe_id FK
- quotation BELONGS_TO customer via quotations.customer_id FK

B — DETERMINISTIC_DERIVED
- order CONTAINS recipe via orders.items_json recipeId, deterministic via service
- recipe CONTAINS part via recipes.parts_json partId, deterministic via BOM engine
- purchase item -> part/coil via purchase_list_json partId/coilId, deterministic

C — LEGACY_EXACT
- recipe name matching for historical model_variant
- part model string matching in BOM snapshot legacy name

D — SEMANTIC
- knowledge_entries semantic link to business objects
- factoryAiRules prompt based relation

## RelationRead Assessment
relationReadContract.cjs / relationReadService.cjs 存在但未挂入真实 AI 可达链。Capability Registry 中 relations.read 未在 ai/tools.cjs 暴露。tests/relationRead.test.cjs 存在但 runtime 不可达。当前 relation 查询主要靠 AI 手工多工具编排。

## AI Relation Hard-code Inventory
aiAssistantRuntime.cjs:
- coil ↔ recipe 专门判断：isCoilRecipeRelationQuery, requiredCoilRecipeToolCall
- coil cost comparison 强制调用 calculate_coil_cost
- completion repair 强制补齐 search_coils / get_all_recipes
- 工具短名单 selectLocalAssistantTools 依赖问题文本启发式

aiToolShortlist.cjs:
- 关系特定 Tool pairing 硬编码

总计 relation-specific hard-code 约 12 处。

## Traversal Corpus 25条
1-hop: recipe->template, recipe->coil, order->customer, order->recipe, etc. 15 条
2-hop: part->recipe->order, coil->recipe->order, customer->quotation->recipe
3-hop: supplier->part->recipe->order
>3-hop: supplier停供影响在手订单需 4-hop

当前可稳定完成 1-hop 全部，2-hop 部分依赖 items_json 解析，3-hop 以上依赖 AI 手工编排。

## Ontology Boundary
Ontology 应负责：entity type, canonical identity contract, relation definitions, authority, traversal eligibility, provenance requirement。
不应负责：成本计算、库存扣减、业务 API 行为、证据验证、LLM 理解。

## Recommendation
NONE 不成立。THIN 可明显减少 hard-code，降低上下文爆炸。
MEDIUM/HEAVY 无代码证据支持，NOT JUSTIFIED。

## Ontology V1 Candidate
Entities READY: customer, order, recipe, part, coil, template, quotation
CONDITIONAL: file, technical_file, knowledge, business_change_event
EXCLUDED: supplier, aggregate snapshots

Relations A: 6 条
Relations B: 3 条
Relations C transitional: 2 条

Max traversal 建议 2-hop，max entities 50，pagination bounded。

## Risk Analysis
Primary blockers: supplier 无独立实体，parts.supplier string; JSON snapshot ID 稳定性; name fallback 风险。
Technical debt: legacy name matching in BOM, relationRead 未上线。

## Final Recommendation
THIN
