# O4-A — Ontology V2.1 Contract Structure Implementation Notes

## Scope completed

O4-A adds a separately addressable, additive V2.1 declaration layer at
`api/ontology/v2_1/`. It remains contract-only:

- `runtimeEnabled = false`
- `storesBusinessValues = false`
- `isBusinessSourceOfTruth = false`
- `access = CONTRACT_ONLY_NO_RUNTIME`

It does not read a business resource, execute a policy, resolve a relation,
calculate a derived value, or participate in any production request path.

## Module structure

| Module | Responsibility |
|---|---|
| `api/ontology/v2_1/catalogs.cjs` | Immutable V2.1 vocabulary: appended role catalog, provenance purposes, value kinds, relation cardinalities, FactRef scopes, predicate kinds, derivation operations, materialization policies, and generic Technical Knowledge entry schema. |
| `api/ontology/v2_1/schema.cjs` | Pure immutable definition builders for sources, Facts, relations, predicates, derivations, policies, extensions, base profiles, and Technical Knowledge collections, plus field-inventory metadata for the V2.1 shape. These builders do not validate or evaluate semantics. |
| `api/ontology/v2_1/liftV2.cjs` | Additive, non-mutating V2 source/profile/contract lift helpers. |
| `api/ontology/v2_1/contract.cjs` | Exports the lifted `ontologyV21` with `version: 2` and `contractRevision: "2.1"`. |
| `api/ontology/v2_1/index.cjs` | Single pure-declaration export surface for the V2.1 contract, catalogs, schema builders, and lift helpers. |

## V2 and Coil compatibility

`api/ontology/v2/*` is unchanged. In particular, its strict validator still
validates only the original V2 shape and has not been broadened to accept
V2.1. V2.1 uses `liftV2Contract(ontologyV2)` rather than changing the frozen
V2 Coil profile.

For every lifted V2 profile, the additive no-op defaults are:

```text
relationIds: []
derivedFactIds: []
policyIds: []
technicalKnowledge: null
```

The lifted Coil profile reuses its frozen V2 Facts, designations, policies,
sources, and authority semantics. It gains no relation, derivation, policy, or
Technical Knowledge behavior in O4-A.

V2 did not previously distinguish the V2.1 `provenancePurpose` dimension.
The lift assigns `CURRENT_RESOURCE` as a neutral current-source purpose to all
V2 sources. This does **not** alter each source's existing `authority` or
`sourceKind`; those remain the authoritative V2 meaning. Future V2.1 profiles
must declare a more specific purpose when they use a relation projection,
preset, compatibility adapter, or Technical Knowledge metadata.

## New declarative catalogs

The V2.1 role catalog preserves all V2 roles and appends only:

- `FUNCTIONAL_TECHNICAL`
- `TECHNICAL_KNOWLEDGE`
- `POLICY_INPUT`

`RELATION_BACKED` is deliberately not a role because canonical relations are a
structural contract concept. Provenance purpose is a separate dimension from
both source authority and source kind:

- `CURRENT_RESOURCE`
- `RELATION_PROJECTION`
- `PRESET_INITIALIZATION`
- `COMPATIBILITY_ADAPTER`
- `KNOWLEDGE_METADATA`

## Shapes introduced

V2.1 now has immutable declaration shapes for:

- Base-profile optional capability references;
- identity-free extension profiles;
- canonical-endpoint relation declarations and cardinalities;
- local and related Fact references;
- minimal declarative predicates;
- direct, relation-projected, and derived Fact value kinds;
- `COPY`, `SUBTRACT`, and `PROJECT_RELATED_FACT` derivation metadata;
- declared materialization policies, including future cache metadata;
- conditional Fact metadata (`applicableWhen`, `requiredWhen`,
  `prohibitedWhen`);
- generic Technical Knowledge collections whose entries have generic metadata
  but whose keys are arbitrary and are not silently formal Facts.

The builders make exported declarations immutable. They intentionally do not
try to decide whether a declaration is semantically safe; that is O4-B's job.

## Explicitly deferred to O4-B

O4-A does **not** add a V2.1 validator or any runtime mechanism. O4-B must
provide the generic fail-closed checks for, at minimum:

- extension/base collisions and extension identity attempts;
- relation endpoint and cross-entity path validity;
- predicate typing and references;
- source and Fact derivation DAGs;
- derived authority/materialization invariants;
- compatibility and unresolved-source precedence;
- Technical Knowledge non-functional restrictions.

No Part, PumpShell, Recipe, Template, bearing, or other production profile was
created here. No database, API, AI, cost, BOM, drawing, or deployment behavior
changed.
