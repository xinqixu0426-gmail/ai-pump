# V5-F1B / P16-A2 Read-Execution Certification

## 1. Executive Result

Status: PARTIAL. P16_B_READY=NO. One new full frozen evaluation completed: Tool selection, validated binding, execution success, result equivalence, evidence validity and verification all 15/15. Coil fully verified 3/3. No old 12-path results were spliced into this evaluation.

Real controlled performance certification FAILED: concurrent same-load p95 overhead was 10.5699%, 8.1557%, 10.5794%; two of three sets exceeded 10%. All sets retained. No scheduler, concurrency, binder, comparator or implementation changes/retries after evaluation. Current architecture is not certified acceptable by this gate.

## 2. Frozen P16-A/A1 Evidence

Start commit 595b5f47ba7725347b0c2c4b0e01e591c1651955, master, dirty worktree. User-owned V4/runtime/resolver/document/package/test edits remain untouched and uncommitted by this stage.

P16-A: correct selection 15/15, supported binding/execution/comparison 12/15, coil binding unsupported. A1 identified discarded authoritative bindable reference and incomplete coil result inspection. A1's synthetic scheduler measurements were not real execution certification. The current workload addresses that evidentiary gap without changing scheduling.

Unchanged: Interpreter V3 and its source/nested mechanisms, prompts/model/settings, classes/semantics, capability registry/router/exposure, Tool schema/Executor semantics, Contract V1, states, risk policy and scheduler concurrency 4. Only the existing independent-shadow execution handoff gains one software-only candidate argument. It does not change interpretation logic.

## 3. Binding Reference Contract

Entity Lookup API version remains 1; request, equality/alias policy, limits, completeness and canonical candidate selection stay unchanged. Optional generic bindingRefs array currently allows only coil + schemeCode. The value is read from the matched formal coils.scheme_code column in the existing bounded query, not from mention/name/model/canonical ID.

Other types retain the old candidate shape. Missing source code omits the reference and cannot enable coil binding. The strict V5 response validator accepts old three-field candidates and the approved optional reference only; wrong kinds/types, extra nested fields or duplicate references fail closed. No stock, cost, price or complete DTO added.

internalApiClient.lookupEntities already returns the contract unchanged and records only safe summary counts; no wrapper change was necessary. Candidate-set/refinement/finalization already preserve the software candidate. Local catalogs use only entity types; Stage1/Stage2 receive no bindingRefs. Interpretation/Task Contract V1 is unchanged.

Backward compatibility here means unchanged resolution/ambiguity and old payload acceptance by the updated consumer. Historical strict consumers need the coordinated optional-field reader; no claim of binary compatibility with an unupdated strict validator.

## 4. Coil Argument Binding

readExecutionRegistry's coil adapter now declares AUTHORITATIVE_SCHEME_CODE. bindReadArguments requires canonical ID/type agreement with the execution entity, resolution receipt, approved match kind and exactly one schemeCode string reference. Existing Tool validator must return the same argument object.

No raw mention fallback, canonical ID as code, aliases, defaults, model arguments or frozen case mapping. The candidate is handed to the execution adapter transiently outside Task V1; it is not copied into shadow outcomes.

## 5. A01 Safety

New deterministic tests cover missing reference/candidate, wrong kind/type/entity/ID/match kind, empty/whitespace value and duplicate references. All remain ARGUMENT_BINDING_UNSUPPORTED. Existing route/policy/receipt gates and source-preservation tests remain passing. No invalid argument reaches Executor.

Focused API plus binding/comparator tests 12/12. Combined V5 295/295. Existing A01 missing/wrong entity/receipt and wrong route tests remain intact. The old component-freeze test received explicit P16-A2 pins for the two approved additive contract files; corpus/expected semantic results were not edited or relaxed.

## 6. Coil Result Comparator

coilReadComparator compares transient formal GET /api/coils reference rows on the same query-only snapshot with search_coils result. Minimum fields: canonical ID, schemeCode, current stock. Reference acquisition uses the formal lookup-owned schemeCode, never guesses from source text.

Reference must be exactly one canonical row with valid code and finite stock; otherwise NOT_COMPARABLE. Result must be exactly one matching row with equal three fields; otherwise MISMATCH. Zero stock is valid. Full DTO/cost/copperBase comparison is intentionally excluded: frozen coil requirement is current inventory, not a cost computation.

## 7. Evidence / Verification

Existing formal query evidence must be verified and GET-only. Coil result inspection requires one row, requested canonical ID, bound schemeCode and finite stock. It then enters the existing coil.inventory EvidenceRequirement and EvidenceLedger, preserving the original policy/state/verification algorithms.

15 ledger entries, 15 VALID, 15 verification PASS, deferred/failed=0. Existing legal transitions and double write lock remain unchanged. Success is not inferred from success:true alone.

## 8. Performance Harness Correction

scripts/certify-v5-f1b-performance.cjs measures HTTP request arrival → server response finish. Client receive and shadow completion are separate. Fake V4 work is a fixed 20-ms response generator; Interpreter output is synthetic with no model call.

Execution is NOT an injected execute function: actual independentShadow → readExecutionShadow → controlledRuntime → existing Executor → internalApiClient → actual official part route/service, on an isolated query-only snapshot. The existing scheduler is used unmodified.

A both OFF; B interpreter ON/execution OFF; C execution ON isolated; D execution ON with four overlapping requests; D_CONTROL has the same four overlapping requests and interpreter ON/execution OFF. The three companion requests are the matched concurrent workload, not idle OFF versus busy ON.

Three predeclared rotated sets, five warmup batches and fifty measured batches per mode. A/B/C: 50 measured per set; D/control: 200 measured per set. Each batch's shadow settles outside response measurement before the next batch. This is bounded batch overlap, not an unrestricted saturation benchmark. Observability exporter disabled consistently for performance; formal trace validation is separate.

## 9. Real Controlled Performance

| Set | Mode | Measured requests | Commit median ms | Commit p95 ms | Control | Median overhead | p95 overhead | Shadow completion median/p95 ms |
|---|---|---:|---:|---:|---|---:|---:|---:|
| 1 | A | 50 | 30.2969 | 31.4704 | A | 0.0000% | 0.0000% | N/A |
| 1 | B | 50 | 30.7536 | 31.9096 | A | 1.5074% | 1.3956% | 46.1659 / 47.5803 |
| 1 | C | 50 | 27.7250 | 29.7720 | A | -8.4890% | -5.3968% | 46.4527 / 53.6872 |
| 1 | D_CONTROL | 200 | 29.7296 | 31.6616 | A | -1.8725% | 0.6076% | 44.6613 / 47.4373 |
| 1 | D | 200 | 22.5818 | 35.0082 | D_CONTROL | -24.0427% | 10.5699% | 45.9569 / 59.0092 |
| 2 | B | 50 | 30.6133 | 31.3686 | A | 0.3876% | -0.2109% | 45.9628 / 47.0466 |
| 2 | C | 50 | 26.4164 | 29.3694 | A | -13.3749% | -6.5707% | 46.4087 / 50.7866 |
| 2 | D | 200 | 22.6879 | 34.2077 | D_CONTROL | -24.0349% | 8.1557% | 45.5641 / 58.9990 |
| 2 | A | 50 | 30.4951 | 31.4349 | A | 0.0000% | 0.0000% | N/A |
| 2 | D_CONTROL | 200 | 29.8662 | 31.6282 | A | -2.0623% | 0.6149% | 45.2036 / 47.7571 |
| 3 | D | 200 | 23.3260 | 34.8961 | D_CONTROL | -22.2373% | 10.5794% | 46.0334 / 60.8997 |
| 3 | D_CONTROL | 200 | 29.9964 | 31.5575 | A | -0.5813% | 1.0461% | 45.3771 / 47.2431 |
| 3 | A | 50 | 30.1718 | 31.2308 | A | 0.0000% | 0.0000% | N/A |
| 3 | C | 50 | 26.2706 | 29.4730 | A | -12.9300% | -5.6284% | 45.9698 / 50.0826 |
| 3 | B | 50 | 30.8285 | 31.8281 | A | 2.1765% | 1.9125% | 46.2066 / 47.5711 |

C median -13.3749% to -8.4890%, p95 -6.5707% to -5.3968%.
D same-load median -24.0427% to -22.2373%, p95 +8.1557% to +10.5794%.
All B/C/D median range -24.0427% to +2.1765%; p95 range -6.5707% to +10.5794%.

Negative medians are timer-phase/workload observations, not proof of negative execution cost. Two D sets fail the predeclared p95 gate; do not round down or discard them. No post-benchmark tuning or repeated certification. No independent-shadow start before that request's response finish was observed, but other concurrent work can still affect event-loop timing.

Performance executed 825 real read Tools and 825 formal API GETs; zero models. Every controlled execution verified. Certification applies to this part-read fixture workload; coil/recipe correctness is separately established by the formal corpus, not claimed as separate latency profiles.

## 10. Frozen 15-Path Evaluation

scripts/run-ai-v5f1b-read-certification.cjs performed exactly one new 15-path formal run after deterministic checks and freeze. Same five source groups/requests/expected results, all applicable. No denominator exclusion. Model calls 24; entity lookups 33; actual read Tools 15; Tool-originated GETs 18. Separate comparator-only formal API calls 18 (including three coil reference lookups) are not V5 execution calls.

Pre/post component hashes match in formal and performance datasets. Frozen prompts, source, policy, states, exposure and model settings remain unchanged. No implementation edits after formal run began.

## 11. Tool Accuracy

15/15 expected Tools, unique selection. Coil search_coils=3, part search_parts=9, recipe preview_recipe_cost=3. Existing exposure/risk registry are not widened; only approved execution binding changed.

## 12. Argument Accuracy

15/15 validated; coil 3/3 binds the API-owned schemeCode. Recipe remains canonical recipeId, part remains existing source-exact keyword contract. No new model-generated arguments or optional defaults.

## 13. Execution Accuracy

15/15 real governed read executions succeeded, retry=0. Execution timeout/error=0. Formal execution median 4.1368 ms, p95 33.6697 ms; these are execution-completion durations, not V4 response latency.

Separate preflight: three direct existing read Tool checks plus ten concurrent controlled part reads =13 Tools,14 API GETs. This is fixture-only, not part of formal 15. Total stage real Tools=853 (15 formal+13 preflight+825 performance).

## 14. Result Equivalence

Applicable=15, MATCH=15, MISMATCH=0, NOT_COMPARABLE=0. All reference comparisons use the same isolated immutable snapshot. Part and recipe comparators remain their prior bounded field comparison. No Tool results, reference rows or business values are persisted.

## 15. Coil

All three frozen coil paths: correct Tool, authoritative args, execution SUCCESS, comparison MATCH, evidence VALID, verification PASS. Entity resolution's canonical ID/type and source identity are unchanged. Original ambiguity and zero-result semantics remain protected by tests; the optional field cannot pick a first candidate.

## 16. R02 / A01

R02 wrong Tool exclusion 3/3: formal expected Tool is uniquely selected, and historical wrong Tools cannot enter that execution plan. A01 rejection tests PASS. No relaxation of fuzzy matching, canonical identity or source anchor.

## 17. Write Safety

V5 writes=0; allowWrite enabling calls=0; business mutations=0; write Tool executions=0. Executor receives allowWrite:false. Fixture HTTP guard allows GET and the existing read-only lookup POST only; DB query_only adds an independent barrier. Production routing=0; user-visible V5 responses=0.

V5 API reads across this stage=890: formal51, preflight14, performance825. Comparator-only calls18 are counted separately. No new V5 direct DB connection; fixture reconstruction uses the existing evaluation-only read snapshot convention, not production resolution.

## 18. Trace / Privacy

Formal Phoenix project pump-ai-v5-f1b-read-execution contains 99 spans:15 AGENT,24 LLM,45 CHAIN,15 TOOL. All formal traces present; orphan=0, invalid/cross-trace parent=0, incorrect Tool root/request-operation correlation=0.

Tool attributes contain name, access, argument keys/count, result type and status only. Forbidden content-key scan=0; formal runner checks source/mention leakage in every record. Binding values stay in transient software candidates/args; no value appears as a recorded field in dataset or observed normal logs. Prompt/response, binding values, Tool argument/result values, raw entity, canonical ID, business values, PII/secrets leakage=0 within this validation scope. This does not claim every future error path or full DTO is privacy-certified.

Ten concurrent real fixture controlled reads passed; existing ten-distinct-synthetic identity/state isolation tests also pass. Performance's four-way batches had no request outcome crossing or skipped tasks. Performance exporter was off; its 825 Tools are not claimed as formal Phoenix spans.

## 19. Database Safety

Formal and performance source/fixture before-after hash/mtime/size unchanged. Source SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e; mtimeMs1788424936315.8767; size35323904; backup count209 unchanged. Unexpected backup=NO. Temporary test snapshots retained, no delete-to-pass.

## 20. Regression

Focused API/binding/comparator 12/12; API governance26/26; combined V5 295/295; shadow-OFF full regression2081/2082, only known missing .guardian/config.yaml. Build PASS. No new deterministic regression observed.

Deep API full runner was inspected but NOT_RUN: it includes write Tool workloads/fixture mutations, outside this stage's explicit no-write-Tool boundary. Prior copperBase race attribution is retained, not repaired or newly verified. Thus no new clean Deep API certification is claimed. All actual read execution paths in scope were exercised on the query-only server.

Only current-stage changes are submitted; user-owned V4 and API documentation edits are preserved. No scheduler tuning, concurrency change or model/semantic tuning.

## 21. P16-B Preconditions

P16_B_READY=NO because real controlled performance gate fails two concurrent p95 sets. Functional read execution is fully correct on frozen15; performance certification is not. Stop for Supervisor review. Do not rerun modified implementation, change scheduler, enable writes, route production traffic, emit V5 responses or implement P16-B.
