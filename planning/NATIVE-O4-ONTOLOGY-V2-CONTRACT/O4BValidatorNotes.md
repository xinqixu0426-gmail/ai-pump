# O4-B — Generic V2.1 Validator Notes

## Location and compatibility

The static validator is located at
`api/ontology/v2_1/validator.cjs` and exports:

```text
validateOntologyV21(contract)
```

It is exported from `api/ontology/v2_1/index.cjs`. It does not alter or
import behavior into `api/ontology/v2/validator.cjs`.

For the frozen V2 portion of every V2.1 profile, the validator creates an
in-memory V2-shaped projection and calls the existing `validateOntologyV2`.
That preserves V2's canonical identity, designation, Fact, role, source,
selection, eligibility, costing, bridge, and runtime-isolation semantics
without broadening V2's accepted object shape. V2.1 then validates only its
additive declarations.

The lifted Coil profile validates with no changed Coil fields or runtime
behavior.

## Validation order

1. Reject non-JSON-safe declarations and validate the exact V2.1 root shape.
2. Enforce V2.1 revision and contract-wide runtime isolation.
3. Validate role catalog, sources, provenance purpose, and source DAG.
4. Reuse V2 validation through the non-mutating V2 projection.
5. Validate base optional capabilities and compose extension semantic surfaces.
6. Validate relations, ownership, canonical endpoint declarations, and
   directed type traversal.
7. Validate Technical Knowledge collections and owner references.
8. Validate Facts, FactRefs, predicates, relation projections, derivations,
   cache declarations, and the independent Fact derivation DAG.
9. Validate inert conditional-policy references and ownership.

Every step is declaration-only. The validator never reads a business row,
calls an API, resolves an endpoint, evaluates a real predicate, or calculates
a derived value.

## Canonical FactRef and predicate shapes

Executable V2.1 FactRefs are objects, never shorthand strings:

```text
LOCAL:   { scope: "LOCAL", factId: "entity.fact" }
RELATED: { scope: "RELATED", relationPath: ["entity.uses_other"], factId: "other.fact" }
```

The relation path always traverses the declared canonical type direction:

```text
Relation.sourceEntityType -> Relation.target.entityType
```

`direction` remains relation metadata; it does not grant an implicit reverse
or fuzzy path. A RELATED path must begin at the current entity, use only
declared relations, type-connect at every hop, end on a declared Fact, and not
repeat an entity type.

For `valueKind: RELATION_PROJECTION`, the contract is deliberately narrower:
`targetFactRef` is a RELATED FactRef with exactly one path element, and that
element must exactly equal `relationProjection.relationId`. Optional
`displayProjection` follows the same one-hop binding. A same-target relation
cannot be substituted merely because it reaches the same entity type. Multi-hop
projection belongs to a RELATED FactRef inside `PROJECT_RELATED_FACT` instead.

The canonical predicate data shapes are:

```text
FACT_EQUALS:    { kind, factRef, value }
FACT_EXISTS:    { kind, factRef }
RELATION_EXISTS:{ kind, relationId }
ALL_OF:         { kind, predicates }
```

Terminal Facts for new V2.1 predicates require the declarative
`POLICY_INPUT` role. Existing V2 selection/eligibility/costing declarations
are intentionally not retrofitted with that role.

## Derived Facts and cache metadata

`valueKind: DERIVED` requires a declared derivation, `authority: DERIVED`, and
no identity or candidate-selection evidence. Its inputs are FactRef objects.
The only approved operations are `COPY`, `SUBTRACT`, and
`PROJECT_RELATED_FACT`; numeric and unit compatibility is checked statically.

The validator builds a separate graph over derived Fact inputs. This catches
self, two-node, and longer Fact derivation cycles independently of the source
DAG.

O4-B makes one V2.1-only schema clarification: derivation metadata may include
optional `cacheMetadata`. It is required only for `MATERIALIZED_CACHE` and has
the exact shape:

```text
{
  inputRefs, sourceRefs, freshness,
  contractVersion, calculationVersion, invalidation
}
```

`COMPUTE_ON_READ` and `NEVER_MATERIALIZE` reject cache metadata. Cache metadata
does not create a cache and can never change a derived Fact into canonical
authority.

## Source purpose and unresolved safety

Source authority, source kind, and provenance purpose remain independent.

- `COMPATIBILITY_ADAPTER` and `PRESET_INITIALIZATION` cannot claim canonical
  current authority.
- Compatibility Facts cannot be identity evidence, selection evidence, or
  safe default summaries.
- Presets cannot be direct identity or candidate-selection evidence, and
  cannot back a formal relation endpoint.
- `RELATION_PROJECTION` sources require a formal projection source kind and
  relation-projection Facts must use that purpose.
- Unresolved sources cannot be used as resolved functional inputs, defaults,
  identity evidence, selection evidence, or conditionally required Facts.

The historical V2 Coil lift uses `CURRENT_RESOURCE` as its documented neutral
purpose. Existing V2 authority and source kind remain unchanged, so its derived
and unresolved source declarations remain valid and truthful.

## Technical Knowledge boundary

Technical Knowledge is validated as a generic collection with exactly the
generic entry metadata fields: `key`, `label`, `value`, plus optional unit,
value type, source reference, version/timestamp, and evidence relations.
It must allow arbitrary keys, be searchable and AI-readable as declared, and
remain runtime-disabled.

The schema rejects functional-control fields such as identity, selection,
relation binding, policy, cost/BOM, requiredness, derivation, or write flags.
Facts, predicates, derivations, policies, and relations resolve only formal
Fact/Relation IDs, so an arbitrary knowledge key cannot silently become
functional truth. Search/index execution remains outside this contract and may
not become operational authority in a later runtime implementation.

## Conditional-policy boundary

O4 did not approve an executable policy-rule DSL. O4-B therefore accepts a
policy's declared predicate, FactRef, and relation references, but requires its
`rules` array to be empty inert metadata. A future policy-runtime design must
introduce any executable rule language explicitly; functions, callbacks,
regular expressions, class instances, and arbitrary expressions are rejected.

## Deferred work

O4-C will construct richer multi-feature synthetic proof scenarios. A later
runtime-design phase may define policy evaluation, relation resolution,
derivation execution, cache persistence, source adapters, and Technical
Knowledge indexing. None is implemented by O4-B.

O4-C must specifically stress-test conditional Extension composition,
including whether references to Facts introduced by other conditional
extensions can leak into a base semantic surface. That composition question is
not changed by this relation-projection binding correction.
