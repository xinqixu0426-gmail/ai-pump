# Pump AI V5 Task State Machine V1

Status: V5-A isolated state contract

Implementation: `api/services/ai-v5/taskState.cjs`

State count: 14

The state machine is a pure deterministic skeleton. It has no model, network, database, tool, resolver, verifier, evidence ledger, policy engine, or hidden global state. It is not imported by production V3/V4 code.

## States

```text
RECEIVED
UNDERSTANDING
RESOLVING_ENTITY
ROUTING
EXECUTING
COLLECTING_EVIDENCE
VERIFYING
COMPOSING
COMPLETED
NEEDS_CLARIFICATION
BLOCKED_POLICY
FAILED_TOOL
FAILED_EVIDENCE
FAILED_INTERNAL
```

## Allowed Transitions

| From | Allowed next states |
| --- | --- |
| RECEIVED | UNDERSTANDING, FAILED_INTERNAL |
| UNDERSTANDING | RESOLVING_ENTITY, ROUTING, NEEDS_CLARIFICATION, FAILED_INTERNAL |
| RESOLVING_ENTITY | ROUTING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| ROUTING | EXECUTING, NEEDS_CLARIFICATION, BLOCKED_POLICY, FAILED_EVIDENCE, FAILED_INTERNAL |
| EXECUTING | COLLECTING_EVIDENCE, FAILED_TOOL, BLOCKED_POLICY, FAILED_INTERNAL |
| COLLECTING_EVIDENCE | ROUTING, VERIFYING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| VERIFYING | COMPOSING, ROUTING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| COMPOSING | COMPLETED, FAILED_EVIDENCE, FAILED_INTERNAL |
| COMPLETED | none |
| NEEDS_CLARIFICATION | none within the same execution |
| BLOCKED_POLICY | none |
| FAILED_TOOL | none |
| FAILED_EVIDENCE | none |
| FAILED_INTERNAL | none |

The implementation exposes the frozen table as `V5_ALLOWED_TRANSITIONS`. The automated matrix checks all `14 × 14 = 196` pairs against that declaration, then executes every allowed edge and rejects every forbidden edge.

## Terminal States

```text
COMPLETED
NEEDS_CLARIFICATION
BLOCKED_POLICY
FAILED_TOOL
FAILED_EVIDENCE
FAILED_INTERNAL
```

Terminal states cannot enter another state within the same task execution. `NEEDS_CLARIFICATION` may be continued only as a new user turn/task-resumption contract in a later phase; V5-A does not implement resume behavior.

## Transition Preconditions

Structural table eligibility is necessary but not sufficient:

- Entering `EXECUTING` requires a non-null `requestedCapability`, an execution-ready validated `V5ToolRequest`, and an exact match between task and request capabilities.
- Entering `VERIFYING` requires `executionCompleted=true` or an explicitly declared `evidenceFree=true` path. V5-A checks orchestration prerequisites only and does not inspect evidence.
- Entering `COMPOSING` requires `verificationCompleted=true`. This is a future-stage completion signal, not a verifier implementation.
- Entering `COMPLETED` requires `answerSupported=true`. This is a future-stage completion signal, not answer verification.
- Retry from `COLLECTING_EVIDENCE` or `VERIFYING` to `ROUTING` requires all of: an open evidence requirement, remaining bounded budget, and an untried eligible capability.

The synthetic capability used in tests is `test.read`; it is not a registry or production capability.

## Failure Semantics

An unknown state, forbidden transition, terminal-state transition, or failed precondition throws `V5StateTransitionError` with code:

```text
V5_STATE_TRANSITION_REJECTED
```

The error records only `from`, `to`, and a structural reason code. The machine never silently falls back, auto-corrects, asks the model to choose a transition, or guesses the intended state. The input task remains unchanged.

Generic C02 guards include rejection of `RECEIVED -> VERIFYING`, `ROUTING -> VERIFYING`, post-evidence routing without all bounded-retry prerequisites, and terminal-state continuation. They are state rules, not product/case special cases.

## History Semantics

Every successful transition returns a new immutable V5 Task and appends:

```text
from
to
timestamp
reasonCode
```

History contains no prompt, entity text, tool payload, business payload, or customer information. Tests inject timestamps for deterministic output. A rejected transition appends nothing and cannot partially modify the original task.

## V4 Shadow Boundary

`v4Projection.cjs` converts only P06 safe structural metadata into explicitly incomplete shadow snapshots. Its state mapping is documented and preserves the original V4 terminal label in metadata:

| V4 observable state | V5 shadow state | Meaning |
| --- | --- | --- |
| completed | COMPLETED | observed terminal completion |
| needs_clarification | NEEDS_CLARIFICATION | observed clarification terminal |
| budget_exhausted | FAILED_EVIDENCE | compatibility classification only |
| running | COLLECTING_EVIDENCE | active/incomplete compatibility classification |
| missing/unknown | RECEIVED | neutral initial state plus explicit missing reason |

This mapping is diagnostic, not a V5-to-V4 adapter and not a production state decision.
