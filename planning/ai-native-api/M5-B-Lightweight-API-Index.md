# M5-B Lightweight API Index

## Scope

M5-B adds a deterministic discovery catalogue only. It is not imported by the
runtime, Main Agent, or Capability Broker, does not alter tool exposure, and
does not load or execute schemas. No model call, API call, or write is involved
in building the index.

## Authority

The builder joins the existing 80 generic and 4 private-assistant tool
definitions with the AI Capability Registry. Tool descriptions provide the
model-facing summary; registry metadata provides operation, domains, entity
scope, risk, data mode, and formal links. Formal links are verified against the
Business Capability Registry.

The only reviewed exposure policy is the four-item
`API_INDEX_V1_REVIEWED_COMPOSITES` exception list:

- `search_factory_knowledge`
- `get_factory_knowledge_detail`
- `get_order_detail`
- `get_recipe_detail`

This is an exposure exception, not a routing table and not a fabricated formal
link. The builder does not read `DOMAIN_TOOL_NAMES`; that legacy Broker profile
has no role in determining whether a tool exists or belongs in the index.

## Why this is neither the 153-capability registry nor all 84 tools

Formal capabilities are lower-level business contracts, not necessarily one
model-executable tool each. The full inventory retains all 84 executable AI
actions for audit. Model Index V1 exposes only non-write query/preview actions
with verified formal links, plus the four reviewed composites. This produces
31 entries: 27 formal-linked and 4 reviewed composites. The 29 protected write
actions and 24 deferred/unlinked read actions remain visible in the audit
inventory but cannot enter the model index.

All 12 A2 `EXPOSE_V1` actions are present. A2 deferred legacy calculators and
draft tools are not exposed: `preview_recipe_cost`, `full_calculate`,
`dynamic_config_cost`, `build_recipe_bom_draft`, and `preview_pump_shell_cost`.

## Model-facing contract

Each entry provides only the discovery information needed before a future schema
load:

- `toolName`, display name, `READ` or `PREVIEW`, and business domains
- a summary mechanically derived from the registered tool description
- direct required top-level fields and top-level alternative-required groups
- entity scope, data mode, risk, backing type, and formal link identity in the
  machine index

The rendered model text intentionally omits formal capability IDs, HTTP routes,
executor keys, sources of truth, table/SQL details, and nested JSON schema.
Nested override structures such as `scenarios[].overrides.packingParts` remain
for a future on-demand schema load.

## Core discovery and cost boundary

The V1 directory includes the required identity/discovery surface: formal
recipes, coils, parts, templates, customers, recent orders, recipe details,
technical profiles/files, coil specifications, and current copper price. It
also includes the formally backed cost tools:

- `compare_recipes` — two formal recipes, authoritative current cost delta.
- `explain_cost_change` — the same authoritative difference result with its
  cost-driver explanation.
- `compare_recipe_scenarios` — a no-save same-read-set scenario comparison.
- `calculate_coil_cost` — formal coil discovery plus coil cost preview.

Their registered descriptions differentiate comparison, explanation, scenario
preview, and coil preview. The deferred legacy calculators are deliberately not
present merely because they mention cost.

## Context size

The generated Model Index V1 is 6,198 characters, estimated at 1,550 tokens.
The complete JSON schemas for the same 31 tools are 23,628 characters,
estimated at 5,907 tokens. The lightweight directory therefore reduces initial
schema context by 73.77% while retaining tool names, purpose, operation, and
top-level input guidance.

## Phase C handoff

Phase C should use the selected `toolName` to resolve the existing canonical
tool definition and load its full parameter schema only then. It must revalidate
the selected tool against the registry/executor boundary and must not treat this
index as a router or executable schema. No Phase C loader is implemented here.

## Verification

The deterministic suite covers IDX-01 through IDX-20: inventory completeness,
closed classifications, zero write exposure, formal-link validity, exactly four
reviewed composites, A2 exposure/defer/exclude regression, private tools,
description and input-hint provenance, rendering leakage resistance, stable
ordering/fingerprint, duplicate prevention, and Phase-C definition resolution.

## Full gates

| Gate | Result |
| --- | --- |
| `npm test` | PASS — 2243/2243 |
| `npm run verify:api-contract` | PASS — 29/29 |
| `npm run test:deep-api` | PASS — 486/486 |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:ai-architecture` | PASS — 9/9 |
| `npm run verify:ai-assistant-release` | PASS |

## Recommendation

The lightweight index is ready for Supervisor review and provides an accurate,
small discovery layer for a later on-demand schema phase. It does not change
the production decision path.
