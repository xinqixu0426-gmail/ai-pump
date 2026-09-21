# BUS-P6 — Legacy Redundancy & Simplification Audit

## Decision

Status: PASS

BUS-P6 audited historical answer protections without deleting, bypassing, reordering, or changing any production runtime behavior. The result does not identify any component that is globally safe to remove yet.

## Frozen audit artifacts

- LegacyWitnessCorpusV1: `tests/fixtures/legacy-witness-corpus-v1.json`
- Witness Corpus SHA-256: `30045b773a26f99eb339d3adb3e3f6ac9eab0b280e94e0e192bde4605db20f05`
- LegacyRedundancyMatrixV1: `docs/legacy-redundancy-matrix-v1.json`
- Matrix SHA-256: `800524e75819d7c6eff6642ca8a96e1c223314367d554477d498e38850a3741a`

The test-only `LegacyRedundancyHarnessV1` composes the existing public functions and bypasses exactly one protection per simulation. It adds no production flag or runtime branch.

## Responsibility result

| Component | Classification | Semantic overlap | Unique remaining responsibility |
|---|---|---|---|
| Money Guard | `REQUIRED_SAFETY` | Supported Semantic answers are replaced with grounded deterministic conclusions | Numeric provenance for Legacy/OUT_OF_SCOPE and other non-Semantic answers |
| Cross Catalog | `PARTIALLY_REDUNDANT` | Semantic identity/evidence represents cross-catalog candidates and their exact cost basis | Bounded discovery and disclosure for Legacy-authoritative requests |
| Coil Variant postprocessor + ambiguity lookup | `PARTIALLY_REDUNDANT` | Semantic official candidate scope, ambiguity, obligations, and clarification cover supported kinds | Executor enrichment and Legacy answer repair outside Semantic ownership |
| Business Rulebook answer enforcement | `PARTIALLY_REDUNDANT` | Semantic requested/actual cost basis and unsupported-request boundary replace unsafe supported answers | Cost-basis disclosure on Legacy/OUT_OF_SCOPE answers; the Rulebook document remains authoritative |
| Legacy coil→recipe repair | `PARTIALLY_REDUNDANT` | `FORMAL_RELATION_RESULT` supplies the same canonical bounded result for supported Semantic relation questions | Deterministic completion when a relation turn remains Legacy-authoritative |

`REDUNDANT_UNDER_SEMANTIC`: none.

Because no component was classified `REDUNDANT_UNDER_SEMANTIC`, Supervisor rule 10 does not require a 64-execution real-model bypass run. Running one would spend local-model capacity without satisfying a missing evidence condition. The accepted SyntheticBusinessAcceptanceV1 baseline remains 64/64 PASS for the unchanged production path.

## Witness evidence

- LW-01 makes Money Guard replace an unsupported `999` amount with the formal `201` amount. With only Money Guard bypassed, the unsafe draft survives, while Semantic independently returns `201.00` for the supported question.
- LW-02 makes the historical cross-catalog path append the verified V800 part candidate. With it bypassed, the Legacy draft loses the candidate, while Semantic independently labels the verified part unit cost and does not call it machine cost.
- LW-03 makes the historical coil variant postprocessor append the missing second official variant. With it bypassed, the Legacy draft implies one variant, while Semantic independently discloses both official variants.
- LW-04 makes `BR-COST-BASIS` identify a machine-cost claim backed only by coil evidence. Semantic independently returns `PARTIAL_VERIFIED` and rejects the machine-cost conclusion.
- LW-05 makes `BR-HYPOTHETICAL-PRICE` state that the current formal amount was not recalculated at the requested copper price. Semantic independently returns `UNSUPPORTED_REQUEST` and preserves current-versus-hypothetical semantics.
- LW-06 exercises the bounded Legacy `search_coils → get_recipes_by_coil` repair. Semantic independently verifies `FORMAL_RELATION_RESULT` for the same canonical coil root.

Each bypass test keeps every other protection unchanged. The harness asserts that the historical trigger disappears only for the selected component while the Semantic result remains identical.

## Production observation

The current stable telemetry does not provide per-postprocessor activation counters for all audited components. BUS-P6 did not add production instrumentation because that would change runtime behavior solely for this audit. Existing deterministic witnesses are sufficient for the classification proposal; any deletion remains a separate Supervisor-authorized phase.

## Safety boundaries preserved

- Legacy components removed: 0
- Production execution order changed: NO
- Production runtime changed: NO
- Production data changed: NO
- New production feature flags: 0
- Ontology relations added: 0
- Cost formula or cost engine changed: NO
- HTTP/API contract changed: NO
- Local-model bypass candidates: 0

## Validation

- Legacy witness/audit tests: 8/8 PASS
- Focused Legacy + Benchmark V2 + Synthetic V1 + Production Shape: 71/71 PASS
- SyntheticBusinessAcceptanceV1 accepted real local baseline: 64/64 PASS, fallback 0, critical failures 0, production writes 0
- Full repository regression: 2725/2725 PASS
- API contract: 27/27 PASS
- Deep API: 490/490 PASS, temporary database integrity OK, foreign-key violations 0
- Lint: PASS
- Web build: PASS

## Recommendation

Do not start BUS-P6R removal yet. The current evidence supports retaining Money Guard globally and retaining the other four groups until a removal phase can explicitly narrow Semantic ownership versus Legacy/OUT_OF_SCOPE behavior. If Supervisor later authorizes simplification, select only one responsibility slice—not an entire component group—and add a real local-model bypass gate for any slice proposed as fully redundant.

One-sentence conclusion: Semantic Enforcement now duplicates major supported-business responsibilities, but every audited Legacy group still has a verified safety or Legacy-authoritative duty, so BUS-P6 recommends no deletion.
