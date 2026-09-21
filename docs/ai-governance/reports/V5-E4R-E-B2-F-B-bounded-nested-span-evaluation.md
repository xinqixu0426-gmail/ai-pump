# V5-E4R-E-B2-F-B Bounded Nested-Span Refinement Evaluation

## 1. Executive Result

Status=PASS; P16_READY=YES for Supervisor review only. No P16 implementation, Tool execution, write or production routing occurred. One formal frozen run completed: final class, canonical entity, entity type, projected semantics, capability and expected exposure all 15/15. Original Top1 and recall@2 remain 12/15; bounded refinement restores expected source recall to 15/15. False unique entity=0; V5_FALSE_BLOCK=0.

Start commit `54fcec9281bce89b9a428c204f98562efcc2d954`, master, dirty worktree preserved. Only isolated V5 refinement/plumbing, tests, evaluator and associated documentation/data changed. Production V4 and forbidden components unchanged.

## 2. Frozen Failure Evidence

The F-A audit identified three Exact failures with two complete NOT_FOUND original lookups and empty authority union. All twelve successes had a hit plus a miss. Its Strategy B ranks the required nested span first under both parents. This implementation uses that exact lexical ordering, not a new ranking discovered after evaluation. The original 15 paths, 5 groups, 4 fingerprints and frozen expected records were preserved.

## 3. Refinement Architecture

Architecture version=3, external contract=1, Stage1 Top K=2. New `nestedSpanRefinement.cjs`: version=1, IDENTIFIER_PRIORITY, K=1/parent, max entity lookups=4. Existing candidateUnion adds per-original-lookup completeness metadata. Interpreter calls the wrapper and permits finalized source witnesses from nested refs. Stage1 output refs remain separately preserved for original recall metrics.

## 4. Trigger Guard

Gate requires original resolverCalls=2, both individual completeness values true, both statuses NOT_FOUND, complete union and zero candidates. Any RESOLVED/AMBIGUOUS/nonempty union/error/incomplete/timeout prevents refinement. All 12 prior successful paths trigger=0. Original errors remain fail closed. No attempt to escape authoritative ambiguity.

## 5. Strategy B / K=1

Proper nested existing catalog spans only; exclude original queried refs and overlength mentions. Identifier > quoted > combined > word, descending code-point length, ascending start/end offsets. Lexical category ownership exactly matches F-A. Test compares output to the original audit's Strategy B on synthetic source fixtures. No business strings, expected labels, fuzzy boundaries, generated substrings or runtime K increase. Entire-request parents may require examining bounded catalog metadata; authority acquisition does not query all spans.

Both parent prefixes are selected before lookup, deduplicated without refill. In this run both Exact parents choose the same nested ref, so only one new read occurs per Exact path.

## 6. Lookup Budget

Call reservation hard cap=4; a fifth reservation is rejected with LOOKUP_BUDGET_EXCEEDED. Original reads<=2, nested reads<=2; maximum observed=3. Synthetic test reaches four with two distinct nested refs and proves a fifth reservation fails. No adaptive next-ref selection, nested-of-nested expansion or retry. Existing per-read timeout remains bounded; finite call count bounds aggregate read work. No API semantics change or new batch endpoint.

## 7. Candidate Union

Refinement starts only from an empty original union. New candidates dedupe by type+canonicalId and retain matchedSpanRefs. All fixed-plan responses contribute before finalization; error/incomplete/timeout fail closed rather than ignoring a failed read. Union upper bound=4*30=120 candidates; no truncation-to-unique. Original and nested rank cannot pick a canonical entity. Existing local catalog and entity finalizer are unchanged.

## 8. Deterministic Tests

F-B focused tests 10/10 PASS. Coverage: trigger truth table/mixed hits/ambiguity, individually incomplete response, nonempty union; audited ranking parity/determinism/source exactness; one nested ref deduped before API; all-negative termination without refill; four-call maximum/fifth rejection; nested error/incomplete/timeout; 10 concurrent nested candidate unions; 10 concurrent full interpreters with request-specific nested mentions, identities, shadow-task model correlation and two-call model budget. Existing suites cover finalization ambiguity, source punctuation/numeric preservation and provider isolation.

Combined V5 tests 279/279 PASS before formal evaluation. No test was modified after evaluation. An initial synthetic four-call fixture used a child equal to its parent; correcting the synthetic bounds before evaluation produced the intended proper-child test. No real case expectation was changed.

## 9. Pre-Eval Freeze

Dataset contains full pre/post SHA-256 maps including new module/config/gate/budget, original Stage1 prompt/protocol, source catalog/anchor, API/client/resolver, candidate union/set, local catalog/Stage2, finalizer, classes/semantics, router/exposure, model settings, external contracts/state/policy/evidence and frozen corpus/expected records. New module SHA-256: `870d6f434e33370be2eec28d70278f26f6138045b4290c8c1e4304d151b50002`.

Against B2-D, only existing candidateUnion and candidateSetTwoStageInterpreter hashes changed, plus the newly added refinement module. All forbidden hashes match. The new evaluator, focused tests and refinement document are also frozen. Final post-evaluation recheck matches every pre/post value. Only dataset aggregate verification and this report were added after the formal run. No canary, tuning or second formal evaluation.

## 10. Frozen 15-Path Evaluation

Formal runs=1; attempted/recorded=15/15; infrastructure fatal=0. Reused the frozen runner fixture definitions and V4 trajectory evidence, not a new live V4 model replay. The isolated authenticated Business API route used the existing readonly DB harness without startup initialization. Fifteen Stage1 calls, nine Stage2 calls. Original datasets were not overwritten.

| Group | Paths | Refinement | Refined recall | Final class/entity/capability/exposure |
|---|---:|---:|---:|---:|
| COIL_INVENTORY | 3 | 0 | 3/3 | 3/3 |
| EXACT_RECIPE_COST | 3 | 3 | 3/3 | 3/3 |
| FLAT_BLADE_PRICE | 3 | 0 | 3/3 | 3/3 |
| PART_INVENTORY_PRIMARY | 3 | 0 | 3/3 | 3/3 |
| PART_INVENTORY_REPEAT | 3 | 0 | 3/3 | 3/3 |

## 11. Exact Entity Recovery

All three original Top2 pairs remain NOT_FOUND/NOT_FOUND. Trigger=3/3; nested expected ref selected=3/3; nested lookup RESOLVED=3/3; exact source witness/identity preserved=3/3. Final expected class, canonical ID/type, capability and exposure=3/3. Original model selections were not rewritten. The required identity was verified transiently against the frozen oracle and through unchanged exact anchoring; no raw source or ID was serialized.

## 12. Coil Non-Regression

Three original coil paths retain one positive hit and one negative result; refinement=0/3. Final class/entity/capability/exposure=3/3; false blocks=0. No local cost/read semantic change.

## 13. 800平刀 Non-Regression

Three original paths preserve part+template authoritative ambiguity and one negative result. Refinement=0/3. Existing Stage2/class-based finalization yields the correct unique canonical entity in all three. Final class/capability/exposure=3/3. No entity type keyword or ambiguity shortcut.

## 14. Refined Span Recall

Original Top1=12/15, recall@2=12/15. Expected source ref in original OR fixed nested refs=15/15. The dataset deliberately retains original spanMatch separately from expectedSpanRecovered; Exact original spanMatch remains false. No metric redefinition hides Stage1's continued boundary-selection weakness.

## 15. Local Intent / Final Entity

Expected class survival=15/15. Singleton deterministic paths=6; Stage2 applicable=9, valid=9/9, correct=9/9. Stage2 same-input consistency=3/3 applicable fingerprints; final interpretation=4/4 fingerprints. Final expected class=15/15, unique canonical entity=15/15, canonical identity correct=15/15 and type=15/15. Same-type ambiguity protection remains unchanged; this corpus is not a general multi-entity acceptance suite.

Legacy summary fields named initialUnique/initialAmbiguous describe the final acquisition union in this reused runner. For original-only status, use originalLookupStatuses; refinement metrics are separately recorded. No underlying case results were changed after the run.

## 16. Capability / Tool Exposure

Projected domain/operation/entity type, deterministic capability and expected Tool membership all 15/15. R02 wrong-Tool exclusion=3/3, conditional on correct final interpretation, not empty exposure. Capability IDs, grouping, allowlists, router and exposure code remain unchanged. No actual Tool executes.

## 17. False Blocks

V5_FALSE_BLOCK=0; V5_BLOCKS_V4_FAILURE=6; V5_INSUFFICIENT_DATA=0; AGREE=9. False unique entity=0. These compare independent shadow interpretations against frozen V4 trajectory evidence; they do not override production V4 verdicts.

## 18. API / Model Call Budget

Original resolver/API reads=30; nested=3; total=33; mean=2.2/path; observed max=3; budget violations=0. Six typed attempts/read implies 198 server typed attempts. Nested infrastructure errors=0; candidate union complete=15/15.

Stage1 model calls=15; Stage2=9; total=24; average=1.6/path; max=2/path. Refinement model calls=0; retry=0; canary=0. DeepSeek deepseek-v4-flash, temperature=0, top_p omitted, JSON object mode, max_tokens=512 unchanged. V5 Tool/real Tool executions/writes/production routing=0. Unit tests use injected fake reads/models and are not counted as real-provider calls.

## 19. Privacy / Trace

Read-only Phoenix inspection matched 114 spans across all 15 formal trace IDs. Missing traces=0, orphan roots=0, invalid parents=0, cross-task correlation=0. Existing metadata-only spans cover selection, governed lookup, local catalog/intent, finalization, routing and comparison. Safe refinement counts/statuses are in the evaluation outcome; no new content-bearing trace fields were introduced.

Transient reconstructed request/mention sentinels and configured secret values were checked against the formal dataset and matched traces: zero leakage. No input/output message, raw mention/span text or canonical-identity attributes were present. Prompt/response/raw entity/span/canonical ID/canonical identity/business value/PII/secret leakage=0 within the inspected metadata-only evaluation surfaces. This is not a global historical log-retention audit. The formal runner stdout emitted only case IDs, validity and match booleans; raw provider results were never logged by the runner.

## 20. Performance / Concurrency

Existing synthetic asynchronous shadow scheduler benchmark: 30 measured +5 warmup OFF and ON. OFF median=15.2569 ms, P95=15.6646 ms; ON median=14.8265 ms, P95=15.7407 ms. Median overhead=-2.8210%, P95=0.4858%; gate PASS. Negative median is timing noise, not claimed speedup. Benchmark exercises the unchanged successful non-refinement scheduler path; nested concurrency is separately exercised through full interpreter tests. V4 model settings isolation PASS; synthetic response/event invariant PASS. No new live V4 AI replay.

Ten concurrent nested unions and ten full interpreters have zero candidate/source/finalization/task crossing. Formal completion median on refinement paths=941.0036 ms; non-refinement paths=634.5691 ms (nearest-rank median). These are shadow completion latencies, not V4 user latency. Stage2 becomes applicable for the recovered paths, so the difference is not solely lookup cost.

Additional post-evaluation read-only synthetic verification (no implementation edits or real calls) exercises the actual mirror scheduler WITH refinement: ten concurrent requests, 20 fake model calls, 30 fake API calls, correct request-local input witnesses, unique shadow tasks and correct capability outputs; contamination=0. Separate 30+5 OFF/ON benchmark: OFF median=15.1148 ms/P95=15.7924 ms, ON median=14.1898 ms/P95=15.2169 ms; median overhead=-6.1198%, P95=-3.6442%, PASS. Synthetic response/event invariant also passes. Both benchmark populations are retained, not selectively rerun to replace a failed gate. Negative differences are timing noise. This refinement-triggered population supplies the final return's overhead values.

## 21. Database Safety

Pre/post/final SHA-256 `09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e`; mtimeMs 1788424936315.8767; size 35323904 bytes; backup files 209. All unchanged across deterministic tests, formal evaluation and verification. Unexpected startup backup=NO; no delete-to-pass or new V5 DB authority.

## 22. Regression

Focused F-B=10/10; combined V5=279/279. Full deterministic Shadow-OFF regression=2065/2066, only missing `.guardian/config.yaml` in businessTerminologyContract. New F-B deterministic regression=NO. Deep API's pre-existing asynchronous copper-price snapshot race was previously attributed; NOT_RUN here, current recurrence UNKNOWN, not repaired or relabeled. No user-owned V4/AI modification was committed.

## 23. P16 Preconditions

All specified frozen accuracy, trigger, call-budget, safety, isolation and deterministic regression gates are satisfied at the stated verification scope. P16_READY=YES is a handoff decision only. No claim of broader corpus generalization: one formal run, four source fingerprints, three Exact runtime variants of one request. No post-result implementation change, model retry, K increase, batch API, Tool execution or production cutover. STOP — WAIT FOR SUPERVISOR REVIEW.
