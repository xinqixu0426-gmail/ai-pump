# V5-E3 Shadow Signal Enrichment + Real Evaluation

## 1. Executive Result

P14 enriches the production shadow with request-scoped structural facts from existing V4 instrumentation and schema-validation boundaries. The final focused real replay produced 15/15 valid traces, 100% overall comparability, frozen root-cause-group coverage C02 3/3, R02 3/3, A01 2/2, and zero false blocks. V4 remains authoritative; V5 model, Tool, Business API, write, and production-routing counts remain zero.

## 2. Frozen Baseline

- P13 commit: `1815de3ce7ffdf487f4aa1c21c4b25ca7e11a535`
- Regression baseline: 1909/1910
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: NO; all pre-existing user V4/AI changes were preserved and excluded.
- Business DB baseline: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size 35,323,904 bytes, mtime UTC `2026-09-03T08:42:16.3158766Z`, backup files 209.

## 3. P13 Limitations Addressed

P13 production outcomes lacked entity, capability, argument-validation, state, and verification structure. P14 adds a bounded `AsyncLocalStorage` collector at the already-instrumented boundaries and snapshots it only after V4 returns. No V4 payload contract was expanded, no business content was copied, and no missing fact was guessed.

The P13 analyzer ambiguity caused by V4 and detached V5 roots sharing correlation was corrected by selecting `invoke_agent pump_factory_assistant` explicitly rather than the first root with a request ID.

## 4. Shadow Fact Contract

The version-1 contract is documented in `docs/ai-governance/v5-shadow-facts-v1.md` and implemented in `api/services/ai-v5/shadowFacts.cjs`. Categories are correlation, entity shape/resolution, route, argument validation/shape, Tool execution, verification counts, and final runtime state. Collections are capped at 24 records and argument shapes at 32 keys.

## 5. Zero-Side-Effect Harness

The import test starts a child with `NODE_ENV=test`, `NODE_TEST_CONTEXT`, a temporary test DB path, and a temporary backup root before importing the Dispatcher. Source DB hash/mtime/size and source backup count remain unchanged, and no temporary backup directory is created.

An early pre-final runtime benchmark omitted `NODE_TEST_CONTEXT` and created one startup backup in its isolated temporary directory. No workspace/business backup was created or deleted. The harness was corrected, then the final benchmark and all final validations were rerun from the frozen workspace baseline with zero startup-backup side effects.

## 6. Entity Facts

Existing normalization and resolution wrappers provide entity type, length/punctuation deltas, resolution status, candidate count, match type, ambiguity, and a canonical-ID hash only when an actual resolver ID exists. Raw and normalized strings and raw IDs are never retained.

## 7. Capability Facts

Actual selected Tool names come from existing route/Tool structure. V5-B reverse mapping supplies the actual Tool capability membership; it is not labeled as model intent. Focused evaluation uses the frozen Oracle primary Tool only as a test expectation for the comparison layer, never as a production fact.

## 8. Argument Facts

The existing `prepareAiToolCalls` validation boundary records `VALIDATED` or `REJECTED`, safe validation code, keys/count, and top-level type signature. Execution success never implies validation. Values are discarded before the snapshot.

## 9. Verification Facts

The current verifier wrapper records decision/status, required/observed/missing counts, and `beforeAnyTool`. P14 does not rerun or alter verification. Final real availability is 5/15 (33.33%); unavailable verification remains `NOT_APPLICABLE` or deferred and does not erase an upstream deterministic block.

## 10. Layered Comparison Model

P14 emits independent entity, capability, Tool-exposure, argument, state, policy, and verification comparisons. Overall priority is: `V5_FALSE_BLOCK`, `V5_BLOCKS_V4_FAILURE`, `AGREE`, `AGREE_WITH_DEFERRED_VERIFICATION`, then `V5_INSUFFICIENT_DATA`. All layer statuses and reason codes remain visible.

## 11. Projection Completeness

Final focused real replay availability:

- Entity: 15/15 (100%)
- Capability: 15/15 (100%)
- Argument: 15/15 (100%)
- State: 15/15 (100%)
- Verification: 5/15 (33.33%)

Low verification availability reflects the real V4 lifecycle and is not filled with fabricated Evidence Requirements.

## 12. P06 Real Replay

The final run re-executed all five frozen read-only cases across Legacy, V4 Investigation, and V4+R3 with the configured DeepSeek provider: 15 attempted, 15 valid, 9 current failures, and 6 current passes. It used an isolated DB snapshot, metadata tracing, shadow sampling 1, and project `pump-ai-v5e3-shadow`.

Real-provider nondeterminism changed the current failure distribution to A01=3, C02=3, R02=3. Frozen root-cause grouping remains separately preserved for the requested P06 coverage denominator; current result/class is also stored independently in the evaluation dataset.

## 13. C02 Coverage

Frozen C02 group: 3/3 comparable. Current upstream state and/or entity structure produced deterministic comparison without requiring verification evidence.

## 14. R02 Coverage

Frozen R02 group: 3/3 comparable. Actual Tool membership is compared against the frozen safe Oracle capability expectation only in the evaluation harness. Production intended capability remains unavailable unless V4 owns an explicit decision.

## 15. A01 Coverage

Frozen A01 group: 2/2 comparable. The exact-identity shape mismatch is identified from safe expected-versus-observed length/punctuation structure and E04 taxonomy, not raw text. Existing schema validation remained independently represented.

## 16. Exact Entity Evaluation

All three Exact Entity paths failed in the final replay and were classified `V5_BLOCKS_V4_FAILURE`. The entity layer recorded identity-shape non-preservation; no raw identity was mirrored and no V4 fix was attempted.

## 17. 800平刀 Evaluation

All three paths failed and were classified `V5_BLOCKS_V4_FAILURE`. Legacy first blocked at state; V4 Investigation exposed capability plus state blocks; V4+R3 exposed capability, argument, and state blocks. No raw entity or Tool value was captured.

## 18. Success Controls

Six current real PASS read paths were evaluated; all were `AGREE`, with `V5_FALSE_BLOCK=0`. This exceeds the minimum three success controls.

## 19. False Block Analysis

`V5_FALSE_BLOCK=0`. The result is evaluated against current V4 outcomes; frozen failure labels are not used to force a block when a current real-provider path succeeds.

## 20. Comparability Metrics

- Comparable: 15/15 (100%)
- `V5_BLOCKS_V4_FAILURE`: 9
- `AGREE`: 6
- `AGREE_WITH_DEFERRED_VERIFICATION`: 0
- `V5_INSUFFICIENT_DATA`: 0
- `NOT_COMPARABLE`: 0
- `SHADOW_ERROR`: 0

## 21. Privacy

Phoenix database-aware privacy inspection reported secret=0, PII=0, business value=0, prompt/response=0, and Tool argument/result=0. The P14 eight-category sentinel trace also reported zero leakage, including raw entity content.

## 22. Trace Integrity

All 15 V4 replay traces have one Agent root, valid parents, no orphan, no duplicate span ID, and no span beyond root end. Each has one correlated but semantically independent V5 shadow root with project/compare children. Shadow orphan=0, invalid parent=0, missing correlation=0, and cross-request contamination=0.

## 23. SSE / Concurrency / Performance

- Deterministic OFF/ON result: byte-equivalent
- SSE event count/order/payload/termination: PASS
- Ten concurrent requests: ten unique task/request/Trace IDs; contamination 0
- Final benchmark: 5 warmups plus 30 OFF and 30 ON measured runs
- OFF median 20.1417ms; ON median 20.2180ms; overhead 0.38%
- OFF p95 20.1673ms; ON p95 20.2623ms; overhead 0.47%
- Performance gate: PASS
- Capacity, independent timeout, fail-open completion, and bounded shutdown remain PASS.

## 24. Business DB / Backup Safety

Final evidence after the real replay, Phoenix inspection, runtime benchmark, combined tests, and full regression is SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, and recursive backup-file count `209`. These exactly match the frozen values. The final import, runtime, combined, and full-regression runs created no workspace or isolated-test startup backup. No delete-to-pass mechanism is used.

## 25. Regression

- P14 focused tests: 7/7 new P14 tests PASS; 28/28 focused P13+P14 tests PASS
- Combined V5 A-E3 plus safe deterministic runtime/SSE tests: 143/143 PASS
- Full deterministic regression with shadow OFF: 1916/1917 PASS
- Same known failure only: missing `.guardian/config.yaml`; new regression introduced: NO

## 26. Production Isolation

- V5 model calls: 0
- V5 Tool calls: 0
- V5 Business API calls: 0
- V5 writes: 0
- Production requests routed to V5: 0
- V4 remains the sole authoritative runtime; the shadow outcome is not returned to the user or SSE.

## 27. Known Limitations

- Verification structure exists for only 5/15 final real paths; upstream comparisons make the corpus comparable without inventing evidence.
- The real provider is nondeterministic: final current failure distribution differs from the frozen P06 run, so both frozen grouping and current classification are retained.
- Intended capability is not a general production fact. The focused evaluation may compare against the frozen Oracle expectation; ordinary production shadow results remain insufficient when V4 exposes no intent-owned capability decision.
- Shadow scheduling and sampling remain process-local with no durable queue.

## 28. P15 Preconditions

P15 readiness requires final zero-side-effect DB/backup evidence, privacy and trace integrity PASS, performance PASS, C02 3/3, R02 3/3, A01 2/2, overall comparability at least 80%, zero false blocks, combined V5 regression PASS, no new V4 regression, and production V5 routing zero. P14 does not authorize cutover, V5 execution, writes, Repeat Stability, or legacy retirement.
