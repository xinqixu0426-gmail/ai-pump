# M4-4H — Terminal Goal Provenance + Goal Minimality Closure

## Status

**REWORK.** The M4-4H deterministic contract is complete and the P-11 electrophoresis reliability target passed 10/10. The required regression prerequisite did not pass: P-13 passed 0/3 and P-03 passed 2/3. Per the approved stop condition, the full 26-case smoke was not run and no further semantic patch was applied.

Source baseline: `350ce9a8a5f45e8e2728434eaccf2ae97dbcdbe5` on `ai-native/m3-optimization-v1`.

## M4-4G single-failure analysis

The prior P-11 failure retained a valid target, scenario class and scenario expression, but added `CURRENT_COST`, `RELATION` and a redundant single-target selection to a request whose terminal result was only the cost increase. The deterministic compiler correctly refused to satisfy the unrelated `RELATION` goal with the scenario-preview capability.

## Terminal goal vs. auxiliary fact

`GOAL_FACT` now means only an Owner-requested terminal result. Facts returned incidentally by a capability or useful to an implementation are not Requirement goals. The parser accepts:

```text
GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本增加多少
```

The compiler continues to decide how a direct capability or multi-output capability satisfies that terminal goal. Its semantics were not changed.

## Goal provenance and minimality

Every fresh real-smoke goal fact requires a contiguous Owner span. The validator permits only mechanical Unicode/whitespace normalization; it does not use synonym, fuzzy, embedding, pinyin, edit-distance or capability-based repair.

The new high-confidence validator rejects a comparison span as evidence for an independent `CURRENT_COST` goal and rejects relationship facts with no relationship wording. A `GOAL_FACT_OVEREXPANDED` result invokes the existing bounded Requirement retry once. The retry addendum asks the model to retain only Owner-requested terminal facts and to provide actual Owner spans; it does not name a fact to remove or choose a capability.

Legitimate multiple Owner goals remain valid. The deterministic tests include “现在用哪个线圈，再告诉我当前成本”, where both `RELATION` and `CURRENT_COST` remain required.

## Selection and target normalization

`SINGLE_TARGET_REQUIRED` is normalized to `NONE` for an EXACT target or an explicit qualified target set. An unresolved MULTIPLE target still uses `SINGLE_TARGET_REQUIRED` for candidate-specific facts and `WHOLE_SET` for candidate-set facts.

Raw target expressions that deterministically map to the same frozen canonical ID are deduplicated using only the frozen mention/canonical name/canonical ID and mechanical text normalization. Different formal IDs remain separate.

## Deterministic contract evidence

`M4-4H-Terminal-Goal-Tests.json` records 17/17 passing tests:

- terminal-goal span support and unsupported auxiliary facts;
- legitimate multi-goal preservation;
- exact/qualified/MULTIPLE selection normalization;
- same-identity target deduplication only;
- one bounded goal-overexpansion retry and fail-closed exhaustion.

Existing requirement reliability, comparison-basis and override-provenance tests also passed locally.

## P-11 ten-run reliability

Fresh DeepSeek `deepseek-chat` Requirement calls produced **10/10 final PASS** for P-11. All ten first attempts were valid, with zero provenance or goal-overexpansion retries. The deterministic compiler made zero model calls.

## Regression reliability and remaining failures

The required regression set exposed new Requirement semantic failures, so the full corpus was intentionally not started.

| Case | Result | Evidence |
| --- | --- | --- |
| P-10 FLOAT | 3/3 | Final PASS; bounded retries recovered scenario-goal omissions. |
| P-12 ROTOR_PROCESS | 3/3 | Final PASS; compiler correctly retained the existing capability gap as `BLOCKED_CAPABILITY`. |
| P-13 multi override | 0/3 | The model retained both exact override spans but repeatedly emitted `CURRENT_COST`/`OTHER` with `OWNER_SPAN=先算一下`, or assigned scenario goals to configuration spans. Retry did not recover a valid minimal scenario goal. |
| N-06 two-recipe comparison | 3/3 | Final PASS; no comparison-basis false positive. |
| P-03 template relation | 2/3 | One model run chose `CANDIDATE_SET`, then `OTHER`, for “有哪些固定件”; the terminal fact should remain `RELATION` or `FORMAL_DETAIL`. |

The raw first and second Requirement memos, validation violations, retry reasons and compiled plans are preserved in `M4-4H-Regression-Reliability.json`. These are Requirement model-semantic failures, not compiler, capability, provenance-repair or frozen-upstream failures.

## Compiler stability and safety

The deterministic compiler was not changed and made zero model calls. The runs made no Tool calls, Business API calls, DB accesses or writes. Requirement targets remained constrained to frozen Grounding. Planner-visible write capabilities remained zero. No frozen Business, Policy or Grounding source was changed.

## Performance

P-11 median first Requirement call: 1177 ms. Regression median first Requirement call: 1195 ms; retry median: 1245 ms. Compiler median time remained approximately 0.02–0.04 ms.

## Recommendation

Return the preserved P-13 and P-03 raw evidence to the Supervisor for architecture review. Do not add a case-specific parser, raw-text scenario extractor, fuzzy goal repair or a further retry class automatically. `PLANNER_V1_READY_TO_FREEZE = NO`.
