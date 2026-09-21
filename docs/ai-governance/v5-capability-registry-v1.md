# V5 Capability Registry V1

## Design principles

- `V5_CAPABILITY_REGISTRY_VERSION=1`; unknown versions are rejected.
- A capability is narrower than a business domain and may group multiple tools that serve one stable operation.
- Existing `AI_TOOLS` and the existing AI capability registry remain authoritative for tool schema, executor mapping, access class, and runtime behavior. V5 stores only policy-free grouping metadata and canonical tool names.
- Registry validation is deterministic and rejects duplicate capability IDs, stale tool references, duplicate tools inside one capability, malformed entity requirements, invalid risk/access classes, and detectable read/write mismatches.
- V5-B is shadow-only. Read capabilities may project bounded tool definitions; write capabilities are registered for inventory completeness but always have `exposableInV5B=false`.

## Contract

Each `V5Capability` contains:

```text
version
capabilityId
domain
operation
descriptionCode
readWriteClass
riskClass
requiredEntityTypes
allowedTools
futureRequiredEvidenceTypes
exposableInV5B
```

`requiredEntityTypes` is a minimal exact string reference. It is not an alias table, relationship graph, resolver, or full business ontology. `futureRequiredEvidenceTypes` is reserved metadata only; V5-B does not evaluate evidence.

## Capability list

| Capability | Domain / operation | Entity types | Class / risk | Allowed tools | V5-B exposable |
| --- | --- | --- | --- | --- | --- |
| `cost.calculate` | cost / calculate | cost_context | READ / L1 | `full_calculate`, `dynamic_config_cost` | yes |
| `coil.cost` | coil / cost | coil | READ / L1 | `get_copper_price`, `calculate_coil_cost` | yes |
| `coil.read` | coil / read | coil | READ / L1 | `get_coil_specs`, `search_coils` | yes |
| `coil.inventory.write` | coil / adjust_inventory | coil | WRITE / L4 | `adjust_coil_stock` | no |
| `inventory.read` | catalog / read_inventory | part | READ / L1 | `search_parts` | yes |
| `inventory.write` | catalog / adjust_inventory | part | WRITE / L4 | `adjust_part_stock` | no |
| `catalog.maintain` | catalog / maintain | part | WRITE / L3 | `create_part`, `batch_create_parts`, `update_part`, `delete_part`, `batch_update_prices` | no |
| `recipe.read` | recipe / read | recipe | READ / L1 | `get_all_recipes`, `get_recipe_detail` | yes |
| `recipe.files.read` | recipe / read_files | recipe | READ / L1 | `get_recipe_technical_files` | yes |
| `recipe.template.read` | recipe / read_template | template | READ / L1 | `search_templates`, `get_template_detail` | yes |
| `recipe.cost.preview` | recipe / preview_cost | recipe | READ / L1 | `build_recipe_bom_draft`, `preview_recipe_cost`, `preview_pump_shell_cost`, `compare_recipes` | yes |
| `recipe.maintain` | recipe / maintain | recipe | WRITE / L3 | `create_recipe`, `update_recipe`, `delete_recipe` | no |
| `quotation.read` | quotation / read | quotation | READ / L1 | `search_quotations`, `get_quotation_detail` | yes |
| `quotation.customer.read` | quotation / read_customer | customer | READ / L1 | `search_customers`, `search_customer_history` | yes |
| `quotation.file.inspect` | quotation / inspect_file | file | READ / L1 | `inspect_quotation_file` | yes |
| `quotation.draft` | quotation / build_draft | quotation | READ / L1 | `build_quotation_draft` | yes |
| `quotation.cost.explain` | quotation / explain_cost | quotation | READ / L1 | `explain_cost_change` | yes |
| `order.read` | order / read | order | READ / L1 | `get_recent_orders`, `get_order_detail` | yes |
| `order.draft` | order / build_draft | order | READ / L1 | `build_order_draft` | yes |
| `order.knowledge.read` | order / read_knowledge | order | READ / L1 | `get_order_knowledge_package` | yes |
| `order.maintain` | order / maintain | order | WRITE / L3 | `create_order`, `add_recipe_to_order`, `update_order_status`, `remove_recipe_from_order`, `update_order_item`, `delete_order` | no |
| `purchase.read` | order / read_purchase | purchase | READ / L1 | `get_purchase_overview` | yes |
| `purchase.generate` | order / generate_purchase | purchase | WRITE / L3 | `generate_purchase_list` | no |
| `quality.read` | quality / read | factory | READ / L1 | `get_data_quality_summary`, `get_factory_learning_health`, `get_factory_rule_candidates`, `get_factory_rule_impact`, `get_factory_rule_compliance`, `get_factory_rule_history` | yes |
| `quality.recipe.analyze` | quality / analyze_recipe | recipe | READ / L1 | `analyze_recipe_configuration` | yes |
| `quality.maintain` | quality / maintain | factory | WRITE / L3 | `set_recipe_analysis_feedback`, `restore_factory_rule_event`, `refresh_factory_rule_candidates`, `review_factory_rule_candidate` | no |
| `management.read` | management / read | global | READ / L1 | `get_management_action_center`, `get_business_alerts`, `get_dashboard_summary` | yes |
| `management.workflow.plan` | management / plan_workflow | workflow | READ / L1 | `plan_factory_workflow` | yes |
| `management.workflow.execute` | management / execute_workflow | workflow | WRITE / L4 | `execute_factory_workflow_step` | no |
| `order.readiness.read` | order / read_readiness | order | READ / L1 | `get_order_readiness_overview`, `check_order_readiness` | yes |
| `order.readiness.plan` | order / plan_readiness | order | READ / L1 | `plan_order_readiness_actions` | yes |
| `order.readiness.execute` | order / execute_readiness | order | WRITE / L3 | `execute_order_readiness_action` | no |
| `order.file.draft` | order / save_file_draft | order | WRITE / L3 | `save_order_requirement_draft`, `save_order_execution_draft` | no |
| `file.search` | file / search | file | READ / L1 | `search_factory_file_archive_targets` | yes |
| `file.archive` | file / archive | file | WRITE / L3 | `archive_factory_file` | no |
| `business_history.read` | business_history / read | business_record | READ / L1 | `search_business_changes` | yes |
| `knowledge.read` | knowledge / read | knowledge | READ / L1 | `search_factory_knowledge`, `get_factory_knowledge_detail`, `get_factory_knowledge_health` | yes |
| `knowledge.sync` | knowledge / sync | knowledge | WRITE / L3 | `sync_factory_knowledge` | no |
| `drawing.read` | drawing / read | drawing | READ / L1 | `get_rotor_drawing_history` | yes |
| `drawing.generate` | drawing / generate | drawing | WRITE / L3 | `generate_rotor_drawing` | no |
| `drawing.print` | drawing / print | drawing | WRITE / L4 | `print_rotor_drawing` | no |

## Tool inventory and sharing

- Existing tools: 77.
- Assigned tools: 77.
- Shared tools: 0. Sharing is not implicit; the reverse index would list every capability explicitly if sharing is later approved.
- Intentionally unassigned tools: 0. Therefore no unassigned reason is currently required. Any future unassigned entry must use exactly one of: `legacy`, `write-only future phase`, `unsafe`, `out-of-scope`, or `ambiguous`.
- Stale references: 0.
- Unknown canonical tools: 0.

The 29 write tools are assigned so drift is visible, but their capability objects are non-exposable in V5-B. Assignment does not authorize execution.

## Validation rules

`validateCapabilityRegistry(existingToolRegistry)` validates the registry against live `AI_TOOLS`. It never invokes a tool or imports an executor. `buildToolCapabilityReverseIndex()` is read-only and exists solely for registry audit and shadow evaluation. `auditToolInventory()` reports `assigned`, `shared`, `unassigned`, `stale`, and `unknown` deterministically.
