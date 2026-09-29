# MVP Tool Inventory

Audit basis: runtime enumeration of `listAiCapabilities()` at `bc9f7ed`: 84 tools = 38 QUERY, 17 PREVIEW, and 29 COMMAND/write. The formal business capability registry has 145 entries. `api/routes/ai/executor.cjs` validates args, resolves registry metadata, calls executors only through `internalApiClient`, and attaches formal API evidence.

For MVP the Main Agent receives broadly usable safe **READ** and **PREVIEW** tools; it does not receive ordinary write tools. “Usable” below means no Business API change is needed. Existing legacy JSON schemas are callable, but most should receive light M1 cleanup (strict `additionalProperties`, crisp descriptions, and explicit identity/basis notes) before broad direct LLM exposure. The four `AI_NATIVE_TOOLS_V2` schemas (`get_recipe_technical_profile`, `compare_recipe_scenarios`, `preview_profitability`, `preview_virtual_readiness`) are already strict direct-call schemas, but their Task V2-only prompt coupling must be removed.

## READ — MVP Agent exposure

All rows are `READ`; API-backed results are formal business facts where stated. `Q` means formal query, `P` means formal preview; “cleanup” is light schema/description work only.

| Tool(s) | Purpose / underlying authority | Formal money or business facts | MVP / direct-call status |
| --- | --- | --- | --- |
| `get_all_recipes`, `get_recipe_detail`, `get_recipes_by_coil`, `get_recipes_by_part`, `get_recipe_parts` | Recipe catalogue/detail and Ontology relation APIs | Recipe identity, BOM/relations; detail can include persisted fields | Include; cleanup identity wording |
| `search_templates`, `get_template_detail`, `get_recipe_technical_profile`, `get_recipe_technical_files` | Template APIs; canonical technical-profile API/files | Canonical technical facts, not inferred legacy fields | Include; technical-profile schema already strict |
| `search_coils`, `get_coil_specs`, `calculate_coil_cost` | Coil catalogue and `/api/coils/calculate` | Scheme-specific stock and deterministic coil cost | Include; require scheme disambiguation |
| `search_parts` | Parts catalogue | Current price/stock | Include; cleanup bounded filtering |
| `get_copper_price` | Daily market snapshot API | Formal copper-price snapshot with `asOf`/stale basis | Include; cleanup basis description |
| `full_calculate`, `dynamic_config_cost`, `preview_recipe_cost`, `preview_pump_shell_cost`, `build_recipe_bom_draft` | `costEngine`/formal cost and BOM preview APIs | Deterministic costs/BOM; must label current versus scenario | Include; normalize overlapping legacy cost schemas |
| `compare_recipe_scenarios`, `compare_recipes`, `explain_cost_change`, `preview_profitability` | Scenario comparison, formal recipe comparison, profitability preview | Current rebuilt/scenario cost, difference, profit | Include; schemas are direct-call ready or need light description cleanup |
| `preview_virtual_readiness` | Formal virtual-readiness API / active-order reservation logic | Readiness, shortages, available-after-reservations; no write | Include; direct-call schema strict |
| `search_quotations`, `get_quotation_detail`, `build_quotation_draft` | Quotation list/detail/draft APIs | Historical quotation money/basis | Include; distinguish historical quotation from current cost |
| `search_customers`, `search_customer_history` | Customer catalogue/history APIs | Customer identity and historical order/quotation facts | Include; require formal identity |
| `get_recent_orders`, `get_order_detail`, `get_purchase_overview`, `build_order_draft`, `get_order_knowledge_package` | Order/purchase formal APIs | Order/purchase quantities and persisted formal money where returned | Include; cleanup date/status filters |
| `get_order_readiness_overview`, `check_order_readiness`, `plan_order_readiness_actions`, `get_management_action_center`, `get_dashboard_summary`, `get_business_alerts`, `plan_factory_workflow` | Management/order-planning services | Formal operational facts; plan tools are non-mutating previews | Include; label preview versus current state |
| `search_business_changes` | `business_changes.list` | Audited historical business-change facts | Include; history is not current-state proof |
| `search_factory_knowledge`, `get_factory_knowledge_detail`, `get_factory_knowledge_health`, `search_factory_file_archive_targets` | Knowledge/file indexes | Supporting knowledge/document facts, not replacement for formal current data | Include as supporting reads; do not make monetary authority |
| `get_data_quality_summary`, `analyze_recipe_configuration`, `get_factory_learning_health`, `get_factory_rule_candidates`, `get_factory_rule_impact`, `get_factory_rule_compliance`, `get_factory_rule_history` | Quality/rule services | Quality/rule facts, not formal cost authority | Defer from core acceptance but safe optional reads; cleanup descriptions |
| `get_rotor_drawing_history` | Drawing history API | Historical drawing-job facts | Optional safe read; cleanup required |
| `inspect_quotation_file` | File parser preview | Extracted file content only | Optional preview; never override formal quotation data |

## PREVIEW classification

The 17 registry `operation=preview` tools are: `plan_factory_workflow`, `plan_order_readiness_actions`, `analyze_recipe_configuration`, `build_order_draft`, `inspect_quotation_file`, `build_quotation_draft`, `preview_recipe_cost`, `explain_cost_change`, `build_recipe_bom_draft`, `compare_recipe_scenarios`, `preview_profitability`, `preview_virtual_readiness`, `preview_pump_shell_cost`, `compare_recipes`, `full_calculate`, `dynamic_config_cost`, and `calculate_coil_cost`. They are all non-persistent in current executor metadata and fit MVP READ/ANALYZE exposure subject to the basis and entity rules in Domain Policy.

## Persistent write — protected path only

None of these is an ordinary Main-Agent tool in MVP. All currently enter `requiresConfirmation`, and the executor checks formal command evidence. Underlying formal capability is shown after `->`.

| Tool(s) | Business purpose | Current protected status / MVP decision |
| --- | --- | --- |
| `adjust_part_stock` -> `inventory.parts.batch_adjust_stock` | Part inventory delta | **Current Native W1 supported capability**; formal preflight, Owner token, idempotency, audit/readback; reuse after extracting neutral safety pieces |
| `adjust_coil_stock` -> `inventory.coils.adjust_stock` | Coil inventory adjustment | Existing confirmation executor; not MVP write scope |
| `create_part`, `batch_create_parts`, `update_part`, `delete_part`, `batch_update_prices` -> `parts.*` | Part catalogue changes | Existing protected confirmation; not MVP write scope |
| `create_recipe`, `update_recipe`, `delete_recipe` -> `recipes.*` | Recipe persistent changes | Existing confirmation/preflights for update/delete; not MVP write scope |
| `create_order`, `update_order_status`, `add_recipe_to_order`, `remove_recipe_from_order`, `update_order_item`, `delete_order`, `generate_purchase_list` -> `orders.*` | Order and purchasing changes | Existing protected executor; not MVP write scope |
| `save_order_requirement_draft`, `save_order_execution_draft` -> `orders.requirements/execution_records.*` | Persist order records | Existing protected executor; not MVP write scope |
| `execute_order_readiness_action`, `execute_factory_workflow_step` -> workflow/order operations | Business workflow execution | Protected; no broad Agent exposure |
| `archive_factory_file` -> `files.archive` | File archival/association | Protected; no broad Agent exposure |
| `sync_factory_knowledge`, quality-rule feedback/review tools -> `knowledge.*`, `quality.*` | Derived knowledge/rule state changes | Protected; out of MVP write scope |

## External side effect

`generate_rotor_drawing` -> `drawings.rotor.generate_pdf` and `print_rotor_drawing` -> `drawings.rotor.print_pdf` are registered writes with external/device effect. They are excluded from MVP Agent exposure and require their existing protected confirmation/operation state.

## Denied internal

The Main Agent must not call direct SQLite, `safeUpdate`, generic internal HTTP, task lifecycle/store/recovery, confirmation-token internals, provider configuration, migration/restore, maintenance, or internal-only registry capabilities such as `catalog.reference_audit`, `entities.lookup_batch`, `entities.coil_span_candidates`, `relations.read`, `collections.read`, and `ontology.relations.resolve` without a purpose-built safe Tool wrapper. These are implementation/support capabilities, not Owner-facing business tools.

## Monetary authority audit

| Capability family | Formal amount source | Result rule |
| --- | --- | --- |
| Current recipe cost / recipe comparison / full estimate / dynamic configuration / pump-shell cost | `costEngine` through formal cost APIs | Deterministic amount; label current rebuilt versus scenario/compatibility basis |
| Scenario cost and profitability | `recipes.scenario_compare_preview` and `cost.profitability_preview` | Deterministic same-read-set scenario amount; never present as stored current cost |
| Coil cost | `/api/coils/calculate` / formal coil record | Deterministic selected-scheme amount; multi-scheme selection is required |
| Copper price | persisted market snapshot API | Formal market snapshot, with as-of/staleness |
| Quotation/order/purchase figures | persisted formal quotation/order/purchase API fields | Historical/persisted basis; not recalculated by the model |
| Virtual readiness | formal inventory/order planning service | Quantity conclusion, not model arithmetic; active reservations remain explicit |

No audited executor asks the model to calculate a formal business amount. The current deterministic task answer renderer may format a result but its supported monetary facts are sourced from verified formal API receipts. `MODEL_CALCULATED_FORMAL_AMOUNT_FOUND: NO`.

## Tool-schema blockers

No blocker prevents MVP planning: the executor and 84 registered JSON function definitions exist. M1 must (1) remove Task V2-specific input/prompt coupling from the four native-only tools, (2) make legacy schemas uniformly strict and concise, and (3) expose only this safe READ/PREVIEW subset to the Main Agent. These are light cleanup tasks, not Business API changes.
