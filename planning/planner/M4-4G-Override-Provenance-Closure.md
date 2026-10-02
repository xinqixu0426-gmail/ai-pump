# M4-4G — Override Provenance Closure

## Status

STATUS: REWORK

START_HEAD: `738700a9fb90c30732747837a81314ceba85ccc2`

REQUIREMENT_PROMPT_HASH_BEFORE: `4529cb6ac5416c218d5e3b9a18795d39baccac338b6e86d4e6d0e6e2bb99c215`

REQUIREMENT_PROMPT_HASH_AFTER: `b6095c59806498cf394cb149c87afd7ef9bc0e7f0a8454cca01b9605980bd496`

Frozen Business Understanding, Domain Policy, and Grounding V1 were not changed. The deterministic Plan Compiler was not changed, and no production runtime, Executor, tool, API, database, write path, or deployment was used.

## M4-4F single remaining failure

M4-4F observed a P-11 Requirement memo for `V750通用款做电泳成本增加多少？` that classified the scenario correctly but emitted `SCENARIO_OVERRIDE: 增加电泳`. That expression was not a continuous owner-language span, so the existing validator correctly returned `REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING`.

## Strict override provenance

`SCENARIO_OVERRIDE.expression` remains a strict owner-language provenance field. It must be an actual continuous span after the existing mechanical normalization. `做电泳`, `电泳`, `电缆5米`, and `木箱` are valid examples when present in the owner wording. Paraphrases such as `增加电泳`, `改木箱包装`, and `改成5米电缆` remain invalid.

No fuzzy repair, synonym map, embedding, edit distance, pinyin matching, or deterministic rewrite was added. Target provenance remains frozen Grounding evidence; scenario-override provenance remains raw owner wording.

## Provenance retry

The Requirement base prompt now contains one general discipline rule: copy an actual continuous owner-language span for every scenario override. The validator remains authoritative.

When the first Requirement validation contains `REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING`, has at least one override with a valid scenario class, and has no target-provenance violation, the contradiction detector adds `OVERRIDE_PROVENANCE_INVALID`. It merges this with any existing contradiction reasons and makes exactly one retry. Its addendum requests a direct owner span without naming the desired expression, target, capability, or business class.

If retry remains invalid, `requirementRetry.exhaustedReasons` retains `OVERRIDE_PROVENANCE_INVALID`; the Requirement remains invalid and the compiler does not repair or delete the scenario.

## Deterministic evidence

The carried-forward Requirement/reliability/comparison suite plus OP-01 through OP-12 passed **38/38**. The new tests cover valid full and subspans, invalid paraphrases, one bounded retry, exhausted retry, valid-first no retry, and multi-override all-or-nothing provenance.

Evidence: `planning/planner/M4-4G-Override-Provenance-Tests.json`.

## P-11 ten-run reliability

P-11 finished **9/10 PASS**. None of the ten fresh calls emitted the prior provenance-invalid paraphrase, so the new runtime trigger did not fire in this sample. One different model semantic failure occurred on run 5:

```text
GOAL_FACT: CURRENT_COST
GOAL_FACT: COST_DIFFERENCE
GOAL_FACT: RELATION
SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT
SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED
```

The span itself was valid. However, the extra current-cost and relation requirements made the deterministic compiler correctly find no compatible scenario capability for `CURRENT_COST`, returning `BLOCKED_CAPABILITY`. This is not an override-provenance defect, so the approved M4-4G retry policy did not trigger.

Evidence includes each raw memo, validation, retry record, final Requirement, and final plan: `planning/planner/M4-4G-P11-Provenance-Reliability.json`.

## Regression reliability

| Case | Final result |
| --- | --- |
| P-10 FLOAT | 3/3 PASS |
| P-12 ROTOR_PROCESS | 3/3 PASS |
| P-13 MULTI_OVERRIDE | 3/3 PASS |
| N-06 TWO_RECIPE_DIFFERENCE | 3/3 PASS |

P-13 used two scenario-goal retries and both recovered. No override-provenance false positive or false negative occurred.

Evidence: `planning/planner/M4-4G-Regression-Reliability.json`.

## Full corpus

The P-11 prerequisite was not satisfied, so the fresh 26-case full run was intentionally not run. `M4-4G-Full-Smoke.json` records `NOT_RUN`; no stale Requirement output was reused.

## Real capability gaps and compiler stability

The existing capability gaps remain unchanged:

- formal packaging binding for the wood-box scenario;
- `ROTOR_PROCESS` / stainless-shaft scenario preview support.

The Compiler remained unchanged and made zero model calls. The P-11 run-5 `BLOCKED_CAPABILITY` was deterministic behavior driven by the Requirement’s extra fact classes, not a Compiler repair or execution failure.

## Safety

No re-grounding, invented formal IDs, invented capabilities, unsupported override execution, silent multiple selection, write step, tool call, Business API call, DB access, visible write capability, or frozen-upstream change occurred.

## Performance

P-11 and regression evidence record per-attempt timings. Requirement calls remained bounded to two attempts; the deterministic compiler median stayed near zero milliseconds.

## Repository gates

All gates passed on the final M4-4G worktree:

- `npm test`
- `npm run verify:api-contract`
- `npm run test:deep-api`
- `npm run lint`
- `npm run build`
- `npm run test:ai-architecture`
- `npm run verify:ai-assistant-release`

## Recommendation

The strict provenance retry is correct and should be retained. Planner V1 is not a freeze candidate: P-11 revealed a new Requirement semantic failure class—unnecessary fact/selection expansion despite a valid owner span. Preserve the evidence and return to Supervisor review; do not add a new retry type or a case-specific prompt rule automatically.
