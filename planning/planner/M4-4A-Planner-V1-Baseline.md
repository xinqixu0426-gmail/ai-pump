# M4-4A — Planner V1 Read / Analysis / Preview Planning Baseline

## 1. Frozen Upstream Contract

Planner V1 consumes the M4-3B frozen contract at `planning/business-understanding/M4-3B-Front-Understanding-Grounding-V1-Frozen.md`.

The prototype treats Business Understanding, Domain Policy, and Grounding V1 as read-only inputs. It does not import Legacy Intent, Semantic Frame, legacy tool plans, production execution results, or a raw Tool/function catalog. No frozen upstream file was modified.

One acceptance case (`P-09`) ran the complete frozen chain Business → Policy → Grounding → Planner. The remaining smoke cases use a frozen upstream fixture derived from the accepted R10 entity fixture and contract, so Planner behavior can be measured without turning upstream model variance into Planner variance.

## 2. Capability Registry Audit

The authoritative source is `api/capabilities/registry.cjs`, through `listBusinessCapabilities()`.

```text
Total formal capabilities: 147
Formal operations: query 41, preview 5, command 78, maintenance 23
Planner-visible capabilities: 6
Visible READ capabilities: 5
Visible ANALYSIS capabilities: 0
Visible PREVIEW capabilities: 1
Hidden command / maintenance capabilities: 101
Planner-visible write capabilities: 0
```

The Planner snapshot is a read-only projection of the authoritative registry, not another registry. It exposes only business capability IDs, modes, and concise business descriptions:

- `templates.detail` — READ
- `recipes.current_costs` — READ
- `relations.read` — READ
- `cost.recipe_difference` — READ
- `coils.list` — READ
- `recipes.scenario_compare_preview` — PREVIEW

The snapshot omits endpoints, HTTP methods, Tool schemas, executor names, database details, and every write/maintenance capability.

## 3. Planner Responsibility

Planner V1 answers only: after the Owner goal has been understood and formal targets have been grounded, what authoritative facts remain necessary and in what dependency order should they be obtained or computed?

It does not re-explain business concepts, resolve language references, perform formal identity resolution, answer final costs, execute capabilities, call business APIs, access the database, or write data.

## 4. Planner Input Contract

Each Planner call receives:

1. Raw Owner input.
2. Business Memo.
3. Policy Memo.
4. Grounding result and ambiguity evidence.
5. Final Grounded Targets.
6. The read-only capability snapshot.

The Planner is instructed that `MULTIPLE` cannot be silently selected, `UNRESOLVED` must stop as `BLOCKED_GROUNDING`, and formal IDs or entity types cannot be invented.

## 5. Planner Output Contract

The output is a lightweight line-based Planner Memo:

```text
PLAN_STATUS: READY | NO_TOOL_REQUIRED | BLOCKED_GROUNDING | BLOCKED_AMBIGUITY | BLOCKED_CAPABILITY | BLOCKED_POLICY
OWNER_GOAL: ...
GROUNDED_TARGET: ...
REQUIRED_FACT: F1 | description | target | source requirement | dependencies
STEP: P1 | READ|ANALYSIS|PREVIEW|COMPUTE | capability | target | produces | depends
COMPLETION: ...
WRITE_REQUIRED: YES|NO
```

`COMPUTE` is limited to deterministic combination of previously acquired formal facts. It is not an execution mechanism. Planner generated zero Tool/API/DB/write calls in every smoke run.

## 6. Required Fact and Dependency Model

The intended model is Owner goal → required facts → dependencies → authoritative capabilities → plan steps → completion criteria.

For a configuration cost preview, the intended facts are current formal configuration, current authoritative baseline, scenario preview, and deterministic delta. Preview depends on current configuration; delta depends on baseline and preview. Independent target reads should remain parallel.

## 7. Status Model

The prototype recognizes only `READY`, `NO_TOOL_REQUIRED`, `BLOCKED_GROUNDING`, `BLOCKED_AMBIGUITY`, `BLOCKED_CAPABILITY`, and `BLOCKED_POLICY`.

The observed baseline shows that the model sometimes writes a correct blocked status while still proposing a read step, and sometimes emits an invalid status such as `READ`. These are Planner semantic failures, not parser normalization targets.

## 8. Targeted Smoke

Real DeepSeek (`deepseek-chat`) targeted smoke ran all ten required cases. `P-09` used the real frozen upstream chain.

```text
Targeted result: 3 / 10 PASS
P-01 Concept: FAIL — NO_TOOL_REQUIRED accompanied by invalid step
P-03 Template fixed parts: PASS
P-05 V750 ambiguous cost: FAIL — blocked status but attempted read
P-06 12-120 ambiguous cost: FAIL — blocked status but attempted read
P-07 12-120 scheme count: FAIL — incorrectly blocked ambiguity
P-08 current coil: PASS
P-09 wood-box preview (real upstream): FAIL — incorrectly blocked configuration value as ambiguity
P-13 multi-change preview: FAIL — invented `recipes.detail` outside catalog
P-16 unresolved reference: PASS
P-17 protected write: FAIL — returned READY instead of BLOCKED_POLICY
```

Raw Planner Memos, frozen-input provenance, and evaluator output are retained in `M4-4A-Targeted-Smoke.json`.

## 9. Full Smoke

The full DeepSeek smoke ran all 18 base cases and 8 negative cases without retry.

```text
Base: 11 / 18 PASS
Negative: 5 / 8 PASS
Overall: 16 / 26 PASS
```

### Failure Matrix

| Class | Cases | Observed baseline behavior |
| --- | --- | --- |
| Blocked ambiguity still planned | P-06 | `BLOCKED_AMBIGUITY` accompanied by a read step for a non-unique formal target. |
| Candidate set treated as unusable count | P-07 | `12-120` scheme count incorrectly returned `BLOCKED_AMBIGUITY`. |
| Configuration / preview planning incomplete | P-09, P-10 | Preview goal was blocked or omitted required deterministic delta / dependency shape. |
| Invalid status / planning grammar | P-04 | Output `PLAN_STATUS: READ` rather than an allowed plan status. |
| Multi-target / deterministic computation omissions | P-14, P-15, N-06 | Missing local compute, target preservation, selected coil capability, or parallel read shape. |
| Policy / capability status error | N-01, N-04 | Missing capability was answered as no-tool; an explicit no-save preview was blocked as policy. |

Full raw model outputs and per-case evaluator results are retained in `M4-4A-Full-Smoke.json`.

## 10. Safety Metrics

```text
Planner re-grounding attempts: 0
Planner invented formal IDs: 0 confirmed
Planner silent multiple selections: 3 confirmed plan failures
Planner write steps: 0
Planner invented capabilities: 3 confirmed plan failures
Planner Tool calls: 0
Planner Business API calls: 0
Planner DB access attempts: 0
Frozen upstream files changed: 0
```

No formal fact was retrieved or generated. No preview, read capability, Tool, API, database, cost engine, or write executor was invoked.

## 11. Performance

```text
Planner median across the 26 Planner calls: 1601.59 ms
Real complete upstream chain (P-09): Business 3296.54 ms, Policy 2097.46 ms, Grounding 4598.50 ms
Real P-09 end-to-end (Grounding + Planner): 6707.53 ms
Planner model calls: 26
Total model calls including the P-09 real upstream chain: 29
```

The one real upstream chain is independently identified in evidence as `REAL_FROZEN_UPSTREAM_CHAIN`; the remaining runs intentionally use `FROZEN_UPSTREAM_FIXTURE_R10`.

## 12. Recommendation

`REWORK` is recommended. The architecture boundary is viable: Planner receives only frozen upstream contracts and a capability projection, does not execute, and keeps all prohibited execution metrics at zero. However, the first no-retry baseline shows material planner semantic failures in blocked-state discipline, capability-catalog adherence, preview handling, multi-target planning, and plan-status conformance.

Per M4-4A measurement rules, this phase did not patch individual cases or alter frozen upstream semantics. Supervisor review should decide the next Planner-level contract or deterministic guard strategy before any targeted semantic change.
