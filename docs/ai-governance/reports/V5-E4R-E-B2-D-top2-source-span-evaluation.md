# V5-E4R-E-B2-D Top-2 Source Span Evaluation

## 1. Executive Result

Status PARTIAL; P16_READY=NO. One formal full evaluation completed: 15 paths, Stage1 protocol valid 15/15, Top1 12/15, Recall@2 12/15. Coil and Flatblade pass 3/3; Exact remains 0/3. Final class/entity/capability/exposure each 12/15. No tuning or semantic rerun followed the evaluation.

Start commit c90ae0e7ff90ee01f8a9dfaca470479ebef4b8a4, master, dirty worktree preserved. Only approved Stage1 protocol/instructions, union plumbing, safe trace counts, tests, isolated evaluation harness and documentation changed. No V4, HTTP API/client, resolver, source algorithm, Stage2 instructions, class semantics or capability controls changed.

## 2. Frozen Root Cause

B2-C established six wrong-but-valid whole-request selections despite available source-unique expected spans. Structural pruning did not satisfy preservation/removal gates. This phase implements the approved two-reference hypothesis, not a new authority or fuzzy lookup. The same 15 paths, 5 source groups and 4 fingerprints and expected values are retained.

## 3. Stage1 Protocol V2

Architecture=3; external Contract=1. Stage1 protocol=2, prompt=2, K=2. Strict fields: version, spanRefs, needsClarification. Normal result requires two distinct ordered current-catalog refs. Clarification uses an empty array. Invalid JSON, unknown/extra fields, wrong version/count, duplicate or unknown refs fail closed before authority reads. Stage2 protocol and prompt remain unchanged.

## 4. Top-2 Selection

Stage1 prompt retains JSON, provided refs, no rewriting/answer and primary-entity clarification; approved general complete-mention versus whole-sentence guidance was added. No business keyword or frozen example is embedded. One synthetic non-business canary: one call, VALID, two refs, no Stage2/API invocation, unchanged DB and freeze hashes.

## 5. Candidate Union

New candidateUnion.cjs invokes existing acquireCandidateSet at most twice. Each is one existing one-mention batch-type API read. NOT_FOUND is a complete empty set. Any incomplete/error/timeout prevents a complete union; no second source is silently ignored after failure. All complete candidates are retained and deduplicated by entityType+canonicalId with source-ref provenance. Aggregate bound is twice the existing per-response candidate cap; no truncation to unique.

## 6. Rank Safety

Rank never selects the final entity. The unchanged finalizer filters the entire union by the selected class's entityTypes. One candidate resolves; zero mismatches; more than one stays ambiguous. Source witness selection occurs only after canonical finalization, ordered by source offsets, not model rank. Top-2 refs remain available for recall metrics. Duplicate-source matches preserve both provenance refs. Stage2 receives safe ref array in the existing spanRef slot, raw request, entity-type labels and local semantics, never candidate IDs/names or separate span texts.

## 7. Deterministic Tests

Focused Stage1/union/two-stage/JSON suites: 50/50 PASS. New Top-2 suite: 14/14 PASS. Combined V5: 269/269 PASS. Coverage includes exact two distinct refs, order, clarification, invalid JSON/extra fields, no free authority fields; zero+unique, zero+ambiguous, same identity dedupe, different identities, ambiguous+unique, both zero; ERROR/INCOMPLETE/TIMEOUT in either position; rank independence; existing unique/mismatch/ambiguity finalization; punctuation/numeric identity; ten concurrent request-local identities; no retry and V4 provider settings isolation.

No existing expectations were weakened to fit real model results. Version-sensitive fake outputs were migrated to the newly approved protocol. Stage2 frozen semantic checks and forbidden component hashes remain enforced.

## 8. Pre-Eval Freeze

Preflight and evaluation datasets contain full SHA-256 maps: Stage1 prompt/protocol, candidate union/set, local catalog, Stage2 prompt/protocol, finalizer, API/client/resolver, source span/anchor, classes/semantics, router/exposure, settings, input/external contracts, state/policy/evidence, observability, frozen corpus/expected and evaluators. The preflight explicitly compares all prior frozen keys except the approved Stage1/runtime and trace-count changes. Canary pre/post and formal pre/post maps match; final read-only verification also matches. No implementation changed after formal evaluation started.

## 9. Frozen One-Shot Evaluation

Formal runs=1; attempted=15; recorded=15; infrastructure fatal=0. Existing read-only fixture recovery and isolated authenticated API router use the business database read-only without startup initialization. The evaluator uses frozen V4 trajectory evidence, not new V4 model calls. Original datasets remain unchanged. No baseline or previous failed evaluation was rerun.

## 10. Top1 vs Recall@2

| Metric | Path | Source group (all paths correct) | Fingerprint (all paths correct) |
|---|---|---|---|
| Top1 | 12/15 | 4/5 | 3/4 |
| Recall@2 | 12/15 | 4/5 | 3/4 |
| Final class/capability | 12/15 | 4/5 | 3/4 |

Second-reference incremental recall=0. Improvement relative to B2-B cannot be attributed solely to adding rank 2 because approved instructions also changed and the successful expected references were rank 1. Stage1 ordered Top-2 consistency=4/4 fingerprints; protocol invalid/noncompliance=0.

## 11. Exact Entity

All three paths select sp_001 and sp_002; frozen expected ref is sp_006. Recall@2=0/3. Both selected mentions return NOT_FOUND, complete=true. Stage2 and finalization NOT_RUN; final class/entity/capability/exposure=0/3. Exact source substring handling remains unchanged, but preservation of the required expected identity was not achieved in these real interpretations. No lookup/alias/source correction was attempted.

## 12. 800平刀

FLAT_BLADE_PRICE: Recall@2=3/3, one NOT_FOUND plus one authoritative AMBIGUOUS result per path. Candidate types part/template, complete union count=2. Expected class survives, Stage2 correct=3/3, final canonical entity unique/correct=3/3, capability/exposure=3/3. No rank-based entity choice; unchanged class-type finalization removes the incompatible type.

## 13. Coil

Recall@2=3/3; candidate type coil; local classes=2; Stage2 correct=3/3; final entity/capability/exposure=3/3; false blocks=0. No regression from the prior success control.

## 14. Candidate Union Safety

15/15 complete union paths, including three complete empty unions. Both NOT_FOUND=3; one NOT_FOUND plus hit=12; both hit=0. Real deduplications=0; synthetic dedupe tests pass. Median/max initial candidates=1/2. False unique entity=0. Complete zero evidence does not count as successful resolution. Additional-authority ambiguity protection is tested synthetically, not exercised by two different successful source hits in this frozen corpus.

## 15. Local Intent

Expected class survives local catalog=12/15. Median/max local class count=1/2 (all-path denominator includes empty catalogs). Singleton deterministic=6; Stage2 applicable=6; valid=6, invalid=0, noncompliance=0, accuracy=6/6. Same-input Stage2 consistency=2/2 applicable fingerprints. Failed Exact paths are not removed from end-to-end denominators.

## 16. Final Entity

Final unique=12/15, canonical identity correct=12/15, final entity type correct=12/15. Final interpretation consistency=4/4 input fingerprints. All successful final identities were compared transiently to frozen authoritative IDs; IDs were not serialized. Failure paths expose no entity/capability outcome claiming success.

## 17. Capability / Tool Exposure

Projected domain/operation/entity type, capability and expected exposure each 12/15. R02 effective exclusion=3/3 only after correct task class and capability; NOT_FOUND/empty exposure no longer qualifies. No actual Tool executes. Router and exposure implementation/allowlists remain frozen.

## 18. False Blocks

V5_FALSE_BLOCK=0; V5_BLOCKS_V4_FAILURE=4; V5_INSUFFICIENT_DATA=3; AGREE=8. The three insufficient paths are Exact. These comparison labels are shadow observations against frozen V4 trajectories, not production verdicts or repairs.

## 19. Model / API Call Budget

Formal Stage1 calls=15, Stage2=6, total=21; average=1.4/path; maximum=2/path. Plus exactly one separate synthetic Stage1 canary: phase real-provider calls=22. No retries, alternative models or third calls.

Formal logical resolver/API read calls=30; average/max=2/2 per path; six types per API request, 180 typed attempts. Synthetic unit/concurrency calls are injected fakes and not included in real read counts. Provider/model/settings unchanged: DeepSeek deepseek-v4-flash, temperature=0, top_p omitted, JSON object, max_tokens=512, retry=0. V5 Tool executions/writes/production routing=0.

## 20. Consistency

Stage1 Top-2=4/4, Stage2=2/2, final=4/4 fingerprint groups. This is observed consistency across frozen runtime variants, not Repeat Stability. No repeated sampling was performed to improve metrics.

## 21. Privacy

Phoenix read-only inspection found 105 spans across all 15 formal trace IDs; invalid parents=0, wrong shadow-task correlation=0. Attribute keys are metadata-only counters/status/correlation. Actual recovered request/entity strings and configured secret sentinels were checked transiently against the formal dataset and matched traces: absent. No input/output content, canonical identity, Tool arguments/results or candidate-name attributes are present. Synthetic outcomes omit private IDs. Observed Prompt/Response/Raw Entity/Source Span/Canonical ID/Canonical Identity/Business Value/PII/Secret leakage=0 within these inspected artifacts; no claim of a global log-retention audit.

## 22. Performance / Concurrency

Ten concurrent synthetic requests pass: unique shadow tasks, correct capability, no private-ID output; request-local final identity assertions also pass in the two-stage tests. Contamination=0. V4 model configuration isolation PASS via injected model tests; response invariant PASS for synthetic scheduler response/event contract, with unchanged V4 code. No new live V4 AI replay was run.

Benchmark: existing bounded scheduler, fixed synthetic V4 delay, 30 measured +5 warmup OFF and ON. OFF median=15.7221 ms, P95=20.6445 ms; ON median=15.2722 ms, P95=20.3651 ms. Median overhead=-2.8616%, P95=-1.3534%, gate PASS. Negative values reflect timing noise, not a claimed speedup. Formal shadow completion median=569.9509 ms, P95=1060.9508 ms; these are not user-visible latency.

## 23. Database Safety

Before/after SHA-256=09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e; mtimeMs=1788424936315.8767; bytes=35323904; backup count=209. All unchanged across tests, canary, formal evaluation and final verification. No startup backup or delete-to-pass. No business schema/dependency changes.

## 24. Regression

Combined V5 269/269 PASS. Full deterministic Shadow-OFF regression 2055/2056; only known ENOENT .guardian/config.yaml failure. New B2-D deterministic regression=NO. Deep API pre-existing startup copper-price snapshot race was previously attributed in B1-C; NOT_RUN here, current recurrence UNKNOWN. No old/user-owned code was fixed. Final frozen-hash verification PASS. HTTP route/client contracts remain unchanged; this phase changes the isolated internal model protocol only.

## 25. P16 Preconditions

P16_READY=NO: Recall@2 and final semantic/entity/capability metrics are 12/15, not 15/15; Exact remains 0/3. The phase is PARTIAL despite passing safety and infrastructure checks. No further prompt, K, source algorithm, API, model or architecture change is authorized by this result. Wait for Supervisor; do not implement P16 or rerun a tuned evaluator.
