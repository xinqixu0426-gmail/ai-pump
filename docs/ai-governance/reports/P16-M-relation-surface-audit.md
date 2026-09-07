# P16-M — Governed multi-read implementation and certification

## Current local checkpoint

Candidate discovery and explicit choice are implemented and locally verified. Final choice cohort18/18; original L30/M30 wording with the two owner-approved interaction oracles60/60; full tests2313/2313; API contract26/26; deep API439/439; buildPASS. No commit, push, deployment, Legacy modification/restart or production access occurred. Multi-read remains source-defaultOFF. See the final section for the current contract, retained failed observations and exact evidence. Historical sections below certify their own versions only.

## Original multi-read decision (historical)

Original API_GAP implementation blocker **resolved locally**. The owner authorized autonomous in-scope repair instead of another Supervisor prompt. No mutation/routing authority was broadened.

Stage status: **LOCAL REWORK, NOT PRODUCTION CERTIFIED**. Semantic V3 passed 90/90 (30/30 in each fixed repeat). The single full owner UAT passed29/30; M-18 returned RISK_UNAVAILABLE before any Tool execution. All29 admitted investigations produced validated answers. Do not replace this result with30/30 or count a safe fallback as a completed V5 investigation.

Five subsequent fixed diagnostic risk-only requests, unchanged M-18 wording, all returned valid READ_SAFE. This demonstrates no persistent blocker in that diagnostic set, not the exact cause of the earlier failure. The earlier classifier catches provider, JSON and schema errors under the same availability class; its discarded response cannot be reconstructed. Risk model/prompt/normalizer were not modified, and no runtime retry or bypass was added. Full Answer UAT was not rerun.

Start/End committed HEAD: c30dab87fbaebd25f94ac71f540d1855c6743b21, master. Implementation is Stage-owned uncommitted work. P16_M_PRODUCTION_COMPLETE=NO; P16_N_READY=NO; P17=PAUSED.

## Authoritative relation audit and repaired boundaries

| Existing source | Actual authority / deficiency | P16-M implementation |
|---|---|---|
| customers/:id/context | Customer ID wins; legacy name fallback only without ID. Existing service loads catalogs before slicing | customer.orders preserves ID precedence, unique exact legacy name, SQL count/keyset/LIMIT |
| orders/:id / orderRow | customerId/customerName exist, broad purchase-plan DTO unsuitable | order.customer projects one exact canonical customer; stale ID never falls back to name |
| collections/read orders detail | Approved line recipeName/qty/unitPrice, no current product identity | order.lines preserves saved line semantics, never invents product IDs |
| recipes/:id | Saved parts_json available, no approved bounded canonical component relation | recipe.parts exact saved BOM references, governed Business-service resolution |
| recipes/:id/inventory-status | Legacy first model+supplier or model-only find can collapse ambiguity | NOT reused as identity authority; new relation rejects zero/multiple candidates and mismatched explicit IDs |
| recipes list | No reverse partId relation route | part.recipes exact saved JSON references in Business SQL, bounded candidate validation |
| parts list | Formal low/out/attention/ok exist; legacy JS filtering lacks keyset/count | parts.stock uses same threshold5, SQL filtering/count/pagination before transfer |
| Part current price/inventory | Existing formal catalog values, not product manufacturing cost | part.facts composes stock + catalog unit price with explicit units, separate fields |

Eight audited boundary shapes include two uses of the collections endpoint, not eight distinct routes. The new formal read route is POST /api/relations/read, capability relations.read, Tool read_relation. Candidate-only exposure; never added to Legacy/MCP runtime execution. API-reference is updated in the existing read category; capability registration, input schema, service, route, executor and tests are included.

## Closed plan and identity authority

- Seven execution relations: customer.orders, order.customer, order.lines, recipe.parts, part.recipes, parts.stock, part.facts.
- Semantic catalog: ten choices (six entity-rooted relations and four stock predicate variants). Model chooses choiceRef/topN/confidence only. Unknown keys/choices and unsupported combinations reject. No model-produced Tool/API/SQL/arguments/IDs.
- Source identity is separate from investigation choice. A single explicit quotation identifies an exact raw source substring only, never a canonical entity. Otherwise the existing source-span selector is reused unchanged. Governed lookup and resource-scoped finalization remain mandatory. Multiple explicit identity references fail closed. No fuzzy/first-result selection.
- Additional semantic selection call: one per new request; an unquoted entity root may also use the existing source-span model slot. No retry. Current corpus's explicit source identities require one semantic call; valid continuation/ordinal require zero. Quotation is not an authentication or canonical identity bypass.
- Plan V1 is deterministic and deeply frozen. MaxReadSteps=4. Entity plans: approved root detail, then relation; collection stock plan: one relation query. Full graph equality validates tools, bindings, ordering, acyclic dependencies and budget before execution. No dynamic append or recursive investigation.
- Downstream rootId is read only from the scoped VERIFIED root detail's canonical ID. The relationship API verifies the same root. Governed identity lookup is outside the investigation Tool-step count and is not hidden as an answer read; entity paths have one such lookup in addition to two planned reads.
- Each step has an opaque task/context-bound evidence handle. Combined ledger requires formal root evidence where applicable and formal relation evidence. Failed root, wrong relation/root, missing dependency, wrong-task access or forged proof rejects before answer. No partial completion answer.

## Business bounds and semantics

- Default page20/max50; deterministic id DESC keyset. SQL COUNT for customer orders and stock filters, exact counted bounded references for nested/reverse relations. Empty results are valid.
- Nested saved arrays max50. Reverse recipe candidate scan max512; overflow/invalid sources fail closed, never silently claim a complete result. Raw JSON remains inside Business service. Candidate receives approved projected fields only.
- Global cap262144 unchanged. No full registry transfer to V5. Unknown row fields reject; typed numeric/string and identity checks run before delivery. No truncation-to-fit behavior.
- Exact BOM model/supplier (or explicit consistent partId) resolves current part references. A specified supplier never degrades to model-only. Duplicate same-model records without a unique exact identity remain ambiguous. Explicit coil-rotor roles are excluded and reported as exclusions, not relabeled as parts. This is saved BOM reference coverage, not assembled dynamic BOM coverage.
- order.lines identities are order-local line indices, not product/order canonical IDs. Their ordinal follow-up is unsupported and fails closed; no incorrect order binding. Other canonical relation pages support existing P16-L ordinal detail.
- stock low:0<stock≤5; out:stock≤0; attention:stock≤5; ok:stock>5. NULL uses existing formal query's0 convention. Catalog price is not manufacturing cost. No generic finished-product inventory/cost inference.
- Per-page/step read transactions do not imply a historical cross-step or cross-page snapshot.

## Continuation and answer

P16-L continuation store is extended with VERIFIED relation promotion; same principal+conversationId namespace, queryId/token validation,10-minute TTL,128-context bound and conversation lease. Frozen relationRequest carries root/filter/page size; only afterId advances. Continuation does not re-plan or reclassify filters. Wrong namespace/principal/token/query, expiry or forged evidence cannot access another query. A relation continuation cannot accidentally enter the ordinary collection executor.

Answer rendering is deterministic, Tools=NONE. Only verified typed relation fields enter it. Counts, returned rows, inventory/price fields, filter descriptions and continuation are contract-driven. No causal reasoning or business summary is fabricated. Business text is escaped for Markdown without stripping identity punctuation. No answer/raw row/source snapshot logging added.

## Certification history (retained, not overwritten)

| Frozen version | Fixed semantic decisions | Finding |
|---|---|---|
| V1 | 22/90 | Fragmented relation/root/filter output allowed inconsistent field combinations and incomplete source selection |
| V2 | 84/90,28 per repeat | Relation×span choice expansion hit catalog bound and obscured one stock predicate |
| V3 | 90/90,30 per repeat | Fixed ten-choice catalog; source extraction separated from semantic class |

Each version used the same30 questions. Changes were generic contracts/catalogs, not question-specific branches. No unchanged-version rerun-until-green. Full answer UAT ran only after V3 semantic PASS and exactly once.

- Full UAT:29 PASS /1 unavailable (M-18); all29 admitted paths validated. Actual/planned investigation reads maximum2, hard limit4. Six controlled write/mixed negatives: WRITE_OR_MUTATION, semantic calls0, Tools0, answers0.
- Follow-up control cases: risk/semantic calls0, normal/filtered continuation and ordinal detail grounded in verified state. Stable fixture page boundary has no duplicates/skips; namespaces, TTL and tampering have deterministic tests.
- Production business calls for certification:0. Fixtures are migrated in-memory databases; fixture construction is not V5 business mutation. After-fixture UAT total_changes delta0.
- Metadata capture: orphan spans0, cross-request contamination0, raw-question trace leakage0, normal-answer technical parameter leakage0. No business rows, answer bodies, credentials or tokens persisted in evidence files.

Evidence: `data/p16m-semantic-certification.json`, `data/p16m-semantic-v2-certification.json`, `data/p16m-semantic-v3-certification.json`, `data/p16m-investigation-certification.json`, `data/p16m-risk-availability.json` (relative to ai-governance).

Automated checks:

- Focused P16-L/owner/narrow/relations suite:67/67 PASS.
- API contract:26/26 PASS, route table/registry counts aligned.
- npm test:2293/2294 PASS; only pre-existing missing `.guardian/config.yaml` businessTerminology test fails. Separate prerequisite suite2/2 PASS.
- Build PASS.
- Isolated timing: semantic selection median439ms; successful non-control investigation end-to-end median1022ms/p951435ms; maximum certified relation response2495bytes. These are not production latency measurements.
- Deep API retains pre-existing search_coils copperBase/current API consistency failure; no unrelated fix attempted.
- Frozen capability hash tests updated only for the reviewed additive READ investigation capability. No entity Task Class/risk/model/lookup pins changed.

## Production preservation and remaining release gate

Read-only final check: Legacy revision12fee179b6074215cf359bcc1a789ce1a345b9ba, PID59155, ready; no source diff. Candidate PID80116, ready, still /Users/dan/pump-p16l-prodr4/source. Owner-default remainsON. Business DB hash/mtime/size and34 backups match the starting snapshot. No deployment, process signal, restart, config mutation or data change occurred.

AI_V5_MULTI_READ_ENABLED remains source-defaultOFF and was enabled only in isolated harness options. Original API gaps no longer require another architecture approval prompt. No production release or commit claimed.

### M-18 supplemental end-to-end certification

After the user requested autonomous resolution, one additional focused M-18 request was fixed in advance and executed with unchanged wording, real risk/semantic models and real internal HTTP against the isolated fixture. `scripts/certify-p16m-m18-focused.cjs` refuses to overwrite its evidence. No runtime retry, prompt change or risk bypass was introduced.

Result: PASS; READ_SAFE; risk calls1; planned/actual Business Tool reads2; canonical identity and both authoritative fact fields correct; validated delivery1; technical leakage0; business mutation delta0; latency1286ms. Only metadata is stored in `data/p16m-m18-focused.json`; answer bodies and business payloads are not stored.

This closes the missing M-18 end-to-end evidence, not the cause of the historical unavailable classification. Original full UAT remains29/30; supplemental M-18 is1/1. All30 distinct cases now have successful execution evidence, but this is not a single30/30 run. The original classifier failure reason was not retained, so no specific transport/parsing defect is claimed fixed. Five earlier risk-only successes and this focused success indicate non-persistent availability, not guaranteed future availability. Production certification/deployment and the strict original single-run release criterion remain uncompleted; safe fallback remains required.

V5 Writes=0; allowWrite enabling calls=0; Business Mutation Calls From V5=0; Candidate DB Mutation Successes=0; Production Business Data Modified=NO. User-owned changes preserved. No P16-N or P17 execution.

## Production attempt after user-directed continuation

Implementation committed as e89a2d695856556ddcb34813735184d367cbe2d0. Only45 reviewed Stage files/hunks were committed;12 unrelated tracked working-tree files remain byte-preserved. No push. The persistent adapter gained exact-boolean multiReadEnabled (defaultOFF) and closed metadata fields. A Git-tree archive excluded user changes, local databases, dependencies and secrets;451 canonical Candidate/script hashes matched on Mac mini.

Clean-artifact API contract26/26, focused regression68/68, buildPASS. Initial clean test setup lacked Web dependencies/database/backups and exported different line endings; those environmental differences were isolated, and the24 frozen/DB-import tests then passed using content-equivalent source with original byte line endings. The existing Guardian missing-config failure and Deep API copperBase mismatch remain known failures; no global all-green release claim.

Candidate e89a2d6 was activated under the existing non-root supervisor (PID81407), then a fixed production cohort executed19 ordinary-route requests:17 positive attempts,12 validated V5 successes,5 safe Legacy fallbacks; shared-admin and anonymous controls both excluded Candidate. Customer-orders, order-customer, order-lines, part-recipes, stock filter, relation continuation and part stock/price composition passed. Inventory, coil inventory and recipe-cost narrow probes also passed.

Failures: orders list and direct order detail returned INVESTIGATION_SOURCE_UNAVAILABLE; the order ordinal had no successful prior page and returned RISK_NOT_ELIGIBLE; order count returned RISK_UNAVAILABLE; price returned RISK_NOT_ELIGIBLE. This exposes a non-applicable-read routing/availability gap at the additional investigation entry. Original model selections were not retained, so no specific model output is asserted. One isolated unchanged orders-list semantic diagnostic subsequently selected NOT_APPLICABLE; that does not erase production failures or prove stability. Production write-negative harness did not complete (CERTIFICATION_CONTRACT_FAILED); its acceptance is NOT_RUN, notPASS. No Legacy mutation request was sent.

Recipe-parts failed formal preflight with RELATION_NOT_FOUND. A separate readonly source-shape audit found24 saved references:1 excluded coil role,22 unique exact part references,1 missing exact model+supplier reference. The same model exists under a different supplier. Automatically dropping the supplier or choosing that row would violate identity governance. No production record was modified and no source values/names were logged. This needs an explicit missing-reference answer policy or owner-approved data correction, not fuzzy binding.

Because mandatory certification failed, prior P16-L source /Users/dan/pump-p16l-prodr4/source was restored and is healthy. Legacy remains revision12fee179b6074215cf359bcc1a789ce1a345b9ba, PID59155. Business DB hash/mtime/size and34 backups unchanged. Metadata privacy leakage0, orphan spans0, cross-request contamination0. M is NOT active in production. Final intended-artifact rollback/reapply certification is not claimed complete. P16_M_PRODUCTION_COMPLETE=NO; P16_N_READY=NO; P17 remainsPAUSED.

Operational metadata evidence: output/p16m-release/production-uat.json and remote /Users/dan/pump-p16m/reference-audit.json. No question/answer/business payloads or credentials are persisted there. Remaining work is the generic M-vs-existing-read routing boundary and explicit handling of an authoritative missing supplier-specific BOM reference.

## Owner-approved missing-reference policy

The owner subsequently approved displaying verified recipe part references alongside explicit missing-reference notices, without substitution or data changes. recipe.parts now retains exact authoritative NOT_FOUND references in a bounded referenceResolution projection, separate from canonical items and verified-part totals. A verified absence does not acquire a canonical identity, price or inventory. Current-page ordinal bindings still contain only verified part IDs. Duplicate saved references, missing references and unique canonical part counts are distinguished.

Only exact absence is recoverable under this answer contract. Ambiguous matches, explicit-ID conflicts, invalid source JSON, malformed values, exceeded bounds and technical/transport errors remain fail-closed. Reverse part.recipes semantics are unchanged. All-missing results explicitly report unresolved references, not an empty BOM. The global payload and nested50 bounds remain unchanged. These are local changes; no production deployment occurs for this policy alone, since the separate M-vs-existing-read routing regression remains unresolved.

Verification: relation/investigation/collection regressions40/40; API contract26/26; full suite2297/2298 with only the known missing Guardian config failure (prerequisites2/2). Deep API retains the known copperBase mismatch. Added coverage includes mixed/all-missing references, no supplier/ID substitution, canonical-page isolation, duplicate-reference versus unique-part counts, pagination replay, tampered warnings/counts, malformed source and technical failures. No new runtime failures found in these checks. No production write, deployment or read-routing change in this policy turn.

## Investigation entry repair and fixed repeat certification

Code audit confirmed a deterministic protocol mismatch: the frozen Stage1 source selector returns exactly two span references, while investigation entry required exactly one. Unquoted investigation roots therefore always failed that adapter. The repair consumes both through the existing governed candidate union, then the existing resource-scoped finalizer. A second-only exact match is permitted; incomplete lookup or multiple same-type canonical identities fail closed before Business Tools. Neither the source selector, governed lookup semantics nor risk stage was changed.

Root extraction validity is now enforced only after a true investigation is selected. Existing-read delegates never require an investigation root. V4 used two coarse delegate choices; its fixed44-question ×3 semantic run scored120/132. Failures included whole order detail incorrectly selecting order.lines and single inventory/price incorrectly selecting part.facts. Evidence is retained in data/p16m-entry-v4-certification.json.

V5 replaces coarse delegates with the existing15 collection catalog entries and four explicit narrow-fact entries, alongside ten investigation choices (29 total). No extra model stage, execution capability, business domain or risk bypass was added. The same frozen44 questions ran exactly three times, no retries:120/132, hashes unchanged. All10 existing-read controls and four unquoted-root variants were correct across three runs. The original M corpus was26/30 each run (78/90): M-19, M-21, M-23 and M-24 returned NONE instead of part.facts in every repeat. These are two-fact inventory-plus-price requests. The evidence does not retain the selected delegate, so NONE cannot be attributed to a particular delegate. V5 is REWORK, not production-certified; no further unchanged-version rerun, full Answer UAT or deployment followed. Evidence: data/p16m-entry-v5-certification.json.

Current deterministic focused regressions42/42 and API contract26/26 PASS. The full suite run before V5 catalog substitution was2299/2300, solely the known missing .guardian/config.yaml; it is not claimed as a post-V5 full-suite result. Remaining work is stable generic multi-fact semantic identification, not entity authority, business values or pagination. All new changes remain uncommitted; unrelated user changes remain preserved. No production process/config/data operations occurred during this entry repair. P16_M_PRODUCTION_COMPLETE=NO; P17 remains paused.

## Current continuation checkpoint: entry V6

Four fixed V5 classification diagnostics confirmed M-19/M-21/M-23/M-24 all returned NOT_APPLICABLE, not a particular existing-read delegate. A code audit found that investigation catalog construction discarded the authoritative relation semantics, whereas collection delegates retained descriptions. V6 preserves semantics for all seven relation classes and adds bounded generic descriptions; part.facts explicitly declares its two required fact classes. This is a catalog repair, not a full-question match, a new Tool or model stage. Source extraction, governed resolution, risk behavior and production remain unchanged.

The same44-question semantic corpus ran exactly three times once for V6:132/132, unchanged source hashes. This includes the original M30/30 ×3, existing-read10/10 ×3 and unquoted-root4/4 ×3. Evidence: data/p16m-entry-v6-certification.json. Deterministic tests43/43, API contract26/26, full suite2300/2301; the only failure remains missing .guardian/config.yaml.

After that gate passed, the unchanged30-question full owner fixture UAT ran once through real risk/semantic models and real internal HTTP:29/30. M-24 returned RISK_UNAVAILABLE before semantic/execution, zero Tools and no delivered answer. All other29 cases passed canonical/evidence/answer verification; all six mutation negatives were WRITE_OR_MUTATION, zero semantic calls/Tools/answers. No fixture business mutation, orphan span, cross-request contamination or question trace leakage. Evidence: data/p16m-entry-v6-uat.json. This is not a30/30 full-run PASS.

Five fixed independent M-24 risk-only diagnostic requests then all returned valid unfenced JSON, HTTP200, READ_SAFE (5/5). They do not replace the failed full-UAT observation or prove its original cause; no raw provider response was retained for the failure. Evidence: data/p16m-entry-v6-risk-availability.json. Runtime retries remain zero. Do not rerun the full corpus until green or weaken risk. The remaining issue is intermittent risk-stage availability with insufficient original failure-category evidence, rather than the now-certified dual-fact semantic route.

Resume here: HEAD e89a2d695856556ddcb34813735184d367cbe2d0, master; all subsequent Stage fixes are uncommitted alongside unrelated user changes. Production still uses the prior stable P16-L artifact; no production access/deployment or mutation was performed in this continuation. Before release, close risk failure diagnostics/fallback evidence and current-artifact existing-read end-to-end regression, then use the established isolated Candidate release/rollback mechanism. Do not use the general Legacy-restarting deployment script. P16_M_PRODUCTION_COMPLETE=NO; P16-N not started; P17 paused. The owner's missing supplier-reference policy remains verified results plus explicit missing notices, never substitution.

## Owner disposition: historical risk availability event (non-blocking)

The owner explicitly requested investigation of RISK_UNAVAILABLE and, if no fix can be established, retention as a historical intermittent event rather than continued blockage. Read-only audit confirmed requestRisk can fail at provider transport, provider envelope, JSON parsing or strict risk schema validation; classifyCandidateRisk catches these without retaining the underlying cause. The original M-24 record contains only the collapsed failure class and832ms elapsed time. It cannot establish a specific provider, parsing or schema defect; in particular no30-second timeout is demonstrated. The previously frozen five diagnostics all returned valid HTTP200/READ_SAFE; no additional real-model reruns were used to chase success in this disposition.

Current isolated risk and gateway regression22/22 PASS: invalid/throwing/timed-out risk produces no V5 interpreter/resolver/Tool/answer execution; RISK_UNAVAILABLE at the gateway returns exactly one fixture Legacy response, one Candidate attempt, no Candidate retry or failed-body exposure. This verifies failure handling with fixtures, not the actual historical Legacy answer. No risk code, prompt, model, execution permissions or production state was changed.

Disposition: HISTORICAL_INTERMITTENT_RISK_AVAILABILITY_UNRESOLVED_CAUSE; non-blocking by owner decision. Preserve full-UAT29/30 and the historical failure unchanged, not relabelled30/30. This supersedes treating M-24 availability alone as a release blocker. Current-artifact existing-read end-to-end checks and isolated production deployment/certification remain required; production readiness is not automatically granted by this exception. If it recurs, capture bounded error-category metadata before proposing a targeted repair. No automatic retry or safety bypass is authorized.

## Existing collection regression and bounded delegate correction

The original30-question P16-L corpus was executed once with M enabled, real models and fixture HTTP:23/30. Five Top-N list requests failed INVESTIGATION_SEMANTIC_INVALID. A fixed L-15 diagnostic confirmed the model selected existing.customers.list with topN10/high confidence; the delegate adapter incorrectly required null topN. The generic repair permits integers1..50 only for list delegates; detail/count/narrow delegates still require null. Delegate arguments are discarded here, never forwarded as execution arguments; the existing collection interpreter independently validates the actual query. Unit tests cover all15 collection delegates, four narrow delegates and invalid bounds/types. No question-specific rules, execution permissions or risk changes.

The old collection harness also lacked the formal entity-span-candidates route now required by the certified coil detail bridge. It was registered against the fixture DB, without production code changes. After these two explicit changes the same30 questions ran once:28/30, hashes stable (data/p16m-existing-collection-topn.json). All five Top-N requests now pass. Initial evidence retained at data/p16m-existing-collection-v6.json. Current focused tests44/44, API contract26/26, buildPASS; narrow fact/owner/risk/gateway regression38/38.

Remaining cases are distinct from the waived historical risk event:
- L-09 names a nonexistent customer. M selects customer.orders and governed root binding returns COLLECTION_TARGET_NOT_FOUND; the original P16-L Oracle expects an empty name-filtered order list. These are different authority contracts. Do not invent a customer ID, infer an order count from missing customer identity, or silently waive this difference.
- L-29 names fixture coil63. After the route is present, direct authoritative supply confirms two exact occurrences: fixture coil6 and coil63, at offsets2..6 and2..7, candidateCount2/scanCount126. Existing exact-span governance refuses ambiguity; do not pick longest/first or change frozen supply semantics. The old fixture Oracle assumes a unique identity. The runtime reports generic PREVIEW_INTERNAL_ERROR for this non-COLLECTION-prefixed error; the direct supply audit establishes the fixture collision, not an admitted incorrect target.

No deployment/commit in this continuation. Read-only production check confirms Legacy revision12fee179b6074215cf359bcc1a789ce1a345b9ba/PID59155 healthy; stable Candidate /Users/dan/pump-p16l-prodr4/source healthy. DB hash490d011f44aa85b50749235467d60c563d131b9d8ab058e32f7e94dc7b390f00, mtime1788697665837.5352, size28106752 and34 backups unchanged. P17 remains paused. Next resolve the two regression Oracle/identity applicability distinctions explicitly, retain genuine fail-closed negative coverage, then certify the final artifact rather than reusing earlier132/132 hashes after the Top-N adapter change.

## Latest owner decision: candidate discovery and explicit disambiguation

The owner now explicitly requests two behaviors, superseding a terminal refusal for these read interactions:
1. Missing exact customer may return target-not-found, followed by keyword/surname customer candidates for selection. A keyword query should expose all matching customers via bounded pages, not truncate silently or transfer an unbounded registry.
2. Coil detail with two identities must ask which candidate, or whether both are wanted. No automatic first/longest/fuzzy target selection.

Implementation audit (no feature implementation yet): customers.list / GET /api/customers already supports name containment, but customerQueries.getAllCustomers loads listCustomers() then filters/slices, so it is unsuitable as the bounded Candidate discovery transport. P16-L collectionReadContract has no customer keyword filter. Its current continuation store contains verified page row IDs and frozen queries, but no pending-disambiguation purpose or original investigation binding. exactAuthoritativeSpan correctly preserves multi-span ambiguity; it must not be changed into an automatic resolver.

Next implementation scope:
- Add bounded server-side customer keyword discovery to the governed read boundary, with approved projections, authoritative count, id-desc keyset pages, default20/max50. Treat literal user keyword matching as discovery, not canonical resolution or spelling/semantic similarity. Register/update capability/schema/service/route/executor/evidence/API documentation under the existing SOP.
- Model may identify a customer-search intent and source span, never invent a keyword by deleting arbitrary words or select a canonical ID. A bare surname can use explicit current customer-selection context; absent resource context requires clarification, not guessing a domain.
- Preserve exact lookup. On verified absence/ambiguity only, create bounded VERIFIED candidate-choice evidence. Transport/protocol failures are not missing targets and must still safely fall back. Display candidate names with necessary approved distinguishing fields; candidates are not automatically substitutes, even when discovery returns one.
- Pending choice binds authenticated principal + conversationId + original read purpose + candidate page/query + TTL600000ms. Reuse the namespace/lease/limits, not a global last choice. A new unrelated question invalidates pending choice; expiry/wrong principal/wrong conversation/tampering cannot execute.
- Explicit choice of an advertised ordinal continues the frozen original read using that canonical reference, with authoritative reread/evidence. Preserve the distinction between selecting a customer for its orders and merely opening list-row detail. Selection grammar must not swallow write-bearing instructions.
- Coil ambiguity first resolves each bounded exact span through existing governed lookup, preserving real same-type ambiguity. Show the resulting canonical choices; one chosen target uses the existing detail executor. For the requested two-target case, both uses those two displayed identities only, max2 details within maxReadSteps4, no arbitrary all-domain expansion or partial unverified combined answer. Same-canonical aliases deduplicate; different entities do not.
- Tests must cover surname/keyword with >1 page, zero/one/multiple candidates, selection continuing original purpose, coil choose-one/choose-both, frozen candidate identity, expiry/tamper/cross-conversation/principal, mutation-bearing choice denial, no-row/value telemetry and prior P16-L/M regression. Local certification precedes isolated production release; no Legacy code/restart, no writes, P17 paused.

Handoff state: current HEAD remains e89a2d695856556ddcb34813735184d367cbe2d0 on master. Stage work and unrelated user-owned changes are still uncommitted; do not stage the entire worktree or run the old one-shot prepare-p16m-release script. The historical M-24 risk availability failure is explicitly non-blocking but retained29/30; latest collection regression is28/30 and its two cases motivate this newly approved interaction contract. No production changes in this requirement-audit turn. This section is an implementation handoff, not a claim that discovery/choice is already usable.

## Candidate discovery and explicit choice: local implementation closure

Owner scope: continue the final handoff locally, preserve uncommitted work, do not touch Legacy or enable business writes. Implementation reuses `collections.read` / `read_collection`; no extra Tool, route, database schema, fuzzy resolver or write permission was introduced. Formal input schema, capability registration, SQL service, existing executor/evidence path and the original API-reference/collection-contract chapters were updated together.

Customers/list accepts `customerKeyword`, a nonblank1..160-character literal user source substring. Business SQL applies parameter-bound `instr(name, keyword)>0`, authoritative COUNT and id-desc keyset/LIMIT in the same page transaction, default20/max50. Wildcards and punctuation remain literal; zero/one/multiple candidates are not canonical resolution. Existing exact lookup remains mandatory for direct identity. Only verified exact absence/ambiguity can open recovery; incomplete/technical lookup failures cannot. Two absent alternative source spans produce a keyword clarification context rather than arbitrarily selecting one alternative as the search string.

Pending choices carry an opaque verified proof and freeze the original read purpose, candidate query/page and canonical references in the existing principal+conversation namespace, lease and128-context limit. Initial expiry is600000ms and cannot be extended by pagination/refinement or snapshot tampering. Explicit ordinal choice consumes this context before authoritative reread. Customer-orders purpose executes the existing root+customer.orders plan, preserving the original requested relation page size; it does not become customer detail. A new unrelated question clears the pending purpose. Failed delivery, failed execution, expired/wrong namespace/token or forged proof cannot deliver or reuse a choice. Keyword interpretation receives a customer-selection context flag only, never rows, IDs or original executable parameters.

Coil ambiguity preserves the original exact span supply and governed lookup. Each bounded occurrence is independently resolved and scoped to coil; same-canonical aliases deduplicate, different identities remain separate. Two identities acquire approved formal detail projections before being advertised. Explicit one/both choices reread only those displayed identities, max2 details within the existing4-step budget. More than two identities or any incomplete/failed read rejects safely. Both answers are buffered until both reads validate; there is no partial combined answer, longest/first selection or global expansion. The original single-span implementation and all narrow-fact Task Classes remain unchanged.

### Fixed certification and retained failures

| Artifact | Result | Meaning |
|---|---|---|
| `data/p16m-candidate-choice-v1.json` |16/18, REWORK| Single-surname refinement lacked an explicit pending-customer description in risk context; the following ordinal consequently had no usable context. Both had zero Tools. |
| `data/p16m-candidate-choice-v2.json` |18/18, PASS| Candidate risk input now describes the privately certified pending customer keyword/selection context. Base risk model, schema, normalizer, decision rules, timeout and no-retry policy remain unchanged. |
| `data/p16m-candidate-choice-v3.json` |18/18, PASS| Final runtime additionally validates fixed expiry against the private entry and customer-purpose/page consistency. Hashes match before/after; mutation delta0, question trace leakage0, orphan spans0, cross-request contamination0. |
| `data/p16m-choice-existing-read-regression.json` |58/60 oracle PASS;60 validated deliveries| The new harness incorrectly expected one Tool on rooted relation continuation M-25/M-26; the existing plan correctly reread root+relation using two. This record is retained unchanged. |
| `data/p16m-choice-existing-read-regression-v2.json` |60/60, PASS| Corrected the generic harness step-count expectation for all rooted relation pages; reran the same fixed60 questions once. No runtime change or runtime retry. Hashes match and mutation delta0. |

The original L/M wording is unchanged. L-09 alone uses the approved verified-missing-customer/candidate-selection oracle instead of inferring an empty order set; L-29 alone uses two verified coil choices instead of an assumed unique identity. Actual choice selection, continuation, same-original-purpose execution and choose-both are separately covered in the18-case cohort. The isolated standalone-surname negative certifies no guessed domain or Business Tool execution; it is safe Candidate non-admission/fallback, not evidence of the eventual Legacy clarification wording. Historical full-UAT29/30 risk availability records remain unchanged and are not relabelled by these later runs.

Automated validation:11 new candidate-choice tests plus the existing collection/relation/risk/owner suites; final complete suite2313/2313 PASS, API contract26/26 PASS, deep API439/439 PASS (isolated copied DB integrityOK, zero FK violations), buildPASS and scoped ESLint/syntax checksPASS. The earlier copperBase deep-API mismatch did not recur in this run; no unrelated price/coil repair is claimed. Candidate fixture business mutation deltas are0. Fixture construction and the separate existing isolated API test suite do not enable V5 business writes.

During this turn the owner explicitly confirmed that the old Guardian workflow had been removed and requested removal of `.guardian/config.yaml` and its directory. Live inspection found the directory already absent and no tracked `.guardian` files. The only active reference was the obsolete mandatory config read in `businessTerminologyContract.test.cjs`; that entry was removed, without weakening the remaining product-naming assertions or recreating old workflow configuration. Focused terminology tests6/6 and the complete2313/2313 run close the former missing-config test failure. Historical reports retain their original observations.

HEAD remains e89a2d695856556ddcb34813735184d367cbe2d0 on master. All work remains uncommitted. The23 initially modified tracked files were byte-snapshotted before editing; only investigationRuntime and the three in-scope documentation files (README/API reference/this report) were subsequently extended, while the other19 remained byte-identical. Existing untracked work was not removed or staged. No old release script, remote access, process signal, deployment, production configuration or business-data operation was performed. No claim is made about a fresh production snapshot in this local-only turn. P16_M_PRODUCTION_COMPLETE=NO; P16_N_READY=NO; P17 staysPAUSED. Any later production certification must still use the isolated Candidate mechanism and preserve Legacy.
