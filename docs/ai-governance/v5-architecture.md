# Pump AI V5 Controlled Runtime Architecture

Status: P07 architecture decision; design only  
Evidence baseline: P06 commit `e997b560ceb8a3378623515047ee85f1a42514dd`  
Principle: **LLM handles uncertainty. Software controls state, contracts, evidence, execution, and policy.**

## 1. Goals

- Replace implicit, model-led execution flow with one explicit per-task controlled runtime.
- Preserve the existing Business API, SQLite storage, internal API client, tool implementations, executors, write confirmation, audit, and observability assets.
- Make task state, entity identity, capability exposure, typed arguments, evidence, verification, and write policy deterministic where software can decide them.
- Address the P06 failure families as architectural defects: `C02` state transition, `R02` tool selection, and `A01` argument generation.
- Migrate incrementally through adapters and shadow comparison. Every phase must be independently testable and reversible.
- Retain Phoenix Trace Contract V1 as the evidence surface and evolve it only through a separately reviewed contract version.

## 2. Non-Goals

- No larger prompt, case-specific fallback, or entity-specific special case as the V5 foundation.
- No rewrite of Business APIs, SQLite, `internalApiClient`, all tools, or all executors in the first phase.
- No multi-agent swarm, Temporal, OPA, Kubernetes, vector database, ERP replacement, memory platform, or full event sourcing without new evidence.
- No Phoenix, OpenTelemetry, or model provider as a business-runtime dependency.
- No P07 implementation, behavior change, dependency installation, or repair of current V4 failures.

## 3. Evidence From V4

P06 exercised 15 real-model paths across Legacy V3, V4 Investigation, and V4+R3. Seven passed and eight failed; every trace was valid. The eight primary failures were `C02=3`, `R02=3`, and `A01=2`. Routing accuracy was 5/10 (50.00%) for paths with an independent V4 route span, while expected primary-tool execution was 14/15 (93.33%). This means “eventually used the right tool” is not equivalent to correct routing or a correct trajectory.

The Exact Entity Identity evidence separates ownership correctly. Two paths reached the resolver with a structurally altered identity; the resolver exact-matched the identity it received. A third preserved the expected identity and resolved exactly, then continued into unrelated routing. Therefore identity preservation is an upstream contract, while termination is a state-machine responsibility.

The 800 flat-blade evidence also crosses layers: one path had valid evidence but remained running, one continued routing after valid evidence, and one selected the wrong first tool. No premature verification was observed. `failed_unverified` is therefore an outcome/symptom, not a universal root cause.

The corpus is intentionally small and focused. Percentages are baselines for migration gates, not production prevalence estimates.

## 4. Current Architecture

### 4.1 Runtime graph

```text
User
  -> POST /api/ai/chat                         [CURRENT]
  -> handleAiChat (SSE lifecycle)              [CURRENT]
  -> runAiDispatcherV3                         [CURRENT entry + Agent span]
  -> runAiAgentRuntimeV3                       [CURRENT shared orchestration]
       -> planAiIntentV3 / context / prompt
       -> model provider calls
       -> selectToolsForIntent
       -> prepareAiToolCalls / argument parsing
       -> resolveAiToolTargetV3
       -> executeToolCall
            -> capability registry
            -> executor mapping
            -> internalApiClient
            -> Business API -> SQLite/audit
       -> evidence and verification
       -> answer synthesis / SSE events
```

### 4.2 Path variants

```text
CURRENT production entry
  runAiDispatcherV3 -> runAiAgentRuntimeV3

LEGACY path
  V4 read investigation disabled
  -> model-led tool loop
  -> legacy evidence/verification/synthesis branches

CURRENT V4 Investigation path
  AI_READ_INVESTIGATION_V4_ENABLED=true
  -> createReadInvestigationController
  -> aiCapabilityBrokerV4
  -> aiReadInvestigationDriverV4
  -> V4 state/evidence, legacy runtime shell

CURRENT V4+R3 path
  V4 Investigation plus AI_CLAIM_GROUNDING_V4_ENABLED=true
  -> claim construction/validation
  -> grounded answer composer

SHADOW path
  replayReadInvestigationShadow and aiShadowComparisonV4
  -> observes/replays isolated read-only paths
  -> cannot write and must not change production output

TEST path
  deterministic provider/tool fixtures, formal Oracle, architecture acceptance,
  trace-integrity harnesses, Real AI Shadow runner, Guardian/release gates
```

V4 is not a separate top-level runtime. It is feature-gated control logic inside the V3-named runtime. The paths reuse the provider, tool definitions, registry, executor, internal API client, Business APIs, and many evidence helpers, but duplicate or overlap orchestration decisions in these areas:

| Responsibility | Current overlapping owners |
| --- | --- |
| Planning/tool intent | `planAiIntentV3`, planned steps, model tool calls, V4 broker hints |
| Routing/authorization | tool exposure, model selection, `selectNextCapability`, broker authorization, recovery branches |
| Entity handling | model arguments, tool protocol normalization, identifier grounding, V3 resolver, V4 binding/provenance |
| State/termination | runtime loop counters, V4 fact reducer/controller state, fallback/clarification/synthesis branches |
| Evidence | legacy execution evidence, V3 observation ledger, V4 requirements/claims |
| Verification | legacy `hasVerified*` checks, V4 requirement state, claim validation, synthesis guards |
| Answer completion | direct content, retry synthesis, investigation reply, grounded V4 composer |

## 5. Failure-to-Architecture Mapping

| Failure | Primary architectural layer | Secondary layers | Why this is not mainly a prompt-only defect | V5 control |
| --- | --- | --- | --- | --- |
| `C02 STATE_TRANSITION_FAILURE` | State/orchestration | Evidence contract, routing | Correct tools/evidence were sometimes obtained, but execution continued or never reached a valid terminal state. A prompt cannot enforce legal transitions. | Explicit state machine, transition validator, evidence-complete terminal guard |
| `R02 TOOL_SELECTION_FAILURE` | Routing/capability exposure | Model uncertainty, orchestration | The model was allowed to select outside the task’s intended capability/tool subset. Adding prompt text leaves the invalid choice executable. | Capability-first bounded exposure and deterministic route eligibility |
| `A01 ARGUMENT_GENERATION_FAILURE` | Typed contract boundary | Model generation, entity preservation | The resolver received an already altered identity. Downstream fuzzy repair cannot restore ownership or prove intent. | Raw/model/normalized/validated argument stages plus immutable identity reference |

The model remains useful for interpreting ambiguous language, proposing a task/capability, and composing a supported answer. Software owns whether a transition is legal, which tools may be exposed, whether an argument is valid, what evidence exists, and whether execution may stop or write.

## 6. Target Architecture

```text
USER / Conversation Context
          |
          v
Task Interpreter  -- LLM may propose intent, target mentions, facts needed
          |
          v
Entity & Business Context Resolution -- identity-preserving boundary
          |
          v
Task State -- single authoritative state and transition history
          |
          v
Capability Router -- deterministic eligibility, limited tool exposure
          |
          v
Controlled Execution Runtime
  |-- Typed Contract Validation
  |-- Policy / Risk Gate
  |-- Existing Tool + Executor Adapter
  |-- Evidence Collection
  |-- State Transition Validation
  `-- Verification
          |
          v
Answer Composer -- only supported claims; LLM optional and constrained

Sidecar, never a control dependency:
OpenTelemetry / OpenInference -> Phoenix

Quality plane:
Failure Corpus -> Oracle -> Deterministic Eval -> Real AI Shadow
               -> Repeat Stability -> Guardian -> Release Gate
```

The V5 runtime is a thin control plane over proven business assets. It does not duplicate business truth or execute SQL. Adapters translate V5 contracts to current tool/executor/internal API contracts and translate results back to typed outcomes and evidence.

## 7. Business Ontology

Decision: **ADD a thin, versioned code-level ontology contract**, not a new database.

It owns:

- stable entity types and canonical identity fields;
- relations between entities relevant to capability eligibility;
- aliases as explicit lookup metadata, without overwriting raw mentions;
- canonical IDs sourced only from formal Business APIs/resolvers;
- predicates/fact types used by capability requirements and evidence.

It does not own LLM reasoning, business records, SQL persistence, free-form memory, prompts, or speculative aliases. Existing database/API schemas remain authoritative. The ontology maps them into runtime types and may initially cover only the failure corpus domains.

## 8. Capability Registry

Decision: **ADD a V5 typed capability projection by refactoring the existing registries**, not a second independent catalog and not an API rewrite.

Minimum contract:

```text
CapabilityDefinition
  id                     e.g. inventory.read, coil.inventory, bom.compare
  domain
  operation
  allowedTools[]         existing tool names
  requiredEntityTypes[]
  requiredEvidence[]
  riskLevel              L0-L5
  access                 read | analysis | proposal | write
  sourceOfTruth
  argumentContract
  resultContract
```

Existing `BUSINESS_CAPABILITY_REGISTRY`, AI tool definitions, capability graph/read profiles, and executor mappings are inputs to one compiled projection. A consistency gate must reject missing tools, mismatched access/risk, or an executor with no capability. Early migration maps only selected read-only capabilities; all others remain on V4.

### Limited tool exposure

```text
Task Interpreter proposal
  -> deterministic capability eligibility
  -> selected capability
  -> registry.allowedTools intersection policy allowlist
  -> small tool definition set exposed to the LLM
  -> typed validation before execution
```

The LLM never receives the complete tool catalog by default. Ambiguity yields clarification or a bounded discovery capability, not unrelated domain tools. Tool names remain reusable; Business API behavior stays unchanged.

## 9. Task State Machine

### 9.1 States

```text
RECEIVED -> UNDERSTANDING -> RESOLVING_ENTITY -> ROUTING -> EXECUTING
         -> COLLECTING_EVIDENCE -> VERIFYING -> COMPOSING -> COMPLETED

Terminal or paused outcomes:
NEEDS_CLARIFICATION | BLOCKED_POLICY | FAILED_TOOL | FAILED_EVIDENCE | FAILED_INTERNAL
```

`NEEDS_CLARIFICATION` is resumable only through a new user turn that explicitly supplies the missing contract fields. All `FAILED_*`, `BLOCKED_POLICY`, and `COMPLETED` states are terminal for the current execution.

### 9.2 Allowed transitions

| From | Allowed next states |
| --- | --- |
| RECEIVED | UNDERSTANDING, FAILED_INTERNAL |
| UNDERSTANDING | RESOLVING_ENTITY, ROUTING, NEEDS_CLARIFICATION, FAILED_INTERNAL |
| RESOLVING_ENTITY | ROUTING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| ROUTING | EXECUTING, NEEDS_CLARIFICATION, BLOCKED_POLICY, FAILED_EVIDENCE, FAILED_INTERNAL |
| EXECUTING | COLLECTING_EVIDENCE, FAILED_TOOL, BLOCKED_POLICY, FAILED_INTERNAL |
| COLLECTING_EVIDENCE | ROUTING, VERIFYING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| VERIFYING | COMPOSING, ROUTING, NEEDS_CLARIFICATION, FAILED_EVIDENCE, FAILED_INTERNAL |
| COMPOSING | COMPLETED, FAILED_EVIDENCE, FAILED_INTERNAL |

The retry edge `COLLECTING_EVIDENCE/VERIFYING -> ROUTING` requires an open evidence requirement, remaining bounded budget, and an untried eligible capability signature. `FAILED_TOOL -> ROUTING` is not automatic; a retryable error is represented before terminalization and must pass the same bounded policy.

### 9.3 Forbidden transitions and invariants

- No terminal state transitions to another state within the same execution.
- No `EXECUTING` without a validated `ToolRequest` and passed policy decision.
- No `VERIFYING` until all required investigation steps are completed, explicitly unavailable, or the task is declared evidence-free by its capability contract.
- No `COMPOSING` unless execution completeness, evidence completeness, and evidence validity have deterministic outcomes.
- No `COMPLETED` unless the final answer support check passes.
- No further routing after all required evidence is satisfied, except an explicit optional requirement authorized before verification.
- No retry of the same capability plus canonical arguments unless the prior error class is retryable and retry count remains within policy.

These are general transition constraints aimed directly at `C02`; none names a product, part, or frozen test case.

## 10. Typed Contracts

```text
ToolRequest
  requestId, taskId, capabilityId, toolName
  rawArgumentsRef          immutable model-output envelope reference
  normalizedArguments
  validatedArguments
  entityReferences[]       rawMentionRef, normalizedMention, canonicalEntityId
  riskLevel, access, policyDecisionRef

ToolResult
  requestRef, status, resultType
  businessResult           transient pass-through, not copied to tracing
  evidenceRefs[], operationRefs[], auditRefs[]
  startedAt, completedAt

ToolError
  requestRef, class        validation | policy | business | transport | internal
  code, retryable, safeMessage
  operationRefs[], evidenceRefs[]
```

The contract distinguishes model-generated raw arguments, normalized arguments, typed validated arguments, and the final Business API request. Only the validated form can cross the executor adapter. Adapters must preserve current error and return semantics until callers migrate.

### Argument validation pipeline

```text
LLM raw argument
  -> schema validation                 deterministic
  -> safe type normalization           deterministic, lossless rules only
  -> business constraint validation    deterministic via capability contract/API
  -> entity validation/binding         deterministic resolver/API evidence
  -> policy validation                 deterministic
  -> execute existing tool
```

An LLM may propose corrected arguments only as a new candidate request after a structured rejection. It cannot mark its own arguments valid, fabricate a canonical ID, or mutate the original mention. Ambiguity goes to clarification rather than silent coercion.

## 11. Entity Identity Contract

```text
EntityReference
  entityType
  rawMention              immutable text captured at the user/task boundary
  normalizedMention       derived, rule-versioned lookup value
  canonicalEntityId       nullable until formal resolution
  resolutionReceiptRef
  aliasSource             nullable, explicit
```

Ownership:

- Task Interpreter owns locating `rawMention`, but may not normalize it in place.
- The normalization service owns `normalizedMention` and its rule version; punctuation loss is observable and cannot mutate `rawMention`.
- The resolver accepts the complete `EntityReference`, resolves against formal sources, and alone may attach `canonicalEntityId` with a receipt.
- Capability routing and ToolRequest construction consume the canonical reference or explicitly declared unresolved state.
- The resolver must not repair identity already destroyed upstream. Missing or inconsistent raw identity is a contract failure, not a fuzzy-match opportunity.

Legacy string-only tools receive values through an adapter. That adapter is tested for preservation and is removable after tool contracts converge.

## 12. Evidence Ledger

Decision: **ADD a formal per-task ledger by evolving the existing V3/V4 observation/evidence structures.** It is not a new business database.

Evidence kinds:

- `DIRECT_FACT`: returned by an authoritative current Business API/tool.
- `DERIVED_FACT`: deterministically calculated from referenced facts with derivation metadata.
- `ASSUMPTION`: explicit, non-authoritative premise; cannot satisfy required business evidence alone.
- `UNVERIFIED`: observed or model-proposed value lacking sufficient authority/validation.

Minimum fields:

```text
evidenceId, claimType, evidenceKind, sourceOfTruth
entityRef, predicate, valueRef/valueType
freshness/authorityVersion, toolRequestRef
operationRefs/auditRefs, derivationRefs
verificationStatus, createdAt
```

Large/raw results remain transient; the ledger stores references and the minimum values required to support the task. Business truth remains in existing APIs/SQLite.

## 13. Verification

Verification becomes four explicit decisions:

1. **Execution complete?** Required tool requests reached success/allowed negative outcomes; no mandatory request is still open.
2. **Evidence complete?** Every required claim has evidence or a typed unavailable/ambiguity outcome.
3. **Evidence valid?** Source, entity binding, freshness, operation/audit linkage, and derivation satisfy the capability contract.
4. **Answer supported?** Every business claim in the answer plan references valid evidence; unsupported claims are rejected.

Deterministic checks run first and own state transitions. An LLM verifier may only judge residual semantic alignment that code cannot decide, and its result cannot override a deterministic policy, identity, operation, or evidence failure. `failed_unverified` becomes a compatibility projection of typed failure states during migration, then is deprecated as an overloaded decision.

## 14. Policy / Write Safety

Existing proposal -> confirmation -> `allowWrite` -> execution -> audit remains intact. V5 adds a typed risk policy above it:

| Level | Meaning | Autonomy | Evidence | Approval |
| --- | --- | --- | --- | --- |
| L0 | Conversation/no business action | autonomous | none | none |
| L1 | Business read | autonomous within identity/capability scope | source and entity provenance | none |
| L2 | Business analysis/preview | autonomous, no persistence | input facts and deterministic derivation | none |
| L3 | Change proposal | may prepare only | target, before/after, validation | explicit proposal shown; no execution |
| L4 | Approved reversible write | execute only after bound confirmation | proposal, actor, capability, operation/audit receipts | explicit, identity- and payload-bound approval |
| L5 | Critical/irreversible or broad write | not autonomous | complete impact/rollback evidence | elevated workflow or unavailable to AI |

Current `WRITE_TOOLS`, confirmation tokens, `allowWrite`, operation IDs, and audit evidence are kept and mapped to the policy. The policy never treats model confidence as authorization.

## 15. Memory vs Business Truth

| Information class | Authority | May satisfy business evidence? |
| --- | --- | --- |
| Conversation Context | current turn/session only | No |
| User Preference | presentation/default preference | No |
| Temporary Claim | model/user hypothesis | No; ledger kind `ASSUMPTION` or `UNVERIFIED` |
| Business Fact | formal API/business service | Yes, subject to freshness and identity |
| Business Evidence | typed receipt linking fact to source/operation | Yes |

Conversation memory may guide interpretation but cannot be promoted automatically to a canonical entity, inventory, cost, order state, or other formal fact. P07 does not propose a new memory system.

## 16. Observability

Decision: **KEEP OpenTelemetry, OpenInference, Phoenix, central redaction, and Trace Contract V1.** They provide traces, failure discovery, datasets, experiment/evaluation support, and migration comparison. They remain fail-open and side-effect free. Phoenix unavailability must never alter runtime decisions.

V5 may later add state/capability/contract/evidence span fields through a reviewed Trace Contract V2. It must retain metadata-only privacy and cannot write trace IDs into business storage or return them through SSE/API contracts.

## 17. Evaluation

V5 gates use trajectory evaluation, not answer-text impressions:

- Intent Accuracy
- Entity Preservation Accuracy
- Entity Resolution Accuracy
- Capability Routing Accuracy
- Tool Selection Accuracy
- Argument Validation Accuracy
- Execution Completion Accuracy
- Evidence Coverage
- Verification Accuracy
- Final Answer Accuracy
- Repeat Stability
- Write Safety

The P06 machine-readable dataset becomes a permanent seed corpus. Every confirmed defect adds a minimal regression case, frozen Oracle expectation, safe trajectory signature, and failure class. A fix is incomplete until its case passes permanently without regressing prior cases.

Initial targets:

| Metric | P06 baseline | Initial target | Qualification |
| --- | ---: | ---: | --- |
| Capability routing | 50.00% (5/10) | 100% on P06; >=90% on expanded corpus | At least 50 representative read paths before promotion |
| Primary tool selection | 93.33% (14/15) | 100% on P06; >=98% expanded | Exact expected/allowed tool rules |
| State-transition primary failures | 3/8 failed paths | 0 on P06; <=2% expanded | No illegal transition or post-evidence route |
| Argument-generation primary failures | 2/8 failed paths | 0 on P06; >=99% validation/preservation expanded | Invalid request rejected before execution |

The 15-path corpus is too small to establish production rates. Expansion, repeat runs, and confidence intervals are required before broad cutover.

## 18. Framework Decision

| Option | Decision | Rationale |
| --- | --- | --- |
| Self-built controlled runtime | **ADOPT** | Fits current Node/CommonJS architecture, existing tool/API assets, explicit state/contract needs, and incremental adapters. Keep the runtime small and domain-focused. |
| LangGraph | **BORROW_PATTERN** | Graph/state/checkpoint concepts are useful, but adopting it now adds migration and dependency risk before contracts stabilize. |
| Pydantic AI | **REJECT_FOR_NOW** | Python runtime mismatch and duplicate integration layer outweigh type-safety benefits for this CommonJS application. |
| OpenAI Agents SDK | **BORROW_PATTERN** | Typed tool/guardrail/handoff ideas are useful; direct adoption would increase provider coupling and disrupt existing DeepSeek/provider wrappers. |
| Microsoft Agent Framework | **DEFER** | Reassess only if cross-runtime orchestration or enterprise integration becomes a demonstrated requirement. |
| Temporal | **REJECT_FOR_NOW** | Current assistant tasks are bounded request lifecycles, not durable multi-day workflows. |
| OPA | **REJECT_FOR_NOW** | L0-L5 policy is small and application-local; a separate policy service is unjustified now. |

No framework is installed in P07. A future framework may be reconsidered only after typed contracts and evaluation gates exist, so it can be measured rather than adopted by popularity.

## 19. Migration Strategy

Use a strangler migration:

```text
Existing V4 entry
  |-- unchanged production V4 path
  `-- V5 adapter/shadow path: observe -> shadow -> compare -> promote
```

Six phases are defined in `v5-migration-plan.md`. Routing occurs by a narrow allowlist of eligible cases/capabilities, never by a global switch. Each phase preserves the old path, has deterministic and shadow gates, contains an immediate flag rollback, and stops for Supervisor review.

The first implementation phase is **V5-A Typed Contracts + Task State Skeleton**. It adds side-effect-free contracts, state transition validation, adapters, and deterministic tests only. It does not route production requests through V5 or repair the frozen cases.

## 20. Legacy Deprecation

| Legacy element | End state | Timing and adapter |
| --- | --- | --- |
| Legacy V3 model-led path | DEPRECATE, REMOVE_LATER | Keep as fallback/control through shadow and canary; remove only after expanded gates and rollback window. |
| V4 Investigation path | MERGE into controlled runtime | Reuse fact requirements, observations, and broker knowledge through adapters; retire duplicate controller after V5-D/E. |
| V4+R3 claim grounding | MERGE into evidence/answer pipeline | Preserve claim validation concepts; replace parallel completion ownership after V5-D. |
| Duplicate routing | REMOVE_LATER | Capability Router becomes sole eligibility/exposure owner after V5-B promotion. |
| Duplicate normalization | MERGE | One versioned identity normalization boundary; legacy adapters remain until all mapped tools pass. |
| Duplicate verification | REMOVE_LATER | Four explicit verification decisions replace overlapping checks after V5-D/E. |

Removal requires zero traffic on the legacy branch, a retained rollback release, passing deterministic/real/shadow/stability/Guardian gates, and explicit Supervisor approval. P07 removes nothing.
