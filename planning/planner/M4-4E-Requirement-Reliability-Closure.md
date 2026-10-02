# M4-4E — Requirement Planner Reliability Closure

## Status

`REWORK`. Frozen upstream and the deterministic Plan Compiler remain intact.
The targeted reliability set passed 15/15 and the deterministic compiler passed
every received requirement. The required repeat set found one genuine
Requirement Planner omission: one of five fresh P-12 runs omitted the owner
scenario override entirely. That omission does not meet either approved retry
trigger, so this round stops without expanding retry behavior.

## M4-4D failure reclassification

Three M4-4D failures for template fixed parts were evaluator-contract errors:
`RELATION` is an acceptable Goal Fact because the owner asks for the formal
Template-to-fixed-parts relationship. The typed `templates.detail` descriptor
produces both `FORMAL_DETAIL` and `RELATION`; the negative fixture now removes
every capability that can satisfy that relation.

An unresolved grounded owner expression may preserve a Goal Fact such as
`CURRENT_COST`. It records what the owner needs while the compiler safely
returns `BLOCKED_GROUNDING`; it is not a Requirement contradiction.

Scenario preservation now accepts a conservative owner-language core span.
For example, `电泳` safely preserves `做电泳`; this is not an invented value.

## Deterministic Requirement Status

`REQUIREMENT_STATUS` remains in the raw model memo only for observation. The
effective status is derived exclusively from frozen upstream:

- `UNRESOLVED` → `UNRESOLVED_GROUNDING`
- `NOT_REQUIRED` → `NO_FORMAL_FACT_REQUIRED`
- exact, multiple, or qualified formal grounding → `READY`

Evidence retains raw memo, parsed memo, normalized memo, raw/effective status,
normalization source, and whether normalization changed the raw status.

## Scenario contradiction and bounded retry

The one Requirement LLM sees no capability catalog. A deterministic detector
may make one additional call only when the parsed semantic output is internally
contradictory:

1. Scenario overrides plus a cost goal, but no scenario-oriented Goal Fact.
2. `OTHER` scenario class where the frozen Business Memo has explicit
   configurable/process evidence sharing a conservative owner-language span.

The retry addendum identifies only that structural contradiction. It never
provides the target answer, capability support, database field, or formal ID.
The second result is re-normalized and revalidated. Maximum attempts are two.

## Targeted 15-case reliability run

The requested P-03/P-05/P-06/P-07/P-08/P-10/P-11/P-12/P-13/P-15/P-17 and
N-01/N-03/N-04/N-08 set passed **15/15** after deterministic evaluation.
Requirement first attempts passed 13/15; two approved scenario-goal retries
recovered both. Compiler results were 15/15, with no contract violations.

## Repeat reliability

Each repeat used a fresh DeepSeek Requirement call and at most one bounded
retry.

| Case | Final result | Retry observations |
| --- | ---: | --- |
| P-10 FLOAT | 5/5 | 2 recovered scenario-goal retries |
| P-11 ELECTROPHORESIS | 5/5 | no retry required |
| P-12 ROTOR_PROCESS | 4/5 | one output omitted the scenario override; no approved trigger applied |
| P-13 MULTI_OVERRIDE | 5/5 | 3 recovered scenario-goal retries |

The P-12 miss is a real Requirement semantic failure, not a compiler or
evaluator issue. Adding a third retry trigger for missing overrides is outside
this round's approved A/B contract, so no automatic follow-on change was made.

## Full same-26-case run

Not run. M4-4E requires all four repeat groups to reach 5/5 before the full
corpus. The preserved full evidence explicitly records this prerequisite
failure; it is not a fabricated smoke result.

## Deterministic reliability evidence

`RN-01` through `RN-15` passed: status normalization, `RELATION`
equivalence, unresolved-goal preservation, both contradiction types, retry
maximum, frozen-target preservation, explicit write-intent protection, and
post-retry validation.

## Safety and performance

All observed values remain zero: regrounding, invented formal IDs,
compiler-invented capabilities, unsupported-override execution, silent
multiple selection, write steps, Tool calls, Business API calls, DB access,
visible write capabilities, and frozen-upstream changes.

Repeat model calls: 20 first Requirement calls plus 5 bounded retries; compiler
model calls: 0. Repeat medians: first Requirement 1031.970708 ms, retry
1235.022584 ms, deterministic compiler 0.036000 ms.

## Repository gates

All required repository gates passed after the prototype change:

- `npm test` — 2199 / 2199 pass
- `npm run verify:api-contract` — 29 / 29 pass
- `npm run test:deep-api` — 486 / 486 pass
- `npm run lint` — pass
- `npm run build` — pass
- `npm run test:ai-architecture` — 9 / 9 pass
- `npm run verify:ai-assistant-release` — pass

## Recommendation

Keep the Requirement/Compiler separation. The Compiler remains stable and
safe; the single remaining repeat failure is a new Requirement omission class
(missing scenario override) that must be reviewed by the Supervisor before any
new retry trigger or semantic guard is introduced. Do not connect an Executor,
unfreeze upstream, or create a Planner freeze from this result.
