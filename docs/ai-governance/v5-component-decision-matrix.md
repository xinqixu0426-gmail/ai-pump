# Pump AI V5 Component Decision Matrix

Status: P07 design-only decisions. `ADD` means a thin V5 control-plane component or projection, not a replacement business platform.

| Component | Current State | P06 Evidence | Decision | V5 Role | Migration Phase | Risk |
|---|---|---|---|---|---|---|
| Business API | Formal authority for business reads/writes | No Business API execution failure was a primary class | KEEP | Sole business truth/execution boundary | All | Low; contract adapters must preserve semantics |
| SQLite business storage | Authoritative local persistence/audit backing | DB hash/size/mtime unchanged through P06 | KEEP | Unchanged business storage | All | Low; V5 must not duplicate facts |
| `internalApiClient` | Carries formal API calls and operation/capability headers | Operation receipts exist on some paths; no client root failure | KEEP | Existing executor-to-API adapter | V5-A/D | Medium; preserve errors and IDs |
| Tool definitions | Provider-visible schemas for existing capabilities | Tool eventually selected correctly 14/15, but exposure/routing drifted | REFACTOR | Reuse schemas behind capability-scoped exposure | V5-B/C | Medium; schema compatibility |
| AI tool registry | Large existing tool catalog and write allowlist | Routing only 50%; complete catalog is too broad per task | REFACTOR | Source for compiled V5 capability projection | V5-B | High; duplicate metadata drift |
| Business capability registry | Maps tool to formal capabilities, access, risk, provenance | Existing metadata enabled route/evidence checks | REFACTOR | Authoritative input to one typed projection | V5-B | Medium; registry consistency |
| Executors | Map registered tools to current services/APIs | No `T01` primary failure in P06 | KEEP | Executed through a typed compatibility adapter | V5-A/D | Medium; result/error equivalence |
| AI Dispatcher | Thin current Agent wrapper and runtime entry | One entry but name/version no longer reflects embedded V4 | REFACTOR | Version selector, trace root, strangler switch | V5-A/E | Medium; SSE/async context |
| AI Agent Runtime | Monolithic shared V3 shell with planning, tools, V4 gates, verification, synthesis | C02/R02/A01 cross-cut the same loop | REPLACE | Small controlled runtime with explicit boundaries | V5-A-D | High; incremental only |
| Legacy V3 path | Model-led tool loop and compatibility path | Mixed pass/fail; 3/5 focused cases passed | DEPRECATE | Control/rollback path until V5 promotion | V5-E/F | High if removed early |
| V4 Investigation path | Feature-gated controller inside V3 runtime | Routing drift and budget exhaustion; mixed results | REPLACE | Fact/state concepts merged into V5 runtime | V5-B-D | High; preserve useful reducers |
| V4+R3 path | V4 investigation plus claim-grounded composition | Preserved exact identity yet continued routing | REPLACE | Claim checks merged into V5 evidence/answer stages | V5-D | High; answer equivalence |
| Capability Broker V4 | Selects/authorizes read capabilities from open requirements | Independent routing accuracy 50% | REFACTOR | Deterministic capability eligibility/router core | V5-B | High; must bound exposure |
| Entity Resolver V3 | Formal discovery, exact/fuzzy resolution, receipt | Exact resolver matched what it received; no E03 primary failure | KEEP | Formal resolver behind identity contract | V5-C | Medium; do not make it repair upstream loss |
| Normalization | Exact/fuzzy probe helpers plus other argument normalization | Structural identity loss was observable before resolver in two paths | REFACTOR | One versioned, non-destructive derived value | V5-C | High; punctuation/alias compatibility |
| Tool argument handling | Parse, normalize, ground, resolve, prepare across several helpers | A01 2/8; raw identity arrived altered | REPLACE | Staged typed validation pipeline | V5-A/C | High; prevent silent coercion |
| Verification | Multiple execution/evidence/claim/synthesis checks | V01/V03 often downstream; premature count 0 | REFACTOR | Four deterministic decisions plus narrow semantic judge | V5-D | High; avoid false completion/failure |
| `failed_unverified` | Overloaded compatibility status/reply | Appeared downstream; not a universal root cause | DEPRECATE | Projection of typed failure states during migration | V5-D/F | Medium; response compatibility |
| Write confirmation | Token-bound proposal and confirmation route | P06 read-only safety held; no write attempted | KEEP | Approval mechanism for L3/L4 boundary | V5-F | High security impact if altered |
| `allowWrite` | Runtime/executor write gate | Shadow enforces false; DB unchanged | KEEP | Defense-in-depth input to policy gate | V5-F | High; never infer from model |
| Write tool allowlist | Explicit write-capability control | Current shadow rejects write exposure | KEEP | Compiled with V5 risk/access policy | V5-B/F | High; fail closed |
| Audit / operation receipts | Business execution evidence | IDs available on relevant write/API paths; gaps on reads | KEEP | Evidence/operation references, no trace dependency | V5-D/F | Medium; do not fabricate IDs |
| V3 observation/evidence ledger | Per-task observations and active records | Supported P06 structural diagnosis | REFACTOR | Seed for typed Evidence Ledger | V5-D | Medium; minimize copied payloads |
| V4 fact model/reducer | Goal, requirement, budget, binding, state reduction | Useful structure, but C02 shows incomplete transition ownership | REFACTOR | Inputs/patterns for single state machine | V5-A/D | High; avoid dual state truth |
| V4 claim grounding | Claims and evidence validation before answer | Helped distinguish supported/unsupported output | REFACTOR | Answer-support validation stage | V5-D | Medium; deterministic first |
| Business ontology/entity model | Implicit across DB, tools, graph, resolver descriptors | Cross-domain ambiguity and identity ownership are dispersed | ADD | Thin entity/relation/identity contract over formal APIs | V5-A/C | Medium; avoid new source of truth |
| V5 capability registry projection | Not present as one compiled typed view | R02 and route escape need task-scoped exposure | ADD | Domain/operation/tool/entity/evidence/risk mapping | V5-B | High; must derive from existing assets |
| V5 task state machine | State spread across loops/controller/reducer | C02 is 3/8 primary failures | ADD | Sole legal-transition authority | V5-A/D | High; correctness core |
| V5 typed contracts | No end-to-end request/result/error contract | A01 proves stage ownership ambiguity | ADD | Boundary between model, resolver, executor, evidence | V5-A/C | High; adapter compatibility |
| V5 policy layer | Confirmation/allowWrite/risk exist but are distributed | Read-only safety passed; needs unified levels for promotion | ADD | L0-L5 deterministic risk gate | V5-A/F | High; security boundary |
| Oracle | Formal expected claims/trajectory inputs | Enabled deterministic first-divergence classification | KEEP | Permanent expected-outcome authority | All | Low; fixture quality matters |
| Real AI Shadow | Isolated Legacy/V4I/V4R3 comparison | Produced 15 comparable real paths safely | KEEP | Required V5 observe/shadow/compare gate | V5-B-E | Medium; provider variance/cost |
| Guardian | Release governance and known baseline gate | Only known regression is missing config | KEEP | Final release gate after each phase | All | Medium; prerequisite currently absent |
| Failure dataset | P06 15-path machine-readable seed | Contains all C02/R02/A01 representatives | KEEP | Permanent append-only regression corpus | All | Low; corpus must expand |
| OpenTelemetry | Fail-open span transport/context | All P06 traces structurally valid | KEEP | Runtime-neutral trace substrate | All | Low if fail-open retained |
| OpenInference | Agent/LLM/Tool/Chain semantics | Trace schema V1 locked | KEEP | Semantic conventions only | All | Low; version contract |
| Phoenix | Self-hosted trace/eval evidence store | 199 P06 spans, 15 valid traces, zero privacy leakage | KEEP | Diagnostics, datasets, experiments; never control plane | All | Medium availability/privacy |
| Trace Contract V1 | Locked metadata-only structural contract | P06 validity/privacy both passed | KEEP | Compatibility baseline; V2 only by separate review | All | Low; schema evolution discipline |
| Answer composer | Legacy synthesis plus optional V4 grounded composer | Correct evidence can still fail terminal/synthesis path | REFACTOR | Compose only from verified answer plan | V5-D | Medium; user-facing equivalence |
| Provider wrapper/model calls | DeepSeek-compatible provider and tracing wrapper | Model variance observed; no provider transport root failure | KEEP | Uncertainty interpreter/composer behind contracts | All | Medium; nondeterminism |
