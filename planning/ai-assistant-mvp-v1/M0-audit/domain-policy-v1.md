# Domain Policy V1 — 水泵工厂 AI 语义规则

## Status and boundary

Status: planning draft for MVP. This file is the canonical human-readable location for company-specific interpretation rules until M1 creates the runtime-loaded `api/services/ai-assistant/domain-policy.md`. It informs Judge/Main Agent reasoning; Business APIs remain the source of truth and enforcement point.

This policy must **not** contain BOM or cost formulas, SQL, database constraints, transaction rules, inventory algorithms, authentication, write authorization, numeric validation, Tool schemas, or hard security rules already enforced in code.

### RULE-01

**TITLE:** Temporary recipe parameter preview versus persistent recipe mutation
**STATUS:** ACTIVE
**APPLIES WHEN:** A request changes a recipe-like parameter such as `cableLength`, coil, packing, float, sale price, or quantity.
**RULE:** Interpret the whole objective and context. A temporary override sent to a formal Preview API recalculates a scenario only and does not alter the official stored recipe. A request to change the official, stored business state is a persistent mutation. Do not decide from the isolated verbs “改” or “换”.
**POSITIVE EXAMPLES:** “V550 电缆改成 5 米，卖 340 元，毛利多少？先不要保存。” is scenario preview; “把 V550 正式配方的电缆改为 5 米并保存” is a persistent mutation.
**NEGATIVE / CONTRAST EXAMPLES:** Do not treat “先不要保存” as an official recipe change; do not treat an explicit “正式配方…保存” as a preview.
**FORMAL SOURCE / AUTHORITY:** Scenario cost/profit APIs and `costEngine` for preview; protected recipe command API for mutation.
**OWNER CONFIRMATION STATUS:** Preview does not require confirmation; persistent mutation requires protected Owner confirmation.

### RULE-02

**TITLE:** Persistent writes require explicit protected execution
**STATUS:** ACTIVE
**APPLIES WHEN:** The user asks to create, update, delete, adjust inventory, or otherwise persist a business change.
**RULE:** Reasoning, a chat answer, and a prepared proposal do not authorize a write. The action is performed only after the Owner approves the frozen proposal through protected execution.
**POSITIVE EXAMPLES:** A prepared part-stock proposal waits for Owner confirmation; a declined/expired/revised proposal is not executable.
**NEGATIVE / CONTRAST EXAMPLES:** “我已经帮你改好了” must never be said after planning or preview only.
**FORMAL SOURCE / AUTHORITY:** `aiToolConfirmation`, `aiConfirmedToolExecution`, native W1 protected write API, business command receipt/audit.
**OWNER CONFIRMATION STATUS:** Required.

### RULE-03

**TITLE:** Entity mention is not database identity
**STATUS:** ACTIVE
**APPLIES WHEN:** The message mentions an identifier or familiar name such as `V550`, `12-120`, or `轴承-202`.
**RULE:** Treat the mention as a candidate only. Formal identity must come from a formal catalogue/API/Ontology resolution result; ambiguous or absent matches require a bounded clarification or a formal negative result.
**POSITIVE EXAMPLES:** Resolve V550 to one active recipe before a recipe-specific read; resolve a part model before stock adjustment.
**NEGATIVE / CONTRAST EXAMPLES:** Do not invent an ID; do not choose the first partial match.
**FORMAL SOURCE / AUTHORITY:** Entity lookup, catalog/recipe/coil APIs, ontology identity and relation authority.
**OWNER CONFIRMATION STATUS:** Not applicable for reads; does not replace write confirmation.

### RULE-04

**TITLE:** A common coil designation can represent multiple schemes
**STATUS:** ACTIVE
**APPLIES WHEN:** A query names a coil/common designation such as `12-120`.
**RULE:** A common designation can have several formal coil schemes. For scheme-specific stock or cost, do not choose the first scheme. Do not sum inventories across schemes unless the Owner asks for an aggregate and a formal aggregate capability supplies it.
**POSITIVE EXAMPLES:** Present bounded scheme choices for multiple official 12-120 schemes; report one selected scheme’s stock/cost with its scheme basis.
**NEGATIVE / CONTRAST EXAMPLES:** Never silently merge steel/small-hole and cold-rolled/national-standard schemes.
**FORMAL SOURCE / AUTHORITY:** `search_coils`, `calculate_coil_cost`, coil catalogue and `coilVariantAmbiguity`.
**OWNER CONFIRMATION STATUS:** Not applicable.

### RULE-05

**TITLE:** Money basis must remain explicit
**STATUS:** ACTIVE
**APPLIES WHEN:** An answer returns cost, profit, price, quotation, purchase, or other monetary information.
**RULE:** Label material basis: current official/current rebuilt cost, temporary scenario cost, historical quotation, or hypothetical selling-price profit. Never label scenario money as current official cost.
**POSITIVE EXAMPLES:** “按电缆 5 米的临时试算成本…”; “当前正式报价中的单价…”.
**NEGATIVE / CONTRAST EXAMPLES:** Do not present a saved historical quotation as today’s cost.
**FORMAL SOURCE / AUTHORITY:** `costEngine`, formal cost/preview APIs, and persisted quotation/order fields.
**OWNER CONFIRMATION STATUS:** Not applicable.

### RULE-06

**TITLE:** Inventory basis must remain explicit
**STATUS:** ACTIVE
**APPLIES WHEN:** The answer concerns stock or production readiness.
**RULE:** Stock-on-hand, available-after-reservations, and virtual-readiness are distinct meanings. State the formal basis used, especially where active order reservations affect the answer.
**POSITIVE EXAMPLES:** A virtual 300-unit readiness preview says it deducts active-order reservations; a coil catalogue stock answer describes the selected scheme’s on-hand stock.
**NEGATIVE / CONTRAST EXAMPLES:** Do not call on-hand inventory “够生产” without a formal readiness preview.
**FORMAL SOURCE / AUTHORITY:** Coil/part catalogue APIs, `virtualReadinessPreview`, `orderPlanning`.
**OWNER CONFIRMATION STATUS:** Not applicable.

### RULE-07

**TITLE:** Recipe technical authority
**STATUS:** ACTIVE
**APPLIES WHEN:** The Owner asks a technical-profile question about a recipe.
**RULE:** Use the established canonical technical-profile authority. Missing canonical technical facts must not be filled from retired legacy technical fields or defaults.
**POSITIVE EXAMPLES:** Report canonical technical-profile fields returned by the formal profile API.
**NEGATIVE / CONTRAST EXAMPLES:** Do not infer winding or rotor data from a similarly named template or legacy projection.
**FORMAL SOURCE / AUTHORITY:** `recipes.technical_profile.get`, canonical recipe technical profile and its formal API.
**OWNER CONFIRMATION STATUS:** Not applicable.

### RULE-08

**TITLE:** Read broadly, write strictly
**STATUS:** ACTIVE
**APPLIES WHEN:** The Main Agent considers any business capability.
**RULE:** Formally safe READ and PREVIEW capabilities may be investigated freely within the turn budget. Persistent writes and external side effects stay on their protected, confirmed paths.
**POSITIVE EXAMPLES:** Combine current-cost and coil-stock reads for a multi-goal question; prepare but do not execute an allowed stock adjustment.
**NEGATIVE / CONTRAST EXAMPLES:** Do not reconstruct a narrow GoalKind-to-tool allowlist; do not expose write tools as ordinary Main Agent calls.
**FORMAL SOURCE / AUTHORITY:** Capability registry, executor access classification, protected write API.
**OWNER CONFIRMATION STATUS:** Required for persistent write/external side effect.
