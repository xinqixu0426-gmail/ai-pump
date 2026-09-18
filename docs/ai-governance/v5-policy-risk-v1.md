# V5 Policy and Risk Contract V1

## 1. Purpose

This document freezes the deterministic V5 policy boundary introduced by V5-E1. The policy consumes validated V5 task, capability, entity, ToolRequest, risk and approval metadata. It never consumes a raw model response and it never executes a Tool.

`V5_POLICY_VERSION=1`.

## 2. Risk classes

| Code | Name | Read/write class | V5-E1 meaning |
| --- | --- | --- | --- |
| L0 | `L0_CONVERSATION` | `NONE` | Conversation only; no business execution. |
| L1 | `L1_BUSINESS_READ` | `READ` | Bounded business read. |
| L2 | `L2_BUSINESS_ANALYSIS` | `READ` | Read-only business analysis. |
| L3 | `L3_CHANGE_PROPOSAL` | `WRITE` | Change proposal only; shadow and approval required. |
| L4 | `L4_APPROVED_WRITE` | `WRITE` | Write may be policy-approved only after explicit approval. V5-E1 still performs no write. |
| L5 | `L5_CRITICAL_IRREVERSIBLE` | `WRITE` | Critical or irreversible change; denied in V1 even when approved. |

Unknown risk classes and any risk/read-write mismatch are invalid and fail closed.

## 3. Approval states

The only valid approval states are:

- `NOT_REQUIRED`
- `REQUIRED`
- `PENDING`
- `APPROVED`
- `REJECTED`

Approval is an input fact. The policy does not infer, create or persist approval.

## 4. Policy decisions

The only policy decisions are:

- `ALLOW`
- `DENY`
- `APPROVAL_REQUIRED`
- `SHADOW_ONLY`
- `INVALID`

`ALLOW` means only that the validated request passes Policy V1. In V5-E1 it does not authorize an actual Tool call. The controlled runtime projects `WOULD_EXECUTE` while keeping actual Tool execution and write counters at zero.

## 5. Deterministic gates

For a business capability, policy evaluation requires all of the following:

1. A valid task ID and the `ROUTING` task state.
2. A registered or explicitly supplied shadow capability matching the requested capability ID.
3. Exact agreement among capability risk class, read/write class and the Policy V1 risk definition.
4. A selected Tool contained in the capability allowlist.
5. A ToolRequest that has passed validation and is execution-ready.
6. All capability-required entity types.
7. A valid approval state.

Any missing, unknown or inconsistent input returns `INVALID` with `executionAllowed=false`. There is no fallback, guessing or permissive default.

## 6. Decision matrix

| Risk | Valid bounded request | Approval | Decision | `executionAllowed` |
| --- | --- | --- | --- | --- |
| L0 | No business execution | `NOT_REQUIRED` | `ALLOW` | `false` |
| L1 | Yes | Any valid state | `ALLOW` | `true` |
| L2 | Yes | Any valid state | `ALLOW` | `true` |
| L3 | Yes | Any valid state | `SHADOW_ONLY` | `false` |
| L4 | Yes | `APPROVED` | `ALLOW` | `true` |
| L4 | Yes | `REJECTED` | `DENY` | `false` |
| L4 | Yes | Other valid state | `APPROVAL_REQUIRED` | `false` |
| L5 | Yes | Any valid state | `DENY` | `false` |

The complete cross-product is covered by a deterministic matrix test.

## 7. Stable reason codes

Policy output carries stable reason codes, including:

- `POLICY_CONTEXT_INVALID`
- `POLICY_INVALID_TASK_STATE`
- `POLICY_RISK_MISMATCH`
- `POLICY_APPROVAL_STATE_INVALID`
- `POLICY_CAPABILITY_INVALID`
- `POLICY_TOOL_NOT_IN_CAPABILITY`
- `POLICY_VALIDATED_ARGUMENTS_REQUIRED`
- `POLICY_ENTITY_REQUIREMENT_MISSING`
- `POLICY_ALLOW_CONVERSATION`
- `POLICY_ALLOW_READ`
- `POLICY_ALLOW_ANALYSIS`
- `POLICY_PROPOSAL_ONLY`
- `POLICY_APPROVAL_REQUIRED`
- `POLICY_WRITE_NOT_APPROVED`
- `POLICY_WRITE_REJECTED`
- `POLICY_APPROVED_WRITE`
- `POLICY_CRITICAL_DENIED`
- `POLICY_SHADOW_EXECUTION_DISABLED`

## 8. State-machine relationship

The V5 state machine now requires `policyDecision='ALLOW'` before a transition into `EXECUTING`. The condition is orchestration metadata only. It does not call policy itself and does not alter V4 behavior.

## 9. Safety boundary

Policy V1 is pure and deterministic: no network, database, model, Tool, business API or production runtime dependency. It is imported only by isolated V5 modules, tests and the V5-E1 shadow script. It cannot influence V4 production traffic.

At any future production cutover, V5 Policy must be additive to the existing `allowWrite`, write-confirmation and business-validation controls; it does not replace or duplicate them. V5-E1 does not connect to those V4 controls.
