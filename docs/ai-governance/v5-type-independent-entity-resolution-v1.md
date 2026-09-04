# V5 Type-Independent Entity Resolution V1 — Authority Gate

## Status

`BLOCKED_FOR_SUPERVISOR`. No V1 resolver implementation exists yet.

The required logical boundary cannot be completed under the simultaneous constraints of authoritative resolution, no new V5 Business API dependency, and no new V5 direct SQLite read. This document records the frozen authority model and the decision required before implementation; it must not be treated as a shipped runtime contract.

## Scope

The intended future boundary accepts one exact source-owned entity mention without an entity-type hint and returns one of `RESOLVED`, `AMBIGUOUS`, `NOT_FOUND`, `UNSUPPORTED`, or `ERROR`. It must be deterministic, bounded, read-only, privacy-safe, and independent of Tool selection.

It does not select intent, route a capability, expose or execute a Tool, call a model, write business data, or change V4 behavior.

## Existing authority model

The Business Ontology contains 19 entity types. Current authoritative typed resolution is available for six types: `customer`, `order`, `recipe`, `part`, `coil`, and `template`.

`entityResolverAdapter.cjs` does not acquire candidates. It requires the caller to provide both an entity type and a `formalResult`, then delegates to the pure V3 formal-result reducer. The adapter itself is read-only, makes no Business API call, performs no direct DB read, and writes nothing.

The existing production discovery path is not independent: it receives an already selected Tool, derives entity type from `TOOL_TARGETS`, and calls discovery capabilities through Tool execution. Those executors obtain authoritative records through `internalApiClient` and read-only Business APIs.

## Resolver support inventory

| Classification | Entity types | Reason |
| --- | --- | --- |
| Resolvable | customer, order, recipe, part, coil, template | Existing V3 formal-result reducers and canonical identity descriptors exist, but candidate data must be supplied externally. |
| Structural-only | cost_context, factory, global | These are calculation/scope identities and do not represent independently resolved business records. |
| Unsupported | quotation, purchase, workflow, file, business_record, knowledge, drawing, stator_variant, pump_variant, technical_file | Ontology entries exist, but no approved V3 formal-result resolver adapter exists. |

## Required future registry

A future `entityResolutionRegistry.cjs` may register only the six proven read-only typed reducers and their authoritative candidate providers. Registration must validate ontology IDs, unique types, stable resolver references, and read-only authority. A reducer without an authorized candidate provider is not an end-to-end resolver and must not be registered as operational.

## Bounded fanout

Future fanout begins only after one exact source span has been selected. It may attempt each registered type once and must inspect all attempted types before declaring a unique result. It must not short-circuit on the first match.

The concrete values for `MAX_ENTITY_TYPE_ATTEMPTS`, `MAX_CANDIDATES_PER_TYPE`, and `MAX_TOTAL_CANDIDATES` remain undefined until the authority source and its response limits are approved. Defining limits before knowing the provider contract would create a misleading operational guarantee.

## Cross-type uniqueness

The future decision table remains mandatory:

- one canonical candidate across all supported types: `RESOLVED`;
- candidates across multiple types: `AMBIGUOUS`;
- multiple candidates within one type: `AMBIGUOUS`;
- zero candidates after all complete attempts: `NOT_FOUND`;
- no meaningful registered attempt: `UNSUPPORTED`;
- typed resolver error or incomplete authority: `ERROR`.

Deduplication may use only canonical identity plus entity type. Display names, lexical similarity, ordering, and model output cannot establish uniqueness.

## Identity and privacy

The input identity must originate from an exact Source Span/Source Anchor and remain character-for-character unchanged. Normalized values must be separate fields. Runtime traces may include status, counts, resolved type, match kind, ambiguity, timeout/error, and duration only. They must omit the source mention, canonical identity, business IDs, candidate names, and business payloads.

## Read-only guarantee

No create, update, alias repair, normalization persistence, business audit write, cache mutation, or Tool execution is permitted. A future read provider must be explicitly classified and tested as read-only. Resolving a business record is not authorization to execute any capability against it.

## Frozen evaluation status

All 15 frozen paths require a concrete entity resolution for this evaluation. None was executed because only one frozen source group contains prior resolver evidence and the safe artifacts do not contain the complete authoritative candidate rows needed by the six typed reducers. Synthesizing rows from expected answers would be circular and non-authoritative.

The local Task Class filter, coil set, 800平刀 reduction, latency, typed-attempt count, and concurrency gates therefore remain `NOT_RUN`. They cannot be promoted from the earlier expected-type simulation to real resolver evidence.

## Supervisor decision required

Before a new implementation phase, the Supervisor must authorize one bounded authoritative read source. The narrowest viable option is a dedicated V5 read-only provider built over already-approved business read APIs, with explicit call counters, timeout, capacity, privacy, and zero-write enforcement. This would make `V5 Business API Calls` greater than zero during resolution and therefore changes a frozen invariant.

Direct SQLite reads, reuse of V4 Tool execution disguised as resolution, fixtures treated as production authority, and LLM entity-type guessing remain prohibited.

## Future two-stage usage

Only after the authority decision and a passing resolver evaluation may the boundary be connected as:

```text
exact selected source span
→ bounded authoritative cross-type resolution
→ unique entity type or fail-closed outcome
→ entity-filtered local intent catalog
```

The second model call and Two-Stage Interpreter remain outside this phase.
