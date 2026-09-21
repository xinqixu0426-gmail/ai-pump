# V5 Deterministic Verification V1

Status: V5-D shadow-only contract

## Verification layers

Verification is four explicit deterministic decisions. No LLM participates.

1. Execution completeness: required tool execution and orchestration are complete, incomplete, failed, or not applicable.
2. Evidence completeness: required claim/evidence-type counts are complete, incomplete, or not applicable; optional gaps do not fail this gate.
3. Evidence validity: item status, source trust, freshness, entity consistency, and derivation integrity are valid, invalid, stale, or unknown.
4. Supportability: required claims are supported, partially supported, or unsupported by valid formal evidence.

## Final result

`V5VerificationResult` contains `taskId`, the four layer statuses, missing requirement IDs, invalid/stale/assumption evidence IDs, `decision`, and stable reason codes.

Decisions are `VERIFIED`, `UNVERIFIED`, `FAILED_EXECUTION`, and `FAILED_EVIDENCE`. No overloaded `failed_unverified` equivalent is added.

## Decision table

| Condition | Decision |
| --- | --- |
| Execution failed or incomplete | `FAILED_EXECUTION` |
| Evidence invalid or stale | `FAILED_EVIDENCE` |
| Required evidence incomplete, validity unknown, or support incomplete | `UNVERIFIED` |
| Execution complete, evidence complete and valid, supportability supported | `VERIFIED` |

The full `4 × 3 × 4 × 3 = 144` layer-status matrix is table-tested. Missing, stale, invalid, assumption-only, or unverified evidence cannot produce `VERIFIED`.

## State integration

The existing V5-only state skeleton keeps the P07 transition table. `COLLECTING_EVIDENCE → VERIFYING` now requires completed execution and a versioned ledger scoped to the same task, unless the path is explicitly evidence-free. `VERIFYING → COMPOSING` requires a completed `VERIFIED` decision. `FAILED_EVIDENCE` remains the typed terminal path for failed evidence. No V4 state or behavior changes.

## Failure semantics

- Tool failure is an execution failure, not evidence absence.
- Missing formal evidence after completed execution is `UNVERIFIED`.
- Structurally present but invalid or stale required evidence is `FAILED_EVIDENCE`.
- Assumptions remain visible through `assumptionEvidenceIds` but never satisfy a formal requirement.
- Missing operation correlation is `UNKNOWN`, not fabricated.
- Wrong-entity evidence is invalid/unsupported.

P06 verification labels are interpreted with their recorded primary root cause. The six verification/evidence classifications are downstream symptoms of A01, C02, or R02; V5-D refuses `VERIFIED` but does not claim those root causes as verifier fixes.

## Non-goals

This contract does not judge natural-language correctness, generate an answer, change a Business API, implement policy, execute tools, persist evidence, or replace the V4 verifier.
