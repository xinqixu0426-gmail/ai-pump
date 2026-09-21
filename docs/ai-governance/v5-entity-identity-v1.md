# V5 Entity Identity V1

Status: isolated V5-C shadow/test contract.

Implementation: `api/services/ai-v5/entityIdentity.cjs` and `api/services/ai-v5/entityResolverAdapter.cjs`

## Identity object

```text
V5EntityIdentity
  version                     1
  entityType                  registered ontology type
  rawMention                  immutable exact string observation
  normalizedMention           separate derived string or null
  canonicalEntityId           formal ID or null
  canonicalBusinessKey        {name, value} from formal source or null
  resolutionStatus            UNRESOLVED | RESOLVED | AMBIGUOUS | NOT_FOUND | INVALID
  matchType                   EXACT | FUZZY_UNIQUE | AMBIGUOUS | NOT_FOUND | NOT_RESOLVED
  source                      provenance owner
  resolverPath                explicit resolver provenance or null
  resolverInputField          explicit input field or null
  normalizationPolicyId       policy identity; does not run normalization
  identityPreservationStatus  PRESERVED | TRANSFORMED_TRACKED
  displayName                 optional, never promoted to canonical identity
```

The preservation detector can additionally report `TRANSFORMED_UNTRACKED` or `UNKNOWN` for observations that cannot form a valid identity object.

## Ownership and invariants

- I01: `rawMention` is copied exactly, deeply frozen, and never mutated.
- I02: normalization writes only `normalizedMention`; both values may coexist and differ.
- I03: canonical identity requires trusted `FORMAL_BUSINESS_SOURCE` or `EXISTING_RESOLVER_V3` provenance and an explicit resolver path. A model, normalizer, display label, or caller truthiness cannot promote it.
- I04: the V5 resolver adapter declares `rawMention` as its input. Current V4 input ownership remains documented as `tool_argument`.
- I05: resolver projection creates a new identity and cannot rewrite the earlier raw observation.
- I06: `AMBIGUOUS` rejects any canonical ID or business key.
- I07: `NOT_FOUND` rejects any canonical ID or business key.

An unresolved, invalid, ambiguous, or not-found identity cannot contain canonical identity. A resolved identity must contain a formal ID or formal business key plus provenance.

## Raw and normalized mention

Raw strings retain punctuation, Unicode, whitespace, case, and numeric-looking syntax exactly. In particular:

```text
rawMention="v750-tokoy-"
normalizedMention="v750-tokoy"

rawMention="V750-A"
normalizedMention="v750-a"
```

These are valid tracked transformations, not silent identity replacement. A numeric input `800` is rejected where a raw observation string is required; the string `"800"` remains a string. Typed numeric conversion belongs to later argument validation.

## Resolver input policy

For `customer`, `order`, `recipe`, `part`, `coil`, and `template`:

```text
V5 input field=rawMention
current V4 source=tool_argument
adapter=aiEntityResolverV3.resolveFormalEntityResultV3
mutation allowed=false
```

The adapter requires a caller-provided formal result and does not call Business APIs, the database, an executor, or a write tool. It reuses current candidate scoring/status behavior read-only. Exact becomes `EXACT`; unique fuzzy candidate becomes `FUZZY_UNIQUE`; ambiguous and not-found remain explicit with no canonical identity. Other ontology types are unsupported rather than guessed.

## Damage detection

`detectIdentityTransformation(before, after)` emits only structural metadata:

```text
lengthDelta
punctuationDelta
digitDelta
caseChanged
whitespaceChanged
contentChanged
```

It does not return input text. `detectUntrackedIdentityLoss(expectedShape, observedShape)` compares structural shapes and reports `PRESERVED`, `TRANSFORMED_UNTRACKED`, or `UNKNOWN`. `validateResolverInputIdentity()` rejects any concrete resolver input that is not byte-for-byte equal to the identity's `rawMention`; it records structural damage without repairing it.

## V5Task compatibility

`V5EntityIdentity` extends the V5-A EntityReference shape. A V5Task `entityContext` accepts it and preserves the core `entityType/rawMention/normalizedMention/canonicalEntityId` values. V5-A intentionally projects only its frozen base EntityReference fields; the extended resolution metadata remains on the separate immutable V5-C identity object until a future contract-version change is explicitly approved.

## Ambiguity, not-found, and display semantics

Ambiguous/not-found outcomes never infer identity from the highest score. `displayName` remains presentation metadata and is never copied to `canonicalEntityId`. Candidate names and stable business keys may participate only through the existing formal resolver result and trusted provenance.

## Non-goals

P10 does not change normalization, punctuation handling, fuzzy/exact thresholds, alias rules, resolver behavior, tool arguments, routing, evidence, verification, policy, or production execution.
