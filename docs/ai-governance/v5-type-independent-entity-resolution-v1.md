# V5 Type-Independent Entity Resolution V1

## Status and scope

V1 is implemented as a read-only, bounded resolver over the governed Entity Lookup API V1. A caller supplies one exact, source-owned raw mention and no entity-type hint. The resolver returns `RESOLVED`, `AMBIGUOUS`, `NOT_FOUND`, `UNSUPPORTED`, or `ERROR`.

It does not select intent, route or execute a capability, call a model or Tool, write business data, or change V4 behavior.

## Authority boundary

```text
exact Source Span / Source Anchor
→ resolveEntityTypeIndependent(rawMention)
→ internalApiClient.lookupEntities
→ POST /api/entity-lookup
→ official Business API service/data-access
→ complete authoritative candidate set
```

V5 has no direct SQLite dependency. It makes exactly one batch Business API read per logical resolution. The API evaluates the six registered entity types inside the formal Business API boundary.

## Resolution registry

`V5_ENTITY_RESOLUTION_REGISTRY_VERSION=1` registers only `coil`, `customer`, `order`, `part`, `recipe`, and `template`. Every entry references an existing Business Ontology ID, the same governed read provider, and a read-only authority class. Structural-only and unsupported ontology types remain outside this boundary.

## Bounds and completeness

The logical call sends all six registered types with `EXACT_OR_APPROVED_ALIAS`. The Business API bounds the request to six types, ten candidates per type, thirty candidates total, and a 160-code-point mention. The resolver validates the response shape, exact attempted-type count, allowed candidate types, minimal candidate fields, candidate uniqueness, and status/completeness consistency.

It never short-circuits on the first typed match. `complete=false`, a malformed response, an API error, or `ENTITY_LOOKUP_TIMEOUT` produces `ERROR`; none can be reclassified as `NOT_FOUND` or `RESOLVED`.

## Decision table

| Complete candidate result | Resolver outcome |
| --- | --- |
| exactly one candidate | `RESOLVED` with its entity type and runtime canonical identity |
| multiple candidates in one type | `AMBIGUOUS` |
| candidates across multiple types | `AMBIGUOUS` |
| zero candidates | `NOT_FOUND` |
| no meaningful registered type set | `UNSUPPORTED` |
| incomplete, invalid, failed, or timed out read | `ERROR` |

Deduplication uses `entityType + canonicalId`, never display text. The resolver does not ask a model to arbitrate ambiguity.

## Identity ownership

`rawMention` must originate from the exact Source Span/Source Anchor and remains character-for-character unchanged in runtime memory. The resolver never trims, normalizes, translates, corrects punctuation, or coerces numeric-looking text. Canonical identity is a separate runtime field and is present only for a unique resolved candidate.

## Read-only and privacy guarantees

The resolver adds one Business API read dependency and no write authority. It invokes no Tool, performs no direct DB read, calls no model, creates no alias, and persists no resolution or audit business row.

Traces and durable artifacts may store only status, counts, resolved type, completeness, match-kind categories, reason codes, and duration. They must omit the raw mention, canonical identity, business IDs, names, and business values.

## Frozen evaluation result

The governed real read evaluation exercised all 15 frozen paths. Twelve paths resolved to the authoritative entity type. Three `FLAT_BLADE_PRICE` paths returned a complete cross-type ambiguity because the same exact formal identity exists as both a `part` and a `template`. This is a valid fail-closed result, not a false unique resolution.

Consequently, the frozen accuracy is `12/15 (80%)`, four of five source groups resolve fully, and local Task Class survival is `12/15`. Coil resolves to `coil` with two compatible local classes; the Exact Entity recipe group resolves to `recipe` with four; the two part inventory groups resolve to `part` with one. The 800平刀 group remains ambiguous and cannot proceed to local intent selection without an authoritative disambiguation source.

The evaluation made one batch API call per logical resolution, produced no timeout, passed ten-request isolation, and left the business database and backup inventory unchanged.

## Future two-stage use

The resolver is ready as an isolated authority boundary, but P15R-E-B2 is not ready because the frozen gate requires all 15 paths to resolve uniquely. Future architecture work must preserve this ambiguity rather than add fuzzy, first-result, keyword, alias, or database repair shortcuts.
