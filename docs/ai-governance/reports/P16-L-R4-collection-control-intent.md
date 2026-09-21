# P16-L-R4 — Deterministic Collection Control Intent and Final Semantic Gap Closure

## 1. Executive result

**PASS for local/isolated certification. P16_L_PRODUCTION_READY=YES (ready for Supervisor deployment review, not deployed).** Branch master; start `9acf10c4bcd854705affa700670ab2aabe0dc135`. The complete P16-L/R2/R3/R4 Stage-owned work is closed as one selective commit. User-owned changes are excluded and preserved. P17 remains paused.

Focused L-02 and L-14: each3/3. Exact original semantic corpus:30/30 in each of3 fixed runs,90/90. The subsequent exact original full Answer UAT ran once:30/30, orders10/10 and customers/parts/recipes/coils5/5 each. No question changes, retries, post-evaluation prompt/validator changes or reruns occurred.

## 2. L-02 authority and control boundary

Root cause: a pure continuation control was unnecessarily sent through the risk model to rediscover the prior read's safety. R3 yielded UNKNOWN/WRITE/UNKNOWN despite active server read state.

R4 adds collectionControlPreRouter inside the existing authenticated Candidate gate and same-conversation lease, before risk classification. Closed grammar: optional 请; then 继续, 下一页, 再看后N条 or 剩下的呢; optional one terminal punctuation. N is1..99 and must equal the frozen page size. Surrounding whitespace is ignored. This is an anchored product control grammar, not similarity/substring matching or a business phrase classifier. The previously approved grammar is retained, not expanded.

Bypass requires a valid R1 conversation ID and the matching unexpired private server entry. setVerified obtains the page through the existing task/context-scoped evidence handle and checks list operation, resource, filter values, page size, boundary and deterministic sort before adding a private WeakSet receipt. Public snapshots are clones; ordinary set, forged handle, client boolean, token or mutated clone cannot grant certification. Ownership derives from the unchanged signed owner-subject/conversation namespace. The next execution still checks the actual token/query entry and hasMore. Only the page boundary advances.

Valid controls invoke risk0 and semantic model0, reusing the exact frozen query. No-state, expired, wrong conversation/principal and malformed state do not bypass: normal risk/fallback applies. Mixed continuation+mutation is not a control. Ordinal detail retains risk-first behavior and current-page binding. No generic risk bypass or authentication modification was introduced.

## 3. L-14 audit and generic repair

Before editing, one real diagnostic request reproduced COLLECTION_SEMANTIC_INVALID. In-memory output had valid JSON/exact keys, customers.detail, filter NONE, high confidence, no status/topN, and a correct complete detail source reference. It also supplied customerSpanRef. Both refs existed, but customerSpanRef is prohibited when filterClass=NONE. This exact field-role validation clause caused rejection; the detail identity itself was present and correct. No source-catalog expansion or new semantic was needed.

The existing model-slot contract now explicitly states that customerSpanRef is exclusively an orders customer-filter argument, never a customer detail identity. Every resource detail uses detailSpanRef and null customerSpanRef/status/topN. No L-14 sentence/example/identity was added. Strict parser behavior is unchanged: the original conflicting output still fails the deterministic test. No silent normalization discards an illegal field. Resources remain the same5; operations remain list/count/detail/continue/ordinal. Model Tools NONE; no new model stage, no retries.

## 4. Frozen semantic certification

Dataset: `docs/ai-governance/data/p16lr4-semantic-certification.json`.
Harness: `scripts/certify-p16lr4-semantics.cjs`.

Each semantic case uses fixed Oracle prerequisites; continuation state is formed using the real fixture service, existing evidence/verification and private promotion, not an unverified cursor. This is semantic isolation, distinct from the subsequently executed chained UAT. Only safe enums, booleans, counts, errors, timings and hashes are saved. Expected identity/filter values are compared transiently.

| Set | Correct |
|---|---:|
| Focused L-02 |3/3|
| Focused L-14 |3/3|
| Semantic repeat1 |30/30|
| Semantic repeat2 |30/30|
| Semantic repeat3 |30/30|
| Total semantic decisions |90/90|

All18 continuation decisions bypass both models. Main90 decisions use72 risk calls and69 collection model calls; ordinal skips only the collection model. Additional model stages0. Positive semantic pre/post hashes MATCH.

**Negative-classification caveat:** six real mutation/mixed negatives all fail closed, control bypass0, semantic calls0, Tool0, Answer0, unsafe admissions0. Five classify WRITE_OR_MUTATION; recipe modification classifies UNAVAILABLE_OR_UNKNOWN and is safely denied. The semantic audit runner's stricter `correct` predicate requires literal WRITE for every negative, so its top-level status remains REWORK (5/6 literal classification), preserved unchanged. R4's specified safety gate is zero admission/execution, which is6/6. Before full UAT, the new UAT harness explicitly checked90/90, frozen hashes, all negative denials, no control bypass and no semantic calls; it did not rerun or rewrite the negative evidence. No UNKNOWN-to-READ normalization was added.

## 5. Single full UAT and downstream contracts

Dataset: `docs/ai-governance/data/p16lr4-collection-certification.json`.
Harness: `scripts/certify-p16lr4-collections.cjs` imports the unchanged original case factory and has an existing-output guard. It runs actual configured risk/semantic models, actual read_collection Executor/internal HTTP, formal collection and governed lookup routes against the migrated in-memory fixture. No production DB or production endpoint is used.

Result30/30; correct canonical detail targets5/5 through governed lookup; ordinal detail1/1 through current page. The Oracle independently verifies exact row identities for every page/detail, all filter values and id_desc ordering in addition to operation/count/total. This strengthens the earlier harness's count-only target check without changing any question or expected business result. Normal continuation5/5 and filtered continuation1/1 succeed; the filtered sequence retains query/filter/sort/page size and proves the complete stable-fixture row sequence without duplicates/skips. Filter reclassification0. Orders initial list, top-N, count, filtered list, empty list and direct/ordinal detail pass. Minimal projections, evidence and grounded deterministic answer contracts PASS. Technical parameter leakage0. Read Tool calls30; Answer model calls0. Pre/post hashes MATCH.

## 6. Deterministic regressions

- Focused collection/R2/R3/R4 suites:16/16 PASS. Includes verified/unverified/forged handle, expired/mismatched namespace, token/query tampering, mutation-bearing continuation, frozen-filter clone tampering, wrong page size, direct target ambiguity/incompleteness/wrong type, actual fixture HTTP detail5/5, count and pagination, ordinal and10-conversation isolation.
- Full deterministic regression:2268/2269. Sole failure is the existing missing `.guardian/config.yaml` naming-contract test. No change to Guardian was made.
- Existing narrow-read price/inventory/coil/recipe/Exact Entity/coil span/owner identity/shared-admin/fallback suites PASS in that run. This is deterministic non-regression, not a new production or frozen real narrow-read evaluation.
- API contract:26/26 PASS. Build PASS.
- Deep API: one isolated run stops on the existing copperBase failure signature. No retry or unrelated repair. It operates on a temporary copy; legacy fixture mutation coverage is not V5 execution. No new R4-specific failure was established by this stopped suite.
- Production diff scan finds0 full non-control UAT sentences. Approved anchored continuation/ordinal control vocabulary is intentionally retained.

## 7. Performance and observability

| Metric | Median ms |
|---|---:|
| Semantic router, valid90 decisions including deterministic controls |640.060|
| Collection API/Executor round trip |2.093|
| Non-continuation list |1544.564|
| Continuation |6.047|
| Detail, including ordinal |1482.329|

Maximum certified result2847 bytes; global cap262144 unchanged. These are isolated descriptive measurements, not production latency promises. Both formal datasets use existing metadata-only tracing with an in-memory capture adapter: orphan0, cross-request0, exact raw-question attribute matches0. No live Phoenix/production telemetry audit is claimed. Runtime rows/answers, credentials and model content are not persisted. No answer body or runtime business rows are logged/traced by certification. The deterministic composer makes no model/API calls.

## 8. Safety, ownership and stop

V5 Writes0; allowWrite enabling0; Business Mutation Calls From V50; Candidate DB Mutation Successes0. Production Candidate/frontend/gateway updatedNO; Legacy restartedNO; production business data modifiedNO. No production access/deployment was performed in R4. There is no claimed whole-production DB hash measurement.

Retained prior Stage infrastructure includes bounded backend, schemas/registry/Tool, governed detail, continuation transport, evidence/answer, tests and safe historical reports. Shared docs are selectively staged: only collection changes, excluding the pre-existing user terminal-negative-evidence prose. All pre-existing user runtime/resolver/evaluation/prompt/package/test files and untracked analysis/output remain unstaged and preserved. No failed intermediate Stage commits are created. No push or deployment is part of this closure.

Residual limitation: new business intents still depend on one risk model and one strict semantic model. UNKNOWN safely falls back; finite90/90 evidence is not a guarantee for every natural-language question. Collections promise a separate read transaction per page, not a historical snapshot across changing production data. Supported detail/filter/projection scope remains bounded to P16-L.

STOP — WAIT FOR SUPERVISOR REVIEW. Do not deploy, begin P16-M or resume P17.
