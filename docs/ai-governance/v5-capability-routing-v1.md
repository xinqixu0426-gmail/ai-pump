# V5 Capability Routing V1

## Structured input

V5-B accepts only:

```text
domain
operation
entityType
explicitCapability (optional)
```

It does not accept raw user text and does not perform intent interpretation, entity extraction, alias handling, normalization, or resolution. Routing is allowed only for a validated `V5Task` whose current state is `ROUTING`.

## Outcomes

- `SELECTED`: exactly one compatible capability, or one explicit capability that exists and is compatible with all structured fields.
- `AMBIGUOUS`: more than one compatible capability. No capability is selected.
- `UNRESOLVED`: no compatible capability. No fallback is attempted.
- `INVALID`: malformed task/input, non-`ROUTING` state, nonexistent explicit capability, or incompatible explicit capability.

Compatibility is an exact deterministic match on `domain`, `operation`, and membership of `entityType` in `requiredEntityTypes`. Array order never decides a tie.

## Fail-closed limited exposure

`getV5ToolExposure()` projects the exact declared allowlist only after a `SELECTED` result. `AMBIGUOUS`, `UNRESOLVED`, `INVALID`, unknown capability, registry mismatch, and every write capability yield zero exposed executable tools. V5-B remains shadow-only, so even a valid read projection has `executionAllowed=false` and is never invoked.

`projectAllowedToolDefinitions()` filters the live existing Tool registry. Returned entries are the original canonical Tool definition objects: schema and description are neither copied nor changed. The source registry is never mutated.

## V5-A state integration

A successful route may return a new immutable shadow task with `requestedCapability` populated. Its state remains `ROUTING`; the router does not transition state. The V5-A `EXECUTING` precondition still requires both the selected capability and a validated, matching `V5ToolRequest`. Tool exposure cannot bypass that gate.

## Reverse index and shadow evaluation

The read-only reverse index maps canonical tool names to explicit capability IDs. It is used only to audit grouping and to evaluate frozen P06 expected/actual tool metadata. It is not a production routing shortcut.

The P06 corpus contains no safe structured `domain + operation + entityType` tuple. V5-B therefore reports those cases as `INSUFFICIENT_DATA`; it does not infer from suite names, case IDs, notes, or unavailable raw prompts.

## Non-goals

V5-B does not implement free-text task interpretation, full business ontology, entity resolution, evidence rules, policy execution, tool invocation, write authorization, production shadow mirroring, or production routing.
