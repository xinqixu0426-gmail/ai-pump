# M4-3A-R9 — Grounding Closure

## Outcome

`REWORK — GROUNDING_ARCHITECTURE_REVIEW_REQUIRED=YES`.

R9 closed the R8 over-proposal and qualifier-composition gaps with deterministic
resolver-evidence validation. The frozen full smoke nevertheless exposed one new
Role semantic failure, so this closure round stops without an R10 prompt or rule
patch.

## R8 full-smoke failure matrix

| R8 failure family | R9 mechanism | R9 result |
| --- | --- | --- |
| `V750成本` / `线圈` / `固定件` proposed as entities | resolver probe; accepted targets require evidence | unsupported proposals cannot enter final targets |
| `V750` plus style words | owner-span qualifier refinement over a supported `MULTIPLE` base | `V750-通用款`, `V750-豪贝款` qualified set |
| packaging classification concept question | high-precision plural business-classification grammar | `STOP_CONCEPT_ONLY`, no Role or resolver call |

## Contract

`FORMAL_ENTITY_CANDIDATE` is now a **candidate proposal**, never a final target.
Only a read-only resolver probe may produce an accepted target. An unsupported
proposal is retained as `UNRESOLVED_PROPOSAL_WARNING` but is excluded from final
targets.

Qualifier refinement is deterministic and only applies to a resolver-supported
`MULTIPLE` base. A qualifier must be an exact owner-language span and must make a
unique conservative normalized-text match against a canonical candidate name.
No matching, ambiguous matching, or absent owner qualifier preserves the base
ambiguity; it never selects a candidate.

`CONFIG_VALUE` and `CONCEPT_ONLY` still never enter the resolver probe. An owner
span classified as `CONFIG_VALUE` may be considered for qualifier refinement only
after a separate base target has resolver evidence. It is never itself grounded.

## Frozen upstream proof

| Component | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| Business Agent | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | same |
| Policy Agent | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | same |

Business, Policy, Role prompt semantics, Reference semantics, resolver semantics,
Ontology contracts, and production Runtime were not changed. Intent and utterance
extractor calls remain zero.

## Closure smoke

The authorized real DeepSeek (`deepseek-chat`) closure smoke ran 10/10 PASS.

| Case | Final result |
| --- | --- |
| C-01 / G-05 `查一下V750成本` | `V750` recipe `MULTIPLE` |
| C-02 / G-06 current coil | `V750` recipe `MULTIPLE` only |
| C-03 / G-07 fixed parts | `通用款模板` template `EXACT` |
| C-04 / N-05 styles | `QUALIFIED_SET`: `V750-通用款`, `V750-豪贝款` |
| C-05 / G-16 packing classification | concept fast path; no resolver |
| C-06 / G-13 direct qualified recipe | `V750通用款` recipe `EXACT` |
| C-07 / G-03 coil price | `12-120` coil `MULTIPLE` |
| C-08 / G-12 unknown `这个` | unresolved-reference stop |
| C-09 / G-11 resolved reference | `12-120` coil `MULTIPLE` |
| C-10 / G-10 packaging configuration | `V750` recipe `MULTIPLE` only |

The deterministic proposal/qualifier suite passed 13/13: PV-01..04,
QR-01..06, and CF-PLURAL-01..03.

## Full frozen smoke

The rerun executed all 21 base cases plus the 10 frozen repeats (31 total).

| Population | PASS | FAIL |
| --- | ---: | ---: |
| Base | 20 | 1 |
| Base + repeats | 30 | 1 |

The only failure was `G-07: 通用款模板有哪些固定件？`.

Raw Role output:

```text
ROLE: 通用款模板 | CONCEPT_ONLY
ROLE: 固定件 | CONCEPT_ONLY
```

The Concept Fast Path correctly did not intercept the formal-fact wording
(`有哪些固定件`). The deterministic gate then correctly stopped because all Role
output was `CONCEPT_ONLY`. No resolver was called and no unsafe target was
accepted. But the required formal Template base target was absent, so this is a
`ROLE_SEMANTIC_FAILURE`, not a gate, resolver, proposal-validation, or qualifier
refinement failure.

## Safety and evidence

- Candidate proposals: 32; supported probes: 25; unresolved probes: 7.
- Unresolved proposal warnings: 7; accepted unresolved proposals: 0.
- Qualifier refinements: 19 attempts, 2 successful; no silent selection.
- Final targets: 27.
- Resolver probes were fixture-backed read-only calls to the authoritative adapter;
  no formal facts were retrieved or generated.
- No Planner/tool recommendation, write, ontology mutation, production import, or
  Intent/utterance invocation occurred.

Full smoke medians: Business 2944.75 ms, Policy 2113.45 ms, Role 840.43 ms,
resolver probe 0.32 ms, qualifier refinement 0.02 ms, total 3901.43 ms.

## Verification

All required project gates passed after the R9 changes:

- `npm test` — 2149 passed, 0 failed
- `npm run verify:api-contract` — 29 passed, 0 failed
- `npm run test:deep-api` — 486 passed, 0 failed
- `npm run lint` — passed
- `npm run build` — passed
- `npm run test:ai-architecture` — 9 passed, 0 failed
- `npm run verify:ai-assistant-release` — passed

## Recommendation

Do not add a case-specific `模板/固定件` rule or modify the Role prompt in this
closure round. Supervisor review should decide whether formal relationship-query
base-target preservation belongs in a different deterministic contract or requires
a different role-extraction model. The raw output and the complete resolver/eval
trace are retained in the linked JSON evidence.

## Evidence

- `planning/business-understanding/M4-3A-R9-Closure-Smoke.json`
- `planning/business-understanding/M4-3A-R9-Proposal-Qualifier-Tests.json`
- `planning/business-understanding/M4-3A-R9-Full-Smoke.json`
