# M4-3B — Front Understanding + Grounding V1 Frozen Baseline

## Status

```text
STATUS: FROZEN
FRONT_UNDERSTANDING_V1: FROZEN
GROUNDING_V1: FROZEN
PLANNER_READY: YES

Frozen source baseline: 105e63507fab32fa84f3aea3d789b91b7a5f9fc9
Branch: ai-native/m3-optimization-v1
Production deployed: NO
```

This is a governance and baseline-freeze record. It does not change production runtime behavior, Business Understanding behavior, Domain Policy behavior, Grounding behavior, ontology, resolver semantics, or any write path.

## Frozen Architecture

```text
Raw Owner Input
    |
    +--> Business Understanding Agent
    |
    +--> Domain Policy Agent
    |
    v
Reference Detection / Fast Path / bounded fallback
    |
    v
Working Utterance
    |
    v
Concept Fast Path
    |
    v
Minimal Role Proposal
    |
    v
Contradiction Check
    |
    +--> bounded Role retry, maximum two total attempts
    |
    v
Span / Provenance Guard
    |
    v
Resolver Probe
    |
    v
Qualifier Refinement
    |
    v
Final Grounded Targets
```

`INTENT_LAYER = REMOVED` and `UTTERANCE_EXTRACTOR = REMOVED`. There is no Intent JSON, semantic frame, change classifier, clarification classifier, or utterance intermediary in this frozen chain. Future work must not reintroduce one unless the Supervisor explicitly redesigns and unfreezes this contract.

## Business Understanding V1

Business Understanding answers: “What do the Owner's business expressions mean in this company?” It can explain concepts and relationships including Template, Recipe, BOM, Part, Coil / Coil Scheme, the `12-120` common designation, V-series models / power / styles, and configurable cost or process descriptions.

It is not a formal-ID source, current-cost source, inventory source, database-fact source, or formal-record source.

```text
BUSINESS_UNDERSTANDING_V1: FROZEN
Business Prompt SHA-256: d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba
```

## Domain Policy V1

Domain Policy answers: “How do company rules require this request to be handled?” Its frozen responsibilities include preserving ambiguity, prohibiting silent first-candidate selection, respecting read / preview / persist boundaries, requiring explicit write authorization, and protecting write paths.

It is not a formal-identity source or database-fact source.

```text
DOMAIN_POLICY_LAYER: FROZEN
Policy Prompt SHA-256: 36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038
```

## Grounding V1 Responsibilities

Grounding V1 safely maps Owner language to formal business identity. Its frozen responsibilities are:

1. Reference Detection.
2. Reference Fast Path.
3. Bounded Reference fallback.
4. Working Utterance rewrite.
5. Concept Fast Path.
6. Minimal Role Proposal.
7. Contradiction detection.
8. Bounded Role retry.
9. Conservative span / provenance validation.
10. Formal Resolver Probe.
11. Qualifier refinement.
12. Final Grounded Targets.

Grounding does not answer the final business question, calculate cost, read inventory, plan Tools or APIs, determine execution order, execute mutations, perform writes, or produce clarification wording.

### Reference Contract

The Reference Layer only resolves Owner-language antecedents such as `这个`, `那个`, `它`, and `刚才那个`. It is not formal identity resolution.

For example, `刚才那个线圈 → 12-120` means only that the language antecedent is `12-120`; the formal resolver must still determine whether `12-120` is `EXACT`, `MULTIPLE`, or `UNRESOLVED`.

Frozen safety rules:

- A unique, safe antecedent may resolve.
- Multiple compatible antecedents remain unresolved.
- An incompatible antecedent remains unresolved.
- An unresolved reference makes Role calls `0`.
- An unresolved reference makes Resolver calls `0`.

### Working Utterance

A resolved reference may be rewritten only by deterministic exact-span replacement. For example, `刚才那个线圈多少钱？` becomes `12-120多少钱？`.

This is language canonicalization, not a formal-ID binding. The replacement remains an Owner-language expression until resolver evidence is obtained.

### Concept Fast Path

High-confidence business-definition questions may stop as `STOP_CONCEPT_ONLY`, for example:

- `V750是什么？`
- `12-120是什么意思？`
- `模板和配方有什么区别？`
- `木箱和纸箱在系统里分别算什么？`

Formal-fact requests must not be intercepted, including requests for price, cost, inventory, current configuration, scheme count, current coil, or fixed-part lists.

### Role Proposal Contract

The Minimal Role LLM emits only:

- `FORMAL_ENTITY_CANDIDATE`
- `CONFIG_VALUE`
- `CONCEPT_ONLY`

Its output is a proposal, not a formal identity or final grounded target. A `FORMAL_ENTITY_CANDIDATE` means the expression is worth formally validating for the current request; it does not imply uniqueness, canonical form, exact identity, or an LLM-determined entity type.

### Bounded Role Retry

Role retry is a reliability safeguard, not a normal path. It may run only for the frozen contradiction condition and permits at most two total Role attempts. There is no third attempt and no retry-until-pass behavior. If the second attempt cannot provide a safe usable proposal, Grounding fails closed.

### Span and Provenance Guard

A formal resolver target must come from an actual Owner-language span in the Working Utterance. The only permitted alignment normalization is Unicode normalization, whitespace, dash / connector variants, and Latin case.

Semantic fuzzy matching, embeddings, pinyin matching, edit-distance auto-binding, and LLM canonicalization are prohibited.

### Resolver Contract

Entity type comes solely from authoritative resolver evidence. Frozen fan-out types are:

- `recipe`
- `coil`
- `template`
- `part`

Allowed formal outcomes are `EXACT`, `MULTIPLE`, `MULTIPLE_TYPE`, and `UNRESOLVED`. First-result wins, first-type wins, silent fuzzy binding, and model-invented formal IDs are prohibited.

### Proposal Validation and Qualifier Refinement

After a Resolver Probe, a supported proposal may become a Final Grounded Target. An unresolved / not-found proposal is a warning only and must never become a final target.

An explicit Owner qualifier may refine only an already supported `MULTIPLE` base target. The qualifier must be an Owner-language span and must uniquely, conservatively match a formal resolver candidate name. Qualifiers cannot create entities, and ambiguous qualifier matches cannot auto-select a candidate.

### Final Grounding Contract

Every Final Grounded Target has authoritative formal resolver evidence. Grounding preserves ambiguity rather than selecting silently and ends before fact retrieval, Planner work, Tool/API planning, mutation workflow, or writes.

## Frozen Safety Invariants

1. Unresolved reference implies no Role call.
2. Unresolved reference implies no Resolver call.
3. Concept Fast Path hit implies no Resolver call.
4. `CONFIG_VALUE` cannot become a final formal entity.
5. `CONCEPT_ONLY` cannot become a final formal entity.
6. Only resolver-supported proposals can become Final Grounded Targets.
7. An unresolved proposal cannot become a final target.
8. Multiple candidates remain multiple unless safe explicit qualifier refinement succeeds.
9. Multi-type ambiguity is preserved.
10. No first-result binding.
11. No silent fuzzy binding.
12. No model-invented formal ID.
13. No formal-fact hallucination.
14. No Planner reasoning in Grounding.
15. No Tool/API planning in Grounding.
16. No write.
17. Intent calls remain zero.
18. Total Role attempts are at most two.

## Acceptance Evidence

The frozen source baseline is evidenced by M4-3A-R10:

```text
Reliability closure: PASS
G-07 reliability: 5 / 5 final PASS
Full Frozen Smoke: 31 / 31 PASS
Base cases: 21 / 21 PASS
Deterministic Role Retry Tests: 9 / 9 PASS
Business Agent failures: 0
Policy Agent failures: 0
Reference execution failures: 0
Concept false positives: 0
Final target failures: 0
Unresolved proposals accepted as target: 0
Qualifier wrong bindings: 0
Multi-target failures: 0
Qualifier losses: 0
Silent first-result bindings: 0
Model invented formal IDs: 0
Formal fact hallucinations: 0
Planner leaks: 0
Write attempts: 0
Full repository gates: PASS
```

Authoritative R10 artifacts:

- `planning/business-understanding/M4-3A-R10-Bounded-Role-Retry.md`
- `planning/business-understanding/M4-3A-R10-Reliability-Smoke.json`
- `planning/business-understanding/M4-3A-R10-Role-Retry-Tests.json`
- `planning/business-understanding/M4-3A-R10-Full-Smoke.json`

## Planner Upstream Freeze Rule

Planner development must consume this frozen upstream contract. A Planner failure must not automatically trigger changes to the Business Model, Business Agent, Domain Policy, Policy Agent, Reference semantics, Concept Fast Path, Role base semantics, resolver semantics, qualifier semantics, or any Grounding safety invariant.

If Planner development identifies a genuine upstream deficiency, it must:

1. Preserve the failure evidence.
2. Mark `UPSTREAM_CONTRACT_GAP`.
3. Stop automatic modification of the frozen layer.
4. Return the evidence to the ChatGPT Supervisor for review.
5. Modify the frozen layer only after explicit Supervisor approval to unfreeze it.

## Freeze Marker and Scope

```text
FRONT_UNDERSTANDING_V1 = FROZEN
GROUNDING_V1 = FROZEN
PLANNER_READY = YES
PRODUCT_RUNTIME_CHANGED = NO
```

The project has no separate established frozen-marker framework requiring additional executable protection. This document and its commit are the baseline marker. This phase introduces no Planner implementation and no deployment.

Because this commit changes planning documentation only and preserves the R10 executable baseline unchanged, full gates are reused from R10. M4-3B independently reruns the architecture and AI-assistant release validation gates.
