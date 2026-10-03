# M4-4I — Owner Goal Spec V1 Prototype

## Status

**REWORK.** The side-by-side prototype establishes the intended boundary and preserves all safety properties, but fresh one-shot Goal Spec classification is not yet more reliable overall than the old Requirement contract.

Baseline: `6e8d41fad6267629ed79a6e15bb8f016f8a3b0cf` on `ai-native/m3-optimization-v1`.

## Why the LLM `GOAL_FACT` contract is retired at this boundary

The old Requirement LLM had to emit compiler-facing facts such as `RELATION`, `CURRENT_COST` and `SCENARIO_COST`. This coupled an Owner’s natural delivery goal to the Plan Compiler’s internal fact vocabulary. M4-4H demonstrated the result: P-13 could not naturally ground `SCENARIO_COST` in “先算一下”, while P-03 oscillated between `RELATION`, `FORMAL_DETAIL`, `CANDIDATE_SET` and `OTHER`.

Goal Spec V1 has no LLM-visible fact classes. It limits the LLM to `GOAL_KIND`, `RESULT_SHAPE`, `METRIC`, frozen `TARGET`, strict-provenance `RELATION_REQUEST`/`SCENARIO_OVERRIDE`, and `WRITE_REQUIRED`.

## Owner Goal Spec V1 and deterministic compilation

The new prototype path is:

```text
Frozen upstream
  -> Owner Goal Spec LLM
  -> Goal Spec validator / normalizer
  -> deterministic Goal-to-Fact compiler
  -> existing deterministic Plan Compiler
  -> existing Plan Validator
```

The Goal Spec LLM does not receive a capability catalog. The Goal-to-Fact compiler has zero model calls and maps `LIST` to `RELATION`, `COUNT` to `CANDIDATE_SET`, scenario preview to `SCENARIO_COST`, and target/scenario comparisons to `COST_DIFFERENCE`. The existing Plan Compiler was not changed.

Goal Kind and Result Shape are semantic classifications, so they do not require an exact Owner span. Strict contiguous-span provenance remains for relation requests and scenario overrides, which can later feed formal binding.

## P-03, P-13 and P-11

- P-03 probe and repeat: `LIST / LIST / NONE`, relation request `固定件`, then deterministic `RELATION`; repeat result **5/5**.
- P-13: `PREVIEW_SCENARIO / VALUE / COST`, with exact `电缆5米` and `木箱` overrides; repeat result **4/5**. This removes the old `CURRENT_COST` versus `SCENARIO_COST` ownership problem, but one-shot semantic variance remains.
- P-11: the targeted run passed, but repeat result was **1/5** because the model sometimes drifted away from `COMPARE_SCENARIO` despite retaining the scenario context. This prevents replacement or freeze.

## Targeted and full runs

Targeted 15 cases: Goal Spec 10/15, Goal-to-Fact 13/15, existing Plan Compiler 15/15, final 10/15.

Repeat reliability:

| Case | Final pass |
| --- | --- |
| P-03 template list | 5/5 |
| P-11 electrophoresis delta | 1/5 |
| P-13 multi override preview | 4/5 |
| P-07 candidate count | 3/3 |
| P-10 float preview | 3/3 |
| N-06 two-recipe delta | 3/3 |

Full fresh 26-case run: base **10/18**, negative **6/8**, overall **16/26**. Goal Spec failures were Goal Kind 5, Result Shape 6, Metric 2 and Scenario Class 2. There were no target or provenance failures, no leaked `GOAL_FACT` lines, and no Plan Compiler failures.

## Old Requirement versus Goal Spec benchmark

The old Requirement artifacts did not provide an equivalent fresh full run at this revision; no additional old LLM benchmark calls were made. Historical M4-4H repeat evidence shows P-03 2/3, P-11 10/10 and P-13 0/3. Goal Spec improves the old P-03/P-13 fact-class problem to 5/5 and 4/5, respectively, but regresses P-11 to 1/5. Its full one-shot final rate is 16/26, not a sufficient architecture win.

The new schema has zero old fact-line leakage and removes retry dependency by design, but it does not yet satisfy the semantic-stability threshold.

## Safety and performance

Goal Spec has one DeepSeek `deepseek-chat` call per case and no retry. Both compilers have zero model calls. Across all runs: no regrounding, invented formal IDs, writes, Tools, Business API calls, DB access, visible write capabilities, or frozen-upstream changes. The full-run median Goal Spec latency was 1042 ms; Goal-to-Fact compilation was 0.006 ms and Plan Compiler execution was 0.044 ms.

## Recommendation

Retain this prototype and its evidence; do not replace the old Requirement path yet. The next architecture review should focus on Goal Kind stability, especially scenario comparison versus preview and relation/value distinction. Do not add case-by-case prompt rules, retry, or a second model without Supervisor approval.
