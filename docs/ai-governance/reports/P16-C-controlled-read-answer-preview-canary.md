# P16-C Controlled Read Answer Preview Canary

Status: PASS. P16_D_READY=YES for Supervisor review only.

## Identity

- Start Commit: `53f630e6d6da79ced4541c3791160c5566db3b4f`
- End Commit: the single `feat: add controlled v5 read answer preview canary` commit containing this report; exact SHA is in the Supervisor return.
- Branch: master
- Worktree Clean At Start: NO
- User-Owned Dirty Changes Preserved: YES. All 24 actual pre-existing files under 19 status entries were hashed; removing only the new API-reference paragraph reproduces that file's original bytes.
- Previous blocked attempt made no implementation/commit. Supervisor explicitly approved the missing post-validation runtime body handoff; this report replaces that Stage-owned blocker report.

## Canary architecture and delivery

Global flag: `AI_V5_READ_CANARY_ENABLED`, default OFF; no environment file changed. Request opt-in: exact `x-pump-v5-preview: true`, existing `x-internal-secret` identity, and `x-pump-v5-fact` naming one approved fact. Fact scope must match the frozen deterministic route; it cannot choose entity, Tool or arguments. No new natural-language fact classifier exists.

Existing `/api/ai/chat` completes its unchanged dispatcher and emits authoritative legacy content/state/done first. An internal client may continue reading for one supplementary `v5_preview` SSE event with preview=true, authoritative=false and validated answerText. Opt-in responses use Cache-Control: no-store. Gate-OFF requests have no new fields/events. Failure suppresses only preview and preserves legacy telemetry/content/done.

`readCanary.cjs` composes existing Interpreter, task transitions, capability router, approved read registry, real execution and Composer. Activation is request-local; production environment, shadow scheduler and sampling are unchanged. Every invocation gets a fresh task identity and private verified evidence.

`composeReadAnswerForCanary` invokes a synchronous request-local body sink only after all existing contract/reference/grounding/coverage/numeric/entity gates pass. No raw JSON, claims, evidence or reusable content handle is delivered. Default composeReadAnswer remains metadata/digest-only. Exceptions, cancellation or invalid drafts deliver nothing; no second Answer Model call occurs. No body registry, cache, persistence, logging or tracing was added. Delivery contract version 1 does not change Composer/prompt versions, prompt, DeepSeek/deepseek-v4-flash, temperature 0, retry 0, Tools NONE, approved facts or validator semantics.

Contracts are consolidated in v5-read-answer-shadow-v1.md, v5-read-canary-v1.md and the existing API-reference AI/SSE section. This is an internal variant of existing AI chat, not a new business capability or Tool.

## Frozen corpus certification

Evidence: `../data/p16c-controlled-preview-certification.json`.

| Gates | Paths | Preview attempts | Preview exposed | Legacy preserved |
|---|---:|---:|---:|---:|
| Global OFF / opt-in OFF | 15 | 0 | 0 | 15 |
| Global ON / opt-in OFF | 15 | 0 | 0 | 15 |
| Global OFF / opt-in ON | 15 | 0 | 0 | 15 |
| Both ON, internal identity | 15 | 15 | 15 | 15 |

Both-ON: eligible real read execution 15/15; result equivalence 15/15; evidence verification 15/15; answer contract 15/15; evidence references 15/15; grounding 15/15; required fact coverage 15/15; numeric accuracy 15/15; entity accuracy 15/15; validated body delivered 15/15. Answer Model calls exactly 15, one per path, with no substituted or regenerated samples.

Fact coverage: price.current 3/3; inventory.quantity 6/6; coil.inventory 3/3; recipe.cost.preview 3/3. Frozen flat-blade-price and exact-entity groups each 3/3. Prior V4-failure paths have accepted previews 8/8; this does not repair production V4.

The actual chat handler uses deterministic authoritative legacy content/done events through its existing dispatcher test seam. V5 uses the real frozen Interpreter, governed Business APIs, isolated query-only database fixture and real Answer Model. Legacy preservation therefore measures handler contract preservation, not newly sampled real V4 answer quality. The sink checks body presence/placement transiently and discards it; datasets contain metadata only.

## Safety and failures

- V5 Writes: 0; allowWrite enabling calls: 0; Business Mutation Calls: 0.
- Unsupported Claims: 0; Hallucinated Facts: 0 under constrained realization validation.
- Internal Metadata Leakage: 0; source-content leaks: 0; forbidden business-content fields: 0.
- Orphan Spans: 0; cross-request span contamination: 0 across 237 captured spans.
- Main DB hash/mtime/size/backup snapshot and isolated query-only fixture unchanged during formal certification.
- Answer Body Persisted: NO; Answer Body Logged/Traced: NO; Failed Validation Body Delivery: 0.

Focused tests cover invalid contract, incorrect references, missing facts, numeric mismatch, wrong entity, unsupported text, model error/timeout, verification failure, validation exception and cancellation. Every representative failure suppresses body/preview, makes at most one Answer Model call, preserves legacy content/done and yields only safe metadata. Ten simultaneous synthetic tasks use distinct identities/values to detect delivery contamination; mismatched task evidence is denied. Legacy mutation classification and finalized mutation routes are both rejected before Tool execution; test executors assert allowWrite=false.

## Performance

Evidence: `../data/p16c-gate-performance.json`.

Three valid paired trials, width 4, existing external A3C fixed-slot keep-alive client, 24 warmups and 200 measured requests per mode. Baseline is the start-commit chat handler; treatment is current gate-OFF handler. Both use identical synthetic legacy work and HTTP response-finish timing. All measured connections reused; arrival profile/send-deviation validity passed. No replacement/discarded trials.

- Worst median overhead: 0.7908% (target <=5%).
- Worst P95 overhead: 0.6860% (target <=10%).
- Real preview completion median: 2005.2597 ms.
- Real preview completion P95: 2749.2421 ms.

Preview completion includes the separate real V5 chain and is not authoritative production-answer latency. This is loopback integration evidence, not production provider contention/capacity certification. No model tuning or broad historical performance program repeated.

## Regression and review

- API contract governance: 26/26 PASS.
- Combined V5 before formal run: 385/385 PASS; final combined suite: 387/387 PASS.
- Final delivery tests: 9/9 PASS, covering multiple validator/failure matrices; projection/import tests also pass.
- Stage-only full regression: 2149/2150, solely the accepted missing `.guardian/config.yaml` failure. Initial isolated-environment failures were missing Next dependency links and an empty backups directory; after supplying those, no other failure remained.
- Isolated regression worktree uses baseline user-owned files plus Stage changes; unrelated user modifications are excluded from the tested release and commit.
- No Business API/schema, Web client/type or dependency change. Deep API/build/release/deployment programs not run; known Deep API snapshot race and Guardian configuration untouched.
- Formal pre/post code hashes matched. Subsequently only ineligible-preview guard placement moved inside its metadata span so rejected requests also get trace status; successful pipeline/model/validator/delivery behavior did not change. Focused tests strengthened distinct-value concurrency, exception/cancellation, mutation routing and failure-metadata checks. No real answers rerun or retuned. Final code passed isolated full regression and focused checks.
- Reviewed full production diff and new files: only delivery, canary orchestration, thin chat insertion, metadata helpers, explicit import-boundary tests, certification scripts/data and documentation. No frozen Interpreter/execution change or broader data/Tool import permission.

## Scope

- Production Cutover Performed: NO
- Production Traffic Percentage Rollout: NO
- Write Execution Enabled: NO
- Legacy Retirement Performed: NO
- Push / deployment: NONE
- Current Unique Blocker: NONE
- P16_D_READY: YES, pending Supervisor review only

STOP — WAIT FOR SUPERVISOR REVIEW.
