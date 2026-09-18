# V5-D Evidence Ledger + Deterministic Verification

## 1. Executive Result

V5-D adds an isolated V1 evidence ledger and deterministic four-layer verification. ToolResult is not automatically evidence, evidence presence is not automatically sufficient, and the six P06 verification-classified failures remain attributed to their upstream A01/C02/R02 causes. Production V4 is not connected to these modules.

`V5_E_READY=YES`: deterministic tests, regression, database, and production-isolation gates passed.

## 2. Frozen Baseline

- P10 commit: `aec484875d1a4aad0b1c0c42dc640e8a04836a28`
- Regression baseline: `1841/1842`
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: NO; existing user V4/AI changes were preserved and excluded.

## 3. Scope / Non-Scope

Scope is the V5-only evidence contract, immutable ledger, conservative capability requirements, ToolResult candidate adapter, deterministic verification, state preconditions, tests, and P06 shadow analysis. No V4, database, policy, production mirroring, LLM verification, answer composition, or execution behavior is changed.

## 4. Evidence Ledger V1

Version 1 is task-scoped, deterministic, immutable, validated, and serializable. Evidence IDs are independent. Duplicate IDs, cross-task items, missing derivation inputs, circular derivations, and invalid formal derivations are rejected.

## 5. Evidence Types / Status

Types are `DIRECT_FACT`, `DERIVED_FACT`, `ASSUMPTION`, and `UNVERIFIED`. Statuses are `VALID`, `STALE`, `INVALID`, `MISSING`, `NOT_APPLICABLE`, and `UNKNOWN`. Type and status remain independent.

## 6. Source Trust / Freshness

Trust is deterministically mapped to `FORMAL`, `DERIVED_FORMAL`, `TEMPORARY`, or `UNVERIFIED`. Freshness is explicit `CURRENT`, `STALE`, `UNKNOWN`, or `NOT_APPLICABLE`; timestamps do not promote freshness.

## 7. Capability Evidence Requirements

Registry count is 41. Requirements are defined for the three read capabilities grounded by the P06 corpus: `inventory.read`, `coil.read`, and `recipe.cost.preview`. The other 38 are deferred; none is fabricated or marked not-applicable merely to improve coverage. V5-B registry remains unchanged.

## 8. ToolResult → Evidence Adapter

The adapter validates the existing V5 ToolResult contract and never copies `data`. Formal direct evidence requires explicit source validation, current freshness, source reference, and entity consistency. Missing operation references are retained as explicit unknown state.

## 9. Verification Layers

Execution completeness, evidence completeness, evidence validity, and supportability are separate exported functions. The structured final result contains all layer decisions and typed reason lists.

## 10. Verification Decision Table

The 144-combination matrix deterministically maps execution failure/incompletion to `FAILED_EXECUTION`, invalid/stale evidence to `FAILED_EVIDENCE`, incomplete/unknown/unsupported evidence to `UNVERIFIED`, and only the fully satisfied conjunction to `VERIFIED`.

## 11. V5-A State Integration

The P07 transition graph is unchanged. The V5-only precondition for entering `VERIFYING` now requires a task-scoped V1 ledger when evidence is required. Entering `COMPOSING` requires `verificationDecision=VERIFIED`. All V5-A tests are rerun.

## 12. P06 Verification Shadow Analysis

Six paths carry verification/evidence failure classifications. All six are deterministically refused `VERIFIED`; all six remain `DOWNSTREAM_SYMPTOM`, with zero verifier `ROOT_CAUSE` and zero unknown/insufficient classifications. No production failure is claimed repaired.

## 13. C02 Downstream Classification

Three C02 cases were rechecked. Each is refused `VERIFIED` because orchestration is incomplete. Zero is counted as a V5-D root fix; C02 ownership remains the V5-A state contract.

## 14. Success Control Cases

All seven P06 PASS paths are projected using synthetic structural evidence only. None is falsely rejected. No P06 business values are restored or stored.

## 15. Deterministic Tests

The 31 focused V5-D tests pass. The combined V5-A/B/C/D focused suite passes `88/88`. Coverage includes contract enums, source trust, freshness, direct/derived/assumption/unverified semantics, ledger operations and invariants, ToolResult adaptation, requirements, all four verification layers, the 144-state decision matrix, state integration, P06 classification, and success controls. No network, Phoenix, AI provider, or database is used.

## 16. Capability Requirement Coverage

- Capability count: 41
- Defined: 3
- Deferred: 38
- Not applicable: 0

## 17. Business DB Safety

Start and end SHA-256 are `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`; size remains `35323904`; mtime UTC remains `2026-09-03T08:42:16.3158766Z`; recursive backup count remains `209`. No backup was created.

## 18. Regression Comparison

With `AI_OBSERVABILITY_ENABLED=false`, the full deterministic regression is `1872/1873`. The 31 new V5-D tests account for the increase from `1841/1842`; the sole failure remains `tests/businessTerminologyContract.test.cjs` because `.guardian/config.yaml` is absent. Same known failure: YES. New regression: NO.

## 19. Production Isolation

The V5-D modules are imported only by V5-only state code, tests, and shadow tooling. Static scans outside `api/services/ai-v5/` find zero production evidence or verification imports. Production V5 routing, V5 production verification executions, V5 Tool executions, and V5 writes are zero.

## 20. Known Limitations

- Requirements for 38 capabilities remain deferred until their formal source, freshness, claim, and entity policies can be grounded without invention.
- P06 stores structural metadata, not raw business evidence; the shadow uses synthetic evidence references.
- Operation correlation may be absent and remains explicit `UNKNOWN`.
- This phase does not repair V4 failures or prove production V5 orchestration.

## 21. V5-E Preconditions

V5-E may begin only after final tests confirm ledger invariants, four-layer verification, state integration, P06 downstream classification, success controls, database invariance, production isolation, and unchanged V4 regression behavior.
