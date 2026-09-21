# V5-A Typed Contracts + Task State Skeleton

## 1. Executive Result

V5-A added an isolated, dependency-free contract/state foundation without connecting V5 to production. Contract version 1 distinguishes raw, validated, and execution data; immutable entity references preserve raw identity; a 14-state deterministic machine checks every one of its 196 state pairs; and a one-way adapter projects all 15 P06 safe paths into explicitly incomplete V5 shadow tasks.

```text
V5_A_STATUS=PASS
V5_B_READY=YES
PRODUCTION_V5_IMPORTS=0
PRODUCTION_V5_ROUTING=0
V5_TOOL_EXECUTIONS=0
V5_WRITES=0
```

No V4 failure was repaired. R02 remains explicitly out of scope for V5-B.

## 2. Frozen Baseline

```text
P07_COMMIT=9e7925646ef40ceaf00fe31b6e1ce3fccf771765
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
V4_OBSERVABILITY_BASELINE=LOCKED
FULL_REGRESSION_BASELINE=1777/1778
KNOWN_FAILURE=missing .guardian/config.yaml
```

Pre-existing user-owned changes to V4/AI code, tests, documentation, package metadata, scripts, and output remained unstaged and were excluded from this phase.

## 3. Scope / Non-Scope

Implemented only:

- `V5Task`, `EntityReference`, `V5ToolRequest`, `V5ToolResult`, and `V5ToolError` contracts;
- version and deterministic validation rules;
- immutable task transitions, history, terminal protection, and orchestration preconditions;
- one-way P06 safe-metadata projection and C02/A01/R02 shadow classification;
- pure tests and contract/state documentation.

Not implemented: Capability Registry, routing, limited tool exposure, normalization/resolver integration, tool execution, Evidence Ledger, verifier, Policy Layer, prompt/fallback rules, production shadow mirroring, or cutover.

## 4. Contract V1

`V5_CONTRACT_VERSION=1`. Constructors create version-1 objects; validators require an explicit exact version and reject unknown or missing versions with `V5_CONTRACT_VALIDATION_FAILED`.

The V5 Task has a separate orchestration `taskId` and explicit nullable/empty placeholders for intent, entity context, requested capability, execution, verification, and failure. Values are deep-copied, deeply frozen, and limited to serializable plain data. No dependency was added; implementation uses native JavaScript.

## 5. Entity Identity Preservation

`EntityReference` keeps `rawMention`, `normalizedMention`, `canonicalEntityId`, and `entityType` as distinct fields. `rawMention` is required, copied byte-for-byte as a JavaScript string, and never overwritten by normalization. `canonicalEntityId` remains null until supplied by a future formal resolution step.

Deterministic cases cover `v750-tokoy-`, `800平刀`, `V750-A`, `00123`, punctuation-heavy names, and empty/type-invalid input. This proves the V5 contract can preserve identity; it does not change V4 extraction, normalization, or resolution.

## 6. Tool Request / Result Contracts

`V5ToolRequest` has distinct immutable `rawArguments` and `validatedArguments` stages. Raw-only requests are `executionReady=false`. Execution readiness requires explicit validated status, a validated argument object, and a resolved capability. The state machine also requires task/request ID and capability equality.

`V5ToolResult.status` is exactly `success` or `failure`; truthy/falsy inference is rejected. Success forbids an error, and failure requires a structured `V5ToolError`. Error classifications are:

```text
VALIDATION_ERROR
POLICY_BLOCKED
EXECUTION_ERROR
TIMEOUT
NOT_FOUND
AMBIGUOUS_ENTITY
INTERNAL_ERROR
```

These contracts do not execute any tool and do not change V4 error semantics.

## 7. Task State Machine

The implementation uses the 14 states frozen by P07:

```text
RECEIVED, UNDERSTANDING, RESOLVING_ENTITY, ROUTING, EXECUTING,
COLLECTING_EVIDENCE, VERIFYING, COMPOSING, COMPLETED,
NEEDS_CLARIFICATION, BLOCKED_POLICY, FAILED_TOOL,
FAILED_EVIDENCE, FAILED_INTERNAL
```

The transition table matches P07 exactly. `COMPLETED`, `NEEDS_CLARIFICATION`, `BLOCKED_POLICY`, and all three `FAILED_*` states are terminal within one execution. `canTransition()` is table-only; `transitionTask()` validates the task, table edge, terminal rule, and preconditions before returning a new immutable task.

Rejected transitions throw `V5_STATE_TRANSITION_REJECTED` and leave the input object and history unchanged.

## 8. Transition Preconditions

- `EXECUTING`: resolved requested capability plus an execution-ready ToolRequest with matching task/capability.
- `VERIFYING`: completed execution or explicitly declared evidence-free path. No evidence content is inspected.
- `COMPOSING`: explicit future-stage verification-complete signal.
- `COMPLETED`: explicit future-stage answer-supported signal.
- evidence retry to `ROUTING`: open requirement, remaining budget, and untried eligible capability must all be true.

The signals are state-contract inputs, not implementations of capability routing, evidence, verification, or answer generation.

## 9. V4 → V5 Shadow Projection

Direction is only `V4 safe metadata -> V5 shadow representation`. There is no reverse adapter and no production import.

Projection results:

```text
P06 paths=15
complete=0
partial=15
rejected=0
```

Every P06 entry has a valid case ID and safe metadata, so every entry yields a V5 Task. Every projection is partial because P06 intentionally lacks raw entity content, validated arguments, a V5 capability, and a V5 Evidence Ledger. These remain null/empty with explicit `*_NOT_AVAILABLE` reasons.

The adapter preserves the source terminal label and applies a documented compatibility state mapping. It does not infer a capability from `expected.primary_tool` or observed tools, reconstruct entity values, create canonical IDs, promote arguments, create evidence, or assert verification.

## 10. P06 Failure Shadow Analysis

| Primary class | Cases | V5-A result |
| --- | ---: | --- |
| C02 | 3 | 2 contract-blockable; 1 UNKNOWN |
| A01 | 2 | 2 cannot become execution-ready |
| R02 | 3 | OUT_OF_SCOPE; no routing change |

The analysis reports what the contract would reject, not that the V4 failure is fixed.

## 11. C02 Coverage

The two V4 paths whose first divergence explicitly says investigation continued after required evidence would fail the bounded retry precondition: post-evidence routing requires an open requirement, remaining budget, and an untried eligible capability.

The Legacy flat-blade path reports a verified tool followed by terminal state `running`, but safe metadata does not expose a concrete illegal transition. A state machine can reject illegal edges but cannot infer that a missing/liveness transition occurred. Its answer is therefore `UNKNOWN`, avoiding a false claim.

Generic tests also reject `RECEIVED -> VERIFYING`, `ROUTING -> VERIFYING`, terminal continuation, verification without execution/evidence-free declaration, and retry without all bounded prerequisites.

## 12. A01 Coverage

Both A01 paths contain no V5 validated arguments or preserved `EntityReference` in the P06 safe dataset. They cannot be promoted to execution-ready ToolRequests. This blocks the failure class at the contract boundary in shadow analysis; it does not prove that a future validator will generate correct arguments or repair V4.

## 13. R02 Out of Scope

```text
R02_TOOL_SELECTION_FAILURE=OUT_OF_SCOPE
R02_MODIFIED=NO
OWNER=V5-B Capability Registry / Routing
```

No registry, router, tool allowlist, or limited exposure was implemented.

## 14. Deterministic Tests

```text
node --check api/services/ai-v5/contracts.cjs
node --check api/services/ai-v5/taskState.cjs
node --check api/services/ai-v5/v4Projection.cjs
node --test tests/aiV5ContractsState.test.cjs tests/aiV5Projection.test.cjs
RESULT=25/25 PASS
NETWORK=NO
PHOENIX=NO
REAL_AI=NO
BUSINESS_DB=NO
PAID_PROVIDER=NO
```

The tests cover all requested contracts, identity cases, raw/validated separation, explicit results/errors, the complete state matrix, every declared allowed and forbidden edge, terminal protection, preconditions, immutable failure, all P06 projections and class analyses, and static production isolation.

## 15. Regression Comparison

```text
AI_OBSERVABILITY_ENABLED=false
EXPECTED_WITH_25_NEW_TESTS=1802/1803
ACTUAL=1802/1803
SAME_KNOWN_FAILURE=YES
KNOWN_FAILURE=businessTerminologyContract.test.cjs cannot read .guardian/config.yaml
NEW_REGRESSION_INTRODUCED=NO
```

The frozen pre-P08 suite was 1777/1778. The 25 added tests account exactly for the new total.

## 16. Database Safety

Before and after implementation and both full regressions:

```text
SHA-256=09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E
size=35323904
mtime UTC=2026-09-03T08:42:16.3158766Z
backup file count=209
```

Hash, size, mtime, and backup count are unchanged. The full test runner used its existing process-isolated temporary database convention.

## 17. Production Isolation

Static recursive checks confirm:

```text
production imports of ai-v5=0
production requests routed to V5=0
V5 external executor/internalApiClient/provider/DB/network imports=0
V5 tool executions=0
V5 writes=0
```

No production file was changed. V5 code is reachable only by the two new deterministic test files.

## 18. Files Changed

- `api/services/ai-v5/contracts.cjs`
- `api/services/ai-v5/taskState.cjs`
- `api/services/ai-v5/v4Projection.cjs`
- `tests/aiV5ContractsState.test.cjs`
- `tests/aiV5Projection.test.cjs`
- `docs/ai-governance/v5-contracts-v1.md`
- `docs/ai-governance/v5-state-machine-v1.md`
- `docs/ai-governance/reports/V5-A-typed-contracts-state-skeleton.md`

## 19. Known Limitations

- All 15 P06 projections are intentionally partial because content-safe traces do not contain raw entities, validated arguments, capabilities, or evidence.
- The C02 Legacy liveness failure is `UNKNOWN`; no explicit illegal transition exists in safe metadata.
- Execution/verification/answer completion booleans are future-stage precondition inputs, not implemented subsystems.
- V5-A validates contract shape and promotion readiness, not business schemas, entity correctness, or policy.
- R02 remains wholly unresolved until V5-B.
- The permanent regression gate still has the pre-existing missing `.guardian/config.yaml` failure.

## 20. V5-B Preconditions

```text
contract versioned=PASS
entity identity preservation=PASS
raw/normalized/canonical separation=PASS
raw-only execution rejected=PASS
transition matrix=PASS
terminal protection=PASS
VERIFYING/EXECUTING preconditions=PASS
V4 projection read-only=PASS
no fabrication=PASS
C02/A01 analysis=PASS
R02 untouched=PASS
business DB unchanged=PASS
production isolation=PASS
no AI behavior change=PASS
no new regression=PASS
V5_B_READY=YES
```

V5-B may begin only after Supervisor approval and must be limited to Capability Projection + Bounded Tool Exposure in shadow. This report does not authorize or start it.

STOP — WAIT FOR SUPERVISOR REVIEW.
