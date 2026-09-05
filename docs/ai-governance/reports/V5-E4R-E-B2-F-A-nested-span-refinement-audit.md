# V5-E4R-E-B2-F-A Bounded Nested-Span Refinement Audit

## 1. Executive Result

Status=PASS (audit only). CAN_BOUNDED_NESTED_REFINEMENT_RECOVER_EXACT_FAILURES=YES, restricted to structural recall and frozen authority evidence, not a newly measured end-to-end success. Recommend B_TOP2_PLUS_BOUNDED_NESTED_REFINEMENT with Strategy B, K_nested=1 per parent, and the request-level no-hit guard below. P15R_E_B2_F_B_READY=YES for this precisely bounded future implementation; P16_READY=NO.

The guard is essential: all twelve current successful paths also have one NOT_FOUND selected span. Unconditionally refining each miss would trigger all twelve and fail the non-interference gate. The recommendation refines only after BOTH original lookups are complete NOT_FOUND and the complete original union is empty. Any authoritative hit, including AMBIGUOUS, suppresses refinement for the entire request. This is a stricter sufficient condition within the NOT_FOUND-only requirement, not permission to reinterpret ambiguity.

Start commit `43e46fc21d4301d39ef4f2d587fc936187b5a4ef`; branch master; dirty worktree preserved. Only this report, a safe dataset and an offline analysis script changed.

## 2. Frozen Top2 Baseline

Fully loaded evidence: B2-D Top2 dataset/report, B2-C span failure dataset/report, B2-E model-free audit dataset/report; unchanged sourceSpanCatalog, sourceSpanSelector, candidateSet and entityFinalization implementations. Frozen definitions and expected/fingerprint authority remain those of the original Top2 evaluator. Existing B1-B authority evidence is reused through B2-E, never refreshed.

Fifteen paths, five source groups, four source fingerprints: twelve final successes, three Exact failures. Each path used two original API lookups; six types per lookup. Every success has one complete positive result and one complete NOT_FOUND. Exact has two complete NOT_FOUND results. No new model, business API, Tool or resolver invocation occurred.

The audit script reads the frozen fixture definitions without executing the evaluator, recovers sources through the established readonly fixture harness, verifies input fingerprints and Stage1 signatures, and regenerates the unchanged deterministic catalog. It does not acquire new candidate facts from the DB. Recovered source text is transient and never emitted. Production authority remains behind the Business API.

## 3. Refinement Trigger

Proposed request-level sequence: finish and validate both existing lookups first; preserve their original result and error handling. Only when statuses are exactly [NOT_FOUND, NOT_FOUND], completeness=true and union count=0 may the fixed nested plan run. Individual RESOLVED or AMBIGUOUS results are never refined. Any ERROR, INCOMPLETE, TIMEOUT, unsupported result or incomplete union blocks refinement and fails closed. Do not trigger based on Stage2 or finalizer failure.

| Trigger interpretation | Successful paths triggered | Exact paths triggered | Decision |
|---|---:|---:|---|
| Each NOT_FOUND parent independently, even alongside a hit | 12/12 | 3/3 | REJECTED: violates non-interference |
| Complete empty original union; both parents NOT_FOUND | 0/12 | 3/3 | RECOMMENDED |

Do not silently implement the first interpretation. The trigger truth table includes both positions of each prohibited status, incomplete responses and inconsistent nonzero candidate counts.

## 4. Exact Entity Failures

All three variants have the same frozen source and selections. Stage1 selected `sp_001` then `sp_002`; both are NOT_FOUND. Expected source-unique `sp_006` is strictly nested in both parents. The following counts and ranks hold independently for LEGACY, V4I and V4R3.

| Parent | Nested catalog spans | Rankable after excluding original refs | A expected rank | B | C | D |
|---|---:|---:|---:|---:|---:|---:|
| sp_001 | 31 | 30 | 11 | 1 | 25 | 1 |
| sp_002 | 18 | 18 | 8 | 1 | 14 | 1 |

The expected span is an existing identifier-like lexical span, not a newly generated substring. B1-B's historical exact lookup resolves it to one authoritative recipe candidate. Strategy B/K=1 chooses that same ref for both parents; boundary dedupe yields one new lookup per failed path. These three paths represent one distinct source, not three independent generalization examples.

## 5. Nested Span Structure

Candidate inclusion: existing catalog membership; source-exact text; candidate.start >= parent.start; candidate.end <= parent.end; at least one bound differs; within existing 160-code-point API mention bound. Exclude already queried original refs before ranking so the second original ref is not queried again. No new substring, fuzzy boundary or character rewrite is generated.

Triggered-parent population has six parents, counts [31,18] repeated three times. Arithmetic median=24.5, P95=31, max=31. Per failed path, the nested union contains 31 unique catalog spans before removing already queried refs, 30 rankable refs afterward. Only bounded prefixes are queried, never this entire set.

Important limitation: the first selected parent is the whole request, so its nested structural inventory covers nearly the entire catalog. This proposal avoids global authoritative lookup, not necessarily global metadata inspection. Catalog metadata is already capped at 128; structural comparison is bounded by that cap. If “no catalog scan” meant no metadata examination whatsoever, none of these rank-all nested strategies establishes that stronger constraint. No model-free full-catalog lookup is proposed.

## 6. Structural Ranking Strategies

All strategies have explicit deterministic tie-breaks: start offset ascending, then end offset ascending. Length is Unicode code-point count. Containment depth counts strict enclosing spans inside the same parent. No expected ref, group, entity name, business word, expected type or lookup success participates in the comparator.

- A — Maximal Specificity: shallower nested containment depth first, then longer proper nested span. Maximal nested units precede their fragments.
- B — Identifier Priority: identifier-like, quoted, combined, word-like; then longer span; then source offsets. Overlapping category ownership is made deterministic: identifier wins over quote, quote over other categories; pure word segments are WORD, remaining catalog combinations COMBINED. Classification uses the unchanged catalog's lexical mechanisms, not business patterns.
- C — Boundary Distance / Smallest Unit: shortest span first, then largest minimum distance to source sentence boundaries, then offsets. This is the explicitly selected smallest-lexical-unit form of Strategy C, not an unspecified post-result ranking.
- D — Hybrid Structural: B's lexical class order, then deeper containment, then longer span, then offsets.

Strategy B is preferred over D because both recover at K=1 and B needs no containment-depth tie-break. Synthetic non-business identifier fixtures verify deterministic ranking, containment and exactness; no frozen text is embedded in the algorithm. These simulations compare the four authorized hypotheses, not a real evaluation or prompt-tuning loop.

## 7. Nested-K Recall

K means a fixed prefix of each eligible parent's ordered list. Both prefixes are chosen before any hypothetical reads, then deduplicated without refilling. Recall is at the path-level union. No outcome-adaptive generation or extra candidates after dedupe.

| Strategy | K=1 | K=2 | K=3 | K=4 |
|---|---:|---:|---:|---:|
| A | 0/3 | 0/3 | 0/3 | 0/3 |
| B | 3/3 | 3/3 | 3/3 | 3/3 |
| C | 0/3 | 0/3 | 0/3 | 0/3 |
| D | 3/3 | 3/3 | 3/3 | 3/3 |

Minimum tested positive K=1. There is no rationale to increase it for the current failures. Stage1 Top-K stays exactly two and Stage1 calls stay one; no model retry is introduced.

## 8. Success-Path Non-Interference

Under the recommended complete-empty-union guard, 12/12 successes do not enter structural refinement or additional lookup. Their original candidate union, Stage2 input and finalization path remain unchanged by the proposed mechanism. This is deterministic control-flow simulation, not a runtime response equivalence measurement of an implementation that does not yet exist.

The unsafe per-parent-only interpretation is recorded separately in the dataset and cannot be used to claim success non-interference. Both PART_INVENTORY source groups remain unrefined, including the shared source fingerprint.

## 9. Coil / 800平刀 Safety

Coil: three complete authoritative coil hits paired with NOT_FOUND; request-level refinement trigger=0/3. Existing local read/cost choice is untouched.

FLAT_BLADE_PRICE: three authoritative AMBIGUOUS part/template results paired with NOT_FOUND; request-level trigger=0/3. Both original authority candidates remain present. No search for a more convenient unique answer, filtering by business words or overriding ambiguity is permitted.

## 10. Lookup Cost

At Strategy B/K=1, frozen all-path additional logical resolver/API calls have median=0, nearest-rank P95=1, max=1. Additional typed attempts: median=0, P95=6, max=6. Each Exact failure adds one deduplicated lookup; current successful paths add zero. Frozen total original + proposed reads: 30+3=33; typed attempts: 180+18=198 across the entire fifteen-path corpus. These are structural counts, not executed calls or measured latency.

For arbitrary eligible inputs the two parents may choose different refs. Recommended MAX_ENTITY_LOOKUPS_PER_PATH=4: two original plus at most 2*K_nested new refs, K_nested=1. General additional max=2 reads/12 typed attempts; full-path max=4 reads/24 typed attempts. The observed frozen full-path max is 3 reads/18 typed attempts, not the global safety cap.

Per-K deduped additional maxima for the frozen failed paths: A=[2,4,5,7], B=[1,2,3,5], C=[1,3,4,5], D=[1,3,5,5]. The dataset contains all 240 path/strategy/K simulations and their cost distributions. No outcome-guided refill or nested-of-nested recursion is allowed.

## 11. Batch API Option

Option 1, recommended: use existing one-mention `/api/entity-lookup` reads for the at-most-two new refs. One per failed path in this corpus; no new HTTP contract, dependency or data path needed.

Option 2: a new multi-mention endpoint could combine the two additional mentions into one HTTP read, but still performs the same typed authority work. At observed K=1 dedupe it saves zero HTTP calls; at the global cap it saves at most one. BATCH_API_RECOMMENDED=NO. Its added authorization/schema/completeness complexity is not justified by these counts. Neither option changes the six-type allowlist or authorizes V5 direct DB access.

## 12. False-Positive Risk

General risk classification UNKNOWN. For B/K=1, all three selected additional refs have existing expected-span authority evidence, each one recipe candidate/type; no additional unqueried span is admitted in this frozen simulation. This is materially narrower than B2-E's 390 unknown span outcomes.

Other strategies/larger K admit refs without evidence: for example B/K=2 introduces three unknown path/ref pairs; A/K=1 six; C/K=1 three. Those outcomes are explicitly UNKNOWN, never assumed NOT_FOUND. The dataset counts them. On other requests, even a syntactically valid identifier may name the wrong or an incidental entity; nested ranking conveys no authority to pick a final entity. No general false-positive rate or end-to-end improvement is established.

## 13. Candidate Union Safety

Future new lookup candidates must join an authoritative, completeness-checked union. Deduplicate by entityType + canonicalId, preserving matched source-ref provenance; never deduplicate by display text or choose by rank. Model-visible local classes contain no canonical IDs. Raw source and canonical data remain transient; traces/datasets retain only safe counts/status/ref metadata.

Every preselected new ref is handled under the fixed plan. Complete NOT_FOUND permits the next preselected read; it does not create new work. ERROR, TIMEOUT or INCOMPLETE invalidates the path; do not ignore it because another nested lookup succeeded. Execute the complete planned candidate acquisition rather than first-hit short circuit. Existing class filtering/finalization remains responsible for zero, one and multiple compatible candidates. Same-type multiplicity must stay FINAL_ENTITY_AMBIGUOUS. Preserve original exact anchor validation for any final source witness.

An implementation must explicitly bound the expanded union (at most four existing 30-candidate read responses, hence at most 120 before dedupe) and aggregate duration, with no truncation-to-unique. Existing per-read timeout remains a ceiling, not a measured latency promise. Validation must cover full-plan errors, capacity, provenance and request isolation. No candidate-set, finalizer or runtime code was changed here.

## 14. Architecture Comparison

| Architecture | Stage1 calls | Authority reads/path | Evidence / judgment |
|---|---:|---:|---|
| A_KEEP_TOP2_ONLY | 1 | 2 | measured 12/15; no recovery |
| B_TOP2_PLUS_BOUNDED_NESTED_REFINEMENT | 1 | frozen 2–3; general cap 4 | B/K=1 recalls 3/3 failures; no-hit guard preserves 12/12 successes; recommend future implementation |
| C_REMOVE_STAGE1_MODEL | 0 | proposed batch one HTTP, 162/198 median/max typed attempts | B2-E blocked on full union evidence/cost; not recommended here |
| BLOCKED | unchanged | unchanged | required if the complete-empty-union guard is rejected or broader guarantees are demanded |

## 15. Recommendation

Recommend TOP2_PLUS_BOUNDED_NESTED_REFINEMENT, Strategy B / K_nested=1 per parent, precomputed prefixes, dedupe without refill, MAX_ENTITY_LOOKUPS_PER_PATH=4, reuse existing API, and complete-empty-original-union guard. This mechanism retains the model-selected boundary and changes only bounded recovery after authoritative failure; it is not global Stage1 K escalation or model-free all-span authority search.

CAN_BOUNDED_NESTED_REFINEMENT_RECOVER_EXACT_FAILURES=YES for source recall plus historical authority evidence. Future actual Stage2 selection, final identity and capability success remain NOT_RUN. The guard is a mandatory part of this recommendation, not an optional optimization.

## 16. P15R-E-B2-F-B Preconditions

P15R_E_B2_F_B_READY=YES: authorized structural simulation identifies minimal K=1; all three Exact spans recover; twelve successes and coil/Flatblade stay untouched under the explicit guard; work bounded; no keyword, model retry or adaptive search loop; architecture selected. No implementation or real call occurred. Before any future real run, freeze the implementation and verify mixed-hit suppression, ambiguity/error/completeness preservation, duplicate-prefix handling, two-distinct-prefix maximum, timeout, union/provenance, privacy and concurrency with deterministic tests. No evidence supports changing frozen expected results or promising 15/15 real end-to-end success in advance.

Verification: audit assertions and saved-dataset reproduction PASS; catalog determinism, trigger truth table and synthetic ranking checks PASS; privacy sentinels PASS for reconstructed source/mention against audit dataset/report. Freeze hashes match the B2-D pre/post maps. DB SHA-256 before/after `09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e`, mtimeMs 1788424936315.8767, size 35323904 bytes, backups 209: unchanged. Model/API/Tool/V5 business-write counts=0. Full runtime regression and real evaluation NOT_RUN: no production changes. Existing user dirty files untouched.

Reproduce with `node scripts/audit-ai-v5-nested-span-refinement.cjs`. Output contains safe structures only. STOP — WAIT FOR SUPERVISOR REVIEW.
