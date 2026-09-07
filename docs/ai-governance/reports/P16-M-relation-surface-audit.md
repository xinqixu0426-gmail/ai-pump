# P16-M — Governed multi-read implementation and certification

## Current decision

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
