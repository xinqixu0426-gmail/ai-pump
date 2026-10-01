# M4-3A Grounding Layer Smoke

## Baseline reconcile

- Authorized local start: `04596a6ef8305abd5d9395d51fff864aee44e349`.
- `6be253945836314394c4d43399e09228385bcf9b` is its ancestor.
- M4-2M experiment, Evaluator R9 tests, raw smoke evidence, and the M4-2M report are present at that start.
- Owner-owned dirty files were detected before work and deliberately excluded from this change: `docs/README.md` and `docs/ai-assistant.md`.

## Architecture

The M4-3A experimental chain is:

```text
Raw Owner Input ─┬─ Business Agent ─┐
                 ├─ Policy Agent ───┼─ Grounding Layer ─ formal identity resolver
                 └──────────────────┘
```

The Grounding Layer receives the raw Owner input, bounded recent raw Owner wording, and the two independent Memos. It has no Intent Agent or Utterance Extractor call. It emits an admission memo and sends only explicitly model-named `mention + entityType` targets to the existing formal resolver. It does not retrieve cost, inventory, BOM, or any other final business fact.

## Frozen upstream proof

| Source | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `businessAgent.cjs` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` |
| `policyAgent.cjs` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` |

No Business or Policy prompt, source document, or context construction was changed.

## Ontology and resolver audit

- Baseline Ontology contract: `api/ontology/contract.cjs`, `OntologyVersion = 1`, declarative and `CONTRACT_ONLY_READ_ONLY`.
- Expanded declarative contract: `api/ontology/v2_1/contract.cjs`, `OntologyV21Version` lifted from V2. It is not a runtime reader.
- Active Agent-facing formal identity adapter: `api/ontology/agentResolver.cjs`.
- Formal identity source: `api/services/entityLookupService.cjs`, exposed through `api/routes/entityLookup.cjs` and invoked by the adapter with `EXACT_OR_APPROVED_ALIAS`.
- Supported adapter entity types: recipe, coil, part, order, customer, template.

The smoke used an isolated in-memory SQLite fixture with the actual `createEntityLookupService` and actual `resolveAgentEntity` adapter. It deliberately contained two formal `12-120` coil schemes, two `V750` recipes, aliases for style-qualified V750 recipes, and unique named templates. It is not a production database and contains no business facts beyond identity fixtures.

Read-only resolver evidence:

| Input | Formal status | Evidence |
| --- | --- | --- |
| coil `12-120` | `AMBIGUOUS` | candidates `12-120 普通小眼`, `12-120 加强大眼`; no canonical ID bound |
| recipe `V750` | `AMBIGUOUS` | candidates `V750-通用款`, `V750-豪贝款`; no canonical ID bound |
| template `通用款模板` | `RESOLVED` | canonical identity `21` within the isolated formal fixture |
| recipe `V750通用款` | `RESOLVED` | formal approved alias to isolated canonical identity `11` |

The fixture test verifies query-only behavior by asserting SQLite `totalChanges` is unchanged.

## Grounding contract

The experimental result vocabulary is deliberately bounded:

- admission: `REQUIRED` or `NOT_REQUIRED`;
- formal result: `EXACT`, `MULTIPLE`, `UNRESOLVED`, or `NOT_REQUIRED`;
- reference: raw language only, resolved only from bounded recent Owner wording, otherwise `UNRESOLVED`.

`MULTIPLE` never binds an ID. Configuration words such as wood packaging, float, stainless shaft, cable length, and electrophoresis are kept as configuration language unless a formal top-level entity is explicitly requested.

## Focused tests

`node --test tests/groundingLayerPrototype.test.cjs tests/businessPolicyIntentPrototype.test.cjs` passed: 16/16.

They prove raw input plus both Memos reach Grounding, concept questions do not call a resolver, exact and ambiguous formal results remain distinct, unresolved references are not guessed, no fixture writes occur, legacy M4-2M stays historical, and production runtime files do not import the prototype.

## Frozen real-model smoke

The prescribed 21 base cases and 10 stability repeats were executed once, unchanged, using `deepseek-chat`. Raw execution evidence is stored in [M4-3A-Grounding-Smoke-Results-2026-10-01.json](M4-3A-Grounding-Smoke-Results-2026-10-01.json).

All 31 runs failed before any model response with `DeepSeek ... ENOTFOUND`. The same frozen command was retried with the environment's approved elevated network permission and failed identically. Therefore:

- Raw model outputs: none (provider connection failed before completion).
- Resolver calls from real smoke: 0 (Grounding cannot form model-derived targets without a model response).
- No formal fact, planner, tool, or write result was produced.
- This is classified as `PROVIDER_UNAVAILABLE`, not as a Grounding semantic failure and not as a PASS.

The intended case set remains frozen in `scripts/ai-experiments/business-policy-intent/run-grounding-smoke.cjs`:

- G-01–G-16 cover concept admission, identity admission, configuration values, raw references, and protected mutation language without execution.
- N-01–N-05 cover concept negatives, unresolved reference, two independent targets, independent coil designations, and style-qualified V750 targets.
- The stability subset is G-03, G-05, G-06, G-07, G-08, G-11, G-12, G-13, N-03, and N-05.

## Failure classification and recommendation

| Classification | Count | Result |
| --- | ---: | --- |
| `PROVIDER_UNAVAILABLE` | 31 | Blocks real DeepSeek acceptance only |
| Grounding semantic failure | 0 observed | Not assessable without model output |
| Ontology gap | 0 observed in fixture | Production-shaped resolver coverage still awaits provider smoke |
| Writes / Ontology mutations | 0 | Verified by focused tests |

Do not integrate this prototype into production or add a Planner. Restore DeepSeek DNS/provider connectivity, then rerun the same frozen command and evaluate its raw model outputs against the existing Grounding Evaluator V1. No Prompt, case, fixture, or upstream Business/Policy source should be changed before that rerun.
