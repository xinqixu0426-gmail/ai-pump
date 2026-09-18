# V5-E4R-E-A Entity-First Interpreter Architecture Audit

## 1. Executive Result

P15R-E-A is **PASS** as a read-only architecture audit. The frozen 15-path B2 result contains six semantic errors, and every one is simultaneously wrong on entity type and operation. Three configured models reproduced the same `9/15` Task Class and capability ceiling while Protocol validity, Source Span selection, exact anchoring, Exact Entity, and downstream routing controls remained stable. The evidence therefore confirms the globally flat 27-way Task Class selection as the architectural root cause: `FLAT_TASK_CLASS_ARCHITECTURE_ROOT_CAUSE=CONFIRMED`.

The recommended target is `TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT`: model call 1 selects source refs only; a read-only authoritative resolver establishes canonical identity and entity type; model call 2 selects from an entity-local intent set; the existing deterministic Capability Router and bounded Tool Exposure remain authoritative. The global 27-way model selection is removed.

This is a design recommendation, not an implementation claim. The current V5 resolver adapter requires both an entity-type hint and an externally supplied formal result and cannot perform type-independent resolution. That missing read-only authority boundary is a mandatory P15R-E-B prerequisite. No model, Tool, Business API, resolver, production runtime, or database operation was executed in this audit.

## 2. Frozen Evidence

- Frozen B2 paths audited: `15/15`, five source groups, four input fingerprints.
- Frozen B2 semantic result: Task Class, operation, entity type, capability, and expected Tool exposure `9/15`.
- Stable controls: Protocol `15/15`, Source Span `15/15`, exact anchor `15/15`, Exact Entity `3/3`, R02 wrong Tool exclusion `3/3`, same-input consistency `100%`.
- Model bake-off: `deepseek-v4-flash`, `deepseek-v4-pro`, and `deepseek-v4-flash-vision-exp` all remained at Task Class/capability `9/15`; model root cause was rejected.
- No frozen evaluation was rerun. All case reconstruction came from existing safe datasets and reports.

## 3. Failure-Dimension Analysis

The audit reconstructed expected and actual Task Class, domain, operation, entity type, Source Span/anchor result, and capability for all 15 paths without persisting request or entity text.

| Failure dimension | Paths |
| --- | ---: |
| `ENTITY_DIMENSION_WRONG` | 0 |
| `OPERATION_DIMENSION_WRONG` | 0 |
| `BOTH_WRONG` | 6 |
| `TASK_CLASS_ONLY_MAPPING_WRONG` | 0 |

The three coil-read paths expected `tc_004` (`coil/read/coil`) but selected `tc_002` (`catalog/read_inventory/part`). The three 800平刀 paths expected `tc_002` but selected `tc_003` (`coil/cost/coil`). Both families selected correct exact source spans and passed the unchanged anchor. The first divergence is therefore the coupled class decision, not identity transcription or downstream mapping.

## 4. Flat Task-Class Coupling

The 27 read-exposable classes factor into 12 domains, 18 operations, and 16 entity types. Nine classes share the generic `read` operation; several entity types have multiple local operations, including coil (`cost`, `read`), recipe (four classes), order (four classes plus a purchase class), quotation (three classes), and file (two domains).

The model must currently solve entity recognition, operation recognition, and a cross-product lookup in one opaque `classRef`. Both observed error families changed entity and operation together, and substituting two other configured models did not change the ceiling. `FLAT_CLASS_COUPLING=YES`.

## 5. Existing Entity Resolver Architecture

`api/services/ai-v5/entityResolverAdapter.cjs` accepts a validated V5 identity with an exact `rawMention` and projects an existing V3 formal result into V5 identity semantics. Supported types are customer, order, recipe, part, coil, and template.

The production V3 path is later in the lifecycle: `resolveAiToolTargetV3` receives an already selected `toolName`, obtains entity type from `TOOL_TARGETS`, and performs typed discovery through `executeToolCall`. Thus current V4 resolution depends on the selected Tool/capability boundary and cannot serve as an independent pre-routing entity authority without a new, explicitly governed read-only boundary.

## 6. Resolver Independence

The V5 adapter can consume an exact raw mention, but it also requires:

1. an entity-type hint before resolution; and
2. `options.formalResult`, produced elsewhere.

It does not search across entity types. Therefore:

- independent exact-mention consumption: YES;
- independent end-to-end resolution from raw mention alone: PARTIAL/NO;
- type-independent resolution: NO;
- circular dependency: present (`entityType` is needed to select the resolver, while entity-first wants authoritative resolution to establish `entityType`).

## 7. Resolver Authority / Side Effects

The adapter is read-only and never queries or writes business data. It uses neither `internalApiClient` nor direct DB reads and makes no Business API call. Its `formalResult` must already exist.

The V3 formal-result reducer is also pure once rows are supplied. In contrast, the production V3 discovery path calls typed discovery capabilities through Tool execution. A future entity-first implementation must not silently treat the current adapter as an end-to-end resolver: acquiring authoritative rows would require an approved read source, probably a governed business read/API boundary, and would change the current `V5 Business API Calls=0` invariant unless the supervisor explicitly authorizes it.

## 8. Frozen Resolver Evidence

Only one of the five frozen source groups has usable resolver evidence in the P06 structural artifacts: Exact Recipe Cost (`recipe`, exact matches). Coil, 800平刀, and the two part-inventory groups contain only `unknown/not_applicable` resolution observations. Frozen evidence therefore cannot prove that a new cross-type resolver will correctly type all five groups; it only supports the architecture simulation using frozen authoritative expected entity types.

## 9. Entity-Filtered Candidate Reduction

Using frozen authoritative expected entity types strictly as an architecture simulation:

| Source group | Entity type | Global | Entity-filtered | Safe class refs | Expected survives |
| --- | --- | ---: | ---: | --- | --- |
| Coil inventory | coil | 27 | 2 | `tc_003`, `tc_004` | YES |
| Exact recipe cost | recipe | 27 | 4 | `tc_017`, `tc_024`, `tc_025`, `tc_026` | YES |
| 800平刀 | part | 27 | 1 | `tc_002` | YES |
| Part inventory primary | part | 27 | 1 | `tc_002` | YES |
| Part inventory repeat | part | 27 | 1 | `tc_002` | YES |

Median candidate count falls from 27 to `1`; maximum is `4`. The expected class survives `15/15` paths. This is a simulation of factorization benefit, not evidence that the current resolver can already produce those entity types.

## 10. Coil Read Analysis

With authoritative `entityType=coil`, only `tc_003` (cost) and `tc_004` (read) remain; expected `tc_004` survives. Entity authority removes the erroneous part/inventory class seen in B2, but still leaves a two-way local intent decision. Accordingly the three current coil failures are `MAY_PREVENT`, not claimed as guaranteed prevention.

## 11. 800平刀 Analysis

The frozen authoritative entity type is `part`. Filtering leaves only `tc_002`, so the expected class survives and the incorrect coil/cost class is structurally impossible. All three current 800平刀 semantic failures are `WOULD_PREVENT`, conditional on correct authoritative entity resolution.

## 12. Option A — Pre-resolve Spans

`A_PRE_RESOLVE_SPANS=HIGH_COST`. The Source Span Catalog permits 128 spans and the V5 adapter has six typed policies. A naive cross-product is up to `128 × 6 = 768` typed resolution attempts per request, before accounting for acquisition of formal result sets. This is bounded but operationally disproportionate and is not supported by measured latency or API cost evidence. It is not recommended.

## 13. Option B — Two-stage Span → Entity → Local Intent

`B_TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT=PARTIAL` today and is the recommended target architecture.

- Model calls: 2 per request.
- Intended resolver calls: 1 per selected entity span.
- Current achievable resolver calls: not available as one call because the adapter needs a prior type and external formal result.
- Stage 1 evidence: strong; frozen Source Span selection and exact anchor are `15/15`.
- Stage 2 candidate space: median 1, maximum 4 in the frozen groups.
- Global 27-way selection: removed.

Future Stage 1 output should contain only source-span refs and clarification status. Resolution must map the selected exact source substring to a canonical entity and authoritative type or return not-found/ambiguous; it must never let the model guess. Stage 2 should expose only local refs compatible with the authoritative type and retain one model call for local intent.

## 14. Option C — Span + Global Operation

`C_SINGLE_CALL_SPAN_OPERATION=NOT_SUPPORTED`. The global operation set has 18 values, only modestly smaller than 27 classes. Frozen projected operation accuracy is already `9/15`, and a span plus free global operation still lacks authoritative entity type. It does not remove the demonstrated coupled semantic failure.

## 15. Option D — Entity-first Local Operation

`D_ENTITY_FIRST_LOCAL_OPERATION=PARTIAL`. Once authoritative entity type exists, this is the local-intent half of Option B and yields the same strong candidate reduction. It is not independently implementable with the current pre-model surfaces because there is no type-independent resolver or safe pre-routing entity authority for four of five frozen groups.

Deterministic intent from existing structural context alone is `NOT_FEASIBLE`: the relevant frozen requests do not carry an authoritative pre-routing operation field, and keyword/regex inference from raw text is forbidden.

## 16. Multi-Entity / Compound Requests

Contract V1 permits up to eight entity candidates, so preservation of multiple source identities is representable. The current Task Class catalog, however, contains one entity slot per class and models one primary domain/operation. Multi-entity compatibility is therefore `PARTIAL`.

Factorization makes compound-request extension `EASIER`: separate exact spans can become separate task nodes with their own resolved entities and local intents, instead of requiring a combinatorial global Task Class. Such task-graph work is outside this phase and would need explicit orchestration policy.

## 17. State Machine Impact

No new state is required for the recommended skeleton. Existing `UNDERSTANDING` can own span selection, `RESOLVING_ENTITY` can own authoritative resolution plus local-intent selection, and `ROUTING` remains the deterministic capability boundary. Distinct reason codes and spans can expose sub-stages. `State Machine Revision Required=NO` for the minimal design; compound task graphs may require a later contract decision.

Resolution failure must fail closed: not found or multiple types/candidates leads to `NEEDS_CLARIFICATION`/`UNRESOLVED` according to existing task semantics. It must not return to global class guessing.

## 18. Observability / Privacy

Recommended future trace shape:

```text
AGENT
├─ LLM span-selection
├─ ENTITY resolve
├─ LLM local-intent
├─ capability-route
└─ controlled-runtime
```

Only refs, counts, statuses, entity type, capability ID, and safe hashes should be exported. Raw request/source-span text remains transient model/resolver input and must not enter traces, logs, datasets, or reports.

## 19. Failure Prevention Simulation

For the six frozen semantic failures:

| Architecture | WOULD_PREVENT | MAY_PREVENT | WOULD_NOT_PREVENT | UNKNOWN |
| --- | ---: | ---: | ---: | ---: |
| Current flat V2 | 0 | 0 | 6 | 0 |
| A: pre-resolve spans | 3 | 3 | 0 | 0 |
| B: two-stage entity/local intent | 3 | 3 | 0 | 0 |
| C: span + global operation | 0 | 0 | 6 | 0 |
| D: entity-first local operation | 3 | 3 | 0 | 0 |

The three 800平刀 paths become deterministic after correct part resolution. The three coil paths shrink to read versus cost and therefore remain “may prevent” until a frozen local-intent evaluation proves correctness.

## 20. Architecture Comparison

| Architecture | Model calls | Resolver calls | Global class selection | Exact identity | Entity authority | Expected reliability | Complexity |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `CURRENT_FLAT_V2` | 1 | 0 | 27-way | PASS | model-selected class | observed 9/15 | Low |
| `A_PRE_RESOLVE_SPANS` | 1 | up to 768 typed attempts | Removed | Preserved | possible if every lookup is authoritative | fanout risk dominates | High |
| `B_TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT` | 2 | 1 intended; current boundary missing | Removed | Preserved | authoritative resolver required | strongest evidence-aligned target | Medium/High |
| `C_SINGLE_CALL_SPAN_OPERATION` | 1 | 1 after call | Removed, but 18 global operations | Preserved | unresolved at decision time | not supported by frozen errors | Medium |
| `D_ENTITY_FIRST_LOCAL_OPERATION` | 1 after entity authority | 1 intended | Removed | Preserved | unavailable before model today | strong only after resolver prerequisite | Medium |

## 21. Root-Cause Decision

`FLAT_TASK_CLASS_ARCHITECTURE_ROOT_CAUSE=CONFIRMED`:

- all six failures occur at flat class selection and couple entity with operation;
- three model identifiers reproduce the same 9/15 ceiling;
- Source Span and exact Source Anchor are stable at 15/15;
- Contract, Capability Router, and Tool Exposure correctly process the selected class;
- authoritative entity filtering reduces 27 candidates to a median of 1 and maximum of 4 while retaining every expected class.

The conclusion is about the entrance architecture, not proof that a production-ready cross-type resolver already exists.

## 22. Recommended Architecture

`Recommended Architecture=TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT`.

The next phase should remove model global 27-way Task Class selection and design a read-only, bounded, authoritative, type-independent resolution boundary between source-span selection and local intent. It must preserve exact source identity, return ambiguity instead of guessing, keep deterministic Capability routing and bounded Tool exposure unchanged, introduce no write authority, and explicitly account for any Business API read and the second model call in capacity/latency gates.

Do not implement Option A fanout, free global operation selection, keyword intent routing, new prompt wording, or another model bake-off.

## 23. P15R-E-B Preconditions

`P15R_E_B_READY=YES` for Supervisor review because the root cause, target architecture, current resolver limitation, model-call count, potential business-read implication, frozen failure mapping, and safety boundary are explicit.

Implementation prerequisites:

1. define an authoritative read-only cross-type resolution source for selected spans;
2. cap resolver work to the selected span(s), not all 128 catalog spans;
3. decide whether governed Business API reads are authorized and count them explicitly;
4. preserve Contract V1 and existing exact Source Anchor unless a separately approved contract review proves otherwise;
5. freeze Stage 1 and local-intent protocols before any real evaluation;
6. retain `V5 Tool Calls=0`, `V5 Writes=0`, and production routing `0` until a later gate.

No production or Interpreter file, dependency, business database, or backup was changed by this audit.
