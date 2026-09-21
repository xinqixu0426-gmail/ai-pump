# V5 Evidence Ledger V1

Status: V5-D shadow-only contract
Version: `V5_EVIDENCE_LEDGER_VERSION=1`

## Purpose and ownership

The ledger is an immutable, serializable, per-task runtime structure. It does not persist to SQLite and does not replace Business APIs as sources of truth. A Tool result is only a candidate input: it becomes evidence after explicit source, status, entity, and freshness validation.

## Evidence item

`V5EvidenceItem` contains `version`, independent `evidenceId`, `taskId`, `evidenceType`, `status`, `claimType`, `sourceType`, deterministic `sourceTrust`, `sourceRef`, optional resolved `entityRef`, `toolName`, `capabilityId`, `operationRefs`, explicit operation-link status, `freshness`, optional structured `derivation`, `createdAt`, and safe metadata.

Evidence IDs are not operation IDs, trace IDs, tool-call IDs, or business IDs. Empty operation references are accepted and represented as `UNKNOWN`; no ID is fabricated.

## Evidence types and status

- `DIRECT_FACT`: a fact from an explicitly validated formal `TOOL` or `BUSINESS_API` source.
- `DERIVED_FACT`: a deterministic result referencing existing valid formal evidence through `inputEvidenceIds` and `derivationType`.
- `ASSUMPTION`: an explicit premise. It may remain in the ledger but cannot satisfy formal evidence requirements.
- `UNVERIFIED`: candidate information lacking formal validation. It cannot carry `VALID` status.

Statuses are `VALID`, `STALE`, `INVALID`, `MISSING`, `NOT_APPLICABLE`, and `UNKNOWN`. Evidence type and validation status are separate dimensions.

## Source trust and freshness

Source trust is derived, never caller-promoted:

| Source type | Trust |
| --- | --- |
| `TOOL`, `BUSINESS_API` | `FORMAL` |
| `DERIVATION` | `DERIVED_FORMAL` |
| `FILE`, `DOCUMENT` | `TEMPORARY` |
| `USER_CLAIM`, `UNKNOWN` | `UNVERIFIED` |

Freshness is `CURRENT`, `STALE`, `UNKNOWN`, or `NOT_APPLICABLE`. A timestamp alone never implies `CURRENT`; the adapter requires an explicit source/capability policy decision.

## Derivation rules

A `DERIVED_FACT` requires non-empty `inputEvidenceIds` and a deterministic `derivationType`; `formulaId` is optional. Every input must exist and be valid formal evidence. Missing inputs and circular dependency graphs are rejected. A valid derived fact cannot depend on an assumption, unverified, missing, or invalid item.

## Ledger operations and invariants

`createEvidenceLedger`, `addEvidence`, `getEvidence`, `listEvidence`, and `validateLedger` return or consume task-scoped structures. `addEvidence` returns a new ledger.

- Evidence IDs are unique.
- Every item belongs to the ledger task.
- Every derivation input exists.
- Derivations are acyclic.
- Canonical entity references require a resolution receipt; they are never inferred from labels.
- Missing operation references remain explicit `UNKNOWN`.
- Invalid evidence never silently becomes valid.
- Assumptions never satisfy formal requirements.

## Capability requirements

Requirements distinguish `REQUIRED` from `OPTIONAL` and specify claim type, evidence type, minimum source trust, freshness, count, and optional entity type. Only required items participate in completeness. P11 defines rigorously grounded requirements for `inventory.read`, `coil.read`, and `recipe.cost.preview`; the remaining capability definitions are explicitly deferred instead of receiving invented claim semantics.

## ToolResult adapter and content boundary

The read-only adapter never copies `ToolResult.data`. A success result becomes `DIRECT_FACT/VALID` only when formal source validation, current freshness, source reference, and entity consistency are explicitly supplied. Otherwise it becomes `UNVERIFIED`; a failed tool result becomes `UNVERIFIED/INVALID`.

Real inventory, cost, quotation, customer, order, and raw tool payload values are outside this ledger contract. Tests use synthetic values only.

## Non-goals

No database, V4 verifier change, LLM verifier, Policy Layer, answer composition, production import, production shadow mirroring, or V5 execution is introduced in V5-D.
