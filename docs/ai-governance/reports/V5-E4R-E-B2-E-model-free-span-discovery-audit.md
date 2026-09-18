# V5-E4R-E-B2-E Model-Free Multi-Span Entity Discovery Audit

## 1. Executive Result

Audit status: PASS; implementation decision: BLOCKED. SHOULD_STAGE1_MODEL_BE_REMOVED=INCONCLUSIVE. P15R_E_B2_F_READY=NO; P16 remains unauthorized.

Structural survival is 15/15. However, 390 of 408 eligible path/span pairs have no frozen lookup evidence. A unique entity in the known subset does not prove uniqueness in the expanded set. The mandatory final-unique 15/15 simulation cannot be established without treating unknown results as negative, which this audit explicitly refuses.

Start commit: `7f88833386d418996ddf622169b58363ab0c47e0`; branch master; dirty worktree preserved. Only this report, a safe dataset and an offline analysis script are delivery changes.

## 2. Frozen Top2 Evidence

Sources: `v5-e4r-top2-source-span-evaluation.json`, its B2-D report, B2-C source-span audit/dataset, B1-B resolution dataset and B1-C ambiguity audit. Frozen case definitions are those embedded in the unchanged Top2 evaluator. Fifteen paths, five source groups, four input fingerprints. Final correctness 12/15, Stage1 Top1 12/15 and recall@2 12/15; reached Stage2 6/6. These are historical results, not new runs.

The offline script reconstructs source fixtures using the existing readonly fixture-recovery path and verifies frozen input fingerprints. It does not query entity candidates for any new span, invoke a resolver, initialize the business server or call a model/API. Raw source material remains transient. B2-C lexical inventory is verified against regenerated unmodified catalogs. Pre/post interpreter freeze hashes and DB snapshots match.

## 3. Why K Escalation Is Rejected

TOP_K_ESCALATION=REJECTED. Top2 added no expected-span recall over Top1. This supplies no evidence for K=3 or K=4. No prompt/model/retry change is proposed.

## 4. Source Span Inventory

Counts are per source group; each has three runtime paths. Unique boundaries and unique texts equal total counts in these fixtures. Categories overlap and therefore must not be summed.

| Group | Total / unique | Identifier | Word | Combined | Quoted | Eligible | Typed attempts |
|---|---:|---:|---:|---:|---:|---:|---:|
| COIL_INVENTORY | 19 / 19 | 1 | 4 | 19 | 0 | 18 | 108 |
| EXACT_RECIPE_COST | 32 / 32 | 1 | 6 | 30 | 0 | 31 | 186 |
| FLAT_BLADE_PRICE | 34 / 34 | 1 | 8 | 33 | 0 | 33 | 198 |
| PART_INVENTORY_PRIMARY | 28 / 28 | 3 | 7 | 27 | 0 | 27 | 162 |
| PART_INVENTORY_REPEAT | 28 / 28 | 3 | 7 | 27 | 0 | 27 | 162 |

Global span median/max: 28/34. Eligible median/max: 27/33. All five catalogs are deterministic under the current runtime. This is not a portability claim across Intl.Segmenter versions.

## 5. Lookup-Eligible Structural Rules

Proposed simulation only: retain catalog spans that are nonempty, source-exact and at most 160 Unicode code points; exclude an entire-request span when proper smaller catalog spans exist. Retain identifier, quoted, word and combined candidates without business filtering. Deduplicate boundaries; preserve distinct provenance. Reject a catalog exceeding the proposed batch limit instead of selecting the first N.

Expected survival is 15/15. No keyword, model prefix, business name, expected class or known lookup result participates in filtering. Whole-request exclusion is proven safe only for these fixtures: a standalone identity request elsewhere could require it. Future adoption needs that limitation handled explicitly, not an unconditional production claim.

## 6. Exact Entity

All three expected `sp_006` references survive: identifier category, proper source substring, within existing mention-length bound. `sp_001` is the whole request and is excluded. `sp_002` is a non-whole superspan and remains eligible, with historical NOT_FOUND evidence. Blanket superspan removal or identifier-only filtering is not recommended: combined source identities in other groups would be lost. B1-B supplies the expected span's authoritative recipe candidate; B2-D supplies the two negative selected spans. No new lookup was performed.

## 7. 800平刀

The FLAT_BLADE_PRICE expected `sp_002` is a combined span and survives 3/3. Known expected-span candidates are part and template, both authoritative; their known local union is `tc_002` and `tc_027`. Expected `tc_002` preserves one known part candidate in simulation. Additional eligible spans may add other part candidates: final uniqueness for the full union is UNKNOWN.

## 8. Coil

Expected `sp_005` survives 3/3, identifier/combined category. Known coil candidate supplies local `tc_003` and `tc_004`; expected `tc_004` survives. The current reached Stage2 success is not a test of a larger, previously unseen candidate union.

## 9. Multi-Mention Batch API

Conditional design, not implementation: prefer a separate governed `POST /api/entity-lookup/batch`, leaving single-mention V1 unchanged. Request: version, unique request-local span references paired with exact transient mentions, server-validated entityTypes, existing matchPolicy. No table, SQL, column or arbitrary filter fields. Preserve existing internal authentication and six-type allowlist: coil, customer, order, part, recipe, template.

Return per-span status/completeness plus minimal typed canonical candidates. Preserve aggregate completeness and distinguish INVALID_REQUEST, unsupported type, internal error, complete zero and incomplete results. Never convert an error to NOT_FOUND. A future boundary deduplicates by entityType + canonicalId and retains internal matchedSpanRefs. Canonical values never reach the model. Stage2 receives only candidate types, local class semantics and safe references. No Tool dependency, V5 direct DB, mutation or write authority is required. No DB schema, dependency or V4 change is structurally necessary; existing exact read adapters can be reused behind the Business API.

Mentions, span text, candidate identities and canonical IDs must be excluded from normal logs, traces and persisted datasets. Trace only counts/status/duration; any safe reference provenance must omit text.

## 10. Bounded Fanout

Proposed design limits: 40 mentions (observed maximum 33 with modest headroom), six types, existing 160-code-point mention limit, ten candidates/type, thirty candidates/mention, 120 aggregate candidates. The aggregate cap is a conservative safety budget, not a measured business-size requirement. Overflow at any level means INCOMPLETE and fail closed, never first-result selection. No evidence yet proves this cap accommodates every expanded lookup result.

Current Top2: two HTTP reads and twelve typed attempts/path. Proposed structural batch: one HTTP read, median 27 mentions / 162 attempts, maximum 33 / 198. Absolute proposed cap: 240 typed attempts. Full existing catalog without whole-request exclusion: median 168, max 204 attempts. Classification HIGH: 13.5x median and 16.5x maximum typed work relative to Top2 despite halving HTTP fanout. No milliseconds or overall speedup are claimed.

The existing service uses bounded result queries, including composite/cast identity comparisons. LIMIT bounds returned rows, not necessarily rows examined; query-count boundedness is not a proof of cheap DB execution. Latency/query-plan feasibility remains unmeasured.

## 11. Candidate Union

Evidence is attached to exact request-local spanRefs. Only eighteen of 408 eligible path/span pairs have lookup evidence: fifteen expected-span results from B1-B and three additional negative Exact superspan results from B2-D. The remaining 390 are UNKNOWN, not NOT_FOUND. Across five source groups this is six known / 136 eligible; repeated runtime paths do not create new coverage.

Known-subset candidate median/max: 1/2. Known-subset type median/max: 1/2. Full-union candidate/type counts: UNKNOWN. These lower bounds do not estimate incidental-entity or false-primary selection rates. Historical absence of same-type collisions among selected spans cannot rule out collisions among unqueried spans.

## 12. Local Task Class Survival

Expected class survives the known authoritative subset 15/15. Adding candidate types preserves that membership in an untruncated union: expected-class survival is monotonic. Known-subset local-class median/max: 2/4; full-union local-class median/max: UNKNOWN. A cap failure must block execution rather than silently discard a class or candidate. Membership does not establish correct Stage2 selection.

## 13. Final Entity Simulation

SIMULATION_ONLY: applying the frozen expected class to the known candidate subset yields a unique entity 15/15, as established by B1-C. Applying it to the full eligible-span candidate union is UNKNOWN for all fifteen paths. Unlike class membership, uniqueness is not monotonic under set expansion. The full-union final-unique gate is therefore unproven, not 15/15 and not an observed zero-success rate.

## 14. Same-Type Multi-Entity Risk

Classification UNKNOWN for this expanded frozen lookup set. Mechanically, two distinct canonical entities of the same compatible type both survive a class type filter; finalization must return FINAL_ENTITY_AMBIGUOUS. A local task class cannot identify which same-type source entity was primary. The current single-primary frozen contracts contain no dedicated same-type multi-entity acceptance case, and unqueried spans prevent claiming NONE_IN_FROZEN_CORPUS.

Multiple spans/requests with incidental entities require an explicitly governed primary-span or multi-entity task mechanism; this audit does not design a hidden model identity selector. Fifteen paths/four texts are insufficient to establish general multi-entity suitability, and evidence is incomplete even for all expanded current single-primary inputs.

## 15. Architecture Comparison

| Option | Stage1 model | HTTP/path | Typed attempts median/max | Evidence / limitation |
|---|---:|---:|---:|---|
| A TOP2_MODEL | 1 | 2 | 12/12 | observed final 12/15; Exact missed |
| B all source-exact bounded catalog spans | 0 | 1 proposed | 168/204 | expected spans present; union uniqueness unknown |
| C structural eligible spans | 0 | 1 proposed | 162/198 | survival 15/15; full union unknown; HIGH fanout |
| D keep Stage1 unchanged | 1 | 2 | 12/12 | no authorized accuracy improvement; same baseline as A |

Only Stage2 remains when local selection is needed in B/C. Candidate provenance remains software-owned. All model-free claims are designs, not measured evaluations.

## 16. Stage1 Model Removal Decision

INCONCLUSIVE. Removing Stage1 would remove its model-call/token cost, provider latency variability and model boundary-selection failure mode. It would not remove Stage2 provider dependence, incidental-entity ambiguity or DB-query cost. Expected span recall improves in structural simulation; end-to-end correctness and total latency improvement are unproven. No further K/model/prompt tuning is recommended.

## 17. Recommended Architecture

BLOCKED pending Supervisor direction on missing authoritative per-span evidence and bounded acquisition validation. The candidate design to assess is MODEL_FREE_STRUCTURAL_SPANS_BATCH_LOOKUP, but it is not an approved implementation recommendation because the required final-unique simulation is UNKNOWN. No batch endpoint or Stage1 removal was implemented.

## 18. P15R-E-B2-F Preconditions

P15R_E_B2_F_READY=NO. Missing: authority evidence for 390 eligible path/span pairs, full-union final uniqueness, aggregate-cap sufficiency and query-cost assessment. Any future evidence acquisition requires explicit authorization; this audit did not make calls to fill those gaps.

Verification: offline audit assertions pass; repeated output agrees with the saved dataset; frozen interpreter hashes unchanged. Privacy sentinels check reconstructed raw requests/mentions against the safe dataset/report. DB before/after SHA-256 `09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e`, size 35323904, mtimeMs 1788424936315.8767, backup count 209, all unchanged. Model/API/Tool/business-write calls: zero. Full runtime regression NOT_RUN: no runtime change and no authorization to rerun the frozen evaluation. No production/dependency change, no user file cleanup.

Reproduction: `node scripts/audit-ai-v5-model-free-span-discovery.cjs`; stdout contains safe structure only. The committed dataset contains per-path per-span UNKNOWN markers and distinguishes known-subset simulation from full-union uncertainty. STOP — WAIT FOR SUPERVISOR REVIEW.
