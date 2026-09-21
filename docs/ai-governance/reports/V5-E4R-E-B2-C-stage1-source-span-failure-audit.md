# V5-E4R-E-B2-C Stage1 Source-Span Failure Audit

## 1. Executive Result

P15R-E-B2-C = PASS (audit completion only). P15R_E_B2_D_READY=YES; P16 remains NO.

All 15 frozen paths reconstructed; 9 correct selections and 6 boundary errors. Every failed selection is the whole request, a strict superspan of the correct identity. Correct source spans exist and are source-unique in 6/6 failures (15/15 overall). This is not an exact-anchor failure or a missing-candidate failure.

STAGE1_SPAN_ROOT_CAUSE=SPAN_SELECTOR_SELECTION_FAILURE. Catalog overgeneration is a documented contributing exposure, not a causally isolated explanation. Recommend MODEL_TOP_K_SPANS_ONE_CALL, K=2, for a future approved experiment, not as a proven repair. No prompt rewrite, pruning implementation, model/API invocation, or production change occurred.

## 2. Frozen B2-B Evidence

Start commit: edd109f3dfcced4a0fad69103fd82f6c57c612de, branch master, dirty worktree preserved. The audit compares all hashes returned by the frozen evaluator's freezeHashes with both B2-B pre/post maps, including selectors, contracts, runtime, lookup boundary, settings, corpus and expected cases. All match.

Sources: `v5-e4r-candidate-set-two-stage-valid-evaluation.json` and its B2-B report; frozen P06 case definitions; `v5-e4r-entity-first-architecture-audit.json`; existing B1-B lookup dataset and B1-C ambiguity audit. The frozen evaluator's exact fixture-construction definitions are read, not executed. A read-only fixture connection recovers source text transiently by the frozen input fingerprint; each group must have exactly one matching identity. No business identity is exported. There are 15 paths, 5 source groups, 4 distinct request fingerprints; no new semantic evaluation.

Stage1 VALID=15/15, protocol noncompliance=0, source selection=9/15, observed same-input consistency=100%. Consistency does not imply correctness. Existing authoritative expected-span lookup evidence: Exact group RESOLVED; Flatblade group AMBIGUOUS across part/template; other groups RESOLVED. These are historical observations, not new lookup results.

## 3. Source Span Catalog Structure

Catalog version 1 uses Unicode word segmentation, ASCII identifier runs with connector punctuation, up to six adjacent word-like segments, quoted content, and the whole request. It deduplicates exact start/end pairs, sorts by start then descending length, caps at 128, and exposes reference/text only. It does not expose provenance or semantic entity authority to Stage1. Whole-request sp_001 is therefore an eligible item, not an invalid reference.

| Source group | Total | Identifier | Word | Combined | Quoted | Expected ref | Expected categories |
|---|---:|---:|---:|---:|---:|---|---|
| COIL_INVENTORY | 19 | 1 | 4 | 19 | 0 | sp_005 | identifier, combined |
| EXACT_RECIPE_COST | 32 | 1 | 6 | 30 | 0 | sp_006 | identifier |
| FLAT_BLADE_PRICE | 34 | 1 | 8 | 33 | 0 | sp_002 | combined |
| PART_INVENTORY_PRIMARY | 28 | 3 | 7 | 27 | 0 | sp_005 | combined |
| PART_INVENTORY_REPEAT | 28 | 3 | 7 | 27 | 0 | sp_005 | combined |

Categories are overlapping provenance-compatible memberships reconstructed from the frozen lexical rules, not additive partitions. Combined includes the loop's single-word outputs. Word counts include only spans actually retained in the catalog. Quoted-span preservation has no frozen coverage here. Counts depend on this Node/ICU segmentation environment; exact catalogs and selected signatures were checked deterministically.

## 4. Six Failed Paths

| case_id | Expected | Selected | Relation | Source unique | Lookup |
|---|---|---|---|---|---|
| P06-EXACT-001-LEGACY | sp_006 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |
| P06-EXACT-001-V4I | sp_006 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |
| P06-EXACT-001-V4R3 | sp_006 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |
| P06-FLATBLADE-001-LEGACY | sp_002 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |
| P06-FLATBLADE-001-V4I | sp_002 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |
| P06-FLATBLADE-001-V4R3 | sp_002 | sp_001 | SUPERSPAN / whole request | YES | NOT_FOUND |

The safe dataset contains all 15 per-path references, validity/match flags, neighborhoods, lookup outcomes and pruning simulations. First divergence is Stage1's reference selection, before authority lookup. A valid source reference is not proof of business identity.

## 5. Exact Entity

Expected available=3/3; source-unique=3/3; boundary errors=3; semantic-selection errors=0. Expected exact identifier has zero strict subspans, five strict superspans and five non-containing overlaps. Selected reference includes surrounding request content. No character rewrite occurred: the complete correct identity is available, but the model selected too much source. Prior B1-B evidence for the expected identity is RESOLVED, complete; no new API call was made.

## 6. 800平刀

FLAT_BLADE_PRICE expected available=3/3; source-unique=3/3; boundary errors=3; semantic-selection errors=0. Expected source is a combined span, with 20 strict subspans, one strict superspan and nine non-containing overlaps. The sole strict superspan is the wrong whole-request choice.

Historical expected-span lookup is AMBIGUOUS with authoritative part/template candidates, not NOT_FOUND. B1-C's expected-class simulation preserves the correct local class and yields a unique final candidate. That does not prove a future local model will select it. Do not conflate the suite label with the entire recovered authoritative identity or inject the label as a lookup fixture.

## 7. Successful Controls

Coil 3 paths use sp_005 in a 19-span catalog; each has zero contained fragments, four superspans and four non-containing overlaps. Both part-inventory groups (6 paths, one shared fingerprint) use sp_005 in 28-span catalogs; each has five contained fragments, four superspans and eight non-containing overlaps. All are EQUAL selections. Success also occurs amid noisy neighborhoods. Failure catalogs are larger (32/34), but four distinct requests do not establish size as the sole causal variable.

## 8. Span Boundary Failure

Boundary errors=6; Exact=3, Flatblade=3. The classification counts strict sub/super/overlap as boundary error. These failures preserve the entity within a selected superspan rather than choosing an unrelated entity. Catalog boundaries are exact and deterministic; SOURCE_SPAN_BOUNDARY_DESIGN_FAILURE=NO in the sense of broken source boundaries or missing exact identity. Whole-request eligibility is a granularity/noise design risk, not evidence to weaken anchoring.

## 9. Semantic Selection Failure

Semantic-selection errors (unrelated/non-entity choice rather than boundary errors)=0; other errors=0. This does not exonerate the selector: all six boundary choices are wrong semantic reference selections while remaining schema-valid.

Prompt 1.1 explicitly specifies primary business entity, complete identity, excluding surrounding question/operation, no rewriting or invented references, and clarification when no single primary entity exists. Generic operation exclusion is expressed through the surrounding-operation rule; fragment exclusion is implicit in complete identity, not a separate literal rule. No missing JSON rule is involved. Stage1 must identify entity-bearing text, choose a primary entity and choose boundaries without authoritative lookup: burden HIGH relative to a pure reference-validation task. The evidence does not meet the user's clean-catalog prerequisite for assigning primary PROMPT_FAILURE.

## 10. Catalog Overgeneration

OVERGENERATION=YES as structural mixed-granularity exposure. Path-weighted median/max catalog size=28/34; median/max strict subspans=5/20; median/max strict superspans=4/5. Whole request and many operation-bearing combinations compete with complete identity. Non-containing overlap excludes strict sub/superspans; same-start/end counts exclude self. Counts and exact membership are in the dataset.

No candidate missing, repeated expected substring, nondeterminism, fabricated expectation, or source-identity corruption was observed. Overgeneration is secondary evidence; no experiment here proves that removing it alone fixes model accuracy.

## 11. Structural Pruning Simulation

SIMULATION_ONLY. Rules are uniform lexical/source rules; none inspect domain words, entity labels or expected values when constructing the retained set. Expected values are used only to score survival.

| Rule | Expected survives /15 | Failed wrong removed /6 | Median count | Max count |
|---|---:|---:|---:|---:|
| Exact boundary dedupe | 15 | 0 | 28 | 34 |
| Suppress fragments inside maximal connector-preserving identifiers; preserve quotes | 15 | 0 | 28 | 34 |
| Retain globally maximal spans and quotes | 0 | 0 | 1 | 1 |
| Retain maximal identifiers, word-like spans and quotes, suppress identifier fragments | 6 | 6 | 7 | 8 |

The existing catalog already handles duplicates and identifier-internal fragments. The observed errors are superspans, so further fragment suppression does not remove them. Global maximal pruning retains the whole request and destroys all expected identities. The aggressive lexical-only set loses combined identities. Quoted preservation cannot rescue unquoted fixtures. Option B fails its required preservation-plus-removal gate. The headline pruning metrics use the conservative identifier-nested simulation: 15/15, 0/6, 28/34; all variants remain visible above.

## 12. Top-K Span Option

Recommend a future MODEL_TOP_K_SPANS_ONE_CALL experiment with K=2, feasibility PARTIAL. Every failed pair contains two distinct valid catalog references (whole request plus exact identity); thus correct and current wrong choices can coexist within two slots. This is plausibility, NOT measured top-2 recall. Do not assume the model will supply the correct second item.

Stage1 remains one call, no retry or lookup-guided re-selection. Look up the predeclared distinct refs only. Current Business API batches up to six entity types for ONE mention; it cannot batch multiple mentions. Reusing it means at most two API reads / twelve typed attempts, not one HTTP call. A true multi-mention batch would require separate Supervisor-approved API work. Keep existing per-read bounds plus an explicit aggregate cap, completeness and timeout rules; never truncate and claim unique authority.

Store candidate provenance per span; dedupe identities by type+canonical ID in software. Both spans can independently resolve to different legitimate entities: neither ranking nor first-success may choose a canonical entity. Preserve ambiguity/clarification, keep all IDs and source texts out of model-visible authority metadata/logs, and retain deterministic finalization. Zero matches stays NOT_FOUND with NO RETRY. Cost/latency changes are UNKNOWN, not measured. K=2 is the smallest bounded coverage hypothesis; no evidence justifies paying for K=3 yet.

## 13. Deterministic Multi-Span Option

NOT_FEASIBLE on the tested generic rules for the required small-K/full-survival gate. The safe rules leave as many as 34 spans; the small aggressive set loses 9/15 correct spans. This is not a proof that every conceivable lexical method is impossible. Existing API also lacks multi-mention batching. Do not enumerate all 128 spans or silently invent a batch endpoint.

## 14. Architecture Comparison

| Option | Stage1 calls | Existing API reads | Evidence / decision |
|---|---:|---:|---|
| A keep single span | 1 | 1 | Current safe fail-closed boundary; measured 9/15; no demonstrated improvement |
| B structural prune + single span | 1 | 1 | No tested rule meets 15/15 preservation and meaningful wrong-item removal |
| C model top-K refs | 1 | at most 2 for K=2 | Bounded generic experiment; top-2 recall unknown; recommended subject to approval |
| D deterministic small-K lookup | 0 | K, no current multi-mention batch | Required small-K survival not established; not recommended |

Stage2 is separate: this comparison counts only Stage1 calls and authority acquisition, not any later local-intent model. No alternative grants write, Tool, routing or canonical-identity-selection authority to the model.

## 15. Root Cause

Primary SPAN_SELECTOR_SELECTION_FAILURE: six wrong-but-valid whole-request references instead of available unique expected references. Secondary SOURCE_SPAN_CATALOG_OVERGENERATION: mixed-granularity candidate exposure with counted near-neighbor noise. No evidence for SOURCE_SPAN_CATALOG_FAILURE, MODEL_NONDETERMINISM or EVALUATOR_EXPECTATION_FAILURE. ENTITY_BEARING_SPAN_AMBIGUITY due repeated expected substring is absent. Limited semantic context contributes task burden but is not established as an independent causal defect. Resolver NOT_FOUND correctly fails closed for the selected wrong spans.

## 16. Recommended Next Step

MODEL_TOP_K_SPANS_ONE_CALL, K=2, only after Supervisor authorizes its new Stage1 output contract and bounded multiple lookup budget. Preserve exact source ownership, strict refs, frozen expected results, no retries, candidate completeness, privacy, and software-only finalization. Predeclare recall/false-positive/ambiguity/latency metrics and one-shot rules before future evaluation. Do not implement or tune within this audit.

## 17. P15R-E-B2-D Preconditions

Audit gate satisfied: 15/15 paths reconstructed, 6/6 errors separated, span availability/uniqueness measured, four structural simulations scored, bounded alternative selected. No claim of future top-K accuracy or P16 readiness.

Verification: audit script assertions PASS (frozen pre/post hashes, deterministic catalogs, unique fixture recovery, frozen match reconstruction, safe-output sentinel check, DB snapshots). Dataset reproducibility and diff checks PASS. Full runtime regression NOT_RUN because production is unchanged and this audit prohibits real model/API execution. The script only prints safe JSON; deliverables were created separately. No secrets/environment files were read by the audit runner; no provider or server was started.

DB before/after: SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e; mtimeMs 1788424936315.8767; size 35323904; backup files 209. All unchanged. Model calls=0, API calls=0, Tool calls=0, V5 writes=0. Production/interpreter/dependencies changed=NO. Only analysis script, safe dataset and this report are staged; existing user files remain untouched.

Limitations: one frozen evaluation, four unique request fingerprints; no causal ablation or measured top-K output. Provenance labels are reconstructed, overlapping structural categories. Historical expected lookup evidence is not refreshed. Prior B2-B narrative describing all R02 exclusions as empty-exposure success is too broad: only the Flatblade R02 path is empty-exposure; the two other frozen R02 paths successfully route. Frozen results remain unchanged.
