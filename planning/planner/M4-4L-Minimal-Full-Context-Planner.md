# M4-4L — Minimal Full-Context Planner Prototype

STATUS: REWORK / ARCHITECTURE REVIEW. This is a side-by-side prototype; no production runtime, frozen upstream, or write path was changed.

## 1. M4-4K Failure Decomposition

M4-4K scored 20/26. Full Business and Policy memos improved scenario understanding (P-11/P-12/P-13 each 5/5 repeat), but the Planner was asked to output `REQUEST_MODE`, formal IDs, and a single reference query. Relation/result duplication and multi-target identity loss caused the remaining failures. The prior catalog was a frozen fixture, not current formal data.

## 2. Why Full Context Is Retained

The new Planner still sees unchanged Owner wording, complete genuine Business Memo, complete genuine Policy Memo, optional recent conversation, and the entire read-only catalog projection. Frozen corpus calls reuse complete M4-4K Business/Policy Agent memos without shortening; only the Planner calls are fresh. Six real-catalog integration cases receive fresh Business and Policy Agent calls.

## 3. Why `REQUEST_MODE` Was Removed From the LLM

The LLM outputs `WRITE_REQUIRED` and scenario changes. Code derives `WRITE` for explicit write, `PREVIEW` for a non-write scenario, and `READ` otherwise. A concept-only detail request becomes internal `EXPLAIN`/`NO_TOOL_REQUIRED`. This removes the P-14/N-06 comparison-as-preview error source without a raw-text keyword router.

## 4. Why Formal IDs Were Removed From the LLM

The LLM copies one `REFERENCE_MENTION` owner span per formal business object. It does not output entity type, ID, or canonical name. The resolver searches the current catalog and returns `EXACT`, `MULTIPLE`, `MULTIPLE_TYPE`, or `NOT_FOUND` independently for each mention. Unverified mention or multiple candidates never bind to a first result.

## 5. Minimal Planner Contract

Only `PLANNING_BRIEF`, `REQUESTED_RESULT`, `METRIC`, repeated `REFERENCE_MENTION`, `RELATION_REQUEST`, repeated `SCENARIO_CHANGE`, and `WRITE_REQUIRED` are accepted. The brief is non-authoritative. Mentions, relation request, and scenario expressions require exact continuous Owner spans (mechanical NFKC/spacing only). Full-width and half-width protocol colons are mechanically equivalent. The validator rejects extra fields, including model-chosen formal IDs, mode, capability, or plan status.

## 6. Official Catalog Authentication

M4-4K's 401 came from calling `localhost:3002` without the existing internal read credential while this checkout's `.env` selects port 3012. M4-4L reuses `api/routes/ai/internalApiClient.cjs` with `createInternalFetch` and `getJson`, using only the four existing GET routes. No route, authentication rule, or write credential changed; no credential value is stored. See [catalog auth audit](M4-4L-Catalog-Auth-Audit.json).

## 7. Catalog Snapshot

Current formal GETs returned 2 Recipes, 14 Coils, 1 Template, and 89 Parts (106 records). The Planner projection contains ID, canonical display identity, and existing designation fields; it excludes implementation and database schema details. It serialized to 8,809 characters, estimated 2,203 tokens. The snapshot is marked `OFFICIAL_GET`, timestamped, and carries each domain's route provenance.

## 8. Catalog Resolver

The deterministic resolver compares NFKC/space-normalized mentions against actual catalog names, aliases, `spec`, `schemeCode`, and `commonDesignation`; the latter is deterministically composed from formal `spec` and `sheets` when the API does not return one. It does not ask a model for an alias, run SQL, or select a default. An exhaustive formal GET snapshot can justify a complete candidate set for count requests.

## 9. Frozen vs Real Identity Domains

The historical 26 cases use the frozen fixture identities (3 Recipes, 3 Coils, 1 Template). The current local formal catalog has different names and IDs. These are separate suites; neither suite forces the other's IDs. Real integration Owner wording was constructed from current formal record names and scheme codes.

## 10–16. Case Semantics

- P-03: Template fixed parts is `LIST + RELATION`; Parts catalog content is not needed to bind the Template identity.
- P-07: a common designation can resolve to a complete multiple-candidate set; `COUNT` consumes the set.
- P-08: when the correct relation span and exact target are present, `VALUE` and `DETAIL` are accepted as equivalent surface shapes; the internal fact is `RELATION`.
- P-11/P-12/P-13: complete memos preserve surface treatment, rotor process, and explicit temporary multi-override preview semantics. Real capability gaps remain gaps.
- P-14/N-06: two Recipes plus `DELTA + COST` and no scenario compile as read comparison, not preview.
- P-15: two independent Coil mentions resolve independently and `VALUE + COST` remains separate values, not a delta.
- P-17: `NONE + NONE + WRITE_REQUIRED YES` yields `BLOCKED_POLICY`, zero write steps and no invented cost fact.

## 17. Repeat Reliability

Fifty fresh one-shot Planner calls on the frozen corpus: P-03 4/5, P-07 5/5, P-08 2/5, P-11 4/5, P-12 1/5, P-13 4/5, P-14 5/5, P-15 5/5, P-17 5/5, N-06 5/5; overall 40/50. P-12 regressed because the model repeatedly put the process/configuration phrase in `REFERENCE_MENTION` as well as `SCENARIO_CHANGE`; the resolver safely returned `NOT_FOUND` for that false formal mention. P-08 still drifted on relation/result expression. No retry or case-specific correction was applied. See [repeat evidence](M4-4L-Frozen-Repeat.json).

## 18. Full Frozen 26

Same Owner wording, fresh one-shot Planner calls, frozen identity fixture only: Base 13/18, Negative 7/8, overall 20/26. The six failures were P-02 (concept mislabelled COST), P-09 (packaging value also emitted as formal mention), P-10 (float value also emitted as formal mention and class OTHER), P-13 (both configuration values also emitted as formal mentions), P-18 (split qualified styles could not be bound by independent exact mentions), and N-08 (unresolved reference became NONE/NONE instead of preserving the requested cost value). P-14, P-15, and N-06 were fixed relative to M4-4K's full run, but these gains were offset elsewhere. The existing deterministic Plan Compiler had no intrinsic failure across 26 cases; safe blocking of invalid model semantics is not a semantic pass. See [full evidence](M4-4L-Frozen-Full.json).

Benchmark: M4-4D Requirement 16/26; M4-4I Goal Spec 16/26; M4-4J Demand Slots 23/26; M4-4K Full Context 20/26; M4-4L Minimal Full Context 20/26. This does not support replacing the current prototype path.

## 19. Real Catalog Integration

Six fresh cases cover exact Recipe, exact Coil scheme, multiple common designation, Template relation, two-Recipe comparison, and two-Coil values. Three passed. The other three resolved formal identities correctly but failed semantic fields: common-designation count became `LIST` plus an unnecessary relation; Template fixed parts omitted the relation span; two separate Coil values became `LIST`. The compiler safely blocked plans with incomplete facts. This is a genuine current-catalog integration result, not a frozen-ID mismatch. See [real-catalog evidence](M4-4L-Real-Catalog-Integration.json).

## 20. Safety

The Planner has no SQL, Tool, API, or write interface. Catalog access is an existing read-only internal API path. The resolver and both compilers make zero model calls; no capability is executed. Frozen Business/Policy/Grounding files and the existing Plan Compiler semantic core are untouched. Across frozen and real-catalog evidence: no model-chosen formal ID field, first-result binding, write execution, Business API write, DB write, or LLM SQL was observed. Deterministic ML-01 through ML-18 passed, plus formal GET adapter, full-width-colon parser, and strict-span checks. All seven repository gates passed: `npm test` (2,224/2,224), `verify:api-contract` (29/29), `test:deep-api`, `lint`, `build`, `test:ai-architecture` (9/9), and `verify:ai-assistant-release`.

## 21. Performance

Frozen full-run medians: Planner 1,364 ms, resolver 0.038 ms, semantic/compiler adapter 0.091 ms. Exact Planner system-message context median was 3,840 characters: raw Owner input 16, Business memo 1,130, Policy memo 325, catalog JSON 1,196. Real-catalog six-case median context was 11,511 characters, Business 3,072 ms, Policy 2,331 ms, Planner 1,499 ms, resolver 0.195 ms, compiler adapter 0.244 ms. Evidence originally counted hidden compiler capability data in its context total; the preserved inputs were reconciled to exact Planner message characters with zero additional model calls. Per-case context sizes and timing remain in JSON evidence.

## 22. Recommendation

Do not retire Grounding, Demand Slots, or old prototypes, and do not freeze Planner V1. The formal catalog path and deterministic identity safety are now proven for this local checkout, but the one-shot minimal Planner remains less reliable than Demand Slots (20/26 vs 23/26) and failed three of six independent real-catalog requests. The main remaining issue is not authentication: the model still confuses configuration values with formal references, and simple exact matching cannot bind shared qualifiers such as “通用款和豪贝款的V750”. Supervisor architecture review is required before any new reliability layer, contextual qualifier resolver, or production handoff. No automatic follow-on phase is authorized.
