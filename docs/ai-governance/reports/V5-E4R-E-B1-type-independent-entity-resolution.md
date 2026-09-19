# V5-E4R-E-B1 Type-Independent Entity Resolution

## 1. Executive Result

P15R-E-B1 is **BLOCKED** by the prompt's Business API policy. The current V5 adapter is a pure typed projection over caller-supplied formal results. The only existing path that acquires authoritative candidate rows is the production V3 discovery path, which depends on a selected Tool and executes read capabilities through `internalApiClient` and Business APIs. No independent, authoritative, pre-routing candidate provider exists that avoids both Business API calls and new direct DB reads.

Implementing a fixture-injected fanout would pass synthetic collision tests but would not satisfy `exact mention → authoritative entity → authoritative entityType` or the frozen real resolver gate. Per rule 21, the stage stopped before production implementation and is reported as `BLOCKED_FOR_SUPERVISOR`. No resolver, registry, contract, observability hook, Tool, model, API, DB, or production routing change was made.

## 2. Frozen Architecture Context

Start commit: `2e7b368006e1eea396b8173f49b5833837f9baad`. P15R-E-A established that entity filtering would reduce 27 global Task Classes to a median of one and maximum of four, while retaining the expected class in 15/15 paths. It also explicitly identified the missing type-independent authority boundary.

The worktree was not clean at start. All pre-existing user V4/AI, test, package, and documentation changes were preserved and excluded from this phase.

## 3. Existing Resolver Support

The ontology has 19 types. Six have `V3_FORMAL_RESULT` adapters:

| Type | Existing reducer | Authority declared by ontology | End-to-end candidate acquisition |
| --- | --- | --- | --- |
| customer | `resolveFormalEntityResultV3` | customers primary key/business name | Not in V5 adapter |
| order | `resolveFormalEntityResultV3` | orders primary key/contract number | Not in V5 adapter |
| recipe | `resolveFormalEntityResultV3` | recipes primary key/name | Not in V5 adapter |
| part | `resolveFormalEntityResultV3` | parts primary key/model | Not in V5 adapter |
| coil | `resolveFormalEntityResultV3` | coils primary key/scheme code | Not in V5 adapter |
| template | `resolveFormalEntityResultV3` | templates primary key/shell model | Not in V5 adapter |

The reducer is authoritative only when its input rows came from an approved business source. Lexical text, expected test values, and model output are not candidate authority.

## 4. Resolvable Type Registry

No operational `entityResolutionRegistry.cjs` was created because registering reducers without authorized candidate providers would falsely advertise an end-to-end resolver.

Audit classification:

- resolvable with external authoritative results: 6 — coil, customer, order, part, recipe, template;
- structural-only: 3 — cost_context, factory, global;
- unsupported: 10 — business_record, drawing, file, knowledge, pump_variant, purchase, quotation, stator_variant, technical_file, workflow.

## 5. Type-Independent Resolution Contract

No runtime contract was implemented. The intended statuses and privacy rules are documented in `docs/ai-governance/v5-type-independent-entity-resolution-v1.md`, explicitly marked as an unimplemented authority gate.

The current caller still requires an entity-type hint and an external formal result. `Resolution Authoritative=NO` for a type-independent logical call because that call does not exist.

## 6. Bounded Fanout

No limits were defined or implemented. The maximum meaningful fanout depends on an approved provider's response contract. The future design must attempt at most each of the six registered types once for one selected exact span, not 128 spans × six types.

## 7. Cross-Type Uniqueness

Not run. Without authoritative candidate acquisition, collision fixtures would test only an aggregation algorithm and could not prove an authoritative resolution boundary. No first-match behavior was introduced.

## 8. Ambiguity / Failure Handling

Cross-type collision, same-type ambiguity, not-found, typed error, and timeout tests were not run because no complete resolver was implemented. The required fail-closed table is frozen in the design-gate document; none of it is claimed as passing runtime behavior.

## 9. Identity Preservation

The existing Source Span and Source Anchor code was unchanged. No new resolver consumed the identity test set, so raw, exact, and numeric-like preservation fields are `NOT_RUN`, not inferred from earlier span tests.

## 10. Read-Only / Side-Effect Safety

The existing V5 adapter and V3 formal-result reducer are pure/read-only over supplied values. They make zero Business API calls, direct DB reads, or writes. The production acquisition path is different: `resolveAiToolTargetV3` derives type from a selected Tool and invokes typed discovery through Tool execution. Query executors reach `internalApiClient` and read-only Business APIs.

No new V5 Business API dependency, direct DB read, Tool call, write authority, or production route was added. The blocker is precisely that an end-to-end authoritative resolver needs one of the prohibited read paths.

## 11. Observability / Privacy

No new span was added because no resolver exists to instrument. The safe dataset contains only support classifications, counts, reason codes, and the blocker. It contains no request text, entity mention, canonical identity, business ID, candidate name, business payload, PII, or secret.

## 12. Deterministic Tests

`NOT_RUN`. Implementing tests around a non-authoritative fixture-only resolver would create misleading PASS evidence. Existing code was left unchanged.

## 13. Frozen Resolver Evaluation

Frozen paths: 15. Resolution-applicable: 15. Not applicable: 0. Executed: 0.

Only one of five source groups has prior usable resolution evidence in the frozen P06 artifacts. The other groups do not persist raw candidate rows, by design. Reconstructing candidate rows from expected answers would fabricate authority. Calling existing discovery capabilities would violate the phase's zero Tool/Business API rule. Direct DB reads are explicitly forbidden.

Result: `NOT_RUN_BLOCKED_BEFORE_AUTHORITY`.

## 14. Coil Group

Resolver status: `NOT_RUN`. Resolved type and local Task Class count are not claimed. The prior P15R-E-A expected-type simulation found two local classes (`tc_003`, `tc_004`), but this is not real resolver evidence and is not reused as a B1 PASS.

## 15. 800平刀 Group

Resolver status: `NOT_RUN`. The earlier expected-type simulation reduced `part` to one class, but the frozen artifacts do not contain an approved pre-routing authoritative part-candidate dataset. No database alias, special case, keyword rule, or API call was added.

## 16. Exact Entity Group

Resolver cases executed: 0/3. Earlier artifacts contain recipe resolution evidence, but B1 requires the new type-independent logical boundary and cross-type uniqueness across all supported types. Replaying only the known recipe result would not establish that boundary.

## 17. Local Task-Class Reduction

Not run from real resolver output. Expected-class survival remains an architectural simulation from P15R-E-A, not a B1 evaluation result.

## 18. Resolver Cost / Latency

Logical calls: 0. Typed attempts: 0. Median/p95: `NOT_RUN`. No fanout explosion or timeout occurred because resolution was stopped before any authority call.

## 19. Concurrency

`NOT_RUN`. There is no complete resolver boundary to exercise with ten concurrent calls.

## 20. Database Safety

The business database remained at its start SHA-256, mtime, and size; recursive backup count remained 209. No startup backup was created or deleted. No direct DB access was added.

## 21. Regression

No production implementation changed. Combined V5 tests and full regression were not required to validate a nonexistent resolver and are reported `NOT_RUN`; the frozen known failure remains the missing `.guardian/config.yaml`, but this phase does not claim a fresh baseline run.

## 22. P15R-E-B2 Preconditions

`P15R_E_B2_READY=NO`.

Supervisor authorization is required for a bounded, explicitly read-only candidate provider. The smallest viable future scope is a governed provider over the six existing read-only business queries, with zero writes, no Tool execution, one request-scoped candidate snapshot per type, strict counters, timeout/capacity guards, and privacy enforcement. This would change `V5 Business API Calls` from zero and must be approved explicitly.

Until then, do not implement the Two-Stage Interpreter, second model call, local-intent model, production routing, Tool execution, direct DB read, or fixture-based fake authority.
