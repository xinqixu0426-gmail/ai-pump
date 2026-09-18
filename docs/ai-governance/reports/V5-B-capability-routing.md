# V5-B Capability Registry + Limited Tool Exposure

## 1. Executive Result

V5-B adds an isolated versioned capability registry, deterministic structured router, fail-closed bounded Tool projection, and P06 shadow evaluator. It does not enter the production V4 import graph and never invokes a Tool. Registry validation and 18 focused tests pass. The frozen P06 corpus has three R02 failures; all three wrong first Tools fall outside the expected `inventory.read` capability and would be blocked by bounded exposure.

## 2. Frozen Baseline

```text
P08_COMMIT=0fcd7c0ab04276f02a5860c775f662c58623b3eb
V5-A=PASS
CURRENT_REGRESSION_BASELINE=1802/1803
KNOWN_FAILURE=missing .guardian/config.yaml
P06_R02_TOOL_SELECTION_FAILURES=3
```

The starting worktree was not clean. Pre-existing user V4/AI, documentation, test, script, and `output/` changes were preserved and excluded from the V5-B commit.

## 3. Scope / Non-Scope

Scope is limited to isolated V5 capability grouping, validation, deterministic structured selection, Tool definition filtering, read-only P06 analysis, tests, and documentation. There is no prompt, V3/V4 runtime, dispatcher, resolver, Tool schema, executor, internal API, verifier, Guardian, Oracle, database, or dependency change. Evidence, Policy, full ontology, real AI, Tool execution, production shadow, and cutover remain out of scope.

## 4. Existing Tool Inventory

The live `AI_TOOLS` array contains 77 tools: 48 read and 29 write. The existing AI capability registry contains matching metadata for all 77. V5-B imports these read-only authorities and does not copy schemas or executor mappings.

## 5. Capability Registry V1

`V5_CAPABILITY_REGISTRY_VERSION=1`. Forty-one capabilities group the 77 Tools by stable domain operation. The grouping separates part inventory lookup (`inventory.read`) from coil lookup (`coil.read`) and recipe-template lookup (`recipe.template.read`) for domain reasons, not case-specific exceptions. All write capabilities have `exposableInV5B=false`.

## 6. Registry Validation

Validation rejects unknown versions, duplicate capability IDs, stale or duplicate Tool names, invalid access/risk/entity shapes, empty Tool sets, detectable read/write mismatch, and exposable write capability. The registry and nested arrays are frozen. Result: PASS.

## 7. Capability Router

The router requires a valid `ROUTING` task and exact structured `domain`, `operation`, and `entityType`. Optional explicit capability must exist and match all fields. It emits only `SELECTED`, `AMBIGUOUS`, `UNRESOLVED`, or `INVALID`; zero/multiple matches never select a fallback.

## 8. Limited Tool Exposure

Selected read capabilities project exactly their declared canonical Tool objects. All other outcomes, unknown capabilities, mismatches, and write capabilities project zero Tools. Projection preserves object/schema identity and does not mutate either registry. `executionAllowed=false` throughout V5-B because this phase is shadow-only.

## 9. V5-A State Integration

Routing returns a new immutable shadow task containing `requestedCapability`, without changing its `ROUTING` state. Existing V5-A transition validation still rejects `EXECUTING` without a matching validated `V5ToolRequest`; exposure does not bypass it.

## 10. P06 R02 Shadow Analysis

| Case | Expected | Actual first Tool | Result |
| --- | --- | --- | --- |
| `P06-FLATBLADE-001-V4R3` | `search_parts` → `inventory.read` | `search_templates` → `recipe.template.read` | `BLOCKED_BY_LIMITED_EXPOSURE` |
| `P06-INVENTORY-001-V4I` | `search_parts` → `inventory.read` | `search_coils` → `coil.read` | `BLOCKED_BY_LIMITED_EXPOSURE` |
| `P06-SIMPLE-001-LEGACY` | `search_parts` → `inventory.read` | `search_coils` → `coil.read` | `BLOCKED_BY_LIMITED_EXPOSURE` |

Summary: analyzed 3; blocked 3; same capability 0; unknown 0. This is a counterfactual shadow boundary result, not a claim that production V4 is fixed.

## 11. P06 Corpus Capability Evaluation

All 15 records were inspected. None contains the required safe structured route tuple, so routable=0 and insufficient-data=15. Correct=0, incorrect=0, ambiguous=0, and accuracy is `NOT_AVAILABLE`. No case was counted as passing and no domain/operation/entity type was inferred from case names or raw content.

## 12. Tool Inventory Consistency

```text
existing=77
assigned=77
shared=0
intentionally_unassigned=0
stale=0
unknown=0
```

All 29 writes are inventoried but non-exposable; no V5 Tool was executed and no write occurred.

## 13. Business DB Safety

Start snapshot: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size 35,323,904 bytes, mtime `2026-09-03T08:42:16.3158766Z`, recursive backup-file count 209. End snapshot: the same SHA-256 and size, mtime `2026-09-03T08:42:16.316Z` (the same filesystem instant at the precision reported by Node), recursive backup-file count 209. Hash, mtime, size, and backup inventory are unchanged; no startup backup was created.

## 14. Deterministic Tests

Focused V5-B suite: 18/18 PASS. It covers registry drift and immutability, invalid metadata, write disablement, unique/unresolved/ambiguous/explicit/non-ROUTING routes, exact Tool projection, cross-capability leakage, state preconditions, all three R02 cases, and no-guess P06 corpus evaluation. It uses no network, Phoenix, AI provider, executor, or business database.

## 15. Regression Comparison

With `AI_OBSERVABILITY_ENABLED=false`, the full deterministic suite produced 1,820 PASS / 1,821 total. The sole failure is the frozen `ENOENT` for `.guardian/config.yaml`. Relative to 1,802/1,803, the 18 added V5-B tests all pass and no new regression was introduced.

## 16. Production Isolation

Static scan of `api.cjs` and `api/**` outside `api/services/ai-v5/**` found zero imports of the V5-B capability, router, shadow evaluator, or exposure modules. Production requests routed to V5=0, V5 Tool executions=0, and V5 writes=0. No production file was modified by V5-B.

## 17. Known Limitations

- P09 starts after structured task interpretation; it cannot measure capability routing accuracy on the current P06 corpus because the required structured fields were not captured.
- Registry grouping is a V1 boundary and has no Evidence or Policy semantics.
- Read Tool definitions are projected only; V5-B deliberately provides no execution path.
- A complete business ontology and entity relationship model remain V5-C work.

## 18. V5-C Preconditions

`V5_C_READY=YES`: registry validation, stale/unknown checks, deterministic fail-closed routing, bounded exposure, write disablement, V5-A state integration, 3/3 R02 boundary analysis, regression comparison, database safety, and production isolation all pass. This means the isolated V5-B foundation is ready for Supervisor review; it does not authorize or begin V5-C.
