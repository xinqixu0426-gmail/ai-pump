# M5-C On-Demand Tool Schema Loading

## Control-plane boundary

`load_tools` is a request-scoped runtime control-plane meta tool. It asks for
canonical tool definitions after a future agent has selected names from the
Phase B API Index. It is not an AI action, a Formal Business Capability, an
Executor action, a Business API, or a source of business facts. It is therefore
absent from both registries, the 84-action inventory, the Model Index, executor
dispatch, and the Fact Ledger boundary.

The loader module is not imported by `runtime.cjs`, `mainAgent.cjs`, or
`capabilityBroker.cjs`. No runtime integration is part of M5-C.

## Admission and canonical source

`createToolSchemaSession()` binds to `buildApiIndex().modelIndexV1` and its
fingerprint at session creation. A requested name is loadable only when it is a
current Model Index entry. The exact definition object is then read from the
existing canonical `AI_TOOLS` or `AI_FORMAL_TOOLS` source; the loader neither
copies nor regenerates a schema.

This admits all 31 V1 tools, including four reviewed composites and all four
private-assistant formal tools. It rejects write tools, A2-deferred tools, and
unknown names with `TOOL_SCHEMA_NOT_DISCOVERABLE`. There is no fuzzy matching or
partial success: a mixed valid/invalid batch changes no session state.

## Limits and incremental loading

- Maximum names in one `load_tools` call: **8**.
- Maximum loaded business tools in one request session: **16**.
- Maximum serialized loaded schema context: **32,000 characters**.

The initial exposed tool list contains only `load_tools`. After a successful
load it contains `load_tools` plus canonical loaded definitions. A second load
can add more tools; an already-loaded name is returned as `alreadyLoaded` and
does not consume capacity. Loaded definitions are ordered by the stable Phase B
Model Index order, not caller input order.

The control result returns only success state, newly/already-loaded names,
counts, remaining capacity, and a schema fingerprint. It deliberately does not
repeat a large JSON schema in the message body; a future provider call receives
the canonical definitions via its `tools` parameter.

## Drift protection

Each session records the API Index fingerprint. Before every load it rebuilds
the index through its supplied factory; a mismatch fails closed with
`INDEX_FINGERPRINT_CHANGED`. The loaded canonical definitions have an independent
stable SHA-256 schema fingerprint. Adding a tool or changing its definition
changes that fingerprint.

## Why this is not a Fact Ledger event

Loading a schema proves only that a tool is available to call. It does not read
a business API, resolve identity, calculate cost, query inventory, or return a
formal result. The result is marked `controlPlane: true`; Phase D must not append
it to the Fact Ledger or use it to support a business claim.

## Context samples

| Investigation | Loaded tools | Index + loaded schemas |
| --- | --- | --- |
| Recipe comparison | `get_all_recipes`, `compare_recipes` | 1,766 estimated tokens |
| Coil cost investigation | `search_coils`, `calculate_coil_cost`, `get_copper_price` | 2,089 estimated tokens |
| Recipe scenario investigation | `get_all_recipes`, `compare_recipe_scenarios`, `search_parts` | 2,552 estimated tokens |
| All Model Index schemas | 31 tools | 5,907 estimated tokens, before index text |

The API Index remains 1,550 estimated tokens. The point is not minimum token
count; it is to make a normal investigation load only the full canonical schema
it actually needs.

## Phase D handoff

Phase D may begin a Main Agent turn with `LOAD_TOOLS_TOOL` only, validate a
model `load_tools` call through this request session, and make the next provider
call with `session.exposedTools()`. It must still apply the existing tool input
validator and Executor/business API evidence gates when a business tool is
actually called. None of that runtime integration is implemented here.

## Verification

The deterministic regression covers LOAD-01 through LOAD-20: eligibility,
write/deferred/unknown rejection, atomic batches, batch and cumulative limits,
reload idempotence, stable order, schema/index drift, canonical private schemas,
control-plane isolation, no schema in result bodies, and no API/Executor call.

## Full gates

| Gate | Result |
| --- | --- |
| `npm test` | PASS — 2,248 tests, 0 failures |
| `npm run verify:api-contract` | PASS — 29 tests, 0 failures |
| `npm run test:deep-api` | PASS — 486 checks, 0 failures |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:ai-architecture` | PASS — 9 tests, 0 failures |
| `npm run verify:ai-assistant-release` | PASS |
