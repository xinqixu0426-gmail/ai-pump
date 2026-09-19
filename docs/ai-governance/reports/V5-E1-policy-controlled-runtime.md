# V5-E1 Policy + Controlled Shadow Runtime

## 1. Executive Result

V5-E1 assembled a deterministic Policy V1 and an isolated controlled shadow runtime without importing it into production, executing a Tool, writing data, or changing V4 behavior. Focused V5 A-E1 tests pass. Final full-regression and repository delivery evidence are recorded below.

## 2. Frozen Baseline

- P11 commit: `0884615c9c402b74eb6decba331ddd481f5f32ad`
- P11 status: PASS
- Regression baseline: 1872/1873
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: NO
- Existing user V4/AI changes were preserved and excluded from V5-E1 scope.

## 3. Scope / Non-Scope

Implemented: Policy V1, risk and approval taxonomy, deterministic policy matrix, shadow-only runtime assembly, P06 structural evaluation, tests and governance documents.

Not implemented: production mirroring or routing, model calls, Tool execution, writes, V4 changes, entity resolution, business APIs, database access, answer composition, Real AI replay, deferred evidence requirements or V5-E2.

## 4. Policy V1

`V5_POLICY_VERSION=1`. Policy consumes already validated orchestration facts and returns an immutable decision: `ALLOW`, `DENY`, `APPROVAL_REQUIRED`, `SHADOW_ONLY` or `INVALID`. Unknown or inconsistent inputs fail closed and never become executable.

## 5. Risk Classes

Policy defines L0 conversation, L1 business read, L2 business analysis, L3 change proposal, L4 approved write and L5 critical irreversible risk. The read/write class is part of each risk definition and must agree exactly with the selected capability.

## 6. Approval Semantics

Approval states are `NOT_REQUIRED`, `REQUIRED`, `PENDING`, `APPROVED` and `REJECTED`. L4 requires explicit `APPROVED`; rejected writes are denied. L5 remains denied even when approved. V5-E1 never creates, stores or infers approval.

## 7. Write Safety

The deterministic matrix covers 240 combinations across risk, read/write class, approval, task state and Tool membership. L1/L2 valid reads allow a future execution boundary; L3 is shadow-only; L4 requires approval; L5 denies; every structural mismatch is invalid. Even an approved L4 path only projects `WOULD_EXECUTE`: all P12 paths preserve `actualToolExecutions=0` and `actualWrites=0`. At a future production cutover V5 Policy must be added to, not replace, existing `allowWrite`, confirmation and business validation.

## 8. Controlled Shadow Runtime

The runtime accepts only a structured V5Task, structured route facts, a validated ToolRequest and optional externally supplied shadow result/evidence. It composes the existing V5 state, routing, exposure, ontology, identity, evidence and verification modules. No production runtime imports it.

## 9. State / Contract Integration

Before the shadow execution boundary, the runtime requires a valid RECEIVED task, legal state sequence, selected capability, required resolved entity facts, an execution-ready ToolRequest, exact task/capability/risk/entity agreement, Tool allowlist membership and Policy `ALLOW`. Every rejection preserves zero actual executions and writes. All state changes use `transitionTask`; `ROUTING → EXECUTING` requires the explicit orchestration context `policyDecision='ALLOW'`.

## 10. Capability / Tool Exposure Integration

Capability routing uses V5-B; unresolved or ambiguous routes stop with no Tool exposure. Selected Tools must belong to the capability allowlist. There is no fallback to the global Tool registry.

## 11. Entity Integration

Entity values are not normalized or resolved by this runtime. Required canonical identity and resolution receipts must already exist where the ontology requires them. Invalid or unresolved identity cannot progress to the executable shadow state.

## 12. Evidence / Verification Integration

The runtime accepts only an externally supplied validated shadow ToolResult and evidence ledger. Missing or invalid evidence cannot produce `VERIFIED`. The 38 deferred requirements remain unchanged and return `DEFERRED_REQUIREMENT`.

## 13. P06 C02 Shadow Analysis

- Cases analyzed: 3
- Blocked by V5 state contract: 3
- Insufficient data: 0

This is a shadow contract assessment; V4 C02 behavior was not modified.

## 14. P06 R02 Shadow Analysis

- Cases analyzed: 3
- Wrong Tools exposable: 0
- Wrong Tools policy-allowed: 0

This result is based on P06 safe structural metadata and V5 capability/Tool boundaries. No real routing or model call was replayed.

## 15. P06 A01 Shadow Analysis

- Cases analyzed: 2
- Raw-only/invalid request paths blocked: 2
- Unknown: 0

This demonstrates that the V5 contract blocks execution-ready promotion for this structural class; it does not fix V4 argument generation.

## 16. End-to-End Synthetic Shadow Cases

- L1 valid read: reaches `COMPLETED` only with a supplied valid ToolResult, ledger and `VERIFIED` decision.
- L2 analysis: policy `ALLOW`, projection `WOULD_EXECUTE`, actual execution 0.
- L3 proposal: `SHADOW_ONLY`, approval required, actual execution 0.
- L4 approved write: policy `ALLOW`, projection `WOULD_EXECUTE`, actual writes 0.
- L4 unapproved write: `APPROVAL_REQUIRED`, no execution.
- L5 critical: `DENY` even when approved.

## 17. Deterministic Tests

- V5 A-E1 focused suite: 104/104 PASS
- V5-E1 tests: 16/16 PASS
- Policy matrix combinations: 240
- Network, Phoenix, Real AI and business database dependencies: none
- ESLint on V5-E1 files: PASS

## 18. Business DB Safety

- Start/end SHA-256: `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`
- Start/end size: 35,323,904 bytes
- Start/end mtime UTC: `2026-09-03T08:42:16.3158766Z`
- Backup files at start/end: 209/209
- Unexpected backup created: NO

## 19. Regression Comparison

- Observability: disabled
- Result: 1888/1889
- Expected after 16 added tests: 1888/1889
- Sole failure: missing `.guardian/config.yaml`
- Same known failure: YES
- New regression: NO

## 20. Production Isolation

The deterministic isolation scan reports:

- Production Policy imports: 0
- Production Controlled Runtime imports: 0
- Production requests routed to V5: 0
- Production requests mirrored to V5: 0
- Real Tool executions: 0
- Writes: 0

## 21. Known Limitations

- The runtime is an isolated deterministic harness, not a production shadow mirror.
- `WOULD_EXECUTE` is a policy projection only; no Tool path exists.
- Approval is supplied state, not an approval service.
- The 38 deferred evidence requirements remain deferred.
- P06 evaluation uses only safe structural metadata and cannot prove behavior for unavailable facts.

## 22. V5-E2 Preconditions

V5-E2 may begin only after Supervisor review confirms the final regression, database invariants, production-isolation scan and delivery commit. V5-E1 does not authorize production mirroring, Tool execution, writes or cutover.
