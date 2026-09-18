# V5-F2B-R / P16-B2R Evidence-Grounded Read Answer Shadow Formal Evaluation

## 1. Executive Result

PASS. P16_C_READY=YES for Supervisor review only; no cutover or P16-C implementation. One formal 15-path answer run, 15 calls, 15 accepted. All contract/ref/grounding/coverage/numeric/entity gates 15/15; unsupported claims and internal leakage zero. Price 3/3, inventory quantity 6/6, coil 3/3, recipe preview 3/3.

Start commit `7b0a925728cbf089d54ba5009269f80978c882a3`, master, dirty worktree at start. User-owned changes excluded from the stage. Read execution, Interpreter, handoff, Evidence/Verification, routing, policy and business logic were not modified. New production scope is five answer modules and metadata-only observability helpers. The existing static import test explicitly admits the new Composer's observability import while retaining data/Tool import prohibitions.

## 2. Frozen P16-B1/B2A Evidence

B1 certified 15 read executions/comparisons/verified tasks; B2A certified 18 ledger values and all 15 answer-required facts. The formal answer run establishes each frozen task once in the existing isolated query-only fixture, prepares its authoritative entity from frozen contracts and real lookup, then uses the unchanged governed execution and runtime handoff. It does not rerun Interpreter classification, splice earlier answer samples, or regenerate rejected answers. Earlier blocked datasets remain untouched.

## 3. Answer Composer

`api/services/ai-v5/readAnswerComposer.cjs`, composer/prompt version 1. DeepSeek deepseek-v4-flash via existing configured client: temperature 0, JSON mode, max output tokens 512, Tools absent, maxAttempts 1, retry zero. All three flags must be true; answer flag missing/false means no model call. Composer returns only safe verdict/digest/latency, not a user-visible answer.

The entry point accepts verified task context in controlled shadow runs. It has no production dispatcher routing or response-writing integration. The unchanged mirror schedules the performance workload asynchronously; this stage does not change scheduling architecture.

## 4. Answer Contract

Exact draft keys: version, answerStatus, answerText, claims. FACT requires claimId, claimType, factKey, evidenceRefs, entityRef, numericValue. Unknown fields and reasoning/tool/write requests reject. LIMITATION is restricted to one approved non-business sentence shape and cannot replace required facts. No derived business calculations are enabled.

## 5. Verified Runtime Fact Handoff

Only approved explicit keys are read using `getVerifiedEvidenceValue`. Execution SUCCESS, evidence VALID, verification PASS and every runtime value are prerequisites. Opaque model evidence aliases are minted only from successful same-task/entity/execution/fact access. No Tool DTO, comparator value or V4 answer reaches Composer. Comparator values remain exclusively in the independent read-equivalence harness.

## 6. Claim Grounding

V1 uses constrained fact realization. Each model claim must match a private verified fact and task-local entity/evidence alias; its numeric value is independently compared. Body text must equal approved business sentences reconstructed from verified values. This deterministically rejects extra prose/facts, unsupported actions, approximate numbers and semantic overstatement. It is not a claim of general-purpose free-prose hallucination detection.

## 7. Required Fact Coverage

Pre-evaluation Oracle mapping: price.current 3, inventory.quantity 6, coil.inventory 3, recipe.cost.preview 3. Every required key must occur exactly once in FACT claims and in the body. Required coverage 15/15. No post-result denominator change or V4-derived expected facts.

## 8. Numeric Validation

Finite JavaScript number equality, no coercion, rounding or conversion. Structured values and reconstructed answer text both checked. 15/15 numeric facts match. A correct reference with a wrong numeric value is rejected in deterministic/fake-model tests.

## 9. Entity Validation

Each claim uses the task-local authoritative entity reference. Body identity is independently reconstructed. Exact source punctuation is preserved for non-coil entities. Coil uses a safe business label and opaque entity reference rather than echoing its binding identifier. All 15/15 entity checks pass. Identity authority remains the final entity from the verified task, not model free text.

## 10. Deterministic Tests

28/28 answer tests PASS: all four facts, unknown/cross-task/wrong-entity/unverified refs, unknown/unrequired keys, numeric/type mismatch, punctuation drift, internal ID/Tool/binding leakage, unsupported extra text, omission, duplicate fact, invalid JSON, forbidden fields, preview overstatement, model error and timeout. Fake correct answers accept; wrong number/entity, invented extra fact and required-fact omission reject without retry. Ten concurrent controlled tasks accept their own evidence and reject cross-task handle access. Combined V5: 378/378 PASS.

## 11. Formal 15-Path Evaluation

Formal runs 1; paths recorded 15; model calls 15; errors 0; timeouts 0. Read execution SUCCESS 15/15, independent formal result-equivalence MATCH 15/15, Evidence Verification PASS 15/15. Answer accepted 15/15, contract valid 15/15, evidence refs valid 15/15, grounding 15/15, required coverage 15/15, numeric and entity accuracy 15/15. No implementation changes after evaluation.

## 12. Price

3/3 accepted, exact price.current value with current catalog unit price/CNY/catalog quantity-unit semantics. No lookup retry, comparator handoff, currency conversion or settlement-price claim.

## 13. Inventory

6/6 accepted; quantity exactly equals verified runtime inventory.quantity. Historical incomplete numeric coverage is not reproduced in this constrained answer run.

## 14. Coil

3/3 accepted using verified coil.inventory. Body uses “该线圈方案”, not schemeCode/binding identity. No added coil numeric facts or internal identifier leakage.

## 15. Recipe Cost Preview

3/3 accepted. Answer explicitly says current cost preview, preserving the approved recipe.cost.preview semantic boundary. It never labels the amount settlement/final confirmed production cost.

## 16. 800平刀

3/3 accepted, correct final business entity and required price fact. No intermediate part/template ambiguity is exposed in the final body.

## 17. Exact Entity

3/3 accepted, source-exact punctuation retained, required cost fact covered. No entity mutation introduced by the answer layer.

## 18. Prior V4 Failures

Frozen P06 results: 8 FAIL, 7 PASS. All 8 prior failure paths have correct shadow answers, classified as V5_SHADOW_ANSWER_AVOIDS_V4_FAILURE. V4 outputs are not used as truth. This is not a claim that production has been repaired or switched.

## 19. Unsupported Claims / Hallucination

Unsupported claims 0, hallucinated facts 0, internal metadata leaks 0 in the 15 formal drafts. The exact realization contract makes unsupported additions rejectable; general free-form answering is intentionally outside this certification.

## 20. Trace / Privacy

Metadata-only Phoenix-compatible in-memory trace sink: 15 answer LLM spans, 15 validation spans, correctly parented to their V5 AGENT root. Orphans 0, cross-request mismatches 0. Source leakage 0, business-value fields 0 across safe records and captured observations/logs. No prompt, answer body, verified numeric values, Tool args/results, binding values or canonical IDs are persisted. Only safe answer digest/counts/verdict/latency are stored. Remote Phoenix transport is not separately re-certified here.

## 21. Performance / Concurrency

A3C external fixed-slot keep-alive client reused unchanged; warmup 24 and measured 200 per mode. OFF/ON both run real governed reads and verified handoff; only AI_V5_ANSWER_SHADOW_ENABLED differs. Actual Composer/Validator run with a controlled 2ms fake answer model, avoiding extra formal calls. Existing mirror concurrency/scheduling unchanged. User metric is HTTP request arrival → response finish, not shadow completion.

9/9 valid pairs PASS: 2/4/8 requests each 3. No replacement pairs were needed. All median overheads in [-0.6143%, +1.1463%]; p95 in [-1.1279%, +0.8202%]. All valid pairs meet <=5%/<=10%. Conditions include 200 reused connections, no new measured connections, matched send deviation and foreground arrival profile. This certifies controlled answer-layer scheduling/CPU work, not DeepSeek network contention under production load.

Formal real answer completion: median 1031.6961 ms, p95 1752.6140 ms, separately from user latency. Ten concurrent fake-model controlled answer tasks passed isolation; no extra real-model concurrency evaluation was run.

## 22. Database / Write Safety

Main DB hash/mtime/size and backup count unchanged before/after formal and performance runs. Each isolated query-only fixture unchanged; unexpected backups NO. Writes 0, allowWrite enabling 0, mutations 0. User-visible V5 answers 0, production V5 routing 0. All real Tool executions are approved reads.

## 23. Regression

Answer-specific 28/28; combined V5 378/378. Full Shadow-OFF regression in the isolated start-baseline worktree with this stage's files: 2140/2141, only missing `.guardian/config.yaml`. Same known Guardian failure, no new P16-B2R regression. Deep API race not rerun/repaired; previous attribution retained. User dirty files excluded. Pre/post recorded freeze hashes match; forbidden production components show no stage diff.

## 24. P16-C Preconditions

P16_C_READY=YES for the specified constrained shadow-answer scope. All formal hard-fact gates, controlled performance/isolation/privacy, database and regression gates pass. This does not authorize P16-C implementation, user-visible answers, writes or cutover. Limitations: bounded realization rather than free prose; fixture-prepared frozen task context rather than a new full Interpreter evaluation; fake-model performance/concurrency; remote Phoenix delivery and production provider contention not separately certified. Stop for Supervisor review.
