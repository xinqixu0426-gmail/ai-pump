# P16-L-R2 — Collection Admission, Detail Binding and Filter Continuation

## 1. Executive result

**REWORK. P16_L_PRODUCTION_READY=NO.** Start/end HEAD `9acf10c4bcd854705affa700670ab2aabe0dc135`, master. No commit, push, production access, deployment or restart. P17 remains paused. Original P16-L work and unrelated user changes remain uncommitted and preserved.

The one authorized unchanged 30-question isolated real-model UAT passed **11/30**, failed **19/30**. No implementation or prompt was changed after evaluation, and no answer/UAT retry occurred. Pre/post implementation hashes match. Results are worse than the initial20/30 and must not be described as repaired production coverage.

## 2. Pre-implementation audit

Historical artifacts did not retain raw classifier fields; exact historical field attribution is therefore unavailable. A single new four-case diagnostic used the unchanged risk prompt/provider transport with the same questions and reconstructed active collection context, without Tools or Business APIs. This is not historical reconstruction.

| Case | Operation | New diagnostic safe fields | Result |
|---|---|---|---|
| L-07 | orders continuation | query, previous_turn, high, needsBusinessData=false, no clarification/ambiguities | rejected |
| L-12 | customers continuation | query, previous_turn, high, needsBusinessData=true, no clarification/ambiguities | admitted |
| L-13 | customers count | query, current_turn, high, needsBusinessData=true, no clarification/ambiguities | admitted |
| L-28 | coils count | query, current_turn, high, needsBusinessData=true, no clarification/ambiguities | admitted |

Thus the contextual data-dependency adapter is one proven gap; the other historical refusals are not reproducibly attributable to a deterministic adapter field. No broader risk relaxation or risk prompt tuning was made.

A separate six-case, single-pass target diagnostic confirmed all five direct-detail model offset selections differed from their exact synthetic source target offsets. Bounds validation alone accepts the wrong substring. The sixth case (customer filter L-09) also failed exact filter-target extraction; its classification was not repaired by inventing a filter.

The Supervisor's initial filter-loss attribution is not established by old artifacts: L-07 failed risk admission before Tool execution; L-09 failed semantic parsing. The existing store already cloned typed filters and replayed them. The actual continuation change freezes pageSize too and rejects model replacement. No pagination redesign was justified.

Safe audit artifacts: `p16lr2-admission-audit.json`, `p16lr2-target-audit.json`. They contain enums, counts and synthetic offsets only, not source text or model bodies.

## 3. Narrow changes

- `collectionAdmission.cjs`: explicit five-resource/five-operation read allowlist, in addition to risk eligibility. Contextual admission cannot become an unrelated action.
- Risk adapter: a valid active collection plus previous_turn supplies the data dependency for continuation/ordinal only. Existing command/conversation/unknown/low-confidence/clarification/error rejection remains; current-turn needsBusinessData=false remains rejected. Risk prompt/model unchanged.
- Collection semantic wire contract: model selects existing catalog refs instead of computing UTF-16 offsets. Existing catalog generation and narrow Interpreter remain unchanged. This is a source-ownership contract change, not fixture-specific phrase handling.
- `collectionDetailTarget.cjs`: exact mention enters unchanged governed resolver, then complete unique correct-family canonical ID becomes the detail target. No fuzzy matching, fallback to raw text, first-result selection or model ID. Ambiguous/not-found/error/wrong-family stops before Tool execution.
- Ordinal target remains current-page canonical ID. Both paths use bounded targetId detail execution.
- Continuation replays frozen resource/filter/sort/pageSize/queryId and advances only afterId. Any filter field or changed pageSize supplied on continuation is rejected. Existing TTL600000ms, default20/max50, keyset bounds, namespace and payload cap are unchanged.

## 4. Deterministic certification

Focused collection/risk tests:12/12 PASS. Real in-memory fixture HTTP entity lookup, existing Executor/internal client and collection API prove direct detail5/5 canonical IDs and verified delivery. Filtered page1→continue preserves query/filter and exactly enumerates the32 fixture rows across20+12 without duplication or omission. This deterministic test is distinct from the real model failure below.

Tests cover zero/ambiguous/incomplete/error/wrong-family lookup, source-ref validation, model IDs/offset rejection, current-page ordinal, frozen state mutation copies, filter substitution rejection, wrong owner/conversation/token/query, TTL,10 overlapping namespaces and command/mixed-risk blocking. Representative delete/modify/change/mixed fixture requests use command risk envelopes and execute zero Tools. These are deterministic safety tests, not a claim that a real risk model correctly classified every adversarial natural-language request.

## 5. One-shot real UAT

The original question factory remains unchanged. Fresh migrated memory fixture, same30 natural questions, real configured risk and semantic models, actual read Executor and formal HTTP boundaries. No business DB or production route. Formal runs1, retries0, read Tool calls12. The original blocked dataset is retained.

| Resource | PASS / applicable |
|---|---:|
| orders |4/10|
| customers |4/5|
| parts |1/5|
| recipes |2/5|
| coils |0/5|
| Total |11/30|

Mandatory initial orders list passes with20 rows, authoritative total/hasMore, no limit refusal or oversized response. Orders count passes. Direct detail:1/5 reaches governed canonical detail and passes the recorded query/evidence checks; the other4 stop at collection scope. Formal target matching currently records lookup binding and query shape/count, not an independent canonical-ID Oracle, so it must not be promoted to a full formal5-target certificate. Deterministic tests independently assert the actual expected target IDs.

Historical admission mandatory set: risk admission3/4; end-to-end success2/4 (L-12/L-13). L-07 risk-rejected; L-28 semantic NONE. Ordinary continuation and ordinal regress formally. Filtered page1 itself is semantic NONE, so its later continuation has no valid state and cannot certify filter replay.

Failure classes:5 RISK_NOT_ELIGIBLE,13 COLLECTION_SCOPE_UNAVAILABLE,1 delivered wrong operation/query result (L-22). L-22 expected continuation but returned one row and failed Oracle; validated query evidence alone does not establish correct user intent. This is an actual wrong-response failure, not safe fallback. No further model output was requested to investigate it after the frozen run.

Metadata-only formal dataset: `docs/ai-governance/data/p16lr2-collection-certification.json`. Classification/selection availability remains the release blocker. Do not repair it by accepting query/analysis alone, dropping unsupported filters, forcing an ordinal or retrying until green.

## 6. Regression

- API contract:26/26 PASS.
- Full deterministic suite:2261/2262 PASS; sole failure existing `.guardian/config.yaml` ENOENT.
- Existing narrow price/inventory/coil/recipe, identity/fallback/owner deterministic suites are included and pass. Real narrow-read interception under the modified collection semantic stage is not certified by these tests.
- Deep API:FAIL `search_coils.copperBase` versus formal API. The same failure signature and pre-existing startup race attribution are documented in `V5-E4R-E-B1-C-ambiguity-regression-audit.md`; no search_coils/copper computation edit or retry was made. This is not a new three-way attribution run.
- Build: PASS (Next production build,18 routes).

## 7. Performance, privacy and safety

All-attempt latency medians using fixed case roles (including rejected paths): collection1569.469ms, continuation909.141ms, direct detail1420.405ms. These are not successful-path performance certificates. Formal UAT overlapped deterministic regression, so timing is descriptive only. Maximum returned payload2788bytes, global256KiB cap unchanged.

Real UAT technical-parameter leakage0; answer bodies, rows, credentials and model outputs are not persisted. Audit scripts suppress ordinary provider logs. General regression fixture logs are not production telemetry certification. Formal Phoenix orphan count and full trace-leakage audit are NOT_CERTIFIED; do not report unknowns as zero. Existing controlled10-namespace isolation tests pass, but no live production trace claims are made.

V5 Writes0; allowWrite enabling0; Business Mutation Calls From V50; Candidate DB Mutation Successes caused by stage0. Fixture setup writes are isolated test construction, not V5 writes. No production connection/deployment/restart/data modification occurred. Candidate/frontend/gateway remain untouched; P17 paused.

## 8. Uncommitted handoff

Retain prior P16-L Stage ownership list in its report. R2 adds admission/detail-target modules, focused tests, two diagnostic scripts/datasets, a dedicated certification entrypoint/dataset and this report. R2 modifies only Stage-owned risk/collection files, Stage test/harness and Stage documentation sections. No unrelated user hunks were staged or overwritten. No commit is permitted under the PASS-only closure instruction because UAT failed. The current worktree is an uncertified REWORK artifact, not deployable code.

STOP — WAIT FOR SUPERVISOR REVIEW. No production deployment, P16-M or P17.
