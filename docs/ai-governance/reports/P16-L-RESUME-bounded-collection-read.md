# P16-L-RESUME — Bounded Collection Read

## 1. Supervisor result

**REWORK. P16_M_READY=NO. P17 remains paused.**

Start/end HEAD: `9acf10c4bcd854705affa700670ab2aabe0dc135`, branch master. No Stage commit, no push, no deployment. User-owned dirty work is preserved. New work remains uncommitted and must not be deployed as a certified artifact.

The fixed30-question real-model isolated-fixture UAT passed20 and failed10. The exact mandatory initial orders request and its first continuation passed; direct detail and some contextual requests did not. No prompt/contract/runtime changes or UAT retries were made after that run. Pre/post implementation freeze hashes match.

## 2. Implemented local boundary

`POST /api/collections/read` is a registered read Query, with Candidate-only `read_collection`, formal schema, existing Executor/internalApiClient and static bounded Business API SQL. No V5 DB access. All five resources have list/count/detail projections. Defaults20/max50, id-desc keyset, SQL LIMIT pageSize+1, formal COUNT in the same read transaction. The existing256KiB cap is unchanged. Orders active filtering follows the existing exclude-closed/cancelled business definition; exact status and customer-name filters are typed. No free-form SQL or whole-list fetch/truncate.

Continuation is server-only, random-query/token-bound, scoped to the R1 owner/conversation namespace. TTL600000ms, maximum128 active contexts. Per-conversation lease rejects overlap; cross-conversation requests are independent. Current-page ordinal detail uses server-held canonical IDs. New unrelated queries invalidate old state. Values and state are memory-only. API receipt query IDs and the continuation query handle remain internal.

Collection evidence is a minimal `collection.result` DIRECT_FACT addition to the existing requirements/ledger/verification, with projection/query/count/sort/boundary validation and an unforgeable verified runtime handle. The deterministic collection answer renderer has no model, tools or extra investigation. It displays approved rows/counts/detail and continuation text, not raw DTOs/IDs/cursors. This only verifies the selected query result; it does not independently prove that a model-selected text slice is the user's intended full identity. That limitation is material in this run.

The separate collection capability is excluded from frozen entity Task Class generation. All41 existing capability definitions were compared against the starting commit and are identical. The four narrow fact contracts, entity algorithms, existing read execution/comparator, and narrow answer composer were not changed. Candidate-only Tool admission prevents expansion into Legacy/MCP execution; MCP retains48 read tools.

## 3. Fixed natural-language UAT

Authority: migrated in-memory fixture with63 records per resource, fixed questions and expected query outcomes in `scripts/certify-v5-collections.cjs`. Real current DeepSeek risk/semantic calls; actual existing Executor, internal HTTP client and new formal API. No production corpus or business DB was used. No answer model is required by the deterministic renderer. Exactly one fixed30-question run; retries0. Dataset: [safe certification](../data/p16l-resume-collection-certification.json).

| Family | Questions | PASS | FAIL |
|---|---:|---:|---:|
| orders |10|7|3|
| customers |5|2|3|
| parts |5|4|1|
| recipes |5|4|1|
| coils |5|3|2|
| Total |30|20|10|

L-01: exact mandatory initial orders request PASS;20 rows, authoritative count correct, hasMore true, no technical-limit refusal, no oversized-result failure. L-02: ordinary continuation PASS. L-03: current-page ordinal detail PASS. Orders top-N, count, active first page and closed-status first page also passed. This is fixture acceptance, **not production UAT**.

### Failure evidence (not hidden by safe API validation)

- L-07/L-12/L-13/L-28: `RISK_NOT_ELIGIBLE`, no Tool execution. These include filtered continuation, customer continuation/count and coil count. The exact rejected model field was not retained; do not guess which confidence/context/clarification field caused rejection.
- L-08/L-14/L-19/L-24/L-29: direct detail ran one read and delivered a validated empty result, while the fixed fixture target existed. All five failed the independent Oracle. These are **false-negative user answers**, not successful detail coverage. A separate model-free diagnostic using each exact fixture identity returned one row for all five resources. Backend exact-detail capability therefore exists; the semantic source/target-binding boundary is not certified. Raw selected slices/model outputs were intentionally not persisted, so exact offset errors are not reconstructed or asserted as fact.
- L-09: `COLLECTION_INTENT_INVALID`, no Tool execution, failed the exact-customer empty-result case.

No changes were made after these results to force a pass. Future rework needs to establish reliable collection admission and complete source-identity binding, rather than accepting query-contract validity as proof of question correctness. No new stage is authorized here.

## 4. Deterministic and repository verification

- Focused collection service/runtime tests:6/6 PASS. Includes real Executor/API chain, list→continue→ordinal, authoritative counts, strict args, task/evidence isolation, malformed token/query mismatch, wrong principal/conversation, TTL, bounded projection, empty result,10 concurrent fixture conversations and write-risk rejection.
- Combined focused R1/risk/collection tests:14/14 PASS.
- Frozen V5 capability/evidence/projection/semantic/JSON suites:73/73 PASS. Exact hash pins were updated only for the approved additive collection registry; historical evaluation artifacts were not rewritten. Existing capability equality was separately checked against HEAD.
- API contract gate:26/26 PASS.
- Full deterministic suite:2258/2259 PASS; sole failure is existing `.guardian/config.yaml` ENOENT. No newly failing deterministic test remains.
- `npm run build`:PASS.
- Deep API:FAIL at external `get_copper_price` / `fetch failed`, the same failure recorded in R1. No fix or retry was attempted for that dependency. This is not a claim that the entire Deep API suite passed.
- Existing narrow-read deterministic coverage passes, but real narrow-read interception under the new collection semantic model and post-deployment UAT were **not certified** after the collection UAT failed.

## 5. Performance and payload

Isolated fixture measurements, not production latency:

- API/Executor internal round-trip median:2.073ms (includes wrapper overhead).
- Successful non-continuation list-request median:1586.016ms (12 samples).
- Successfully admitted continuation median:1437.564ms (4 samples); the two rejected continuation requests are not included in this success-only metric.
- All detail-request completion median:1562.186ms (6 samples); includes the five incorrect empty results, so this is not a successful-detail latency certificate.
- Maximum certified response:2847 bytes, below the existing262144-byte cap.
- Formal fixture read Tool calls:25; no handoff access triggers extra Tool calls. The remaining five questions were rejected before execution.

These medians are recomputed from the unchanged per-case measurements using the average of the middle two observations for even sample sizes and fixed case roles. The dataset runner's convenience `metrics` used an upper observation for even samples and classified rejected continuations as non-continuation; those convenience summaries are not used as performance certification. No timing sample or UAT result was removed or rerun.

## 6. Production preservation

No Candidate/gateway/frontend deployment was attempted because local UAT failed. Mac mini read-only health/config inspection confirmed:

- Legacy PID59155, ready=true; not restarted.
- Candidate ready=true; existing R1 artifact remains `/Users/dan/pump-p16lr1-transport/source`.
- Gateway still uses the R1 source artifact; owner-default remains true.
- Web PID77817; unchanged by this Stage.

No production business query UAT, mutation, credentials change, database repair, backup or restart was performed. Production Candidate DB mutation successes caused by this Stage=0. The Stage did not change production business data. There was no before-stage continuous DB hash baseline, so no unsupported whole-turn hash-invariance claim is made.

## 7. Privacy and observability

The UAT suppresses generic logger output and persists only case IDs, result classes, counts, booleans, timing, byte sizes and code hashes. Model prompts/responses, answer bodies, runtime rows, identities and credentials are not saved. The dataset contains no actual business data; synthetic fixture setup is isolated. Production health inspection used the existing internal service secret in memory; no owner password or JWT was used or printed.

The10-conversation controlled test and store isolation tests passed; wrong principal/conversation/token/query is rejected. Formal Phoenix trace-integrity certification was not performed; do not promote an unmeasured orphan count to a production PASS. P16-M remains blocked independently by the20/30 UAT result.

Safety: V5 Writes=0; allowWrite enabling calls=0; Business Mutation Calls From V5=0; production business data modified=NO; P17 paused=YES.

## 8. Uncommitted ownership handoff

Stage-owned new files: `collectionReadContract.cjs`, `collectionReadService.cjs`, `routes/collectionRead.cjs`; V5 `collectionContinuation.cjs`, `collectionIntent.cjs`, `collectionEvidence.cjs`, `collectionAnswer.cjs`, `collectionReadRuntime.cjs`; `scripts/certify-v5-collections.cjs`; collection tests/helper; this report, collection contract document and safe certification dataset.

Stage edits to previously clean files: `api.cjs`, capability registry, Tool schema/executor/query executor, Candidate read entry, V5 capability registry/evidence requirements, risk-envelope collection context, Candidate gateway/entry, AI capability catalog exclusion, focused contract/regression tests.

Shared documentation files `docs/README.md` and `docs/api-reference.md` retain pre-existing user hunks plus Stage additions. All other pre-existing user changes—including aiAgentRuntimeV3, aiEntityResolverV3, aiEvaluations, aiPromptComposer, package.json, user tests/docs and untracked analysis/output files—were preserved. Nothing was staged or committed. A future stage must selectively preserve both ownership sets.

STOP — WAIT FOR SUPERVISOR REVIEW. Do not deploy this artifact, begin P16-M or resume P17.
