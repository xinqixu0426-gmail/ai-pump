# M4-1D — Business Understanding Context Architecture V1

**Status:** Design and current-state audit only. This document is not a runtime source, does not change prompts, and authorizes no implementation.
**Baseline:** `b865b1b3a0e5b8579887d9ac3bdf8f8d609193fc` on `ai-native/m3-optimization-v1`.
**Evidence inputs:** M4-1A Company Business Model candidate; M4-1C isolated model smoke result (10/10 PASS); current Assistant runtime sources listed below.

## 1. Decision summary

Adopt **Core Business Kernel + bounded Domain Knowledge Modules**, all rendered from **one future canonical Company Business Model source**. The selection mechanism runs before Semantic Understanding using a generated lexical concept/alias index and can optionally use a bounded low-cost classifier only to choose from existing modules.

This is a knowledge-context layer, not an entity resolver, policy engine, fact store, planner, or tool router.

```text
User input + safe non-factual UI context
  -> Business Context Selector
  -> immutable Business Model snapshot
  -> Core Kernel + selected Knowledge Modules
  -> Semantic Understanding (Judge)
  -> Ontology / capability planning / formal tools
  -> Formal Facts / Fact Ledger / answer validation
```

The key invariant is:

```text
Business Knowledge != Business Policy != Business Fact
```

## 2. Why M4-1C passed while current Native AI can still seem not to understand the factory

M4-1C gave the model the complete, reviewed Company Business Model directly in every isolated, tool-free request. It therefore tested the capability **MODEL + correct business context**.

The Native runtime does not inject that model. It gives Judge and Main Agent the published Domain Policy, bounded conversation, and non-factual investigation context. The Main Agent later receives tool descriptions and, only after calls, formal tool results/facts. This means the model may know how it must behave around ambiguity or confirmation while not being told what a company term means before it interprets the request.

Thus the gap is **context availability and architecture**, not evidence that the selected model lacks core product understanding.

## 3. Current runtime context audit

### 3.1 Current request assembly

| Stage | Context currently supplied | Evidence | What it is not |
| --- | --- | --- | --- |
| Runtime entry | One published policy snapshot, user message, bounded recent conversation, attachments/page context | `api/services/ai-assistant/runtime.cjs` `runAiAssistant`; `buildInvestigationContext` | No Company Business Model snapshot |
| Judge system message | Judge instructions, policy version, full published Domain Policy | `api/services/ai-assistant/judge.cjs` `judgeSystemPrompt`, `runJudge` | No Ontology contract, Company Model, tool descriptions, or formal facts |
| Judge context | Last four user/assistant text messages; rendered page/conversation-reference/attachment investigation context | `judge.cjs` `boundedConversation`, `renderInvestigationContext` | Page/attachment data are explicitly not formal facts |
| Main Agent system message | Agent instructions, policy version, full published Domain Policy | `api/services/ai-assistant/mainAgent.cjs` `mainAgentSystemPrompt` | No Company Business Model module |
| Main Agent pre-tool context | Last four messages, investigation context, Judge JSON | `mainAgent.cjs` `runMainAgent` | Judge output is explicitly stated not to be a business fact |
| Ontology information | Only formal identity-resolution results/candidates returned by `resolve_entity` or page verification | `api/ontology/agentResolver.cjs`; `api/services/ai-assistant/agentTools.cjs` | The model does not receive Ontology profiles as business teaching material |
| Tool descriptions | Bounded Broker-selected read/preview tools after Judge or formal resolution | `capabilityBroker.cjs` `selectCapabilities`; `agentTools.cjs` | Not a stable product-domain explanation; no tool is a fact until executed |
| Formal facts | Tool result projection plus fact references after actual tool calls | `mainAgent.cjs` tool loop; `factLedger.cjs` projection | Not pre-request business knowledge |

`context.cjs` correctly labels page context, conversation references, and attachments as investigation aids rather than formal facts. `domainPolicyStore.cjs` correctly freezes a single published policy snapshot. Neither creates a Company Business Model snapshot.

### 3.2 Business knowledge visible today

| Knowledge required by M4-1C | Current visibility | Evidence and boundary |
| --- | --- | --- |
| `12` maps to a 120 mm stator | **NO** | Exists in `coilCost.cjs` and Coil Ontology source references, but neither is injected into Judge/Main context. |
| `120` in `12-120` means sheets | **NO** | `coils.sheets` and `coil.commonDesignation` are not rendered into model context. |
| Template is Recipe’s reusable BOM/structure blueprint | **PARTIAL** | Tool names/descriptions and Rule-01 mention recipe configuration, but no coherent Template/Recipe/BOM explanation is injected. |
| Recipe is OEM production configuration basis | **PARTIAL** | Policy describes preview/mutation semantics, not the OEM product-model meaning. |
| V750’s `750` is power | **NO** | No such company terminology is in the current policy, system prompts, or pre-tool context. |
| “通用款” means shell style / template selection | **NO** | No such semantic definition is injected. |
| Template != Recipe != BOM | **PARTIAL** | Formal tools can reveal pieces after investigation; no pre-semantic distinction exists. |
| Process Option != Part | **NO** | No pre-tool business definition is injected. |

**Conclusion:** current runtime has **PARTIAL** business knowledge only because policy and tool contracts expose limited behavior/surface hints. It has no stable, reviewed Business Understanding Context.

## 4. Three information classes

| Class | Question it answers | Examples | Canonical authority | Runtime treatment |
| --- | --- | --- | --- | --- |
| Business Knowledge | “What does this company term/concept mean?” | `12-120`, Template, Recipe, OEM configurability, process option | Company Business Model | Render bounded explanatory context before semantic understanding |
| Business Policy | “How should the assistant proceed?” | no silent scheme selection; preview is not a write; confirmation required | Published Domain Policy plus code-enforced safety | Published policy snapshot; code remains enforcement point |
| Business Fact | “What is true now?” | current 12-120 candidates, V750 cost, stock | Formal Business API / Ontology resolver / database-backed services | Obtain only through formal reads, tools, and Fact Ledger |

No layer may substitute for another:

- Business Knowledge never authorizes identity, cost, stock, write, or current-state claims.
- Policy never defines or invents an entity identity or business fact.
- A formal fact does not become a reusable definition of company terminology.

## 5. Proposed context layers

### Layer A — Core Business Kernel

A very small, stable explanation needed by most product-domain requests. It should state only cross-domain semantics, for example:

- a designation is not formal identity;
- Template, Recipe, and BOM have distinct roles;
- the factory is OEM/configuration-oriented rather than a fixed-SKU-only model;
- Coil common designations can be non-unique;
- business knowledge is not a current business fact.

The kernel must not include data examples, cost formulas, all domain vocabulary, policy prose, current inventory, or tool instructions.

### Layer B — Domain Knowledge Modules

Immutable, compact modules selected before semantic understanding. Initial modules should correspond to reviewed concept groups, not endpoint names:

- `COIL_STATOR_SCHEME`: `12-120`, stator, sheet count, scheme ambiguity and scheme identity.
- `TEMPLATE_RECIPE_BOM`: reusable shell structure, product configuration, BOM expansion.
- `PART_AND_PROCESS_OPTION`: Part identity boundary, coil versus Part, process-option distinction.
- `OEM_PRODUCT_CONFIGURATION`: V-series/power terminology only after Owner-approved definitions; mutable customer configuration; Finished Product boundary.

Modules provide definitions, counterexamples, permitted aliases, and concept IDs. They must not carry current candidate lists, database IDs, formal current prices, or tool schemas.

### Layer C — Published Domain Policy

The existing versioned Policy remains separate. It governs conduct, not vocabulary. For example, it can say not to silently choose an ambiguous Coil Scheme, but should not be responsible for explaining what `12-120` means.

### Layer D — Formal Facts

Unchanged M3 architecture: Ontology/formal resolver and Broker/Tools produce verified facts later in the request. Facts enter the Fact Ledger and validator boundary; they are never embedded as Business Understanding context.

## 6. Canonical knowledge ownership and projection

### Recommended ownership

**One canonical knowledge source:** a future, owner-reviewed, versioned **Company Business Model** artifact/store. M4-1A’s candidate is the initial review artifact, not yet the canonical runtime source.

The canonical source owns only:

- stable business concept definitions;
- aliases/designations for module selection;
- concept-to-module membership;
- examples and counterexamples that explain semantics but assert no current facts;
- status/evidence/review metadata.

It does **not** own entity IDs, database schema facts, current business data, policy enforcement, capability permissions, or calculations.

### Projections and evidence

| Asset | Role | Authoring status |
| --- | --- | --- |
| Future Company Business Model | Canonical authored business knowledge | Sole place an Owner-approved business concept is edited |
| Core Kernel / modules / alias index | Deterministic runtime projections from the canonical model | Generated/compiled; never independently hand-edited |
| M4-1A Markdown and candidate JSON | Review/evidence artifact | Evidence until a later approval/import decision |
| Ontology | Formal entity identity, relations, factual contract | Independent authority; references concepts but does not duplicate explanatory prose |
| Domain Policy | Behavioral rules | Independent authority; references concept IDs rather than restating definitions |
| Business code/schema/docs | Evidence and formal fact behavior | Not runtime Business Knowledge authoring source |

### Change example: a new `13-140` concept

1. The Owner-approved Company Business Model gains or revises the relevant concept definition/aliases **once**.
2. The compiler regenerates the affected module and alias index with a new immutable model version.
3. Ontology changes only if formal identity/fact/relationship behavior also changes; Domain Policy changes only if behavior rules change.
4. Existing formal Business APIs/schema change only if formal data semantics actually change.

Therefore a pure business-meaning change has **one canonical source**, not four manual runtime edits.

## 7. Context selection before Semantic Understanding

### V1 selector

The selector consumes the current user text and safe non-factual UI hints before Judge. It returns a bounded selection from the frozen business-model snapshot:

```text
input text
  -> Unicode/whitespace/punctuation normalization
  -> generated lexical alias/concept index
  -> exact concept candidates
  -> deterministic selection policy
  -> Core Kernel + 0..N modules, or explicit boundary outcome
```

The lexical index may contain approved aliases such as `12-120`, `模板`, `配方`, `BOM`, and approved product/configuration terminology. It is a **concept lookup**, not regex intent routing, entity resolution, capability routing, or a business fact lookup.

Safe UI context can narrow only broad module choice (for example a page declared as `recipe` may select the Recipe/Template/BOM module); it never supplies an identity or current value.

### Deterministic outcomes

| Outcome | Meaning | Required next behavior |
| --- | --- | --- |
| `BUSINESS_CONTEXT_READY` | One or more relevant modules selected from the model snapshot | Pass kernel/modules to Semantic Understanding |
| `BUSINESS_CONTEXT_AMBIGUOUS` | More than one incompatible concept/module interpretation survives selector rules | Do not proceed to semantic planning; ask bounded terminology clarification or show the concepts needing selection |
| `BUSINESS_KNOWLEDGE_UNKNOWN` | The business model has no concept for a material company-specific term | Do not silently treat it as known business terminology; ask what it means or use an explicitly generic non-domain path decided in later implementation |

This solves the circularity problem: module selection is based on a generated glossary/alias index, not on a later intent/tool plan. It must remain conservative: a non-match is safer than injecting an unrelated module.

## 8. Context budget

Budgets are character-oriented guardrails, not fabricated token accounting.

| Budget | V1 target | Rule |
| --- | ---:| --- |
| `CORE_KERNEL_TARGET_SIZE` | <= 600 Chinese characters | Always compact and cross-domain only |
| `DOMAIN_MODULE_TARGET_SIZE` | <= 900 Chinese characters each | Definition, distinctions, aliases, counterexample; no live data |
| Modules per request | normally <= 2; hard cap 3 | Prefer exact concept modules over broad domain dumping |
| `MAX_BUSINESS_CONTEXT_SIZE` | <= 2,400 Chinese characters | Kernel plus selected modules; select none beyond kernel for irrelevant/general requests |

Example: “12-120 是什么” loads Kernel + `COIL_STATOR_SCHEME`; it must not pull customer, quotation, procurement, file, or knowledge modules.

The existing Domain Policy has its own current maximum and is not counted as Business Knowledge merely to obscure prompt size. Future implementation should record both payload sizes separately.

## 9. Versioning and auditability

At request start, take one immutable Business Model snapshot, just as current runtime freezes one Published Policy snapshot. A request must never switch modules or version mid-turn.

Future request-level observability fields:

- `businessModelVersion`
- `coreKernelVersion`
- `selectedKnowledgeModules`
- `knowledgeConceptIds`
- `businessContextSelectionStatus`
- `businessContextSelectionReason` (bounded, non-user-content-sensitive category)
- `businessContextCharCount`
- `businessContextBuildMs`
- `businessContextSnapshotHash`

If `12-120` is interpreted incorrectly, these fields first establish whether Coil knowledge was selected and which immutable version rendered it. They do not log the full prompt, private attachments, internal IDs, or chain-of-thought.

## 10. Failure boundary

Business Understanding must fail before semantic planning, not be repaired invisibly by a later Ontology or Tool call.

- Missing relevant module: `BUSINESS_KNOWLEDGE_UNKNOWN`.
- Conflicting relevant module candidates: `BUSINESS_CONTEXT_AMBIGUOUS`.
- Stale/unreadable model snapshot: `BUSINESS_CONTEXT_UNAVAILABLE`.

These statuses are context-selection outcomes, not business facts and not proof that an entity does not exist. A later phase must define the exact owner-facing wording and generic non-domain handling, but it must not allow a company-term error to be silently “fixed” by tool calls.

## 11. Laya role assessment

Laya is **not required for V1**. If adopted later, its only appropriate role in this layer is a bounded, low-cost **module-selection classifier/reranker** after deterministic alias lookup produces a closed candidate list.

Laya must not:

- author or revise Company Business Knowledge;
- create aliases/modules;
- resolve formal entities or IDs;
- decide policy, capabilities, writes, or current facts;
- override `BUSINESS_CONTEXT_AMBIGUOUS` or `BUSINESS_KNOWLEDGE_UNKNOWN` with invented certainty.

The deterministic alias index remains the explainable primary path. Any classifier result must be constrained to declared module IDs and logged as selection metadata.

## 12. Alternatives considered

| Option | Reliability | Size/cost | Maintenance and duplication | Versioning/observability | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Whole Company Model every prompt | High for known concepts | Poor as domains grow | Repeats irrelevant knowledge; encourages prompt bloat | Simple but coarse | Reject for V1 |
| B. Core Kernel + domain modules | High if selection is conservative | Bounded | One authoring source plus generated projections | Precise snapshot/module trace | **Recommend** |
| C. Ontology-rendered context | Strong for formal identity only | Potentially bounded | Couples explanatory business language to factual ontology profiles | Hard to distinguish knowledge from fact | Reject as sole source; Ontology stays independent |
| D. Structured Business Model compiler | Excellent ownership/projection mechanism | Implementation cost later | Eliminates parallel manual editing | Strong immutable artifact/hash story | Adopt as the implementation mechanism behind B, not as a second source |
| E. Embedding/RAG-only selection | Flexible but non-deterministic | Variable | Retrieval corpus could duplicate facts/policy | Harder to explain missed module | Defer; not V1 baseline |
| F. LLM-only selection | Variable | Adds a model call before understanding | Can hallucinate module intent | Weak deterministic audit | Reject as primary selector |

## 13. Recommended V1 architecture

```text
Canonical Company Business Model (owner-reviewed, versioned)
  ├─ deterministic compiler
  │   ├─ Core Business Kernel
  │   ├─ immutable domain modules
  │   └─ lexical concept/alias index
  └─ audit/version manifest

Request start
  ├─ freeze Business Model + Published Policy snapshots
  ├─ select modules before Judge
  ├─ fail explicitly on unknown/ambiguous business context
  └─ send Kernel + selected modules separately from Policy

Then unchanged M3 path
  Judge -> Ontology -> Capability Broker -> formal tools -> Fact Ledger -> Validator
```

The model messages should preserve labeled boundaries such as `Business Knowledge`, `Domain Policy`, and `Investigation Context`, so the model is not invited to treat explanations as policies or facts.

## 14. Future implementation boundary

M4-1E or a separately authorized task may implement this only after Supervisor approval. Its minimum scope should be:

1. approve/import the Company Business Model into one canonical versioned authoring source;
2. build deterministic compiler output and a lexical selector;
3. inject a frozen business-context snapshot before Judge/Main Agent;
4. expose bounded observability only;
5. add isolation tests for module selection, ambiguity, unknown knowledge, version stability, budgets, and Knowledge/Policy/Fact separation.

It must not modify Ontology semantics, Business APIs, cost calculations, capability permissions, protected writes, or current formal fact authority merely to provide Business Understanding.

## 15. Direct answers to design questions

| Question | Decision |
| --- | --- |
| Why 10/10 in M4-1C but weak Native understanding? | M4-1C manually injected the missing business model; Native runtime does not. |
| Who owns future `12-120` definition? | The one canonical, versioned Company Business Model. |
| Should Policy explain `12-120`? | No; Policy may reference the concept and prescribe ambiguity behavior only. |
| Full Company Model every turn? | No; Kernel plus bounded relevant modules. |
| How before Semantic Understanding? | Deterministic, generated alias/concept lookup at request start. |
| How avoid circular dependency on later semantic planning? | Module selection does not use intent/tool planning; it selects from a frozen index and returns explicit unknown/ambiguous outcomes. |
| Laya’s suitable role? | Optional constrained module classifier/reranker only, never an authority. |
| How many canonical sources for a new business concept? | One: the Company Business Model; other systems change only when their own independent concerns change. |
