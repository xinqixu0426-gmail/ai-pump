# P16-D Explicit User-Visible V5 Read Canary

Status: PASS. P16_E_READY=YES for Supervisor review only.

## Identity

- Start Commit: `362d107fc8eb7a593c4251db7e420d96115aae1d`
- End Commit: the single `feat: add explicit v5 read authoritative canary` commit containing this report; exact SHA is in the Supervisor return.
- Branch: master; Worktree Clean At Start: NO.
- User-Owned Dirty Changes Preserved: YES. All 24 actual user-owned files were hashed. Removing only the new API-reference paragraph reconstructs its original bytes; all other originals are unchanged. User changes are excluded from the commit and isolated regression worktree.

## Authority architecture

Base gate: AI_V5_READ_CANARY_ENABLED, default OFF. Independent authority gate: AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED, default OFF. Request marker: exact x-pump-v5-use:true, plus existing x-internal-secret authentication and approved compatible x-pump-v5-fact. No environment/secrets/deployment configuration was changed.

The new request-local readAuthorityMux buffers legacy SSE events only for fully authorized authority requests. Legacy still executes once, providing the original fallback and risk summary. The frozen V5 read/Composer/validated-body pipeline is reused unchanged. On complete PASS, its validated body occupies normal provider/content/done; on failure, original legacy events are released. No legacy state or body is mixed into successful V5 output. Ordinary and P16-C responses bypass buffering. P16-C preview gates cannot grant authority; authority requests do not trigger a second preview attempt.

Only the frozen post-validation sink can populate the local validated body variable. Raw model JSON, claims and evidence never reach the mux. Body/event references are cleared on completion/failure/close; no registry, cache, persistence or sticky user/session state exists. Authorized responses use no-store. The normal response payload remains content:string; no new business capability, Tool, fact or entity type was introduced.

## Gate matrix

| Base | Authority | Marker/identity | Authoritative attempts | Final behavior |
|---|---|---|---:|---|
| OFF | OFF | none | 0/15 | legacy |
| ON | OFF | preview + internal | 0/1 focused fixture | legacy + supplementary P16-C preview |
| ON | OFF | use + internal | 0/15 | legacy |
| OFF | ON | use + internal | 0/15 | legacy |
| OFF | OFF | use + internal | 0/15 | legacy |
| ON | ON | no use marker | 0/15 | legacy |
| ON | ON | use, missing internal identity | 0/15 | legacy at handler boundary |
| ON | ON | use, invalid internal identity | 0/1 focused fixture | legacy at handler boundary |
| ON | ON | use + valid internal identity | 15/15 | validated V5 final |

The route's pre-existing authentication middleware remains unchanged. Handler tests deliberately exercise missing internal identity independently of normal route authentication; unauthenticated HTTP callers still cannot bypass that middleware. Both markers together cause only one V5 attempt; subsequent requests without markers remain legacy.

## Frozen corpus and actual final response

Authoritative evidence: `../data/p16d-authoritative-response-certification.json`.

Frozen Paths=15; Authoritative Canary Requests=15; Eligible Read Tool Execution=15/15; Result Equivalence=15/15; Evidence Verification=15/15; Answer Contract Valid=15/15; Evidence Ref Validity=15/15; Claim Grounding=15/15; Required Fact Coverage=15/15; Numeric Fact Accuracy=15/15; Entity Identity Accuracy=15/15; Validated V5 Final Answers=15/15. Each request emits exactly one normal content and one done, without supplementary preview or legacy answer substitution.

Fact coverage: price.current 3/3; inventory.quantity 6/6; coil.inventory 3/3; recipe.cost.preview 3/3. Frozen flat-blade-price and exact-entity answer groups each 3/3. Existing P16-C runtime and P16-B2R Composer, prompt/model, validators, read execution, fact handoff and Interpreter files have no Stage diff.

Certification uses the actual chat handler and deterministic legacy dispatcher events, with real frozen V5 Interpreter, governed Business API reads and Answer Model over the existing isolated query-only fixture. It certifies response selection and V5 answers, not real production V4 answer quality. Independent Oracle reads are used only by the comparator, never by the answering consumer. Bodies are inspected transiently at the response callback and discarded; only metadata is saved.

The first run (`p16d-authoritative-certification.json`) also passed 15/15 but its latency clock included Oracle preparation. That dataset is retained. A second complete P16-D run corrected only the clock start to handler invocation after Oracle preparation. Both runs are fully retained, with 15 real Answer calls each, one per request, zero retries. No failed answer was discarded and no implementation, model, prompt or validator was retuned. The corrected run's pre/post code hashes match.

## Safety and failure fallback

- Raw Model Answers Exposed: 0; Invalid/Unverified/Failed Validation Bodies Exposed: 0.
- Unsupported Claims: 0; Hallucinated Facts: 0 under the frozen constrained realization boundary.
- V5 Writes: 0; allowWrite enabling calls: 0; Business Mutation Calls: 0.
- Answer Body Persisted: NO; Answer Body Logged/Traced: NO; Runtime Facts Logged/Traced: NO.
- Source-content and forbidden value-field leaks: 0.
- Orphan Spans: 0; Cross-request contamination: 0 across 537 captured spans in each run.
- Main DB hash/mtime/size/backup snapshot and query-only fixture unchanged in both formal runs.

The actual final mux was tested with model error, model timeout, invalid contract, missing/failed evidence, numeric mismatch and entity mismatch. All six cases keep legacy final, expose no partial V5 body, and make at most one Answer call (zero for evidence failure). Legacy mutation classification and a finalized mutation route both stop before V5 Tool execution. Ten concurrent distinct synthetic entities/values retain their own final body; outcomes contain metadata only. Existing P16-C validation-exception/cancellation and body-delivery tests remain passing.

## Performance

Gate-OFF evidence: `../data/p16d-gate-performance.json`. Three valid paired trials, width 4, 24 warmups and 200 measured requests per mode. Uses the unchanged external A3C fixed-slot keep-alive client, actual start-commit/current chat handlers, identical synthetic legacy workload and HTTP response-finish timing. All measured connections reused; send-deviation and arrival-profile gates passed. No discarded/replacement trials.

- Worst median overhead: 0.6076% (limit <=5%).
- Worst P95 overhead: 1.2384% (limit <=10%).
- Corrected authoritative handler-to-final-done median: 1868.8021 ms.
- Corrected authoritative handler-to-final-done P95: 2293.1986 ms.

Synthetic failure timing at the same handler boundary: ordinary 0.2006 ms; model error 2.5472 ms; injected 10 ms timeout 14.4747 ms; contract 1.9911 ms; evidence 1.5668 ms; numeric 1.7449 ms; entity 1.8297 ms. No abnormal extra retry/wait was observed beyond the injected timeout and orchestration. These are focused fixture samples, not production latency guarantees. Real timeouts retain existing stage deadlines; successful authority latency includes legacy execution before V5. No new latency threshold or tuning was introduced.

## Regression and scope review

- V5 regression: 393/393 PASS, including P16-C and P16-B2R.
- API contract governance: 26/26 PASS.
- Isolated full regression: 2155/2156. Sole failure is the accepted missing `.guardian/config.yaml`; no new failure is attributed to it.
- Frozen Interpreter/resolver/router/Tool/evidence/Composer files and P16-C adapter remain unchanged. Reviewed the thin HTTP insertion, local mux, safe metadata helper, import-boundary test, certification scripts/data and consolidated API/authority documentation.
- No Business API/schema, Web client/type or dependency change. Deep API/build/release/deployment programs were not run; known snapshot race and Guardian issue remain untouched.

## Scope

- Production Deployment Performed: NO
- Global Production Cutover: NO
- Traffic Percentage Rollout: NO
- Automatic Canary Assignment: NO
- Write Execution Enabled: NO
- Legacy Retirement Performed: NO
- Push: NO
- Current Unique Blocker: NONE
- P16_E_READY: YES, pending Supervisor review only

STOP — WAIT FOR SUPERVISOR REVIEW.
