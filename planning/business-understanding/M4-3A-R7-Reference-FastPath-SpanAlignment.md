# M4-3A-R7 — Reference Fast Path + Span Alignment

## Result

Status: **REWORK**. The first frozen real focused smoke completed with 24/25 PASS. Per the R7 acceptance rule, the full frozen smoke was not run: it requires a 25/25 focused result first.

The only confirmed semantic failure is `R-ROLE-04` (`V750是什么？`): the Role model returned `V750 | FORMAL_ENTITY_CANDIDATE`, causing a resolver fan-out. The frozen oracle requires `V750 | CONCEPT_ONLY` and `STOP_CONCEPT_ONLY`. This is a `ROLE_CLASSIFIER_SEMANTIC_FAILURE`; it is not a fast-path, rewrite, alignment, gate, or resolver failure.

## R6 Failure Breakdown

R6 had three separate failure classes:

- unstable resolution of obvious, unique recent-owner references;
- harmless Role output that repeated a pre-rewrite reference surface, despite the provenance guard preventing resolver execution;
- pure surface differences such as `V750-通用款` versus `V750通用款` being rejected by exact substring matching.

R7 addresses the first two deterministically and accepts only safely filtered dirty output as a warning. It does not relax execution safety.

## Architecture

`Business + Policy + Reference Fast Path + Reference LLM Fallback + Working Utterance + Minimal Role + Span Alignment + Deterministic Gate + Resolver Fan-out`

Business and Policy remain independent, frozen upstream calls. The Intent/Utterance layer remains absent. No production runtime imports this prototype.

## Frozen Upstream Proof

| Artifact | SHA-256 before / after |
| --- | --- |
| Business prompt | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` |
| Policy prompt | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` |

Both source files are unchanged in this stage. Role prompt semantics are also unchanged; R7 only changes deterministic handoff, post-processing, and evaluation acceptance.

## Deterministic Reference Fast Path

`resolveReferenceFastPath()` consumes only the current owner input, detected reference surface, bounded recent raw owner wording, and narrow category-only reference hints.

- A single generic recent candidate resolves safely.
- A typed reference resolves only when exactly one candidate has a compatible narrow business category.
- No recent candidate, incompatible category, or more than one compatible candidate safely returns unresolved.
- Only `DEFER_TO_LLM` would call the existing Reference Resolver; no new LLM agent was introduced.

The real 25-case run used 9 safe resolutions and 4 safe unresolved results, avoiding 13 Reference LLM calls. It made 0 Reference LLM calls.

## Conservative Span Alignment

`alignRoleExpressionToWorkingUtterance()` permits only NFKC, whitespace normalization, joiner normalization (`-`, `－`, `–`, `—`), and ASCII case normalization. It requires one normalized match and maps the resolver mention back to the original working-utterance span.

It does not use fuzzy matching, embeddings, synonyms, reordered characters, or model correction. Zero or multiple normalized matches fail closed and cannot enter the resolver.

## Warning Acceptance Contract

An extra Role expression outside the working utterance is a warning only when it is filtered before the resolver, the expected formal target remains present, the gate is correct, and the final formal result is correct. The run records 14 `ROLE_OUT_OF_WORKING_UTTERANCE_WARNING` entries and filtered two formal-role expressions (`刚才那个` twice). Filtered expressions reached the resolver zero times.

## Real Focused Smoke

Evidence: [M4-3A-R7-Focused-Smoke.json](M4-3A-R7-Focused-Smoke.json)

| Group | PASS | FAIL |
| --- | ---: | ---: |
| Targeted | 10 | 0 |
| Reference focused | 5 | 0 |
| Role focused | 4 | 1 |
| Working utterance focused | 5 | 0 |
| Total | 24 | 1 |

Key successful R7 checks:

- `T-10`: fast path resolved `刚才那个线圈 → 12-120`; working utterance was `12-120多少钱？`; only `12-120` reached the resolver and formally resolved as `COIL / MULTIPLE`.
- `R-REF-05`: fast path resolved `这个 → 通用款模板`; working utterance was `通用款模板有哪些固定件？`; resolver result was `TEMPLATE / EXACT`.
- `W-02`: working utterance `V750通用款现在成本多少？` yielded resolver target `V750通用款` and `RECIPE / EXACT`. The alignment helper separately proves `V750-通用款` maps safely to that original span.

Raw Business, Policy, Reference, Role, rewrite provenance, resolver fan-out evidence, and evaluator warnings are preserved in the JSON artifact. The smoke made 71 model calls and 76 read-only resolver calls. It performed no write, planner, tool-planning, or final-fact retrieval operation.

## Deterministic Additions

Evidence: [M4-3A-R7-Deterministic-Reference-Span-Tests.json](M4-3A-R7-Deterministic-Reference-Span-Tests.json)

All 9/9 deterministic tests passed:

- `RF-N01` multiple compatible coil candidates → safe unresolved;
- `RF-N02` multiple generic recipe candidates → safe unresolved;
- `RF-N03` recipe candidate for typed coil reference → safe unresolved;
- `RF-N04` no recent owner candidate → safe unresolved;
- `SA-01..03` unique separator/whitespace-compatible span alignment;
- `SA-04` no fuzzy cross-style alignment;
- `SA-05` repeated normalized span → ambiguous and fail closed.

The prototype test file also passes 22/22 focused structural tests, including early-stop, provenance, no Intent calls, upstream freeze, and no production import checks.

## Full Frozen Smoke

Not created and not run. The R7 protocol requires 25/25 real focused PASS before `G-01..G-16`, `N-01..N-05`, and frozen repeats may execute.

## Performance

| Metric | Median ms |
| --- | ---: |
| Business | 2962.196 |
| Policy | 1922.831 |
| Reference fast path | 0.014 |
| Reference LLM | 0 |
| Rewrite | 0.008 |
| Role | 950.701 |
| Span alignment | 0.053 |
| Resolver fan-out | 0.349 |
| Total | 3808.904 |

## Remaining Failure and Recommendation

`R-ROLE-04` is an actual concept-versus-formal-fact role classification error. R7 forbids Role Prompt modification, and this report does not add a case-specific rule. Return this result to the Supervisor as `REWORK`; decide separately whether the Role contract should remove concept classification, switch the role model, or revise the frozen architecture. Do not treat a retry as acceptance evidence.
