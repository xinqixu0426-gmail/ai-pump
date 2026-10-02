# M4-3A-R6 — Resolved Reference Rewrite + Working Utterance Handoff

## Outcome

**REWORK.** The first frozen R6 focused smoke made real DeepSeek
`deepseek-chat` calls and completed 25 cases: **19 PASS / 6 FAIL**. Because
the focused acceptance is not 25/25, the frozen full smoke was not run.

R6 is prototype-only. It does not alter the production runtime, Business API,
Ontology contract, database schema, planner, tool router, or write path.

## R5 root cause

R5 correctly recovered a linguistic antecedent such as:

```text
刚才那个线圈 → 12-120
```

but still supplied both the raw reference surface and the resolved expression
to the Role Classifier. The old surface could then become a second false formal
target. This was a Reference-to-Role handoff/data-flow defect, not a formal
resolver defect.

## Working Utterance contract

R6 adds the deterministic `buildGroundingWorkingUtterance()` helper.

For a resolved reference, it replaces exactly one detected reference surface
with the resolved Owner-language expression, preserving every other raw token:

```text
raw:       刚才那个线圈多少钱？
surface:   刚才那个线圈
resolved:  12-120
working:   12-120多少钱？
```

The persisted rewrite provenance records `applied`, `sourceSurface`,
`replacement`, raw input, working utterance, and
`RESOLVED_OWNER_LANGUAGE_REFERENCE`. The replacement remains a language
expression, never a canonical or verified identity.

`UNRESOLVED` references still stop before Role and resolver calls. A missing or
non-unique exact surface fails closed as `REFERENCE_REWRITE_MISMATCH` or
`MULTI_REFERENCE_NOT_SUPPORTED`.

## Role handoff and provenance guard

The Role Classifier now receives only:

```text
Grounding Working Utterance + Business Memo + Policy Memo
```

It receives no raw reference metadata. The Role semantics themselves are
unchanged.

Each accepted formal target carries deterministic provenance:

```text
source: ROLE_CLASSIFIER
sourceExpression: <role expression>
workingUtterance: <current working text>
```

An expression absent from the working utterance is recorded as
`OUT_OF_WORKING_UTTERANCE_INFERENCE` and is filtered before resolver fan-out.
Thus an old reference surface cannot reach the resolver even if a model emits
it. The evaluator treats that output as a model failure; filtering is not a
silent acceptance.

## Focused smoke

The authorized DeepSeek execution used only frozen test prompts and derived
Business/Policy Memo plus controlled Reference Hint context. The resolver path
is the existing read-only `api/ontology/agentResolver.cjs` exercised through
the experiment's isolated formal-entity lookup fixture. No production database
was queried or mutated.

| Group | PASS | FAIL |
| --- | ---: | ---: |
| Targeted (T-01…T-10) | 9 | 1 |
| Reference focused (R-REF-01…05) | 3 | 2 |
| Role focused (R-ROLE-01…05) | 5 | 0 |
| Working utterance focused (W-01…05) | 2 | 3 |
| **Total** | **19** | **6** |

### T-10: rewrite and guard succeeded; model remained out of context

Reference and rewrite were correct:

```text
REFERENCE_STATUS: RESOLVED
REFERENCE_SURFACE: 刚才那个线圈
RESOLVED_LANGUAGE_REFERENCE: 12-120
WORKING_UTTERANCE: 12-120多少钱？
```

The Role model emitted the correct formal candidate plus a stale hallucinated
reference fragment:

```text
ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE
ROLE: 刚才那个 | FORMAL_ENTITY_CANDIDATE
```

The provenance guard rejected `刚才那个`; only `12-120` reached the resolver.
The evaluator correctly records `OUT_OF_WORKING_UTTERANCE_INFERENCE` and
`FORMAL_TARGET_PROVENANCE_FAIL`. Classification: `ROLE_OUT_OF_CONTEXT_HALLUCINATION`.

### R-REF-01: stale non-target fragment

The resolver and rewrite succeeded, and `12-120` alone entered fan-out. The
model nevertheless emitted `线圈 | CONCEPT_ONLY`, which is not present in the
working utterance. The evaluator recorded
`OUT_OF_WORKING_UTTERANCE_INFERENCE`. Classification:
`ROLE_OUT_OF_CONTEXT_HALLUCINATION`.

### R-REF-05 and W-04: template reference not recovered

With the correct narrow hint:

```text
通用款模板：模板相关业务表达
```

the Reference Resolver returned `UNRESOLVED` for `这个有哪些固定件？`. Early
stop then correctly prevented Role and resolver calls. Classification:
`REFERENCE_MODEL_SEMANTIC_LIMIT`.

### W-01: inconsistent coil reference recovery

The same prior expression `12-120` received the generic hint
`12-120：业务相关表达` in this run and Reference returned `UNRESOLVED`; T-10
and W-05 demonstrate that the successful path still works. Classification:
`REFERENCE_HINT_GENERATION_BUG` plus reference-model instability.

### W-02: strict provenance caught an altered expression

Working text was `V750通用款现在成本多少？`, but the Role model emitted
`V750-通用款` and the stale `它` as formal candidates. Both are absent from the
working utterance and were filtered before fan-out. Classification:
`ROLE_OUT_OF_CONTEXT_HALLUCINATION`.

## Structural tests and invariants

`node --test tests/groundingLayerPrototype.test.cjs`: **20 / 20 PASS**.

Coverage includes exact rewrite, no-reference passthrough, unresolved early
stop, mismatch fail-closed behavior, rewrite provenance, old-target filtering,
formal-target provenance, frozen upstream agents, no Intent, no new LLM agent,
and no production import.

## Performance

| Metric | Median |
| --- | ---: |
| Business | 3068.78 ms |
| Policy | 1906.37 ms |
| Reference Hint | 0.03 ms |
| Reference Model | 737.21 ms |
| Reference Rewrite | 0.01 ms |
| Role | 826.56 ms |
| Resolver fan-out | 0.25 ms |
| Total | 4170.21 ms |

Model calls: 81. Resolver calls: 56. Intent and Utterance calls: zero.

## Recommendation

Do not enter Planner or production integration. R6 fixed the mechanical
handoff and ensured the old reference surface cannot enter formal fan-out, but
the isolated model still emits out-of-working-context spans and Reference
recovery is not stable for template and one repeated coil case. R6 is frozen as
REWORK; no prompt, smoke case, oracle, resolver, or Business/Policy source was
changed after the first real smoke.
