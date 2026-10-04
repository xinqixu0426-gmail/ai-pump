# M5-D1 FH1 — Final Acceptance Harness Repair

## Result

The Final Acceptance harness is ready without changing AI-Native product behavior. FH1 adds a separate evaluator and runners; the historical `run-d1-smoke.cjs` remains unchanged.

## Product boundary

- Product baseline: `82b0dce603c7ee2c715a55799ce1b04db0344bc7`
- Start commit: `dee9b29f65c97cfcaca451fce40b834697824b42`
- Product changes: none
- Model calls: 0
- Real business catalog access: none
- Deployment: none

The new product-drift guard permits only Final Acceptance harness, tests, and evidence after the product baseline. It rejects `api/**`, Candidate runtime, Business/Policy sources, the controlled Fixture, schemas, Cost Engine, Ledger, Validator, and other product paths.

## New harness

- `d1FinalAcceptanceEvaluator.cjs` evaluates delivered business outcomes, derives safety telemetry from traces/receipts/validation, and snapshots reviewed business-state tables.
- `d1FinalAcceptanceOracles.cjs` builds controlled and real scoring oracles only through the formal Executor with `allowWrite:false`.
- `run-d1-final-controlled.cjs` is an explicit-opt-in future model runner over the isolated Fixture.
- `run-d1-final-real-catalog.cjs` is an explicit-opt-in future read/preview runner that dynamically constructs only applicable real cases.

Neither runner runs merely by being imported. A future acceptance invocation must explicitly set `D1_FINAL_ALLOW_MODEL_RUN=1`.

## Eliminated evaluator defects

The Final harness no longer uses the historical status-only summary or its fixed-zero `safety()` output.

- Business success requires an Oracle-compatible delivered result, cited formal evidence, and a valid final envelope.
- D1-07 requires the current Rotor Process semantics: `rotorProcessMode` applied, comparison `COMPARABLE`, and a formal Scenario candidate/delta. An old `UNAVAILABLE` answer fails.
- Dynamic REAL cases use formal directory/read/preview calls to obtain exact targets, amounts, and scenario outcomes. Missing real data is `DATA_LIMITATION`, not a model failure.
- Final results classify `PASS`, `DATA_LIMITATION`, `AGENT_RELIABILITY_FAILURE`, `ANSWER_DELIVERY_FAILURE`, and infrastructure failure separately.

## Safety and database measurement

Safety is reported as attempted, rejected, executed, and accepted where the frozen trace permits measurement. A failed `load_tools` call without requested tool names is explicitly `NOT_OBSERVABLE`; it is never reported as zero write attempts.

The reviewed DB snapshot covers Recipe, Coil, Part, Template, Order, Customer, Quotation, Purchase/Inventory, System Settings, model variant, and identity-profile state. Controlled direct formal Oracle construction changed no fixture business table.

## Verification

- FH1 evaluator test suite: 7/7 pass.
- Controlled formal-oracle construction: direct real Executor/API preview only; no mutation; D1-01 through D1-08 and D1-10 values observed from formal responses.
- `npm test`: 2288/2288 pass.
- `verify:api-contract`: 29/29 pass.
- `test:deep-api`: 486/486 pass; canonical deterministic DB only.
- `lint`, `build`, `test:ai-architecture` (9/9), and `verify:ai-assistant-release`: pass.

No fresh Business, Policy, or Candidate model call was run in FH1. A Final Acceptance restart can now use the product baseline plus the new harness commit, with all model samples fresh and no historical result reuse.
