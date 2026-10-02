# M4-3A-R10 — Bounded Role Retry

## Outcome

`PASS — GROUNDING_READY_TO_FREEZE=YES`.

R10 retains the R9 Grounding architecture and adds one fail-closed reliability
mechanism: a single conditional Role retry after a deterministic contradiction.
The frozen full smoke passed all 21 base cases and all 10 repeats (31/31).

## R9 failure analysis

R9's only failure was `通用款模板有哪些固定件？`. The Concept Fast Path
correctly classified the sentence as a formal-fact query, but one DeepSeek Role
response labelled every expression `CONCEPT_ONLY`. The deterministic gate then
safely stopped; it did not invent a Template target. A subsequent independent run
classified `通用款模板` as a formal proposal and resolver evidence produced the
exact Template result. This was a transient base-target omission, not a Reference,
resolver, qualifier, or safety failure.

## Bounded retry contract

`detectRoleContradiction()` is deterministic and triggers only when all conditions
hold:

1. the Concept Fast Path is `NOT_MATCHED` and reports an existing formal-fact
   signal;
2. first Role output has no `FORMAL_ENTITY_CANDIDATE`;
3. it has no `CONFIG_VALUE`;
4. output is empty or exclusively `CONCEPT_ONLY`.

The retry uses the identical Working Utterance, Business Memo, and Policy Memo.
It adds only this scoped addendum:

```text
上一轮输出与当前请求存在结构矛盾：当前请求包含正式事实查询信号，但你没有提出任何
FORMAL_ENTITY_CANDIDATE 或 CONFIG_VALUE。请重新检查老板原话中的业务主体。仍只按原
ROLE 协议输出，不得为了消除矛盾强行制造实体；如果确实没有 formal candidate，应保持原判断。
```

The base Role prompt is unchanged. Retry maximum is two total Role attempts. If
attempt two still has no formal candidate, the pipeline returns
`STOP_ROLE_UNRESOLVED`, calls no resolver, and records the failure.

## Frozen proof

| Component | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| Business prompt | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | same |
| Policy prompt | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | same |
| Role base prompt | `ce3c7bf52a4be43d558440907ed326283f7ac298b8de9a5b988b64c7694288a8` | same |

Retry addendum SHA-256:
`58e9a97b90c6b4c40367ba26443e2ab4158658cf180198399f5eee0f8f417f85`.

Business, Policy, base Role semantics, Reference semantics, Concept semantics,
resolver semantics, Ontology, and production Runtime were not changed. Intent and
utterance extractor calls remained zero.

## Reliability smoke

The authorized DeepSeek `deepseek-chat` reliability run included the 10 R9 closure
cases plus five independent G-07 runs. All 15 executions passed.

| G-07 run | First attempt | Retry | Final target |
| --- | --- | --- | --- |
| 1 | Template formal candidate | not triggered | Template EXACT |
| 2 | Template formal candidate | not triggered | Template EXACT |
| 3 | Template formal candidate | not triggered | Template EXACT |
| 4 | Template formal candidate | not triggered | Template EXACT |
| 5 | Template formal candidate | not triggered | Template EXACT |

The five observed G-07 samples needed no retry, which confirms retry is
conditional rather than a second unconditional model call. Deterministic pipeline
tests separately force the contradiction branch and verify both recovery through
the resolver and `STOP_ROLE_UNRESOLVED` fail-closed behavior.

## Full frozen smoke

| Population | PASS | FAIL |
| --- | ---: | ---: |
| Base G-01..G-16 + N-01..N-05 | 21 | 0 |
| Frozen repeats | 10 | 0 |
| Total | 31 | 0 |

Safety results: zero reference execution failures, concept false positives, retry
false positives/negatives, unresolved-after-retry outcomes, final-target failures,
unresolved proposals accepted as targets, qualifier wrong bindings, silent
first-result bindings, invented formal IDs, formal-fact hallucinations, planner
leaks, and writes. Maximum observed Role attempts was one; the enforced maximum is
two.

## Deterministic tests and verification

- Role-retry deterministic evidence: 9/9 PASS (`CR-01` through `CR-09`).
- Prototype structural tests: 31/31 PASS.
- `npm test`: 2149/2149 PASS.
- `npm run verify:api-contract`: 29/29 PASS.
- `npm run test:deep-api`: 486/486 PASS.
- `npm run lint`, `npm run build`, `npm run test:ai-architecture`, and
  `npm run verify:ai-assistant-release`: PASS.

## Performance

Full-smoke medians: Business 2849.37 ms, Policy 1932.79 ms, first Role call
955.24 ms, resolver probe 0.33 ms, total 3962.58 ms. No retry occurred in the
full run, so retry latency was not sampled there; it is paid only on the narrow
contradiction path.

## Recommendation

The grounding front layer meets its frozen acceptance contract. Freeze this
prototype boundary and await Supervisor direction before any Planner or production
integration.

## Evidence

- `planning/business-understanding/M4-3A-R10-Reliability-Smoke.json`
- `planning/business-understanding/M4-3A-R10-Role-Retry-Tests.json`
- `planning/business-understanding/M4-3A-R10-Full-Smoke.json`
