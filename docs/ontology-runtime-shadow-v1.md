# ONT-P3 — 1-Hop Runtime Shadow V1

## Purpose and architecture

Current AI runtime remains the sole authority for user-visible behavior. Ontology only observes a relation the current tools have already read, independently reads it through ONT-P2 and compares canonical identities. It does not solve the large-list/model-context problem in this phase.

Integration is at the successful end of `runAiAssistant`, after final answer grounding, content/detail/done events and session completion. An ON request queues `setImmediate`; lazy ontology imports, eligibility, SQLite work and telemetry execute outside the authoritative completion. Protected command runtime is untouched. No relation-specific runtime, shortlist or graph hard-code was removed or replaced.

```text
Current assistant -> current tools/APIs -> current evidence -> current answer
                                                           -> asynchronous observer
                                                              -> read-only worker/P2
                                                              -> canonical comparison
                                                              -> bounded local record + metadata span
```

There is no shadow result return channel to the assistant. Answer, model messages, tools, arguments, TaskEnvelope, EvidenceBundle, Presenter and Grounding cannot consume it.

## Flag, budgets and failure isolation

`AI_ONTOLOGY_RELATION_SHADOW_ENABLED=false` is the default in `.env.example`. Only a trimmed case-insensitive `true` opts in; absent/false/0/off stay OFF. No production `.env` or saved runtime settings were changed. OFF does not import ontology, schedule observation, call its resolver, read its DB or create comparison records. The existing assistant does only the flag check; no shadow work enters its latency accounting.

`maxHop=1`; `maxShadowRelationsPerRequest=1`. Select the first eligible, formally executed context in tool execution order, skipping unavailable root identities. Other relations are not read. No retries, pagination completion, recursive traversal, chained reads, new classifier, NL planner or model calls occur.

The worker opens the existing database with `readonly:true`, `fileMustExist:true`, `query_only=ON`, and SQLite lock timeout 100ms; it does not import `api/db.cjs`, migrate, checkpoint, repair or start background services. A 1500ms independent wall-clock timeout covers worker construction/load/read. Timeout terminates the worker; a maximum of four workers per process prevents unbounded concurrent observer resource consumption. Busy observations fail open as technical failure. One bounded P2 page (50 targets) is read; `hasMore` is incomplete, never a mismatch. No extra page is read.

Worker timeout, worker crash, missing DB, P2 unavailable/incomplete, comparison difference and trace/sink failure never cause current-path retry, fallback, model call, confirmation, command, knowledge write or answer rewrite. Failed/cancelled current requests that do not reach authoritative completion do not schedule shadow.

## Deterministic eligibility

Require current successful `formal_api_query` execution evidence with an actual GET path, canonical root ID and registered relation. Model arguments or ID-shaped user text alone are insufficient. Root identity comes from current formal response rows; names never bind ontology roots or targets.

| Current executed result | Observed relation | Current canonical evidence |
| --- | --- | --- |
| `get_recipe_detail`, verified GET `/api/recipes/:id` | `recipe.contains_part` | Persisted `partsJson` decoded with shared bounded parser, or existing decoded `parts`; `partId`, shared non-part role exclusion |
| `search_coils` with exactly one result plus verified unfiltered `get_all_recipes` | `coil.used_by_recipe` | Existing `isCoilRecipeRelationQuery` signal; coil ID and all recipe rows' `coilId`; no name/spec binding |
| `get_order_detail`, verified GET `/api/orders/:id` | `order.belongs_to_customer` | Formal order ID and `customerId` |
| `get_quotation_detail`, verified GET `/api/quotations/:id` | `quotation.belongs_to_customer` | Formal quotation ID and `customerId` |

Legacy target references may still have an eligible canonical root/relation, allowing one independent read, but cannot be compared as complete canonical current facts. Ambiguous/multiple coil roots, filtered/partial recipe lists, unsupported tools or absent formal paths are not eligible. Current projection has a 512-row/target ceiling; larger data is incomplete and not scanned for identity comparison.

The observer checks the first actual formal context, which can differ from the relation or entity requested in natural language if current AI chose a different query. A MATCH proves those observed current facts agree with P2; it does not prove the original user question was answered or the requested missing entity exists. P3 does not change current selection behavior to increase eligibility.

## OntologyShadowComparisonV1

The deeply frozen contract is exported by `shadowContract.cjs` as `OntologyShadowComparisonV1` / `ShadowContractVersion=1`, with `ontologyVersion=1`:

- `requestId`: safe existing correlation ID or bounded hash; no conversation ID.
- `relationId`, `root:{entityType,canonicalId}`.
- `current:{sourceCapabilities,canonicalTargetIds,completeness,canonical}`.
- `ontology:{canonicalTargetIds,completeness,authority,resolverStatus,failureReason,provenance}`; provenance includes only registered source ID, known source service, UUID query ID, timestamp and canonical-only declaration.
- `comparison:{status,exactCanonicalMatch,missingInOntology,extraInOntology,classifications}`.
- `timing:{ontologyMs}`.

Compare deduplicated, numerically ordered strict decimal canonical ID sets of the declared target type. Ignore display labels, JSON ordering and duplicate references. There is no similarity matching, embedding or LLM judge. Current insufficient canonical evidence takes precedence over any mismatch classification.

| Status | Meaning |
| --- | --- |
| MATCH | Both complete canonical results agree |
| MISMATCH | Comparable complete results differ, or successful source reports inconsistent root/relation/completeness |
| CURRENT_PATH_NOT_CANONICAL | Current target identities are absent/invalid/legacy; not a mismatch |
| CURRENT_PATH_INCOMPLETE | Current result is malformed, bounded or lacks complete relation evidence |
| ONTOLOGY_INCOMPLETE | P2 unresolved/ambiguous saved references, or bounded page has more targets |
| ONTOLOGY_UNAVAILABLE | Missing root, unavailable/invalid source or P2 scan bound |
| ROOT_IDENTITY_UNAVAILABLE | Relation context exists but canonical root cannot be established; no worker |
| NOT_ELIGIBLE | No supported executed formal relation context; no worker |
| TECHNICAL_FAILURE | Observer worker/resolver failure or timeout; record-only |

Mismatch classifications: `TARGET_MISSING_IN_ONTOLOGY`, `TARGET_EXTRA_IN_ONTOLOGY`, `COMPLETENESS_MISMATCH`, `ROOT_IDENTITY_MISMATCH`, `RELATION_MAPPING_MISMATCH`. Timeout, worker budget/crash, resolver exception and DB-open failure have bounded `SHADOW_*` failure reasons. No raw exceptions are retained.

## Privacy and observability

Reuse existing privacy-filtered OpenTelemetry/Phoenix instrumentation with span `ontology_relation_shadow` and attributes `pump.ai.ontology.shadow.{eligible,relation_id,root_entity_type,status,exact_match,duration_ms}` plus safe request correlation. No canonical ID arrays, root IDs, names, supplier details, prices, stocks, arguments, payloads, model reasoning, CoT or credentials are exported. Exporter failures are swallowed by existing fail-open instrumentation and the observer boundary.

The process retains only the latest 100 immutable comparison records in observer-local memory; restart clears them. Canonical IDs exist in this bounded local diagnostic store, never in model/evidence or client responses. There is no public endpoint for the store. A controlled test sink can capture records; sink failure is isolated. `recentShadowComparisons()` returns a new array of immutable records. Observability OFF still permits bounded local comparison records when shadow ON; shadow OFF creates none.

The acceptance script reads existing `.env` and encrypted runtime provider settings through a readonly source connection, holds credentials only in memory and reports only provider/model/configured status. It uses a disposable migrated fixture DB and the existing business routers/unified executor, with non-GET requests rejected by the acceptance server. Setup migrations/seeding happen before read-only checks. Reports contain only synthetic case IDs, statuses, known tool names, safe failure codes and call counts; reports/logs live under ignored `logs/` or `.log` paths. No production secrets/data are copied into fixtures or evidence.

## Corpus and metrics

The supplied P0 audit records 15 one-hop cases and family examples, but does not contain those 15 individual questions/expected results. Exact historical replay is therefore unavailable. `tests/helpers/ontologyShadowFixture.cjs` explicitly reconstructs a representative controlled corpus from the audited relations and boundaries; it is not presented as recovered original P0 cases.

Runtime observation corpus: 21 cases, covering four naturally supported observed families plus explicit `SHADOW_NOT_COMPARABLE` gaps for template, customer histories and order-recipe list paths. Includes populated, empty, renamed display, ID-less legacy, ambiguity, missing/unverified root, malformed snapshot, filtered lists, multiple coil roots and first-eligible budget. Results: eligible 13; comparable 8; MATCH 8; MISMATCH 0; current not canonical 3; current incomplete 1; ontology unavailable 1; root identity unavailable 1; not eligible 7; technical failure 0. Non-eligible total including unavailable root: 8. Successful reads and comparisons leave `total_changes()` and serialized database unchanged.

Separate comparator/source corpus exercises all six authoritative families / twelve directions plus empty, stale/missing, incomplete and ambiguity: 17 cases. These direct canonical comparison inputs verify source/comparator semantics, not twelve-direction natural AI eligibility. Taxonomy tests also deliberately inject all mismatch classes and failures; injected mismatches are not corpus failures.

Real AI: existing configured **DeepSeek / deepseek-v4-flash**, unchanged provider prompt/runtime, 15 unique representative questions run twice (30 executions). First run: eligible 8, compared 6, MATCH 6, current noncanonical 2, not eligible 7. Second run: eligible 6, compared 6, MATCH 6, not eligible 9. Aggregate: eligible 14/30 (46.7%); compared 12/14 eligible (85.7%); exact canonical match 12/12 comparable (100%); MISMATCH 0; current incomplete/noncanonical 2; ontology incomplete 0; shadow technical failure 0; not eligible 16. Both runs' fixture DB baselines are unchanged. Four observed directions/families occur across runs; second run alone observes three. No unexplained authoritative mismatch exists.

| Real case | First run | Second run |
| --- | --- | --- |
| recipe-part | MATCH | MATCH |
| recipe-empty | MATCH | MATCH |
| recipe-legacy | CURRENT_PATH_NOT_CANONICAL | NOT_ELIGIBLE |
| recipe-ambiguous | CURRENT_PATH_NOT_CANONICAL | NOT_ELIGIBLE |
| recipe-missing | NOT_ELIGIBLE | MATCH on a different formally read existing root |
| coil-recipe | MATCH | NOT_ELIGIBLE |
| coil-empty | MATCH | NOT_ELIGIBLE |
| coil-missing | NOT_ELIGIBLE | NOT_ELIGIBLE |
| order-customer | MATCH | MATCH |
| order-recipe | NOT_ELIGIBLE | NOT_ELIGIBLE |
| customer-order | NOT_ELIGIBLE | NOT_ELIGIBLE |
| customer-quotation | NOT_ELIGIBLE | NOT_ELIGIBLE |
| quotation-customer | MATCH | MATCH |
| recipe-template | NOT_ELIGIBLE | MATCH on formally read recipe-part context |
| template-recipe | NOT_ELIGIBLE | NOT_ELIGIBLE |

Current-path tool failures and differing provider query choices are preserved as coverage evidence. Unsupported knowledge endpoints in the narrowly mounted controlled fixture can produce current `INTERNAL_API_PROTOCOL_FAILURE`; those current failures are not ontology technical failures or verified negatives. No extra tool/hard-code was added to force coverage. Real execution is via current assistant and unified executor with actual temporary business HTTP routes, not public chat transport, SSE authentication or production deployment.

## Validation and ONT-P4 entry criteria

Automated tests cover default/OFF zero observer work, ON eligible-only reads, first stable relation budget, all statuses/classes, canonical-only identity and payload redaction, physical readonly worker, `total_changes()`/serialization equality, worker timeout, trace exporter/sink failure and actual assistant OFF/ON equivalence. Provider messages/tools, tool execution sequence/arguments, model calls, final answers and tool evidence are identical between OFF and ON fixtures. Public routes/tool catalogs/schema/dependencies remain unchanged.

Final local validation (2026-09-18): new P3 tests **26/26**; ontology/relationRead/identity/assistant/observability focused tests **300/300**; complete `npm test` **2304/2304**, no skips/failures; API contract **26/26**; isolated deep API **491/491**; Web `npm run build` PASS; changed CJS ESLint, syntax and whitespace checks PASS. Deep API used the existing original DB only as a readonly backup source into disposable isolated test databases. Build reused installed dependency junctions; no dependencies or lockfiles changed. No merge, push, deployment, production flag/config change or business migration occurred. Original master remains at `24106a1`, with its sole user-owned untracked P0 audit unchanged (SHA-256 `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`).

P4 requires Supervisor review of P3, the missing original P0 corpus, current result/identity coverage and temporal consistency. Preserve the current defaults until a separately authorized staged rollout. No current relation hard-code migration, planner, 2-hop expansion or answer/evidence authority is justified by the small P3 corpus. Before broader rollout, formal bounded/indexed relation APIs and comparable current results are needed; the 1500ms worker/page and conservative reverse JSON scan ceilings remain operational limitations. Concurrent business edits between current reads and later worker reads can yield real temporal differences requiring investigation; timestamps alone are not proof of a shared snapshot.
