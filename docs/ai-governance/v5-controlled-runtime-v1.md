# V5 Controlled Shadow Runtime V1

## 1. Purpose

The V5 Controlled Shadow Runtime assembles the previously frozen V5 contracts, task state machine, capability routing, bounded Tool exposure, entity identity, evidence ledger and deterministic verification behind Policy V1.

It is a shadow-only orchestration skeleton. It accepts structured inputs and returns a structured outcome; it does not call a model, Tool executor, internal API, business API or database.

## 2. Input boundary

The runtime accepts:

- a versioned `V5Task` in `RECEIVED`;
- structured capability routing input;
- a validated, execution-ready `V5ToolRequest`;
- a valid approval state;
- optionally, an externally supplied shadow `V5ToolResult` and evidence ledger;
- test-only synthetic capability definitions when explicitly supplied to the harness.

It does not accept or interpret a raw prompt or raw model object.

## 3. Ordered gates

The controlled path is:

1. Validate the V5Task and require `RECEIVED`.
2. Advance only through the deterministic task transition table.
3. Validate required entity identity facts without resolving or normalizing them.
4. Route through the V5-B capability router.
5. Bound the selected Tool through V5-B exposure/allowlist metadata.
6. Require validated arguments and exact task/capability/risk/entity consistency.
7. Evaluate Policy V1.
8. Project what would happen; never execute a Tool.
9. If supplied, validate the external shadow ToolResult.
10. If applicable, validate the evidence ledger and run the P11 deterministic verifier.
11. Return an immutable structured outcome.

No stage may skip or reorder the task state machine.

## 4. Execution projection

The only projection statuses are:

- `NOT_EXECUTED_SHADOW`
- `WOULD_EXECUTE`
- `WOULD_REQUIRE_APPROVAL`
- `WOULD_DENY`
- `INVALID`

Every projection contains `actualToolExecutions=0` and `actualWrites=0`. `WOULD_EXECUTE` is not an execution receipt and must not be treated as one.

## 5. State path

A complete synthetic read with valid externally supplied result and evidence follows:

```text
RECEIVED
→ UNDERSTANDING
→ RESOLVING_ENTITY (when entity context exists)
→ ROUTING
→ EXECUTING
→ COLLECTING_EVIDENCE
→ VERIFYING
→ COMPOSING
→ COMPLETED
```

The `EXECUTING` state means the shadow contract reached the execution boundary; it does not mean a Tool ran. The execution projection remains the authoritative statement of actual activity.

Invalid state, unresolved/ambiguous capability, missing entity, invalid ToolRequest, Tool mismatch or policy rejection stops progression deterministically. Tool failure supplied by the harness terminates at `FAILED_TOOL`; unsupported evidence terminates at `FAILED_EVIDENCE`.

## 6. Entity boundary

The runtime reads existing V5 entity references. It never normalizes, resolves, aliases or fabricates an entity. When the ontology has an identity source, the required canonical ID and resolution receipt must already be present. ToolRequest entity references must agree exactly with task entity references.

## 7. Capability and Tool boundary

The runtime uses the V5-B router and bounded capability allowlists. Unresolved and ambiguous routes expose no Tool. A selected Tool outside the capability allowlist is rejected. Write Tool definitions remain unavailable to the model-facing V5-B exposure surface.

## 8. Policy boundary

Only a Policy V1 result with `decision='ALLOW'` and `executionAllowed=true` can cross the shadow execution-state gate. L3, unapproved L4 and L5 paths are stopped. Approved L4 remains a `WOULD_EXECUTE` projection and never performs a write.

## 9. Evidence and verification boundary

The runtime does not fabricate a ToolResult or evidence. Both must be supplied by an external deterministic harness. Missing or invalid evidence cannot become `VERIFIED`. Capabilities whose evidence requirements remain among the 38 deferred P11 requirements return `DEFERRED_REQUIREMENT` and do not claim verification.

## 10. Output contract

The result contains only orchestration metadata:

- `taskId`
- `finalState`
- capability and Tool exposure outcomes
- policy decision
- execution projection
- evidence and verification outcomes
- stable reason codes
- state history

The result does not expose raw prompts, business payloads, Tool payloads or customer data.

## 11. Production isolation

Production imports, production routes and production mirroring are all zero. The runtime has no reverse adapter into V4 and no executor dependency. The only entrypoints are tests and `scripts/run-ai-v5e1-shadow.cjs`.

## 12. P06 shadow evaluation

The P06 structural corpus is evaluated without replaying real AI or business data:

- C02 cases are projected through the state gate.
- R02 cases are checked against bounded Tool exposure and Policy V1.
- A01 cases use raw-only ToolRequests and verify that execution-ready promotion is blocked.

This is architectural evidence, not a claim that V4 failures are fixed.
