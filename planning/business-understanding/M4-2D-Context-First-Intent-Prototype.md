# M4-2D — Context-First Intent Prototype

**Date:** 2026-09-30

**Branch / start:** `ai-native/m3-optimization-v1` / `a22f9c3051d981dba752ec0b486b6c952e610ecd`

**Scope:** isolated context preparation and intent understanding only. No production Runtime, API, Tool, Capability, Planner, Executor, formal data query, cost calculation, or write path.

## Architecture

```text
Raw User Input + necessary recent user conversation
        ├── Business Understanding Agent (LLM)
        │     full Company Business Model + Published Domain Policy snapshot
        │     → Business Understanding Memo
        └── Ontology Context Agent (LLM)
              full active Ontology v2.1 declaration
              → Ontology Context Memo
                    both branches run concurrently
                              ↓
                     Intent Agent (LLM)
                       raw input + recent conversation + both complete memos
                              ↓
                         Intent Memo
```

Each handoff is natural language with Markdown headings. No LLM-to-LLM JSON contract, enumerations, entity IDs, or execution-oriented schema is used. The harness records full prompt outputs and timing evidence in [M4-2D-smoke-results.json](../../scripts/ai-experiments/context-first-intent/results/M4-2D-smoke-results.json).

## Context ownership and responsibility

| Agent | Input | Responsibility | Explicit boundary |
| --- | --- | --- | --- |
| Business Understanding | Original input, necessary recent user wording, complete Company Business Model V1, complete local runtime Domain Policy bootstrap text | Extract relevant factory concepts and relevant policy meaning | No Ontology, database facts, candidate counts, IDs, costs, stock, tools, APIs, or plan |
| Ontology Context | Original input, necessary recent user wording, serialized complete active `ontologyV21` declarative contract (69,181 characters across 11 declaration source files) | Extract relevant entity types, facts, designations, relations, and identity limits | No Domain Policy, Business Model, database rows, costs/stock values, tools/APIs, or plan |
| Intent | Original input, necessary recent user wording, both complete memos | Describe the Owner's goal, requested changes/results, persistence meaning, identity boundary, and only truly blocking missing information | No full source documents, formal grounding, tools/APIs, planner, or execution |

The Ontology Context payload is generated directly from the active declarative `ontologyV21` export. Its source modules contain contract definitions only; no database access or formal entity rows are imported. Context prompts include no tool definitions, and the model client sends `tools: []`.

The necessary recent conversation is passed as ordinary text to all three agents. CTX-11 received `User: 我先看一下12-120。`; the other cases received no conversation context.

### Memo examples

The Context agents and Intent agent return natural-language Markdown memos. The stored artifacts retain every memo for all 24 runs. Representative first-run intent excerpts:

- **CTX-05:** preserved both `电缆 5 米` and `木箱`, and interpreted `先算一下，不保存` as a temporary calculation without persistence.
- **CTX-06:** interpreted `正式配方…并保存` as an explicit persistent change request, without executing it.
- **CTX-11:** used the recent user wording to resolve “刚才那个线圈” to the `12-120` mention while retaining that it is not a unique canonical Coil identity.

## Source snapshot verification

The Company Business Model came from `planning/business-understanding/company-business-model-v1.md`. The Domain Policy text came from `api/services/ai-assistant/domain-policy.md`, the runtime bootstrap source, and was provided in full (7,323 characters).

The current workspace `pump.db` has no `domain_policy_versions` table. A read-only query for the published policy row therefore returned no snapshot, and no business tables were read. The bootstrap source is version 1, but its match to the current Published Domain Policy version could not be confirmed. The smoke artifact records this explicitly as `policyCurrentPublishedVersionVerified: false`. This is a material context-source limitation; the policy input must not be described as a verified current Published Version.

No remote production database was accessed. None of the three Agents has a database import or database connection path.

## Parallel orchestration and timings

`orchestrator.cjs` starts Business Understanding and Ontology Context in the same `Promise.all`. Intent starts only after both promises resolve. Each run records both Context call durations, the wall-clock parallel interval, Intent duration, total duration, and overlapping start/finish intervals.

All 24 completed runs recorded overlapping Business/Ontology intervals. The observed medians were:

| Measurement | Median |
| --- | ---: |
| Business context | 4,845 ms |
| Ontology context | 8,930 ms |
| Parallel context wall time | 8,930 ms |
| Intent | 4,453 ms |
| Total | 13,333 ms |

## Smoke method and results

The first smoke ran all 12 CTX and 4 ADV cases once, then repeated exactly CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-10, CTX-11, and ADV-04. It completed 24 runs with 72 DeepSeek `deepseek-chat` calls and no model-call errors. Prompts, source documents, cases, and outputs were not changed or rerun after observing results.

The initial deterministic cue evaluator recorded **15 PASS / 9 PARTIAL / 0 FAIL**, with 6 evaluator-marked critical failures. A separate manual review against the stated critical-failure list confirms **0 critical failures**: the key configuration changes, both CTX-10 goals, explicit save/do-not-save wording, 12-120 identity boundary, and ADV-04's missing object reference were retained. The six machine flags are false positives from wording cues, not six observed critical semantic failures. The evaluator is not a semantic model or a human review. Review of the stored memos shows it flags a correct sentence saying that persistence was *not* requested because it contains the phrase “正式保存”; it also misses spacing variants such as `5 米`. The initial machine labels are retained as literal results, but must not be treated as a reliable semantic acceptance result. The output itself remains frozen.

### Per-case first-run score

These are the literal initial evaluator outcomes by layer (`B` Business, `O` Ontology, `I` Intent). `PARTIAL` includes either a substantive memo issue or an evaluator cue failure; the stored output is the evidence for supervisor review.

| Case | Business | Ontology | Intent | Overall | Finding / failure classification |
| --- | --- | --- | --- | --- | --- |
| CTX-01 | PASS | PASS | PASS | PASS | 12-120 meaning and non-unique designation boundary retained. |
| CTX-02 | PASS | PASS | PASS | PASS | Cost intent clear; formal identity ambiguity kept separate from intent. |
| CTX-03 | PASS | PASS | PARTIAL | PARTIAL | Packaging delta preserved and no save inferred. Cue evaluator misread negated persistence wording; classify as evaluator limitation, not a confirmed language-fidelity failure. |
| CTX-04 | PASS | PASS | PARTIAL | PARTIAL | Stainless shaft retained as rotor process rather than ordinary Part. Repeat varied on preview/persistence phrasing; Intent synthesis stability concern. Ontology also incorrectly suggested V750 may map to `coil.ratedVoltageV`. `ONTOLOGY_CONTEXT_FAILURE`. |
| CTX-05 | PASS | PASS | PARTIAL | PARTIAL | Cable 5 m, wooden crate, and explicit do-not-save intent all retained. Cue evaluator missed spacing/format variation. |
| CTX-06 | PASS | PASS | PASS | PASS | Explicit formal save intent retained; no execution claim. |
| CTX-07 | PASS | PASS | PARTIAL | PARTIAL | Change retained and persistence left unspecified. Cue evaluator treated boundary wording as a fidelity issue. |
| CTX-08 | PARTIAL | PASS | PASS | PARTIAL | Conceptual Template/Recipe question understood; Business memo included policy/persistence material with little relevance. `BUSINESS_CONTEXT_FAILURE` / policy relevance. |
| CTX-09 | PASS | PASS | PASS | PASS | Asked about template fixed parts without claiming actual database contents. |
| CTX-10 | PASS | PASS | PASS | PASS | Both current cost and currently configured coil were retained. Repeat had minor boundary phrasing variation. |
| CTX-11 | PASS | PASS | PASS | PASS | Conversation reference resolved in language to 12-120; no canonical identity asserted. Persistence wording varied between pure query and temporary preview. |
| CTX-12 | PASS | PASS | PASS | PASS | Recognized a desired change but did not invent which configuration or target value. |
| ADV-01 | PASS | PASS | PASS | PASS | Said the model permits designation collisions without asserting actual candidate count. |
| ADV-02 | PASS | PASS | PASS | PASS | Treated fixed-finished-product status as a concept question; did not query formal data. |
| ADV-03 | PASS | PASS | PASS | PASS | Identified the comparison goal and missing Recipe/configuration context. |
| ADV-04 | PARTIAL | PASS | PASS | PARTIAL | Did not guess V750 and identified the unresolved “这个”; however, it speculated that the object was likely a Recipe and that its current package was usually a carton. `SOURCE_HALLUCINATION` / language fidelity risk. |

### Repeat stability review

Stability below compares the meaning required by the case, not exact wording.

| Case | Stability | Observation |
| --- | --- | --- |
| CTX-02 | STABLE | Both identify the price/cost question and leave 12-120 identity unresolved. |
| CTX-03 | STABLE | Both preserve carton → wooden crate and no explicit persistence request. |
| CTX-04 | VARIANT | Repeat weakened the preview interpretation to an unresolved future persistence question; both preserve the stainless-shaft cost-difference goal. |
| CTX-05 | STABLE | Both preserve cable 5 m + wooden crate + do not save. |
| CTX-06 | STABLE | Both preserve explicit save intent. |
| CTX-10 | STABLE | Both preserve both cost and current-coil goals. |
| CTX-11 | VARIANT | Both resolve the reference to 12-120; repeat changes the persistence description from temporary preview to pure query. |
| ADV-04 | VARIANT | Both identify the unresolved “this”; one says it likely means a Recipe and assumes carton as current packaging, while the other likewise infers an existing packaging object. |

## Failure classification and rubric summary

Observed failure classes:

- `ONTOLOGY_CONTEXT_FAILURE`: Ontology Context sometimes mapped `V750` speculatively to coil concepts, including an unsupported possibility that `750` is `coil.ratedVoltageV`; it also listed many irrelevant cost/stock facts for configuration questions. These are semantic context errors, not database facts.
- The prototype prepended a mislabeled version string, `v2.2.1`; the loaded export is Ontology V2 with contract revision 2.1. The serialized contract contents came from `ontologyV21`, but this header is an `ARCHITECTURE_FAILURE` in source labeling.
- `INTENT_SYNTHESIS_FAILURE`: CTX-04 and CTX-11 persistence framing varied; ADV-04 did not consistently keep the object type wholly unknown.
- `SOURCE_HALLUCINATION`: ADV-04 inferred the current package was usually a carton without conversation evidence.
- `BUSINESS_CONTEXT_FAILURE`: some Business memos included RULE-07 or unrelated persistence/write policy, despite narrow relevance instructions.
- `CONVERSATION_CONTEXT_FAILURE`: none observed for CTX-11's core antecedent reference.
- `ARCHITECTURE_FAILURE`: none in orchestration or isolation; parallel execution, handoff order, and production import isolation passed. The deterministic evaluator itself has a semantic-coverage limitation.

| Dimension | Initial evaluator | Review note |
| --- | --- | --- |
| BUSINESS_CONTEXT_RELEVANCE | PASS | Useful business concepts were present, but some memos were broader than needed. |
| POLICY_RELEVANCE | FAIL | Some irrelevant policy details were included; cue evaluator also overflags some rule combinations. |
| ONTOLOGY_CONTEXT_RELEVANCE | PASS | This aggregate flag is too permissive: CTX-04 and other memos contain unsupported or irrelevant ontology projections. |
| NO_FORMAL_FACT_HALLUCINATION | PASS | No current DB candidate counts, costs, inventory values, or IDs were generated. ADV-04 did infer an unsupported generic current package. |
| INTENT_COMPLETENESS | FAIL | Cue evaluator false negatives include correct multi-change and negated-persistence wording. Manual evidence shows requested goals were generally preserved. |
| INTENT_BOUNDARY | FAIL | Cue evaluator treats negated ambiguity language as ambiguity. Actual issue is CTX-04/11 persistence variation and ADV-04 object-type speculation. |
| LANGUAGE_FIDELITY | FAIL | Cue evaluator produced false positives; ADV-04 contains a genuine unsupported package assumption. |

## Focused tests and isolation evidence

`tests/contextFirstIntentPrototype.test.cjs`: 7/7 pass. It verifies actual overlapping context calls, Intent waiting for both completed memos, raw input and recent conversation propagation to all three agents, context source separation/completeness, no production DB or Business Tool imports, empty provider tool lists, and zero production imports from the prototype.

Production import scan result: `PRODUCTION_IMPORTS_FROM_PROTOTYPE = 0`. No production source was edited. No production DB/business facts were accessed. The model client exposes no tools (`tools: []`).

## Required production gates

| Gate | Result |
| --- | --- |
| `npm test` | PASS — 2,109 / 2,109 |
| `npm run verify:api-contract` | PASS — 29 / 29 |
| `npm run test:deep-api` | PASS — 486 / 486; canonical deterministic source, local `pump.db` not used |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:ai-architecture` | PASS — 9 / 9 |
| `npm run verify:ai-assistant-release` | PASS |

## Comparison with M4-2C

M4-2C chained a Business Agent into a semantic JSON-contract Agent and then deterministic fixture-backed Ontology grounding. It used 32 LLM calls across 16 executions and deliberately tested enum/contract completeness and fixture identity binding.

M4-2D fits the current project's knowledge boundaries better as an *intent-understanding experiment*: business meaning and behavioral policy are owned by one knowledge expert; ontology structure and identity semantics by another; both independently receive the original wording and run in parallel; the Intent Agent sees the original wording plus both natural-language memos. This retains the Owner's wording and keeps future formal identity resolution separate from intent clarity. It also avoids turning speculative pre-execution meaning into a rigid action/entity enum.

The first smoke does not justify production adoption. Rich context reduced missing-domain-knowledge risk but encouraged the Ontology Agent to over-extract unrelated facts and infer unsupported mappings. The evaluator also needs stronger semantic review before its labels can serve as an acceptance gate. The Published Policy snapshot version remains unverified in this workspace.

## Production changes and decision

Prototype files are confined to `scripts/ai-experiments/context-first-intent/`, its focused test, and this report. The M4-2C historical experiment is unchanged. No Runtime, Judge, Main Agent, Capability Broker, production Ontology, Published Domain Policy, Business API, `costEngine`, schema, migration, route, or deployment configuration was changed. Nothing was deployed.

**Decision:** REWORK before any further prototype iteration or production consideration. Preserve this first smoke as the result; do not repair its prompts/cases or rerun it. Supervisor review is required for the ontology overreach, persistence variation, evaluator limitations, and missing confirmation of the current Published Policy version.
