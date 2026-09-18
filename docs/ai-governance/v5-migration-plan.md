# Pump AI V5 Incremental Migration Plan

Status: P07 design only. No phase is authorized by this document.  
Strategy: incremental strangler, six phases, one Supervisor STOP after every phase.

## Global controls

- The current V4 production path, Business APIs, SQLite, `internalApiClient`, tools, executors, SSE contract, write confirmation, and audit remain available throughout migration.
- New V5 behavior is off by default and selected only by an explicit case/capability allowlist.
- Shadow execution is read-only, isolated, cost-bounded, and cannot influence the user response or business data.
- Every phase must preserve Trace Contract V1 until a separately approved schema revision.
- Every failure becomes a permanent Oracle-backed regression case.
- Rollback is removal of the V5 selection flag/allowlist or deployment of the prior release; it must not require data migration.
- Every phase ends with `STOP — WAIT FOR SUPERVISOR REVIEW`.

## Phase V5-A — Typed Contracts + Task State Skeleton

**Scope:** Introduce side-effect-free `Task`, `TaskState`, `EntityReference`, `ToolRequest`, `ToolResult`, `ToolError`, transition validation, and compatibility adapters. No production routing or execution cutover.

**Allowed files:** new isolated V5 contract/state modules; deterministic tests; architecture/API contract documentation if the implementation changes an internal contract; evaluation fixtures. A minimal call-site adapter is allowed only in test/shadow mode.

**Forbidden changes:** prompts, tool selection, production routing, resolver behavior, executor behavior, Business APIs, SQLite, SSE, write flow, dependencies, V4 failure fixes.

**Entry gate:** P07 approved; P06 dataset and Trace Contract V1 intact; baseline regression only has the frozen Guardian configuration failure; dirty user work isolated.

**Implementation:**

- Define versioned immutable contracts and runtime-safe validators.
- Define the legal transition table and terminal-state invariants.
- Add adapters that can wrap current intent/tool/evidence outputs without changing them.
- Add deterministic transition tests for all allowed and forbidden edges, especially “evidence satisfied then route again.”

**Tests:** contract serialization/validation, identity preservation, transition property matrix, error/result preservation, disabled no-op, no database writes, current regression.

**Exit gate:** all new tests pass; P06 C02 trajectories can be represented and rejected by the skeleton in fixtures; production output and path are unchanged; no new regression.

**Rollback:** remove the isolated modules/tests or keep them unused; no data/config rollback.

**Shadow comparison:** fixture-only projection of V4 events into V5 state; compare classification without executing new tools.

**Supervisor checkpoint:** approve contract names, state invariants, and P06 mappings before any runtime hook. STOP.

## Phase V5-B — Capability Projection + Bounded Tool Exposure

**Scope:** Compile a V5 capability projection from existing registries and expose a limited tool set in shadow for a small read-only allowlist.

**Allowed files:** V5 capability projection/router, adapters over existing registry/tool definitions, deterministic routing tests, shadow evaluator, docs.

**Forbidden changes:** Business APIs, executors, existing tool behavior/schema, write capabilities, global production routing, prompt-only fixes.

**Entry gate:** V5-A approved; transition and contract gates green; registry consistency baseline captured.

**Implementation:** map domain/operation/entity/evidence/risk/access to existing tools; fail closed on inconsistent or ambiguous mapping; select capability before tool exposure; begin with P06 read-only domains.

**Tests:** registry completeness, access/risk consistency, unrelated-tool exclusion, ambiguity/clarification, R02 permanent cases, no write exposure, unchanged executor calls.

**Exit gate:** 100% capability/tool eligibility on P06 fixtures, >=90% routing on an expanded >=50-path corpus, zero out-of-allowlist tools, no regression.

**Rollback:** disable V5-B allowlist; V4 receives all production traffic.

**Shadow comparison:** run V4 and V5 route decisions on identical frozen task input; V5 does not execute or answer.

**Supervisor checkpoint:** approve capability taxonomy and first production canary proposal. STOP.

## Phase V5-C — Entity Identity Boundary + Argument Validation

**Scope:** Carry immutable raw mention, versioned normalized mention, and formal canonical ID through typed requests; validate arguments before existing executors.

**Allowed files:** V5 identity contract/normalizer adapter/validation pipeline, selected read-only tool adapters, tests, trace-contract proposal if needed.

**Forbidden changes:** resolver matching algorithm, fuzzy/exact thresholds, Business APIs, generic special cases, production writes.

**Entry gate:** V5-B shadow routing meets exit target; selected tool contracts mapped; formal resolver/API source identified.

**Implementation:** separate raw/model/normalized/validated forms; require a resolution receipt for canonical IDs; reject loss/inconsistency as typed errors; preserve current resolver behind adapter.

**Tests:** punctuation/numeric/CJK identity preservation, alias provenance, exact collision, invalid type/business constraint, A01 corpus cases, adapter equivalence.

**Exit gate:** P06 A01 primary failures become pre-execution typed rejections or correct preserved requests in shadow; 100% P06 and >=99% expanded argument validation/preservation; no resolver behavior change outside V5.

**Rollback:** remove selected capability from V5-C allowlist; use unchanged V4 argument path.

**Shadow comparison:** compare request structure and prospective decision; never double-execute Business APIs.

**Supervisor checkpoint:** approve identity ownership and any compatibility limitations. STOP.

## Phase V5-D — Controlled Execution + Evidence + Verification

**Scope:** For selected read-only capabilities, make the V5 state machine the single execution controller and split verification into execution/evidence validity/answer support.

**Allowed files:** V5 runtime, existing-executor adapter, per-task evidence ledger, deterministic verifier, answer-plan adapter, selected read-only entry hook, tests/docs.

**Forbidden changes:** Business API/DB/executor behavior, write execution, all-capability cutover, raw content tracing.

**Entry gate:** V5-C identity and argument gates green; no operation/audit correlation regression; fail-open observability verified.

**Implementation:** execute only validated requests; collect referenced evidence; enforce transition invariants; project compatibility `failed_unverified` without changing legacy semantics; constrain answer composition to supported claims.

**Tests:** success/negative/ambiguous/transport/business failures, evidence freshness/source/entity linkage, illegal transition rejection, bounded retry, C02 corpus cases, SSE equivalence.

**Exit gate:** zero C02 on P06, <=2% expanded illegal/incorrect transitions, complete evidence gates, unchanged business results, no new regression.

**Rollback:** capability allowlist returns to V4; no ledger persistence to migrate.

**Shadow comparison:** V5 consumes captured safe outcomes or single-execution observations; only one path calls the Business API.

**Supervisor checkpoint:** approve first read-only canary and rollback evidence. STOP.

## Phase V5-E — Real AI Shadow, Stability, and Read-Only Promotion

**Scope:** Exercise end-to-end V5 read-only paths with the real provider, expand corpus, and promote only passing capabilities by canary.

**Allowed files:** shadow runner/evaluators, V5 selection allowlist/config, release gates, tests/docs. No new business features.

**Forbidden changes:** write promotion, broad default-on, case-specific fixes, business schema/data changes.

**Entry gate:** V5-D deterministic gates pass; Phoenix healthy/fail-open proven; privacy sentinel zero.

**Implementation:** observe -> shadow -> compare -> small canary -> staged read-only promotion. Record trajectory hashes and failure taxonomy.

**Tests:** full deterministic regression, permanent corpus, full R4-B Real AI Shadow, Repeat Stability, OFF/ON equivalence, Phoenix-down behavior, privacy, Guardian.

**Exit gate:** targets hold on expanded corpus and repeated runs; final-answer accuracy does not regress; write safety remains 100%; Supervisor accepts residual risk.

**Rollback:** set V5 capability canary to zero and route to V4; retain trace/dataset evidence.

**Shadow comparison:** mandatory until each capability passes a defined observation window; compare Oracle, trajectory, state, tool set, evidence, answer, latency, and cost.

**Supervisor checkpoint:** approve each capability promotion cohort. STOP.

## Phase V5-F — Write Policy Integration + Legacy Retirement

**Scope:** Integrate selected write proposals with L0-L5 policy while retaining current confirmation/`allowWrite`/audit, then retire duplicate paths only after sustained gates.

**Allowed files:** V5 policy adapter, selected write-contract adapters, release gates, deprecation cleanup explicitly approved per component, docs/tests.

**Forbidden changes:** bypass confirmation, autonomous L4/L5, audit weakening, bulk legacy deletion without measured zero traffic and rollback release.

**Entry gate:** V5-E read-only promotion stable; threat/risk review complete; write fixtures isolated; current confirmation and audit gates green.

**Implementation:** first proposal-only L3; then explicitly approved L4 capabilities one at a time. V3/V4 routes are marked deprecated, traffic measured, and removed only in separate approved changes.

**Tests:** proposal binding, actor/target/payload integrity, replay resistance, `allowWrite=false`, confirmation expiry, audit/operation receipts, failure recovery, full regression, real controlled acceptance.

**Exit gate:** write safety 100%, no unapproved write, audit correlation complete for promoted capabilities, sustained zero legacy traffic, rollback drill passes, Supervisor authorizes each removal.

**Rollback:** disable individual write capability and V5 selection; preserve existing Business API/data/audit and deploy prior runtime release if necessary.

**Shadow comparison:** write shadow stops at proposal/validation; it never duplicates execution.

**Supervisor checkpoint:** approve each write capability and each legacy removal separately. STOP.

## Cross-phase release gates

| Gate | Required evidence |
| --- | --- |
| Deterministic | contracts, state matrix, privacy, error semantics, full regression |
| Shadow | identical inputs/Oracle, no business writes, trajectory comparison, no response influence |
| Real AI | bounded existing corpus, valid traces, costs recorded, failure taxonomy |
| Stability | repeated runs, trajectory variance, no hidden fallback acceptance |
| Guardian | current project gate including known baseline treatment; no new failures |
| Supervisor | explicit approval after each phase; next phase never starts automatically |

## Implementation priority

- **P0:** typed contracts, state transition skeleton, permanent C02/R02/A01 corpus.
- **P1:** capability projection, bounded tool exposure, identity preservation, argument validation.
- **P2:** evidence ledger, split verification, read-only controlled-runtime shadow/canary.
- **P3:** selected write-policy integration and measured legacy retirement.

No new AI feature precedes P0-P2 reliability work.
