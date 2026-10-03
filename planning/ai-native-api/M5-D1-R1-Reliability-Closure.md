# M5 D1-R1 — Autonomous Agent Reliability Closure

Status: **REWORK**. The Candidate architecture remains recommended; the controlled semantic suite is 6/10, below the required 10/10.

## Controlled formal runtime

The previous D1 controlled labels were not valid semantic evidence because the historical names were sent to the mutable local catalog. D1-R1 adds an isolated temporary SQLite runtime, seeded with three Recipes (`V750-通用款`, `V750-豪贝款`, `V110-通用款`), three official Coil Schemes (`12-120-A`, `12-120-B`, `12-130-A`), and formal Cable, Float, packaging and Wood Box Parts. It starts real Express routes, uses the existing Executor and formal services, and deletes the temporary DB after each process. No Tool, Executor, API response, cost result, or Answer result is mocked.

Direct fixture verification confirmed formal current-cost comparison and formal Float, Electrophoresis, Cable+Wood Box previews. Rotor Process intentionally has no fixture override because the formal Scenario API still does not support it.

## Reliability fixes

- The Candidate no longer applies an additional 6KB cut after the Fact Ledger model projection; the current result retains the formal projection budget. Historical results compact separately while retaining tool name, formal completeness, scalar data, error code and fact references.
- `renderClaimableFactsForModel()` exposes deterministic fact ID, entity, predicate, value, unit, basis, qualifiers and source Tool. It suppresses low-signal duplicate deep fields while retaining identity, relation and scalar-bearing fields.
- Investigation retains ten calls; finalization reserves two calls for the same Agent. Finalization has no business tools and receives only the Claimable Fact Catalog. A rejected envelope receives one repair.
- Successful formal results are fingerprinted after volatile trace fields are removed. Equal evidence does not append another Fact and returns `NO_NEW_EVIDENCE`; consecutive events surface `INVESTIGATION_NO_PROGRESS` without selecting a replacement Tool for the model.
- Candidate-only scenario ledger projection retains formal base/candidate costs and deltas with entity, scenario and basis qualifiers. Default production Ledger behavior remains unchanged.

## Coil cost root cause

The REAL-03 failure was an **AGENT_ADAPTER_ERROR**, not a coil-cost, route, authentication or data-quality failure. `resolve_entity` intentionally returns minimal identity evidence. The cost adapter then overwrote an otherwise valid `spec`/`sheets` request with missing identity attributes, so `POST /api/coils/calculate` rejected the request. With a confirmed `coilId` and absent dimensions, the adapter now deterministically hydrates dimensions, material and slot type from the existing formal `/api/coils` catalog before calling the unchanged cost preview route. No formula or API semantics changed.

## Controlled first pass

| Case | Expected safe semantic result | Actual | Result |
| --- | --- | --- | --- |
| D1-01 Coil count | COMPLETED | COMPLETED | PASS |
| D1-02 Recipe current Coil | COMPLETED | COMPLETED | PASS |
| D1-03 Recipe cost difference | COMPLETED | PARTIAL | REWORK |
| D1-04 Two Coil costs | COMPLETED | COMPLETED | PASS |
| D1-05 Float preview | COMPLETED | UNAVAILABLE | REWORK |
| D1-06 Electrophoresis delta | COMPLETED | UNAVAILABLE | REWORK |
| D1-07 Rotor Process gap | UNAVAILABLE | UNAVAILABLE | PASS |
| D1-08 Cable + Wood Box preview | COMPLETED | UNAVAILABLE | REWORK |
| D1-09 Unresolved reference | CLARIFICATION | CLARIFICATION | PASS |
| D1-10 Ambiguous V750 | CLARIFICATION | CLARIFICATION | PASS |

No accepted unsafe completion occurred. The four remaining cases are final-answer completeness/citation reliability issues after formal investigation, not free-form identity binding, write execution, or unsupported override execution. Repetition and real-catalog R1 smoke are deliberately not represented as closure evidence while this first pass is below the 10/10 gate.

## Boundaries and recommendation

The Candidate remains isolated from `POST /api/ai/chat`, Judge routing, `DOMAIN_TOOL_NAMES`, mandatory Grounding, Business/Policy/Ontology source changes, cost formula changes and write execution. The formal fixture proves the complete Candidate → Executor → Business API path is now testable. Continue with a narrowly scoped answer-evidence reliability follow-up; do not restore Intent Slots or fixed API chains.

## Repository gates

All required repository gates passed after the D1-R1 changes: `npm test` (2,263 tests), `npm run verify:api-contract`, `npm run test:deep-api` (486/486), `npm run lint`, `npm run build`, `npm run test:ai-architecture`, and `npm run verify:ai-assistant-release`.

Evidence: `M5-D1-R1-Deterministic-Regression.json`, `M5-D1-R1-Controlled-Fixture-Smoke.json`, `M5-D1-R1-Agent-Traces.json`, and `M5-D1-R1-Coil-Cost-Root-Cause.json`.
