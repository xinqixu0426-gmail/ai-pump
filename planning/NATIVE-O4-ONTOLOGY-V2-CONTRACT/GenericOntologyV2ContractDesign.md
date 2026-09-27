# Generic Ontology V2 Contract Design

> O4 is a design-only closure based on Coil R3 and O3 Owner review. It does not alter `api/ontology/v2`, data, APIs, runtime, AI behaviour, or deployment. All proposed consumers remain disabled until separately implemented and approved.

## Decision and scope

Recommend an **additive Ontology V2.1 contract revision**, not V3. The V2 foundations remain correct: formal resource IDs own canonical identity, sources are a DAG, roles are declarative, and profiles are contract-only. The new capabilities extend those concepts; they do not replace Coil's profile or invent a second runtime.

The current V2 gap inventory is **eight** generic capabilities:

1. base profile plus declarative extension composition;
2. formal canonical-ID relations beyond the V1-only `relationBridge`;
3. relation-backed Fact projections;
4. Fact-level declared derivations and a derivation DAG;
5. declarative conditional applicability/requiredness, including related-entity conditions;
6. compatibility/preset provenance ranking separate from current authority;
7. a flexible non-functional Technical Knowledge collection;
8. generic validation of all above without entity/category/fact-name branches.

V2.1 must be **additive**: absent new fields mean empty/no-op capabilities. A V2.1 reader may lift a current V2 profile with `extensions=[]`, `relations=[]`, `policies=[]`, and no Technical Knowledge declaration. Coil therefore stays an `OWNER_REVIEWED_REFERENCE_PROFILE` with its existing Facts, designations, policies, source DAG, and V1 relation bridge unchanged.

## Preferred contract shape

```text
OntologyContract V2.1
├── sources                 # metadata addresses, never business values
├── roleCatalog             # declared role IDs
├── profiles                # base/standalone entity profiles
├── extensions              # applicability-gated enrichment profiles
├── relations               # formal canonical-ID relation declarations
├── policies                # declarative conditions; runtime disabled
└── technicalKnowledgeTypes # generic collection schemas, not fixed Fact inventories

Profile
├── identity                # formal resource canonical ID only
├── facts                   # typed functional/current/derived concepts
├── designations
├── existing policies       # selection, eligibility, costing remain additive
├── relationBridge          # V1 compatibility only, where needed
├── relationIds             # formal V2.1 relations owned by this profile
├── derivedFactIds          # optional explicit derived Fact declarations
├── policyIds               # applicability/requiredness declarations
└── technicalKnowledge      # optional generic collection reference
```

`profiles`, `extensions`, `relations`, and policies are definitions. The contract stores no values and creates no runtime read/write path. Existing exact-key V2 validation should gain a V2.1 reader/validator rather than silently weakening V2's strict shape rules.

## Base profile and extension composition

A base profile is a normal entity profile. An extension is an additive profile fragment with this minimum declaration:

```text
ExtensionProfile {
  extensionId, baseEntityType, applicability,
  facts[], designations[], relationIds[], policyIds[],
  technicalKnowledge?, sourceRefs[], runtimeEnabled:false
}
```

`baseEntityType` references one declared base profile. `applicability` is a declarative predicate; it does not execute JavaScript, regex, LLM logic, or storage queries. Composition produces an immutable virtual profile only after applicability is known. The generic engine never contains a category literal.

### Extension identity invariant

An extension enriches one base resource; it cannot define, replace, fork, or alias its canonical identity. It has no `identity` block, cannot add a canonical-ID Fact, and cannot mark a designation canonical. A separate resource with its own identity must be a separate entity profile, not an extension. Any violation fails `ONTOLOGY_V21_EXTENSION_IDENTITY_FORBIDDEN`.

### Collision rule

All composed IDs are globally unique within the composed profile: Fact IDs, designation IDs, relation IDs, and policy IDs. A base/extension collision, two applicable extension collisions, or incompatible relation/policy declarations fail closed. There is no inheritance override and no “last one wins.” An extension may refer to a base Fact, but must not redefine it.

## Applicability and conditional policy

The minimum safe V2.1 predicate language is deliberately small:

```text
Predicate :=
  FACT_EQUALS(factRef, typedLiteral)
| FACT_EXISTS(factRef)
| RELATION_EXISTS(relationId)
| ALL_OF(Predicate[])
```

`FACT_EQUALS` is sufficient for both boolean states (`true` and `false`); `FACT_EXISTS` distinguishes recorded from missing; `RELATION_EXISTS` guards a path. `ALL_OF` supports a small conjunction without opening arbitrary boolean expressions. `ANY_OF` and `NOT` are deferred until a real approved use case requires them.

Each functional Fact may declare `applicableWhen`, `requiredWhen`, and `prohibitedWhen` using this predicate language. A validator checks referenced Facts, relation IDs, literal data types, and path shapes statically. Runtime semantics are not enabled in O4, but their intended states are fixed:

- predicate known true → applicable/required/prohibited rule applies;
- predicate known false → the relevant Fact is `NOT_APPLICABLE`;
- missing relation, missing upstream Fact, or unresolved projection → `UNKNOWN_OR_UNRESOLVED`, never false and never a safe default.

`UNKNOWN_OR_UNRESOLVED` blocks a future functional completeness decision unless a separately declared compatibility adapter is permitted; it must never trigger a guessed branch.

## Formal relation model

V2.1 adds formal relation definitions independent of the legacy V1 bridge:

```text
Relation {
  relationId, sourceEntityType,
  target: { entityType, canonicalEndpointRequired:true },
  direction, cardinality, sourceRef,
  applicableWhen?, semanticRoles?, runtimeEnabled:false
}
```

The endpoint is always a formal canonical resource ID of the target profile. A display designation, model string, code, alias, or normalized name may be a projection or compatibility input, but cannot satisfy `canonicalEndpointRequired:true`. Cardinality is one of `ZERO_OR_ONE`, `EXACTLY_ONE`, `ZERO_OR_MANY`, or `ONE_OR_MANY`; its operational enforcement remains a future runtime concern.

### Relation-backed Facts

A Fact may be declared as a relation projection:

```text
valueKind: RELATION_PROJECTION
relationId: <declared relation>
targetFactRef: <target profile fact>
displayProjection: optional non-authoritative designation/fact
```

Its provenance retains the source relation ID, target canonical ID, target source/version, and projection source. A relation-backed Fact never changes the identity of either endpoint. This makes “selected bearing Part” distinct from “bearing model-looking string.”

## Derived Facts and derivation DAG

Derived Facts remain normal Facts with explicit `valueKind: DERIVED` and a `derivation` declaration:

```text
Derivation {
  operation, inputs: FactRef[], sourceRef,
  missingInputPolicy: UNRESOLVED,
  materialization: COMPUTE_ON_READ | MATERIALIZED_CACHE | NEVER_MATERIALIZE
}
```

The minimum justified operation inventory is:

- `COPY` — typed projection of one local Fact;
- `SUBTRACT` — two compatible numeric/unit inputs;
- `PROJECT_RELATED_FACT` — a declared canonical relation plus target Fact;
- `JOIN` remains limited to existing designation construction, not an executable business algorithm.

`ADD`, `MULTIPLY`, `DIVIDE`, conditionally selected calculations, and any cost formula are intentionally out of scope until a real use case is approved. `costEngine` and other business algorithms remain external authority boundaries.

Source DAG validation is not enough: source addresses can be acyclic while Facts derive from one another cyclically. V2.1 therefore requires a **separate Fact derivation DAG** across every local and relation-projected derivation dependency. Self-reference, A→B→A, and longer cycles fail `ONTOLOGY_V21_DERIVATION_CYCLE`.

### Derived authority and materialization

`DERIVED` is never independent authority. `COMPUTE_ON_READ` is preferred; `NEVER_MATERIALIZE` forbids persistence; `MATERIALIZED_CACHE` must retain all input Fact/source IDs, input versions/freshness, calculation/contract version, invalidation rule, and a derived marker. A cache may improve retrieval but cannot override or survive a changed source input as a live value. The validator can require this metadata shape; a later runtime must enforce freshness.

## Cross-entity policy

Cross-entity conditions reference only declared relation paths:

```text
FactRef {
  scope: LOCAL | RELATED,
  relationPath?: [relationId, ...],
  factId
}
```

For `RELATED`, the first relation originates on the local profile; every next relation originates on the preceding target profile; the terminal profile declares `factId`. Validator graph checks reject unknown relations, wrong direction/type, undeclared terminal Facts, cycles in a path, and non-canonical relation endpoints. No fuzzy name traversal is available.

This supports a generic policy such as “when a Fact reached through an explicitly declared relation path equals true, require two local Facts and derive a third.” The contract does not know any category or field name. A future runtime must return `UNKNOWN_OR_UNRESOLVED` if a required path is absent or ambiguous, rather than using a string fallback.

## Compatibility, authority, and provenance

Authority, source kind, and provenance purpose must be separated:

| Dimension | Meaning | Recommended values |
|---|---|---|
| authority | whether a value is current/derived/snapshot/unresolved | retain `CANONICAL_CURRENT`, `DERIVED`, `ESTIMATED_DERIVED`, `SAVED_SNAPSHOT`, `TEMPORARY_NON_AUTHORITATIVE`, `UNRESOLVED` |
| sourceKind | structural way a value is addressed | retain `RAW_CURRENT_RESOURCE`, `FORMAL_PROJECTION`, `DECLARATIVE_DERIVATION`, `UNRESOLVED_SEMANTIC_GAP` |
| provenancePurpose | why an otherwise valid source is being used | add declarative metadata: `CURRENT_RESOURCE`, `RELATION_PROJECTION`, `PRESET_INITIALIZATION`, `COMPATIBILITY_ADAPTER`, `KNOWLEDGE_METADATA` |

This avoids adding a new SourceKind for every migration state. A legacy adapter can be a formal projection structurally while honestly declaring `provenancePurpose: COMPATIBILITY_ADAPTER`; a preset is initialization provenance, not an authority tier.

Global structural rules:

1. `CANONICAL_CURRENT` outranks all non-canonical sources for a confirmed functional Fact.
2. `DERIVED` never overrides declared inputs; `SAVED_SNAPSHOT` never claims live current status.
3. `PRESET_INITIALIZATION` is allowed only before confirmation/finalization and cannot remain the effective authority of a saved functional Fact.
4. `COMPATIBILITY_ADAPTER` cannot be selection evidence, canonical identity, safe default, or an unlabelled functional override. It may only fill a missing explicitly declared legacy boundary and must surface compatibility provenance.
5. `UNRESOLVED` cannot satisfy requiredness, relation binding, derivation input, selection/default policy, or a cache freshness test.

The validator guarantees declaration rank, allowed purpose/authority combinations, and prohibited metadata. A later runtime is responsible for enforcing actual source selection against those declared ranks.

## Technical Knowledge contract

Technical Knowledge is not a flexible bag of Facts. It is a generic collection declaration:

```text
TechnicalKnowledgeCollection {
  collectionId, ownerEntityType,
  entrySchema: { key, label, value, unit?, valueType?, sourceRef?, updatedAt?, version?, evidenceRelationIds? },
  searchable:true, aiReadable:true,
  defaultClassification: TECHNICAL_KNOWLEDGE,
  allowsArbitraryKeys:true,
  runtimeEnabled:false
}
```

Entries are business-owned documentation/evidence metadata. They may be indexed and AI-readable, but have no canonical identity, designation, selection, relation-binding, requiredness, derivation, policy-input, cost, BOM, or write semantics. The contract must not expose fields that opt an arbitrary entry into those semantics. Formal file/evidence relations may be listed, but an entry cannot bind an entity by a display string.

### Promotion boundary

Promotion is a separate future change: declare a new typed Fact/relation/policy input, define source mapping and business role, optionally declare a migration mapping from legacy knowledge key, retain provenance, and approve a migration/compatibility plan. No label text, AI inference, or search result automatically promotes an entry.

The canonical owner remains the entity's Technical Knowledge metadata. `knowledge_entries`, FTS, vectors, and retrieval are derived search projections and may be stale, ranked, partial, or unavailable; they cannot supply operational functional truth.

## Role and source catalog evolution

Recommended minimal role additions are `FUNCTIONAL_TECHNICAL`, `TECHNICAL_KNOWLEDGE`, and `POLICY_INPUT`. Existing `TECHNICAL` may retain its current display-oriented meaning; `DERIVED_TECHNICAL` and `PROVENANCE` remain useful. Do **not** add `RELATION_BACKED`: it is a structural relation/value kind, not an independently assignable business role.

No new SourceKind is required. Add `provenancePurpose` metadata as above, validate its declared catalog values, and retain the existing source authority enum. This prevents compatibility/preset/knowledge semantics from multiplying source structural kinds.

## Runtime isolation and Coil compatibility

Every proposed relation, extension, policy, derivation, and Technical Knowledge collection declares `runtimeEnabled:false`. V2.1 must preserve the contract-wide `runtimeEnabled:false`, `storesBusinessValues:false`, `isBusinessSourceOfTruth:false`, and `CONTRACT_ONLY_NO_RUNTIME` gate. It adds no Business API read, resolver, dispatcher, parser, LLM call, entity linker, or write capability.

Coil needs no extension, V2.1 relation, derived Fact, cross-entity policy, or Technical Knowledge collection to remain valid. Existing source/identity/designation invariants remain in force. Its V1 relation bridge remains a compatibility block; V2.1 formal relations are additive and must not reinterpret that bridge or its unresolved fallback-default source.

## Real-use-case design fit

| Frozen case | Generic representation |
|---|---|
| Coil reference profile | standalone base profile; all new collections empty |
| ordinary Part | lightweight base profile with ordinary identity/designation/Facts |
| category-specific Part semantics | applicability-gated extension referencing a base Fact, without validator category logic |
| small PumpShell extension | extension adds one functional Fact, declared Template relation, and related-policy applicability; legacy defaults are compatibility sources only |
| Recipe functional profile | standalone profile with typed functional Facts and conditional policies |
| upper/lower bearing | `EXACTLY_ONE` canonical-ID relation to Part; display/model remains projection |
| stainless span | `SUBTRACT` derived Fact from two local numeric functional Facts under a related policy condition |
| non-stainless span | explicit local functional Fact under the opposite condition |
| Recipe Technical Knowledge | optional generic collection with arbitrary entries and evidence relations |
| Shell/Template legacy values | sources with `COMPATIBILITY_ADAPTER` purpose, non-authoritative rank and explicit unresolved safety |

## Design-only implementation phases

1. **O4 review:** Owner/Supervisor approve this generic contract design and invariant matrix.
2. **O4-A contract implementation:** add V2.1 shape/types/catalog metadata while retaining V2 Coil compatibility.
3. **O4-B validator implementation:** implement generic static validation and all fail-closed errors.
4. **O4-C synthetic tests:** prove composition, path, derivation, authority, and Technical Knowledge extensibility without entity-specific validator changes.
5. **O4-D profile work:** define Part Base and PumpShell Extension after their own review.
6. **O4-E profile work:** define Recipe functional/knowledge profiles after storage/DTO design approval.
7. **O4-F runtime adapter design:** separately design migration, compatibility adapters, relation resolution, and any runtime enablement.

No phase above is authorized by this document.
