# O4-F — Recipe Runtime Adapter and Cutover Design

## Boundary

Business storage and Business API own values.  The Ontology V2.1 contract continues only to describe/validate their semantics:

```text
Business DB/API -> canonical Recipe storage DTO -> semantic adapter
  -> validated facts/relations/derived facts -> Rotor / AI / future consumers
```

`runtimeEnabled=false`, `storesBusinessValues=false`, and `isBusinessSourceOfTruth=false` remain true.  The adapter is future business/runtime code, not Ontology-as-database.

## Read precedence

1. Read canonical Functional Profile for a Recipe that has supported `schema_version` and a suitable migration/completeness state.
2. Derive facts only from canonical inputs (`pieceCount` from `recipes.coil_sheets`; stainless span from canonical barrel length/open offset).
3. For a Recipe explicitly marked `LEGACY_COMPATIBILITY` or without a profile, invoke the existing legacy reconstruction adapter and label every resulting field `COMPATIBILITY_LEGACY`.
4. Return `UNKNOWN_OR_UNRESOLVED` when neither canonical inputs nor permitted legacy evidence can safely establish a value.

Legacy sources must never overwrite a canonical Fact.  An incomplete canonical profile is not permission to selectively fill missing values from PumpShell defaults or Template rotor params; it yields incomplete/unresolved status unless the whole record remains explicitly in legacy-adapter mode.

## Canonical Rotor DTO

The future Rotor boundary receives a validated DTO with values, per-field provenance, relation IDs, derived markers, completeness state, and unresolved reasons.  For canonical/migrated Recipes it must not inspect `rotor_params_json`, PumpShell defaults/open offset, model variant values, name heuristics, or legacy 62xx strings.

```text
Functional Profile + recipes.coil_sheets + Recipe->Template->Part policy
  + bearing Part IDs -> bearing geometry projection -> Rotor DTO
```

For explicitly legacy Recipes, an adapter may still call the historical reconstruction chain to support existing data.  Its DTO must label the mode and sources as compatibility, and cannot be written back as canonical merely by reading it.

## Relation and bearing geometry adapter

Resolve Recipe Template/Coil through existing FK IDs, then Template Shell through `catalog_template_shell_bindings`.  Missing link, missing target, inactive target, missing extension, or unresolved `isStainless` is `UNKNOWN_OR_UNRESOLVED`, not false.

For canonical bearing relations, resolve exact `parts.id`, validate category/lifecycle, then project a shared engineering specification.  Until a Bearing Specification catalog exists, adapt the concrete Part through `catalogSpec.bearingCodeOf()` and `rotorParameters.normalizeBearing()` to the current `BEARING_DB`.  The code is strictly a geometry lookup key.  Unknown geometry blocks validated canonical Rotor input; it does not invalidate the selected Part identity or invite a different Part guess.

## Conditional states

| State | Meaning | Example |
|---|---|---|
| `NOT_APPLICABLE` | policy condition is confidently known and the Fact does not apply | non-stainless Recipe: `openOffset`, `barrelLength` for stainless derivation, and derived span inputs are not applicable |
| `UNKNOWN_OR_UNRESOLVED` | policy condition/path or required Fact cannot be established | no Template FK, no shell binding, missing/is-unresolved `isStainless`, absent open offset |
| `INCOMPLETE` | mode known but one or more required canonical inputs are missing | stainless mode known but owner has not entered open offset |
| `NEEDS_REVIEW` | conflicting or migration-candidate evidence requires owner action | two bearing Parts match 6202, or thickness values differ |

Unknown is never coerced into non-stainless behavior.

## Completeness plan

The future generic policy evaluator declares the requirement set; runtime checks its resolved results rather than embedding PumpShell-specific branches.

- **Stainless complete:** canonical Recipe→Template→Shell-Part path; `isStainless=true`; all standard Rotor dimensions; `barrelLength`; Owner-confirmed `openOffset`; upper/lower bearing Part IDs; bearing geometry resolution; span derived.
- **Non-stainless complete:** same path; `isStainless=false`; all standard Rotor dimensions; explicit `bearingSpan`; upper/lower bearing Part IDs; bearing geometry resolution.
- **Legacy compatibility:** may create old output only through explicit adapter labeling, never claim canonical completeness.

## Write model

After canonical-write cutover, the technical command writes Functional Profile and Technical Knowledge atomically under existing confirmation, audit, idempotency, and optimistic concurrency mechanics.  It is the only authority.

Temporary compatibility for old UI/runtime is a **one-way projection** from canonical storage to legacy fields, in the same transaction, with projection version and mismatch detection.  There is no two-way synchronization.  A legacy field edit cannot later overwrite canonical state.  The projection is removed after old consumers cut over.

New Recipes after cutover must create canonical profile/knowledge state or be marked incomplete.  They must not use PumpShell `defaultXXX`, PumpShell offset, Template rotor params, legacy bearing code, or a name heuristic to establish final technical authority.

## Shadow comparison and gates

Before canonical Rotor read, generate both old and new input DTOs for migrated records.  Compare each field and classify `MATCH`, `EXPECTED_SEMANTIC_CHANGE`, `CONFLICT`, or `UNRESOLVED`.  Stainless comparison includes old span versus derived canonical span.  No unexpected mismatch is automatically accepted.

**Read cutover requires:** supported profile version; required facts complete; formal relations resolved; no unresolved migration conflict; profile/provenance validation; and Rotor parity or approved expected semantic difference.

**Write cutover requires:** read shadow gate passed for agreed cohort; canonical command/API/readback works transactionally; one-way projection parity is monitored; audit/idempotency/concurrency coverage passes; and Owner review queue is actionable.

## Future API design

Prefer one aggregate technical endpoint so Functional Profile and Knowledge save under one transaction:

```text
GET /api/recipes/:id/technical-profile
PUT /api/recipes/:id/technical-profile
  { functional, technicalKnowledge, expectedUpdatedAt }
```

The response includes Facts, relations, derived values, field provenance, completeness/migration state, and unresolved/review items.  Existing Recipe routes remain unchanged until an implementation ticket.  Existing technical-file endpoints remain evidence endpoints.

AI writes remain subject to proposal, confirmation, capability authorization, idempotency, audit, and readback verification.  This design does not expand `WRITE_TOOLS`.

## Retirement and rollback

Retire in this order: old functional JSON reads, Template/PumpShell technical fallbacks, legacy bearing-string reads, dedicated legacy columns, then legacy JSON keys.  Freeze legacy writes before deleting any compatibility projection.  Rollback only switches the read feature gate back to the legacy adapter; it preserves canonical tables/data and has no reverse migration.
