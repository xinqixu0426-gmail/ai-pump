# Ontology Relation Binding V1 — ONT-P4

## Problem from P3

P3 established resolver correctness, but only observed four of six relation families and four of twelve directions. Its 30 real executions yielded 14 eligible, 12 compared, 12 MATCH and zero MISMATCH. Natural language intent and a trustworthy canonical root were the limiting inputs. P4 adds a deterministic, precision-first binder to observation only. It does not solve authoritative AI routing or the large-result context problem yet.

## Binding architecture and contract

`bindingMetadata.cjs` owns anchored relation expressions, entity aliases, formal resource adapters and exclusion policy. `relationBinder.cjs` consumes current user text and existing verified read results, optionally existing exact V3 resolution receipts and trusted server-owned session results. It does not query a database, execute tools, invoke a resolver or call a model. Registry validation requires exactly the existing seven entities and twelve directional relations.

`bindingContract.cjs` exports the deeply frozen `OntologyRelationBindingV1`, version 1, ontologyVersion 1. Status is one of BOUND, AMBIGUOUS_RELATION, AMBIGUOUS_ROOT, ROOT_NOT_CANONICAL, RELATION_NOT_SUPPORTED, NO_RELATION_INTENT, INSUFFICIENT_CONTEXT or NOT_ELIGIBLE. BOUND contains relationId, root.entityType, decimal root.canonicalId, targetEntityType, bindingEvidence, bindingSource, confidenceClass=deterministic and shadowEligible=true. Unbound fields are null/empty and shadowEligible=false. Unknown fields, model probability and display identity fields are rejected. Text is bounded to 2048 characters; input receipt arrays to 32; formal row projection to 512.

## Root binding precedence

1. Existing exact canonical V3 entity-resolution receipt, with verified formal source evidence and matching capability/resource/type/ID.
2. Current verified formal read result, with actual GET path owning the resource and returned canonical row.
3. Existing exact V3 resolver receipt; candidate/fuzzy matches are rejected. No new resolver execution occurs.
4. Trusted same-user, same-conversation server session results for explicit pronouns, within the existing 15-minute TTL.

Priority chooses provenance only after identity uniqueness is established. Conflicting IDs reject binding regardless of priority. User ID-shaped text must match a returned canonical row; model arguments, ordinary assistant text, semantic knowledge and names alone never establish identity. Exact display/business identifiers can select an already verified formal row, retaining punctuation. Truncated or limited collections cannot establish name uniqueness. Canonical typed IDs still require an owned verified row. Deleted rows and mismatched detail paths are rejected.

The current flexible assistant supplies verified tool results. Existing resolver/canonical receipt input seams are tested, but P4 does not insert resolution into that runtime. Session integration uses `session.previous.toolResults` only after the existing session ownership/TTL checks; client-persisted conversation prose is excluded.

## Relation intent metadata and direction semantics

Every existing relation has at least two centrally stored expressions; generic matching iterates metadata without relation-specific runtime predicates. Aliases answer only which registered direction the user requested. They do not prove any business edge; ONT-P2 remains the independent authority for actual relations.

| Family | Forward | Inverse |
| --- | --- | --- |
| recipe_template | recipe.uses_template | template.used_by_recipe |
| recipe_coil | recipe.uses_coil | coil.used_by_recipe |
| order_customer | order.belongs_to_customer | customer.has_order |
| quotation_customer | quotation.belongs_to_customer | customer.has_quotation |
| order_recipe | order.contains_recipe | recipe.contained_in_order |
| recipe_part | recipe.contains_part | part.contained_in_recipe |

For example, customer → order and order → customer are distinct bindings. Shared “用在哪些配方” wording is disambiguated by a trustworthy root type, never by selecting the first inverse pair.

## Ambiguity and negative cases

Multiple relation directions reject as AMBIGUOUS_RELATION. Multiple matching canonical roots, repeated clauses naming different roots, or multiple possible session referents reject as AMBIGUOUS_ROOT. Missing/stale/unowned pronoun context rejects. Unsupported directions return RELATION_NOT_SUPPORTED where identifiable; unfamiliar grammar may conservatively return NO_RELATION_INTENT. Hypotheses, negation, writes, history/snapshot, knowledge, semantic similarity, vague relatedness and possible impact are excluded.

The dedicated corpus has 24 positive cases (explicit entity and boss phrasing for each direction) and 25 negative cases. Additional boundary tests cover exact/fuzzy receipts, duplicate names, inconsistent paths, partial collections, empty inverse collections, session ownership/TTL, contract validation and isolation. The exclusion policy intentionally sacrifices recall, including literal names containing excluded words. There is no fuzzy fallback or most-recent referent selection.

## Shadow integration

`AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED=false` is an independent child switch of `AI_ONTOLOGY_RELATION_SHADOW_ENABLED`. The parent must also be ON. No production configuration was changed. Child OFF preserves the P3 observer, does not import/run the binder and adds no binding span.

Child ON runs after authoritative answer grounding, events and session completion in the existing asynchronous observer. Binding never enters Tool selection, shortlist, current entity resolver, model context, TaskEnvelope, Presenter, answer or evidence. No model call or prompt field is added.

An existing complete canonical P3 comparison is always retained, even if the binder finds a different requested direction. Otherwise BOUND can supply the observer's root and relation. Thus bound intent and actually observed relation are separately reported; P4 cannot replace a good P3 comparison or exceed its one relation/one hop/one bounded page worker budget.

`bindingCurrentFacts.cjs` independently projects current formal fields by the six existing source families. Direct facts require explicit FK or valid saved item/part IDs; missing fields do not prove empty. Inverse facts require a verified complete unfiltered source collection. No new read is issued to discover missing context and no ontology result is reused as current-path evidence. Legacy ID-less references remain noncanonical. The worker remains readonly/query_only; instrumentation and sink failures are fail-open.

Binding telemetry uses `ontology_relation_binding` with `pump.ai.ontology.binding.{status,relation_id,root_entity_type,source,shadow_eligible}`. No complete user text, payload, names or canonical IDs are exported. Controlled synthetic fixture IDs are retained only in local acceptance reports.

## Metrics

Bindable opportunities require a supported intent and an available unique verified canonical root. Successfully bound counts unique root + directional relation bindings. Structurally unbindable cases include absent canonical paths, ambiguous inputs and unsupported relations; they are not counted as deterministic implementation failures. Binding does not imply comparability: current target IDs or completeness may still be absent.

Deterministic corpus: 24 positive opportunities, 24 structurally bindable, 24 successfully bound (100%); 12/12 directions; 25 negatives, zero false positives, wrong roots, wrong relations or wrong directions. Boundary ambiguities are rejected, not guessed. These figures are separate from runtime eligibility.

## Frozen P3 comparison

`tests/fixtures/ontology-p3-frozen-v1.json` preserves all 30 P3 case records and original questions, including failures, original report SHA-256 values and the 14 eligible/12 compared baseline. P3 did not store complete tool receipts or canonical roots; exact historical context replay cannot be recovered. This limitation is explicitly recorded in the frozen fixture.

`scripts/run-ontology-binding-corpus.cjs` executes the frozen 30 records twice through the current configured Provider and current assistant/executor against disposable formal HTTP business fixtures. Each actual execution observes Binder ON and replays P3 OFF on the same verified results without another model/tool execution. This paired comparison isolates binder effects from provider variance. Historical aggregate comparison is reported separately; paired non-regression alone does not prove historical non-regression.

Final numerical acceptance is recorded below. Exploratory results are retained separately and are not selected instead of the final run.

## Real AI stability

The runner records 60 actual executions: two repetitions of the frozen 30 records, four executions per unique question. Strict stable root/relation requires all four executions to bind the same identity/direction. BOUND/NOT_BOUND changes are variance, even if all successful bindings agree. An independent synthetic fixture oracle checks wrong roots and relations; it is never provided to the binder or model. Current tool errors are retained. No prompt tuning, new provider output requirement or forced tool is introduced.

## Known gaps

- The current model may return list/search context without the unique formal detail needed for binding; P4 does not perform an autonomous discovery chain.
- Customer context quotations omit canonical quotation IDs; customer.has_quotation may bind intent but cannot establish a comparable target set.
- Filtered recipe lists cannot prove complete inverse membership. Missing formal fields and ID-less saved references remain incomplete/noncanonical.
- Complex/mixed language outside the metadata grammar rejects conservatively. Twelve directions are deterministic test coverage, not a claim of twelve naturally observed runtime directions.
- The historical P3 corpus has no full execution receipts; current repeated provider choices may differ from P3. Report both historical and paired baselines.

## P5 2-hop entry criteria

Require zero false positives, wrong roots/relations/directions and unexplained authoritative mismatch; >=95% binding success for structurally bindable deterministic cases; 12/12 direction tests; completed repeated real corpus; historical and paired eligibility/comparability non-regression; equivalent authoritative ON/OFF behavior; full regression and Web build PASS. If any gate fails, P4 is REWORK and P5 must wait. This phase implements no traversal, planner, graph database, public API/tool, new relation/entity, schema migration, writes or dependency.

## Final acceptance

Final validation on 2026-09-18: **PASS**. Provider: DeepSeek / deepseek-v4-flash. Frozen 30 records repeated twice, 60 actual executions completed. All records, including current-path failures and NOT_BOUND, are retained in local `logs/ont-p4-real-results.json`; exploratory evidence remains `logs/ont-p4-real-exploratory-results.json`.

| Metric | Historical P3, normalized to 60 | Current P3 OFF, paired 60 | P4 ON, 60 |
| --- | ---: | ---: | ---: |
| Eligible | 28 (14 × 2) | 32 | 46 |
| Compared | 24 (12 × 2) | 24 | 27 |
| MATCH | 24 | 24 | 27 |
| MISMATCH | 0 | 0 | 0 |
| Not Eligible | 32 | 28 | 14 |
| Current Path Not Canonical | 4 | 8 | 8 |
| Current Path Incomplete | 0 | 0 | 11 |

Per frozen 30 replay: P4 first repetition eligible 23/compared 13; second eligible 23/compared 14. Both exceed the original 14/12. Paired improvements: +14 eligible (+23.3 percentage points) and +3 comparable (+5 points); zero eligible or comparable case regressions. Against normalized historical aggregates: +18 eligible (+30 points), +3 compared (+5 points). Historical contexts differ, so only the paired comparison attributes the improvement to binding.

Binding status: BOUND 45; INSUFFICIENT_CONTEXT 11; ROOT_NOT_CANONICAL 4; relation-intent-missing statuses 0 in this frozen real set. These are binder outcomes, not inferred business negatives or a claim that all 60 were bindable opportunities. Current noncanonical target paths remain eight in both paired settings. Eligible 46 can exceed BOUND 45 because a retained P3 comparison does not require the binder to succeed.

Independent fixture oracle: wrong roots 0, wrong relations/directions 0. No authoritative mismatch, shadow technical failure or fixture database mutation occurred. Runtime bindings span eight directions and five of six families (order_recipe remains unobserved); deterministic direction coverage remains 12/12. Runtime coverage is measured from BOUND intents, separately from the retained P3 observation direction.

Strict four-execution stability: 10/15 unique questions always bind the same root and direction. Three consistently reject (missing recipe, missing coil and order-recipe without a usable canonical root). Two vary between binding and rejection (recipe-part: 3/4 bound; template-recipe: 2/4). Every successful binding within each question agrees on identity and direction; there is no bound-to-different-root/direction variance. This is availability variance in the existing formal context, not permission to guess.

Checks: P4 57/57; focused ontology/relationRead/entity identity/assistant/evidence/observability 363/363; full `npm test` 2361/2361, no skips; API contract 26/26; isolated deep API 491/491; Web build PASS; changed CJS ESLint and whitespace checks PASS. The deep API source database was read only for a disposable backup. OFF/ON assistant tests compare final content, provider messages/tool exposure, execution sequence/arguments, model calls and verified tool evidence; all equal, with writes disabled. Fixture serialized bytes and total_changes are unchanged.

No package/lockfile/dependency, SQL schema/migration, public route/API/tool, formal routing/prompt/evidence or business write changes. Both observation switches remain default OFF. Original master and its user-owned untracked P0 audit remain untouched (audit SHA-256 `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`). Delivery is local to `codex/ont-p1-thin-contract`; no merge, push or deployment. P5 remains subject to supervisor review; P4 has not implemented 2-hop.
