# M4-P0 Legacy Decontamination Delete Matrix

**Scope:** remove retired AI implementation and executable acceptance assets before Business Understanding V1 begins.  This is an evidence-only cleanup: no product runtime, Business API, `costEngine`, schema, or Domain Policy behavior changes are included.

## Closure method

For every candidate family, repository references were checked across runtime imports, tests, package and release scripts, API consumers, and documentation links.  An item was deleted only when all three current consumer sets were zero:

- `CURRENT_RUNTIME_CONSUMERS = 0`
- `CURRENT_BUSINESS_CONSUMERS = 0`
- `CURRENT_RELEASE_GATE_DEPENDENCY = 0`

Historical Git commits remain the immutable record for the retired material.  They are not an active source of architecture or release authority.

## Matrix

| Path / family | Classification | Current consumers | Reason | Replacement / current authority |
|---|---|---|---|---|
| `docs/business-understanding-benchmark-v1.md`, `docs/business-understanding-benchmark-v2.md`, `docs/business-understanding-baseline-v1.json`, `docs/business-understanding-baseline-v2.json` | DELETE | Runtime 0; Business 0; Release 0 | Mixed retired benchmark contracts joined old identity, cost, evidence and orchestration rules. | A future Business Understanding V3 must define its own scoped benchmark; current M3 evidence lives under `planning/ai-assistant-mvp-v1/`. |
| `tests/businessUnderstandingBenchmark.test.cjs`, `tests/fixtures/business-understanding-benchmark-v*.json`, `tests/helpers/businessUnderstandingEvaluator.cjs`, `tests/helpers/businessUnderstandingFixture.cjs`, `tests/helpers/businessUnderstandingOracle*.cjs` | DELETE | Runtime 0; Business 0; Release 0 | Executable implementation of the retired V1/V2 benchmark. | `tests/syntheticBusinessAcceptanceV1.test.cjs` remains a current isolated business regression and now uses neutral helper names. |
| `tests/helpers/businessUnderstandingFixtureV2.cjs` | DELETE (renamed/replaced) | Old name: Runtime 0; Business 0; Release 0 | The generic test-data builder was the only reusable portion; retaining the old name would preserve false V2 authority. | `tests/helpers/syntheticBusinessAcceptanceBaseFixture.cjs` is a neutral current test fixture. |
| `docs/business-semantic-enforcement-p2.md`, `docs/business-semantic-frame-v1.md`, `docs/business-semantic-frame-v1-baseline.json`, `tests/fixtures/business-semantic-frame-oracle-v1.json`, `tests/helpers/businessSemanticFrameFixture.cjs` | DELETE | Runtime 0; Business 0; Release 0 | Retired semantic-frame / enforcement architecture. | Current Answer Validator and Fact Ledger contracts under `api/services/ai-assistant/**` and M3-3 evidence. |
| `docs/ontology-runtime-shadow-v1.md`, `docs/ontology-traversal-shadow-v1.md`, `docs/handoff-ontology-owner-canary-supervisor-2026-09-20.md`, `docs/handoff-ai-depth-review.md`, `docs/l5-off-compatibility-v1.md`, `docs/legacy-redundancy-audit-v1.md`, `docs/legacy-redundancy-matrix-v1.json`, `docs/ai-native-v1-handoff.md` | DELETE | Runtime 0; Business 0; Release 0 | Shadow, canary, handoff and fallback material describes a physically retired AI architecture. | Current M3 baseline, capability, fact-ledger and final acceptance reports. |
| `tests/fixtures/ontology-coil-recipe-canary-v1.json`, `tests/fixtures/ontology-coil-recipe-legacy-oracle-v*.json`, `api/services/ontologyRelationCanaryEligibility.cjs`, `tests/ontologyRelationCanaryEligibility.test.cjs` | DELETE | Runtime 0; Business 0; Release 0 | Canary eligibility had no current importer; fixtures only exercised retired observation paths. | Current formal resolver and Agent adapter under `api/ontology/` and M3-2. |
| `tests/helpers/ontologyShadowFixture.cjs` | DELETE (renamed/replaced) | Old name: Runtime 0; Business 0; Release 0 | Its data is still used by current isolated ontology tests, but it is not a Shadow implementation. | `tests/helpers/ontologyFormalFixture.cjs` retains the identical formal test-fixture responsibility. |
| `scripts/phase-d/**`, `scripts/run-business-understanding-benchmark.cjs`, `scripts/check-ontology-routing-local-provider.cjs`, `scripts/verify-s2r3p1-counters.cjs` | DELETE | Runtime 0; Business 0; Release 0 | One-off retired validation scripts; one counter script depended on a deleted release artifact. | Current `npm` gates and `scripts/verify-ai-assistant-release.cjs`. |
| `planning/ai-native-v1/**`, `planning/ai-native-w1*/**`, `planning/ai-native-w2*/**` | DELETE | Runtime 0; Business 0; Release 0 | Retired Task/Dispatcher rollout, hard-cut, canary and early write plans/release records. | `planning/ai-assistant-mvp-v1/M3-{0,2,3,5}/` holds the current retained M3 evidence. |
| `planning/ai-assistant-mvp-v1/M0-audit/**` | DELETE | Runtime 0; Business 0; Release 0 | M0 described the retired architecture and has no current release dependency. | M3-0 Baseline Freeze is the current Assistant comparison baseline. |
| `planning/ai-native-v1/implementation/N7.2/legacy-*`, `tests/fixtures/legacy-witness-corpus-v1.json`, frozen-history / retired task fixtures | DELETE | Runtime 0; Business 0; Release 0 | Legacy witness and retirement artifacts are not executable current safety evidence. | Current focused Assistant safety tests and M3 release gate. |
| `docs/ai-business-rulebook.md`, `docs/business-impact-enforcement-v1.md` | DELETE | Runtime 0; Business 0; Release 0 | Retired prompt/semantic-rule documentation was linked as if authoritative and contradicted current M3 architecture. | Published Domain Policy, `docs/ai-assistant.md`, M3 baseline and current runtime contracts. |
| `docs/technical-debt.md` retired AI Native V1 section; stale doc-entry links | KEEP_CURRENT (edited) | Current documentation entry point | Its old section misrepresented retired runtime as current debt. | Replaced with current M3 Assistant boundary; operations history remains separately retained. |
| `api/services/legacyPartNaming.cjs` | KEEP_BUSINESS_COMPATIBILITY | `api/services/partCommands.cjs` | Formal catalog naming compatibility; not AI runtime. | Existing Business API / part-command contract. |
| `api/services/recipeTechnicalLegacyProjection.cjs` | KEEP_BUSINESS_COMPATIBILITY | `api/services/recipeTechnicalProfile.cjs`, its regression test | Formal technical-profile projection compatibility; not AI runtime. | Existing recipe technical-profile service. |
| `api/services/recipeTechnicalLegacyWriteGuard.cjs` | KEEP_BUSINESS_COMPATIBILITY | `api/services/recipeCommands.cjs`, `tests/recipeTechnicalLegacyWriteGuard.test.cjs` | Formal historical recipe-write protection; not AI runtime. | Existing recipe command and write-safety contract. |
| `api/business-semantics/**`, `api/services/aiResourceResolutionV3.cjs`, `api/services/aiCrossCatalogCandidates.cjs`, `api/services/coilVariantAmbiguity.cjs` | KEEP_CURRENT | Formal Business/API executors and current read paths | Names and historical comments alone do not prove retired AI ownership. | Formal business compatibility and current executor dependencies; no deletion in M4-P0. |
| `api/services/ai-assistant/**`, active `api/ontology/**`, `api/capabilities/registry.cjs`, Business APIs, `costEngine` | KEEP_CURRENT | Current public Assistant/runtime and formal business consumers | Current M3 architecture. | M3 Native Assistant and formal business authority. |

## Documentation boundary after cleanup

Current AI documentation must describe the M3 Native Assistant and the next development sequence only:

```text
Business Understanding → Semantic Understanding → Ontology Grounding → Planning → Tools
```

The deleted material must not be used as a fallback implementation guide, release authority, or semantic contract.
