# M5 D2-A — Coverage and Structured Producer Entry Audit

## Scope and frozen baseline

This is a read-only planning audit at commit `220251cb326567135d0fc3182d547b7f2b3752b8`. The D1 product baseline remains `f68dbaf024f3f424d7052da88d0009f6b7dd8043`. No product, test, harness, schema, API, cost-engine, runtime, or write-flow file was changed. No model run, production canary, formal business-DB read, or deployment was performed.

The audit traced each candidate producer through: formal Business API → executor → AI tool definition/API Index → agent adapter → Fact Ledger → Claimable Fact Catalog → Answer Validator. The detailed machine-readable results are in the four companion JSON artifacts.

## Current formal surface

| Surface | Observed count |
| --- | ---: |
| Executor actions / AI capabilities / tool definitions | 84 |
| Formal Business capabilities | 153 |
| Formal Business query + preview capabilities | 52 |
| Formal Business write capabilities | 101 |
| Current API Index discoverable capabilities | 31 |
| Deferred/private/non-discoverable AI capabilities | 53 |
| Discoverable read/preview AI capabilities | 55 |
| Write-protected AI capabilities | 29 |

The API Index remains deliberately small: its 31 discoverable entries cover catalogue, recipes, coils, parts, templates, orders, purchasing, quotations, customers, files/knowledge, current-cost/comparison/scenario previews, virtual readiness, and profitability. The other 53 are either write-protected or deferred private read/preview paths. D2 should preserve on-demand discovery rather than preload the whole formal surface.

## What is already Native-ready

D1 has made the following high-value read/preview producers reliable and claimable:

- Recipe detail current cost: `get_recipe_detail.currentCost.currentTotalCost` is projected only when formally cost-complete, as `CURRENT_FORMAL`.
- Directional recipe comparison: participants, direction, and the formal delta are represented by `RECIPE_DIFFERENCE`.
- Recipe scenario preview: current/base, candidate, and delta remain distinct for float, cable, packing, surface treatment, and Rotor Process.
- Coil directory cost: each formal coil record keeps its own identity and eligible formal cost; unit/kit parameters are not promoted as full cost.
- Formal coil calculation: calculated `totalCost` remains a structured, bound monetary fact.

Those producers provide the stable foundation for Owner questions about recipe/coil identity, current cost, comparisons, and temporary configuration previews.

## Owner-task coverage

The new Owner-style corpus contains 43 tasks, sourced from the current Business Understanding, formal capability registry, database business structure, and existing Owner question style—not invented ERP functionality.

| Classification | Tasks |
| --- | ---: |
| `SUPPORTED` | 15 |
| `PARTIAL` | 19 |
| `UNSUPPORTED` | 4 |
| `DATA_LIMITATION` | 2 |
| `WRITE_OUT_OF_SCOPE` | 3 |

The corpus spans cost (7), coil (4), recipe (6), catalogue (2), template (2), inventory (3), order (4), procurement (3), quotation (3), customer (1), file (2), knowledge (1), business history (1), and cross-domain investigation (4). `PARTIAL` means the formal read/preview exists but cannot yet be delivered reliably as a complete, structured Owner answer; it is not evidence that the business capability itself is absent.

## Structured producer gaps and exact breaks

### P0 — shortages, order readiness, and procurement linkage

The highest-leverage D2 entry is a reusable structured shortage relation:

- `preview_virtual_readiness` already returns a formal preview but lacks canonical per-shortage part binding, required/available/shortage quantity, unit, completeness, and readiness-basis facts.
- `check_order_readiness` exists and is discoverable, but its order-line and shortage relations are not Claimable Catalog facts.
- `get_order_detail` is identity-protected and formally available, but order/customer/recipe-line collections and collection-completeness evidence are generic fields.
- `get_purchase_overview` exists, but purchase rows lack reliable canonical part/supplier bindings and structured status/quantity relations.

This wave should project formal results only; it must not duplicate allocation arithmetic, infer missing quantities, or expose write paths. It unlocks Owner questions such as “这个订单缺什么？” and “缺的东西有没有采购？” while remaining read/preview-only.

### P1 — commercial and explanation producers

- `preview_profitability` is already discoverable and formal but needs bounded gross-profit/margin/cost-basis/scenario facts plus validator support for those predicates.
- Customer history and quotation list/detail reads need complete collection receipts and safe relations to customer/order/quotation records. Quotation identity must be reviewed before introducing a resolver.
- Template detail needs canonical component and template-to-shell/recipe relationship facts.
- Cost-change/explanation results should be reviewed for formal causal/relation facts rather than surfaced as generic text or scalars.

These are formally useful but require more semantic policy than P0; they follow only after the shortage relation is sound.

### P2 — deferred or specialty producers

- `preview_recipe_cost` is a real formal producer but is `DEFERRED_UNLINKED`. Its `pricingComplete=false` contract must remain incomplete/unknown—not zero—before deciding whether exposure is non-redundant with scenario comparison.
- `build_recipe_bom_draft` and `preview_pump_shell_cost` are deferred and should be exposed only if each has a distinct Owner-facing question with a structured output contract.
- Technical-file and quotation-file inspection require safe file metadata, collection completeness, parser-status, and formal-error projections; unbound extracted text must not become formal evidence.
- Dashboard, quality, management, and private maintenance paths are not candidates for indiscriminate exposure.

## Historical candidate disposition

| Candidate | Audit result |
| --- | --- |
| `preview_recipe_cost(pricingComplete=false)` | Formal producer exists, but is deferred and lacks a complete/incomplete Claimable Fact contract. Do not treat incomplete pricing as zero. |
| `preview_virtual_readiness(unresolvedRequirements)` | Partially resolved: the API/tool exists and is discoverable; structured unresolved/shortage rows remain a P0 evidence gap. |
| Order shortage | Formal reads exist; missing structured order/line/shortage projection is P0. |
| Procurement shortage | Formal overview exists; missing canonical purchase-to-part/supplier linkage is P0. |

## Cross-domain findings

The formal capability graph can already investigate recipe cost and previews, but it cannot yet reliably close multi-domain Owner questions because relation and completeness evidence is weak outside D1 money scenarios. Examples:

- “这个配方现在成本多少，库存能做几台？”: current cost is ready; virtual-readiness capacity/shortages need P0 structured projection.
- “这个订单缺什么？缺的东西有没有采购？”: order readiness and purchase overview exist, but the shortage-to-procurement relationship is not structured.
- “这个客户最近有哪些报价和订单？”: customer identity is available, but quotation/order collections lack complete, claimable relationship evidence.
- “这个型号成本最近为什么变了？”: comparison is ready; formal change-history/explanation relation semantics are still partial.

No fixed tool chain, router, slots, or Legacy fallback is recommended. The Native agent should remain free to investigate through API Index discovery and `load_tools`; D2 should improve the formal evidence it receives.

## D2 roadmap

### Wave 1 — Readiness, shortage, and procurement evidence

Project formal readiness/order/purchase results into bounded, canonical identity and quantity relations with collection completeness/error receipts. Scope is Fact Ledger, Claimable Catalog, and validator semantics for the new formal predicates; no write exposure. Gate: formal shortage rows and purchase linkage answer the defined Owner questions without inferred arithmetic, silently selected entities, or missing-data-as-zero behavior.

### Wave 2 — Commercial, template, and profitability answers

Add formal structured projections for profitability, quotations, customer history, template details, and cost-change explanations. Gate: every monetary/commercial fact preserves a basis and entity/collection binding; quotation identity is deliberately safe before any resolver is introduced.

### Wave 3 — Deferred specialty producers

Evaluate non-redundant recipe-cost/BOM/shell previews, file inspection, quality, and management summaries one producer at a time. Gate: each newly discoverable capability maps to a distinct Owner task, has structured formal outputs and error semantics, and stays read/preview-only unless a separately approved write proposal is made.

## Recommendation

Proceed with **D2 Wave 1**. It offers the largest Owner-coverage gain from already existing formal data while requiring no new business API, DB schema, cost formula, fixed workflow, or write capability. After Wave 1 technical freeze, add its mature Owner tasks to the next consolidated Owner-acceptance window rather than starting ad hoc manual acceptance now.
