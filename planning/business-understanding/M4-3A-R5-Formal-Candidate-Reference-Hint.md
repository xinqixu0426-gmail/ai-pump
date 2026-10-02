# M4-3A-R5 — Formal-Candidate Semantics + Narrow Business Reference Hint

## Outcome

**REWORK.** The first frozen R5 focused smoke completed with real DeepSeek
`deepseek-chat` calls: 18 of 20 cases passed. The two failures share one
confirmed Role Classifier defect on an already resolved linguistic reference;
therefore the frozen full smoke was not run.

This is a prototype-only change. It does not import into the product runtime,
does not call a planner or tool, and does not write to the database.

## R4 root cause and R5 correction

R4 conflated a common designation that was not already a unique identity with
an expression that should not be grounded. R5 changes the Minimal Role
Classifier contract:

> `FORMAL_ENTITY_CANDIDATE` means an Owner expression that must enter the
> formal resolver to complete the current request. It does not mean the
> expression is already unique, canonical, or formally bound.

Consequently, `12-120` is `CONCEPT_ONLY` when the Owner asks what it means,
but is a `FORMAL_ENTITY_CANDIDATE` when the Owner asks for its price or the
number of formal schemes. The authoritative resolver—not the model—then
returns `EXACT`, `MULTIPLE`, or `UNRESOLVED`.

## Narrow Business Reference Hint

Reference resolution now receives a controlled category compression of recent
Owner wording made from the frozen Business Memo. Example:

```text
12-120：线圈/线圈方案相关业务表达
```

The hint is used only for linguistic type compatibility. It contains no formal
ID, candidate count, formal fact, cost, inventory, resolver output, policy
conclusion, or full Business Memo. It lets a linguistic reference such as
`刚才那个线圈` recover the previous Owner expression `12-120` without claiming
that `12-120` is a unique Coil Scheme.

Language-reference ambiguity and formal-identity ambiguity remain separate:

```text
刚才那个线圈 → 12-120            (language reference: RESOLVED)
12-120 → two Coil Scheme records (formal identity: MULTIPLE)
```

## Architecture and invariants

```text
Business Agent (frozen) ─┐
Policy Agent (frozen) ───┼─> Reference Detection → optional Reference Resolver
Raw Owner Input ─────────┘                                │
                                                    UNRESOLVED → early stop
                                                         RESOLVED/NONE
                                                               ↓
                                                     Minimal Role Classifier
                                                               ↓
                                                     Deterministic Gate
                                                               ↓
                                           read-only resolver fan-out: recipe,
                                                   coil, template, part
```

- `UNRESOLVED` reference stops before Role and resolver calls.
- Only `FORMAL_ENTITY_CANDIDATE` reaches fan-out.
- `CONFIG_VALUE` and `CONCEPT_ONLY` never reach fan-out.
- Entity type and formal status are derived from resolver evidence, never from
  an LLM label.
- Intent and Utterance calls are both zero.

## Frozen upstream proof

| Input | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| Business Agent prompt | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` |
| Policy Agent prompt | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` |

No Business Agent, Policy Agent, Company Business Model, or Domain Policy file
was changed.

## First frozen focused smoke

The authorized run sent only frozen test inputs plus derived Business/Policy
Memo and controlled Reference Hint context to DeepSeek. It used the existing
read-only `api/ontology/agentResolver.cjs` through the experiment's isolated
formal-entity lookup fixture; no production database was queried or mutated.

| Group | Result |
| --- | --- |
| Targeted T-01…T-09 | 9 / 9 PASS |
| Targeted T-10 | FAIL |
| Reference R-REF-01 | FAIL |
| Reference R-REF-02…R-REF-05 | 4 / 4 PASS |
| Role R-ROLE-01…R-ROLE-05 | 5 / 5 PASS |
| Total | **18 / 20 PASS** |

The machine-readable raw outputs and resolver evidence are in
`M4-3A-R5-Targeted-Smoke.json`.

### Confirmed failure: T-10

Current Owner input: `刚才那个线圈多少钱？`

Recent Owner wording: `我先看看12-120。`

The hint was correct and narrow:

```text
12-120：线圈/线圈方案相关业务表达
```

The Reference Resolver correctly returned:

```text
REFERENCE_STATUS: RESOLVED
REFERENCE_SURFACE: 刚才那个线圈
RESOLVED_LANGUAGE_REFERENCE: 12-120
```

But the Role Classifier returned:

```text
ROLE: 刚才那个线圈 | FORMAL_ENTITY_CANDIDATE
```

It should have classified the supplied resolved language reference `12-120`.
The formal fan-out therefore looked up `刚才那个线圈`, received `NOT_FOUND` for
all supported types, and correctly returned `UNRESOLVED`. This is a
`ROLE_CLASSIFICATION_FAILURE`, not a reference, gate, or resolver failure.

### Confirmed failure: R-REF-01

The Reference Resolver again correctly recovered `12-120`. The Role Classifier
emitted both an unsupported current-reference surface and the correct resolved
expression:

```text
ROLE: 那个线圈 | FORMAL_ENTITY_CANDIDATE
ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE
```

The deterministic gate correctly fanned out both model-labelled formal targets.
The extra `那个线圈` lookup violates the formal-target contract and produced
eight resolver calls rather than four. This is the same
`ROLE_CLASSIFICATION_FAILURE`: a current reference surface was promoted after
reference resolution.

No prompt, case, evaluator oracle, or resolver behavior was modified after the
first smoke result. Full frozen smoke was intentionally not created or run.

## Structural verification

`node --test tests/groundingLayerPrototype.test.cjs`: **16 / 16 PASS**.

The test set covers formal-candidate semantics, controlled hint content,
resolved language references, unresolved-reference early stop, config/concept
exclusion, resolver-derived type/status, multi-target preservation, frozen
Business/Policy agents, zero Intent calls, and no production prototype import.

## Performance and call counts

| Metric | Value |
| --- | ---: |
| DeepSeek model calls | 64 |
| Resolver calls | 56 |
| Business median | 2859.10 ms |
| Policy median | 2065.57 ms |
| Role median | 968.75 ms |
| Total median | 3825.34 ms |

Reference-hint and reference medians round to zero in the all-case aggregate
because most focused cases have no reference; individual reference-case timings
are retained in the evidence JSON.

## Recommendation

Do not enter Planner or production integration. R5 proved the corrected
common-designation semantics (T-07/T-08 and both role-focused formal-fact cases
passed) and the narrow hint recovered the intended linguistic antecedent. The
remaining failure is narrower: after a reference has resolved, the Role
Classifier must operate only on the resolved language expression, never on the
current reference surface. This requires Supervisor direction for a new stage;
R5 itself is frozen as REWORK.
