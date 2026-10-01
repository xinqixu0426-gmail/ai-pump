# M4-2M — Minimal Utterance Extractor Final Smoke Report

## Scope

This prototype keeps three fully isolated, parallel experimental calls:

```text
User Input → Business Agent
User Input → Utterance Extractor
User Input → Policy Agent
```

The Utterance Extractor receives only the current user message. Its memo records
only mentions, conditions/descriptions, information requests, and an explicit
save/no-save signal. It does not classify a condition as a business change, make
clarification or reference decisions, interpret business concepts or policy, or
perform grounding, planning, tool, API, database, or formal-fact reasoning.

Business and Policy Agent prompts were not changed in M4-2M. The prototype is
not imported by production runtime code.

## Evaluator R9

R9 checks only the frozen extractor boundary:

- mention preservation;
- condition/description preservation;
- information-request preservation;
- explicit save-signal preservation;
- unsupported inference; and
- scope leakage.

It does not score change classification, multi-change classification,
clarification, or reference recovery. Focused tests pass for literal references,
missing targets, unexpressed source values, multiple conditions, multiple
information requests, and save/no-save signals.

## Frozen Smoke Set and Result

The requested frozen smoke command ran 35 cases: 20 base cases plus the 15
specified repeat cases, for 105 isolated DeepSeek calls. The successful
controlled-network execution produced all 35 Business, Policy, and Utterance
memos. Its timing medians were 2864.47 ms for Business, 1034.76 ms for
Utterance, 1967.13 ms for Policy, and 2864.47 ms end-to-end.

After one static evaluator correction for negative boundary disclaimers (for
example, “this memo does not provide API reasoning” is not an API leak), the
saved memos evaluate as follows:

- Business: 35 PASS, 0 FAIL.
- Policy: 35 PASS, 0 FAIL.
- Utterance: 29 PASS, 3 FAIL, 3 REVIEW_REQUIRED.

The three confirmed Utterance omissions are CASE-03 run 1 (the condition only
said “换成”, omitting the stated packaging values), CASE-06 run 1 (the
conditions omitted “先算一下”), and CASE-06 run 2 (the requested calculation
was omitted). CASE-15 runs 1 and 2, and CASE-19 run 2, preserved their literal
mention and information request but omitted an explicit save/no-save expression,
so R9 records them as REVIEW_REQUIRED. These are four-duty completeness
variances, not business, policy, grounding, or unsupported-source inference.

The raw, complete execution evidence is:

`planning/business-understanding/M4-2M-Smoke-Results-2026-10-01.json`

## Freeze Decision

`FRONT_UNDERSTANDING_LAYER_V1 = NOT_FROZEN`.

The frozen 35-run acceptance is REWORK because the Utterance Extractor did not
stably preserve all four required duties. No prompt or case was changed after
the frozen provider run. The only post-run evaluator adjustment fixed a false
positive caused by an explicit negative boundary disclaimer; it re-evaluated
the unchanged stored memos and did not add model calls. No product Runtime,
ontology, database, Domain Policy, Business API, or cost engine was changed.

## Next Boundary

Supervisor should decide whether the fourth save-signal duty needs a different
extraction mechanism or a revised downstream contract. Do not move to Ontology,
Planner, tools, or runtime integration until that decision and a subsequent
reviewed smoke result exist.
