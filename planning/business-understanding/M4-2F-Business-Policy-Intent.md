# M4-2F — Business Model + Domain Policy + Intent Prototype

## Decision and boundary

This is an experimental, non-production prototype. It validates whether two
specialist interpretation calls can be isolated and then combined by a third
Intent call. It does not import, invoke or alter Ontology, entity grounding,
planning, tools, database access, Fact Ledger, answer generation, Business API,
cost engine or any production route.

```text
                   +-- Business Model Agent -- Business Memo --+
Raw user wording --+                                             +-- Intent Agent -- Intent Result
                   +-- Domain Policy Agent --- Policy Memo ----+
```

Business and Policy calls are started in one `Promise.all`; Intent starts only
after both memos are available.

## Sources and context isolation

| Agent | Permitted source | Excluded |
| --- | --- | --- |
| Business Model | raw user wording, optional prior user wording, Company Business Model V1 | Domain Policy, Ontology, database, tools, APIs, IDs, current facts |
| Domain Policy | raw user wording, optional prior user wording, Domain Policy | Company Business Model, Ontology, database, tools, APIs, IDs, current facts |
| Intent | raw user wording, optional prior user wording, Business Memo, Policy Memo | Both raw source documents, Ontology, database, tools, APIs, IDs, current facts |

`POLICY_SOURCE = BOOTSTRAP_PLUS_CANDIDATE`: the workspace did not read a
separate formally published policy snapshot. The experiment used the repository
bootstrap policy plus the Owner-reviewed configurable-cost-driver candidate.
No database was opened for this decision or for smoke execution.

## Prototype and contracts

Prototype: `scripts/ai-experiments/business-policy-intent/`.

- Business and Policy Agents return Markdown memos rather than strict JSON.
- Intent returns only `objectMentions`, `requestedChanges`,
  `requestedInformation`, `persistence`, `needsClarification`, and
  `clarificationReason`.
- Every change/information item includes evidence which must be a contiguous
  portion of current user wording or supplied prior user wording.
- Persistence is limited to `SAVE`, `DO_NOT_SAVE`, `UNSPECIFIED`, and
  `NOT_APPLICABLE`.
- Evaluator R2 first performs deterministic contract/evidence/privacy checks;
  then it performs bounded case-oracle semantic review. Unknown equivalent
  natural-language wording is `REVIEW_REQUIRED`, never an automatic failure.

Focused tests cover context isolation, parallel admission, intent source
isolation, evidence provenance, SAVE/DO_NOT_SAVE/UNSPECIFIED, multi-change,
multi-goal, no Ontology import, no production import, and
`REVIEW_REQUIRED` behavior.

## First formal smoke execution

The first and only formal run used `deepseek-chat` through DeepSeek. It ran the
16 BP and four ADV cases plus the nine requested stability repeats: 29 end to
end executions and 87 model calls. There were no Ontology calls, tools, API
calls, database reads, writes or deployment actions.

Complete raw evidence that was successfully formed, plus execution errors for
the remaining cases, is retained in
`planning/business-understanding/M4-2F-Smoke-Results-2026-09-30.json`.

### Result summary

| Outcome | Count |
| --- | ---: |
| Complete three-layer evidence records | 12 |
| Overall PASS records | 3 |
| Intent JSON contract decode failures | 17 |
| Business memo boundary failures among complete records | 0 |
| Policy memo boundary failures among complete records | 4 |
| Intent deterministic failures among complete records | 6 |
| Evaluator `REVIEW_REQUIRED` records | 0 |
| Context leaks | 0 |

The raw-result artifact records zero-valued aggregate medians because its first
version included failed records without timing data. The valid-record medians,
computed only from the 12 complete records, were: Business 3168.08 ms; Policy
3028.26 ms; parallel context 3338.60 ms; Intent 1437.76 ms; total 4894.03 ms.

### Stable observations

The requested repeats do not support a runtime-adoption claim. They do show
that the following problems recur rather than being only score-format noise:

- `BP-02`: the Intent Agent can promote a read-only money question to
  `DO_NOT_SAVE` and request formal identity clarification.
- `BP-04`: the Intent Agent can invent an unstated source configuration;
  Policy Memo can mention prohibited API wording.
- `BP-07` and `ADV-04`: the Intent Agent can invent a `from` value such as a
  current package despite that value not appearing in user wording.
- `BP-14`: multi-goal extraction is present in one repeat, but persistence and
  Policy boundary behavior vary.

`BP-03`, `BP-06`, and the repeat of `BP-05` formed valid, evidence-grounded
Intent results. This is useful positive evidence, but it is not enough to
overcome the 17 strict-contract failures and the safety-boundary mistakes.

## Failure classification

1. **INTENT_AGENT_FAILURE:** the model did not reliably emit the six-field,
   evidence-bound Intent JSON contract. The first run's failed responses are
   frozen as `INTENT_RESULT_INVALID`; the current pipeline consequently cannot
   preserve their partial raw memo chain. This is a prototype evidence-capture
   defect as well as an adoption blocker.
2. **INTENT_AGENT_FAILURE:** on complete records, the agent sometimes invents
   an unspoken `from` state or assigns a persistence meaning not explicitly
   expressed by the Owner.
3. **POLICY_AGENT_FAILURE:** four complete Policy Memos used prohibited
   Tool/API language despite being instructed to remain policy-only.
4. **EVALUATOR_LIMITATION:** none confirmed in this run. R2 did not reject a
   complete result merely because of Markdown headers, order, or an exact
   synonym. Its direct failures were evidence/provenance or persistence
   violations. Its future `REVIEW_REQUIRED` path is unit-tested.

## Integration decision

**Do not integrate.** Context separation and parallel sequencing are proven by
focused tests, but the first formal model smoke is not reliable enough for a
runtime path. No prompt was adjusted and no model smoke was rerun after these
findings. The next decision belongs to the Supervisor.
