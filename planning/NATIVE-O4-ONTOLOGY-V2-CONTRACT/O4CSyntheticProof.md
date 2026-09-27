# O4-C — Synthetic Generic Contract Proof

## Purpose and boundary

This proof uses only synthetic entity types: `assembly`, `component`, `module`,
and `reference_item`. It creates no production Part, PumpShell, Recipe,
Template, bearing, or other business profile. It validates declarations only:
there is no database read/write, relation resolution, derivation execution,
API call, AI behavior, or runtime enablement.

The proof closes the composition question left open by O4-B: merely declaring
multiple conditional Extensions on one Base Profile must not make their Facts,
Relations, or Policies globally visible to one another.

## Synthetic world

```text
assembly --uses_component--> component --uses_module--> module --uses_reference_item--> reference_item
                                  |
                                  +-- feature_a (conditional Extension)
                                  |     +-- extension_uses_module_a
                                  |
                                  +-- feature_b (conditional Extension)
                                        +-- extension_uses_module_b
```

`feature_a` and `feature_b` both depend only on the Base `component.category`
policy input. `feature_a` adds an internal amount derivation, a direct relation
projection, a designation, an inert policy, and a generic Technical Knowledge
collection. `feature_b` adds a separate Fact, designation, and relation with no
cross-reference to `feature_a`.

## Semantic surface model

| Surface | Visible Facts | Visible Relations / Policies |
|---|---|---|
| Base | Base Profile only | Base-owned only |
| Extension X | Base + Extension X | Base-owned + X-owned only |
| Extension Y | Base + Extension Y | Base-owned + Y-owned only |

There is no implicit "all extensions on this entity" surface. This is a
deliberate fail-closed rule: static validation does not attempt to prove that
two arbitrary applicability predicates are mutually exclusive or compatible.

### Bootstrap rule

An Extension's `applicability` is validated using the Base surface only. It
cannot reference its own Fact, a sibling Extension Fact, or an
Extension-owned relation. Otherwise the declaration would need the Extension
to exist before it could determine whether it exists.

### Relation and policy ownership

`profile.relationIds` and `extension.relationIds` establish declaration
ownership. The same applies to policy IDs. A Base declaration may traverse a
Base-owned relation. Extension X may additionally traverse X-owned relations.
A sibling-owned relation or policy fails closed with extension-scope/ownership
validation; generic external RELATED paths may not traverse a conditional
Extension-owned hop without a future explicit relation-scope contract.

## Related Extension Fact refinement

O4-C makes one additive V2.1 contract refinement: an extension-owned terminal
Fact in a RELATED FactRef requires `targetExtensionId`.

```js
{
  scope: 'RELATED',
  relationPath: ['assembly.uses_component'],
  factId: 'component.aGate',
  targetExtensionId: 'component.feature_a',
}
```

The validator requires all of the following:

1. The path reaches the declared terminal entity type through formal,
   visible relations.
2. `component.feature_a` exists and is an Extension of that terminal entity.
3. `component.aGate` is owned by that Extension.
4. An extension-owned terminal Fact without a qualifier fails closed.
5. A wrong qualifier, a qualifier from another terminal entity, or a qualifier
   supplied for a Base Fact fails closed.

The qualifier is terminal-Fact provenance, not a runtime assertion that a real
target resource currently satisfies the Extension predicate.

## Positive proof matrix

The focused proof covers 17 positive construction cases:

| Case | Result |
|---|---|
| Frozen Coil V2.1 lift | pass |
| Base-only synthetic contract | pass |
| One conditional Extension | pass |
| Two independent same-Base Extensions | pass |
| Extension applicability on Base Fact | pass |
| Extension derived Fact from Base + own Fact | pass |
| Base-owned canonical relation | pass |
| Same-Extension-owned relation usage | pass |
| One-hop relation projection | pass |
| Multi-hop Base-owned RELATED / PROJECT_RELATED_FACT | pass |
| Materialized-cache declaration metadata | pass |
| Base cross-entity predicate | pass |
| Qualified terminal Extension Fact | pass |
| Generic arbitrary-key Technical Knowledge collection | pass |
| Labelled compatibility source declaration | pass |
| Labelled preset source declaration | pass |
| Full combined synthetic contract | pass |

## Negative proof matrix

The focused mutation proof covers 30 fail-closed cases. Each starts from the
known-good synthetic world and changes one boundary where practical.

| Boundary | Representative rejected mutation |
|---|---|
| Applicability bootstrap | self or sibling Extension Fact |
| Base leakage | Base condition, derivation, policy, or relation use reaches Extension data |
| Sibling isolation | Extension A condition, derivation, policy, or relation use reaches Extension B |
| RELATED target scope | omitted, wrong-type, wrong-owner, or Base-Fact qualifier |
| Designations | Base-to-Extension or sibling-Extension component dependency |
| Composition collision | duplicate same-Base Fact or designation |
| Relation projection | same-target relation substitution or multi-hop projection |
| Conditional relation path | external RELATED path crosses Extension-owned hop |
| Derivation DAG | same-Extension derived cycle |
| Technical Knowledge boundary | arbitrary key used as FactRef, predicate input, or derivation input |
| Compatibility/preset | compatibility identity/policy elevation or preset canonical elevation |
| Runtime/data safety | nested runtime enablement or executable declaration |
| Genericity | validator scanned for real-business branch patterns |

## Unknown versus not applicable

At future runtime, a declared target Extension Fact has two distinct outcomes:

- Target Extension predicate is false: the Fact is `NOT_APPLICABLE`.
- Target Extension predicate cannot be resolved: the Fact is
  `UNKNOWN_OR_UNRESOLVED`.

The static validator deliberately does not collapse either state into false or
attempt to evaluate a real entity. It validates only that the Extension,
terminal Fact, relation path, and qualifier declarations are structurally
safe.

## Why this remains generic

All semantics are driven by entity types, formal relation IDs, Fact IDs,
Extension ownership, and catalogs in the declaration. The validator contains
no branch for a production entity, category, database field, or UI flow. The
synthetic proof demonstrates composition, projection, derivation, policy, and
Technical Knowledge behavior without using a production profile.

## Remaining runtime-only work

Later phases must still define how a concrete resource evaluates Extension
applicability, resolves canonical endpoints, computes derived values, reports
`NOT_APPLICABLE` versus `UNKNOWN_OR_UNRESOLVED`, and indexes Technical
Knowledge. Those concerns remain disabled and outside V2.1 contract
validation.
