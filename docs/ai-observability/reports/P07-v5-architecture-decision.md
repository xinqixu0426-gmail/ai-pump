# P07 V5 Architecture Decision

## 1. Executive Decision

Adopt a small self-built **Controlled Runtime** through a six-phase strangler migration. Keep formal business assets and observability; replace the monolithic/feature-gated orchestration incrementally with typed contracts, one state machine, capability-scoped tool exposure, identity preservation, a per-task evidence ledger, and split deterministic verification.

```text
P07_STATUS=PASS
MIGRATION=INCREMENTAL
P08_RECOMMENDED=YES
P08_SCOPE=Typed Contracts + Task State Skeleton
```

P07 changes documentation only. It does not implement V5 or repair any frozen V4 failure.

## 2. Evidence Base

- Read the authoritative P00-P06 reports, P06 machine-readable 15-path dataset, and Trace Contract V1.
- Rechecked current entry/runtime/entity/broker/tool/executor/internal API/evidence/verification/observability code at start commit `e997b560ceb8a3378623515047ee85f1a42514dd`.
- Confirmed current entry is `handleAiChat -> runAiDispatcherV3 -> runAiAgentRuntimeV3`; V4 is feature-gated inside that shared runtime rather than a separate top-level runtime.
- Confirmed formal Business APIs/SQLite remain source of truth and existing executor/client/capability assets can be adapted.
- Confirmed P06: 15 valid paths, 7 pass, 8 fail; `C02=3`, `R02=3`, `A01=2`; routing 50.00%; tool selection 93.33%; premature verification 0; DB and privacy unchanged.

The worktree was not clean at start. All pre-existing user-owned V4/AI/document/package/test/output changes were preserved and excluded from this P07 design commit.

## 3. Root Cause Interpretation

| Rank | P06 class | Primary layer | Architectural interpretation |
| --- | --- | --- | --- |
| 1 | `C02 STATE_TRANSITION_FAILURE` | State/orchestration | There is no single transition authority across loop, V4 controller, evidence, verification, and synthesis. Valid evidence does not universally force the correct terminal transition. |
| 2 | `R02 TOOL_SELECTION_FAILURE` | Routing/capability exposure | Task intent, model tool selection, catalog exposure, broker selection, and recovery can all influence the route. The executable tool set is insufficiently bounded by capability. |
| 3 | `A01 ARGUMENT_GENERATION_FAILURE` | Typed contract/identity boundary | Raw model arguments can lose identity before resolver entry; downstream exact resolution can be correct for the wrong received identity. |

These have model/prompt contributors, but the primary remedy belongs in software-controlled state, routing, and contracts. P07 rejects a larger prompt plus fallback/special-case strategy.

## 4. Keep / Refactor / Replace / Add Summary

**KEEP:** Business API, SQLite, `internalApiClient`, executors, resolver core, confirmation, `allowWrite`, write allowlist, audit/operation receipts, Oracle, Real AI Shadow, Guardian, OpenTelemetry, OpenInference, Phoenix, Trace Contract V1, provider wrapper.

**REFACTOR:** tool definitions/registries as a compiled capability projection; AI Dispatcher as strangler selector; V4 broker concepts into deterministic eligibility; normalization into one non-destructive boundary; evidence/claim/verification/answer components into explicit stages.

**REPLACE:** monolithic AI Agent Runtime control flow, V4 Investigation control ownership, V4+R3 parallel completion ownership, and scattered tool-argument handling. Replacement is incremental through compatibility adapters.

**ADD:** thin business ontology, V5 capability projection, task state machine, typed contracts, per-task evidence ledger, and L0-L5 policy layer.

**DEPRECATE:** Legacy V3 path and overloaded `failed_unverified`, followed later by duplicate routing/normalization/verification paths. Nothing is deleted in P07.

## 5. Target V5 Architecture

```text
User
 -> Task Interpreter
 -> Entity / Business Context Resolution
 -> Task State
 -> Capability Router
 -> Controlled Execution Runtime
      -> Typed Contract Validation
      -> Policy / Risk Gate
      -> Existing Tool / Executor
      -> Evidence Collection
      -> State Transition Validation
      -> Verification
 -> Answer Composer

Sidecar: OpenTelemetry / OpenInference -> Phoenix
Quality: Failure Dataset -> Oracle -> Shadow -> Stability -> Guardian -> Release Gate
```

The LLM proposes uncertain interpretation and may compose supported language. Software owns state, capability eligibility, argument validity, canonical identity, execution permission, evidence, verification, and terminal decisions.

## 6. Framework Decision

| Candidate | Decision |
| --- | --- |
| Self-built controlled runtime | ADOPT |
| LangGraph | BORROW_PATTERN |
| Pydantic AI | REJECT_FOR_NOW |
| OpenAI Agents SDK | BORROW_PATTERN |
| Microsoft Agent Framework | DEFER |
| Temporal | REJECT_FOR_NOW |
| OPA | REJECT_FOR_NOW |

The current Node/CommonJS code, mature formal API/tool assets, provider abstraction, failure evidence, and need for narrow typed/state controls favor a small internal runtime. Framework concepts may be borrowed, but adoption before contracts stabilize would add migration and vendor/runtime risk without evidence of improved outcomes.

## 7. Migration Phases

1. **V5-A Typed Contracts + Task State Skeleton** — isolated types, transition validator, adapters, deterministic fixtures; no production cutover.
2. **V5-B Capability Projection + Bounded Tool Exposure** — shadow-only routing for selected reads.
3. **V5-C Entity Identity Boundary + Argument Validation** — preserve raw/normalized/canonical forms and validate before execution.
4. **V5-D Controlled Execution + Evidence + Verification** — selected read-only runtime becomes the sole controller for canary paths.
5. **V5-E Real AI Shadow + Read-Only Promotion** — expanded/repeated evaluation and capability-by-capability canary.
6. **V5-F Write Policy + Legacy Retirement** — proposal-first write integration, explicit approvals, measured deprecation/removal.

Every phase keeps V4 available, has a flag/allowlist rollback, and stops for Supervisor review.

## 8. Evaluation Gates

Required metrics are intent, entity preservation/resolution, capability routing, tool selection, argument validation, execution completion, evidence coverage, verification, final answer, repeat stability, and write safety.

Initial targets:

- Routing: 50.00% -> 100% on P06 and >=90% on an expanded >=50-path corpus.
- Tool selection: 93.33% -> 100% on P06 and >=98% expanded.
- C02: 3/8 failed paths -> 0 on P06 and <=2% expanded.
- A01: 2/8 failed paths -> 0 on P06 and >=99% argument validation/preservation expanded.
- Write safety: 100%; no unapproved or shadow write is tolerable.

The 15-path baseline is too small for production-rate claims. Promotion also requires deterministic, shadow, real-AI, repeat-stability, privacy, observability fail-open, full-regression, and Guardian gates.

## 9. Rollback Strategy

- Default V5 off; select only explicit read-only capability/case cohorts.
- A failed cohort immediately returns to unchanged V4 by disabling its allowlist.
- Shadow never changes the response and never performs duplicate writes.
- The per-task ledger requires no schema/data rollback.
- Business APIs, SQLite, executors, and confirmation/audit stay unchanged, so rollback is runtime/config/deployment only.
- Each production promotion retains a known-good V4 release and a tested rollback path.

## 10. Legacy Retirement Strategy

Legacy V3 remains the initial control and rollback path. V4 fact/reducer, broker, claim, and evidence concepts are selectively merged through adapters; their duplicate control ownership is retired only after V5-D/E gates. `failed_unverified` remains a compatibility projection until typed failures are accepted by all callers. Removal requires sustained zero legacy traffic, expanded and repeated gates, a rollback drill, and explicit Supervisor approval.

## 11. Risks

- Dual-run drift: two state/evidence authorities could exist during migration. Mitigate with shadow-only projection and one authoritative executor per request.
- Registry drift: current tool/business registries overlap. Mitigate with a compiled projection and consistency gate, not another hand-maintained catalog.
- Identity adapter loss: legacy string contracts may discard provenance. Mitigate with immutable references and preservation tests before selected-tool adoption.
- SSE/error semantic change: async wrapping can change lifecycle. Mitigate with equivalence tests and no buffering/protocol changes.
- Real-provider nondeterminism and small corpus: mitigate with repeat stability and >=50-path expansion.
- Framework creep: keep initial runtime narrowly scoped; reconsider dependencies only with measured unmet needs.
- Guardian baseline prerequisite: `.guardian/config.yaml` is currently absent and must be treated as an explicit release-gate prerequisite, not silently waived.

## 12. Implementation Preconditions

- Supervisor approves the state table, typed contract boundaries, identity ownership, and capability projection approach.
- Existing user changes are isolated before implementation.
- P06 dataset is retained as a permanent seed corpus and expanded before promotion.
- V5-A is default-off, side-effect free, and has no production routing hook.
- Any internal/API contract touch follows the repository API SOP and authority documentation.
- Observability remains fail-open and metadata-only; database and SSE contracts remain unchanged.
- Each later phase defines exact allowed files, gate commands, rollback flag, and STOP checkpoint before work begins.

## 13. P08 Recommendation

```text
P08_RECOMMENDED=YES
P08_SCOPE=Typed Contracts + Task State Skeleton
```

P08 should implement only V5-A: isolated immutable contracts, legal transition validation, compatibility projections, and deterministic tests. It must not route production traffic, expose a new tool set, change prompts/resolver/executor/verifier behavior, repair P06 failures, or begin V5-B.

STOP — WAIT FOR SUPERVISOR REVIEW.
