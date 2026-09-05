# V5 Read-Only Execution Shadow V1

## Scope and activation

P16-A adds a separate, default-OFF execution boundary. Both `AI_V5_SHADOW_ENABLED` and `AI_V5_EXECUTION_SHADOW_ENABLED` must equal the literal string `true`. V4 remains authoritative; no V5 response is composed or sent. No deployment, default model change, Tool/schema change, or HTTP API change is included.

The existing bounded asynchronous shadow scheduler owns the task. Capacity remains occupied until actual work settles, including when the observer times out. Execution-capacity skips report `SHADOW_EXECUTION_SKIPPED_CAPACITY`. The execution timeout is at most 10 seconds, passes AbortSignal to the existing Executor and internal client, and never retries.

## Registry and predeclared applicability

All frozen 15 paths are business reads and remain applicable, including blocked binding paths. The reviewed registry is intentionally limited to these adapters, not all read Tools:

| Capability | Risk | Approved Tool | Binding | Existing formal read path |
|---|---|---|---|---|
| inventory.read | L1 / READ | search_parts | source-exact part mention → keyword | GET /api/parts → partQueries.listParts; canonical parts source |
| recipe.cost.preview | L1 / READ | preview_recipe_cost | canonical recipe ID → recipeId; no overrides | GET /api/recipes then GET /api/recipes/current-costs → costQueries.getCurrentRecipeCosts / costEngine |
| coil.read | L1 / READ | search_coils | authoritative schemeCode binding reference | GET /api/coils; canonical coils source |

The other exposed Tools have no approved P16-A adapter. In particular, spec-catalog retrieval is not an entity inventory lookup; BOM/parameter overrides/comparison are not inferred from a cost-preview intent. Registry intersection with the unchanged bounded exposure must contain exactly one entry. Zero is NOT_EXECUTABLE; multiple is TOOL_SELECTION_AMBIGUOUS. No model chooses Tools or generates arguments.

## Authority and typed arguments

The input is the V3-finalized authoritative entity plus the independently anchored source mention. A request-local resolution receipt references that completed V3 finalization; unresolved or incomplete interpretation cannot enter execution.

`recipeId` is a positive safe integer converted only from the authoritative canonical ID. No display-name fallback or overrides are added. `keyword` is an unchanged string from the exact source anchor, never a model-authored string. Existing schema validation must preserve the binder's argument object exactly. Optional fields are omitted, not invented. Zero/ambiguous entities, missing receipts, wrong types and unsupported identity fields fail closed.

The coil Tool accepts spec/schemeCode but not canonical ID. P16-A2 adds an optional software-owned binding reference from the formal coil row to the lookup candidate. The binder requires matching candidate/entity type and canonical ID, an approved match kind and exactly one valid schemeCode reference. Missing/invalid references remain unsupported: rawMention, names and canonical ID cannot substitute. The reference stays outside the unchanged Interpretation/Task V1 contract and both model inputs; it is supplied transiently to the execution adapter only.

## Read-only proof and policy

All three existing Tool metadata entries declare `access=read`, no confirmation, no audit mutation, and inherent idempotency. The reviewed Executor branches perform only formal GET queries for these bound arguments. They do not invoke workflow recording, proposal creation, stock mutation, or command executors. Recipe overrides are unavailable through the binder. All known WRITE_TOOLS are excluded by test.

Before execution, an independent lock rechecks existing formal Tool metadata, capability membership, READ classification, and L1/L2 risk consistency. Existing controlledRuntime, policy and state gates must allow the validated ToolRequest. The actual routed task then transitions through EXECUTING → COLLECTING_EVIDENCE → VERIFYING → legal terminal states. A write entry cannot acquire permission through a registry mistake or approval state. Executor is invoked with `allowWrite:false`; V5 never calls a Tool implementation directly or reads SQLite.

## Evidence and verification

Results remain transient. Existing formal execution evidence must be verified, nonempty, and GET-only. Existing three requirement definitions remain unchanged; no deferred requirements are fabricated. Part inventory evidence requires a complete result list containing exactly one row with the resolved canonical ID and finite numeric stock. Recipe cost evidence requires the resolved ID and finite current total without an explicit incomplete-pricing marker. These checks support only those narrow existing claims, not arbitrary answer correctness or an independent cost recomputation.

Existing EvidenceLedger and verification evaluate the claim; unsupported evidence terminates FAILED_EVIDENCE. A missing requirement is VERIFICATION_REQUIREMENT_DEFERRED, never VERIFIED. COMPLETED uses existing state transitions only; no Answer Composer or user-visible text is generated.

An optional evaluation-only in-memory comparator returns MATCH/MISMATCH/NOT_COMPARABLE. Part comparisons cover canonical identity/model/stock/price against formal query output; recipe comparisons cover canonical recipe identity/current total against the formal current-cost output. Comparison is separate from execution success. Not having a comparator never means MATCH.

Coil evidence requires exactly one returned row matching canonical ID and bound schemeCode, with finite current stock including zero. The same-snapshot comparator checks ID, schemeCode and stock against the formal API; missing reference is NOT_COMPARABLE, different identity/facts is MISMATCH. This supports current inventory only, not cost or complete DTO equivalence.

## Privacy and evaluation

Returned shadow metadata contains Tool name, argument keys/types, safe statuses, evidence count, state names, durations and call counts. Neither arguments, results, raw mentions, canonical IDs nor business DTOs are copied into shadow outcomes. Existing Executor TOOL spans retain metadata-only observability.

Formal evaluation is one-shot after deterministic checks and freeze. It uses unchanged frozen requests/expectations and real existing Executor/internal HTTP/routes against an isolated test snapshot with SQLite query_only enabled after normal test initialization. Source business DB and test snapshot are checked separately. Synthetic fixture checks are not represented as frozen evaluation results. Temporary diagnostic fixtures are retained; no delete-to-pass is allowed.

Performance certification measures synthetic V4 HTTP request arrival to server response finish, separately recording client receive and shadow completion. Interpreter output may be synthetic; execution must use the real independent shadow, controlled runtime, existing Executor, internal client and official routes on a query-only snapshot. Three rotated sets use five warmup batches and fifty measured batches per mode, with equal four-request overlap for D and its execution-OFF control. All valid sets count; scheduler timing/concurrency remain unchanged. This certifies the declared fixture workload, not arbitrary production saturation.
