# Entity Lookup API V1

## Scope and authority

`POST /api/entity-lookup` is a governed read-only Business API query. It gives V5 a bounded way to acquire authoritative entity candidates without direct SQLite access and without invoking an AI Tool. The endpoint does not select an entity, route a capability, execute a Tool, or mutate business data.

`ENTITY_LOOKUP_API_VERSION=1`. The MVP server allowlist is exactly `coil`, `customer`, `order`, `part`, `recipe`, and `template`.

## Request contract

```json
{
  "version": 1,
  "mention": "source-owned exact mention",
  "entityTypes": ["part", "coil"],
  "matchPolicy": "EXACT_OR_APPROVED_ALIAS"
}
```

Validation is strict: no additional fields, no type coercion, a non-empty string mention, a non-empty unique allowlisted type array, and a supported match policy. Limits are:

- `MAX_MENTION_LENGTH=160` Unicode code points;
- `MAX_ENTITY_TYPES_PER_REQUEST=6`;
- `MAX_CANDIDATES_PER_TYPE=10`;
- `MAX_TOTAL_CANDIDATES=30`.

## Match semantics

The supported policies are `EXACT`, `APPROVED_ALIAS`, and `EXACT_OR_APPROVED_ALIAS`. Exact matching uses the existing business identity columns and their formal case-insensitive equality policy. It does not remove punctuation or spaces and does not use contains, prefix, edit-distance, semantic, top-score, or first-result fallback.

The six MVP types currently have no approved alias source. `APPROVED_ALIAS` therefore yields no alias candidates; `EXACT_OR_APPROVED_ALIAS` currently has the same candidate set as `EXACT`. Runtime alias generation is forbidden.

The exact identity field classes are:

| Entity type | Identity field classes | Canonical ID source |
| --- | --- | --- |
| coil | scheme code, scheme name, specification, specification-sheet composite | `coils.id` |
| customer | customer name | `customers.id` |
| order | order ID, contract number, customer identity recorded on order | `orders.id` |
| part | part model | `parts.id` |
| recipe | recipe name, recipe specification | `recipes.id` |
| template | shell model | `pump_shell_templates.id` |

Multiple identity fields matching the same record are deduplicated by `entityType + canonicalId`.

## Response contract

```json
{
  "version": 1,
  "status": "OK",
  "complete": true,
  "attemptedEntityTypes": 2,
  "candidateCount": 1,
  "candidates": [
    {
      "entityType": "part",
      "canonicalId": "opaque-business-id",
      "matchKind": "EXACT"
    }
  ]
}
```

Candidates contain `entityType`, `canonicalId`, and `matchKind`; coil candidates may additionally carry `bindingRefs: [{ kind: 'schemeCode', value: string }]`, sourced solely from the matched row's formal `coils.scheme_code`. Missing codes omit this optional field. Old three-field candidates remain valid but cannot enable coil binding. No other reference kind is approved. Full DTOs are never returned; zero/one/multiple candidate and cross-type ambiguity semantics remain unchanged. Binding values are software-only: never model input, logs, Phoenix attributes or evaluation records. Only kinds/counts/status may be observed.

`complete` is authoritative. Per-type or aggregate overflow returns `status=INCOMPLETE` and `complete=false`; V5 must fail closed and cannot resolve a unique entity from that response. Stable error statuses distinguish `INVALID_REQUEST`, `UNSUPPORTED_TYPE`, and `INTERNAL_ERROR` from a complete zero-candidate result.

## Read-only and security guarantees

Although the endpoint uses POST for a bounded complex query body, it is a query: it does not require `allowWrite`, confirmation, an idempotency key, a mutation transaction, an audit business row, or a backup. SQL is parameterized, equality-only, bounded at the data-access boundary, and follows the existing Business API database convention.

The endpoint is mounted after the standard `/api` authentication middleware and is not public. V5 reaches it only through the read-only `internalApiClient.lookupEntities` wrapper. No AI Tool exposes this endpoint, and V5 does not open a database connection.

Telemetry may record status, attempted type count, candidate counts, completeness, match-kind categories, and duration. It must not record the mention, canonical IDs, identity values, or other business payloads.
