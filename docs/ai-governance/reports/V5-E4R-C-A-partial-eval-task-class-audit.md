# V5-E4R-C-A Protocol V2 Partial Evaluation Audit

## 1. Executive Result

P15R-C-A is **PASS** as an audit, and `P15R_C_B_READY=YES`. No model, Tool, business API, or write call was made. No production, Interpreter, evaluator, Prompt, Task Class, Source Span, Protocol, model-setting, context-envelope, Capability, Ontology, Contract, or Source Anchor implementation was changed.

The 6/15 stop has a confirmed evaluator-design cause. The frozen V4 runner completed the second selected case, wrote a case result whose comparison was `INCOMPARABLE`, represented the suite as `INCOMPLETE`, and mapped that status to process exit code 2. The Protocol V2 evaluator admitted only exit codes 0 and 1, threw on code 2, and aborted the remaining source-case loop. `SHADOW_INCOMPARABLE` is a valid case-level comparison outcome even though it makes the selected runner invocation suite-incomplete; it is not evidence that the child failed to launch or that the environment failed.

The three successful coil-read paths form one identical-input source group. All returned a Protocol-valid, source-anchored `tc_003` (`coil.cost`) selection instead of authoritative `tc_004` (`coil.read`). This is a consistent wrong classification, not nondeterminism or protocol noncompliance. The primary cause is `TASK_CLASS_DESCRIPTION_FAILURE`, with `TASK_CLASS_SEMANTIC_OVERLAP` and `MODEL_SELECTION_FAILURE` secondary: both classes share the same domain and entity semantics, 22 tokens, and 95.65% of the smaller description vocabulary; more importantly, the generic `read` definition says it is not a specialized inventory operation even though the existing `coil.read` capability owns coil inventory retrieval. The source request is semantically explicit about retrieval, and no additional pre-routing context is required to distinguish it from cost.

## 2. Frozen Protocol V2 State

Recomputed values exactly match both the P15R-C pre-evaluation and post-evaluation hashes:

| Frozen item | Recomputed SHA-256 | Match |
| --- | --- | --- |
| Prompt V2 | `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3` | YES |
| Task Class Catalog | `c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9` | YES |
| Source Span code/config | `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8` | YES |
| Protocol V2 | `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad` | YES |
| Model settings | `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398` | YES |
| Input envelope | `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded` | YES |

`Protocol V2 Hashes Still Frozen=YES`. Current HEAD is the frozen P15R-C commit `4bb78cf65d37df5d6aab319adcbdb1aed17839a1`; none of the six frozen files had a pre-existing user modification at audit start.

## 3. Evaluation Path Inventory

The frozen corpus remains 15 paths, five source groups, and four input fingerprints.

| Path ID | Source group | Audit status | Expected class | Observed class / status |
| --- | --- | --- | --- | --- |
| `P06-COIL-001-LEGACY` | COIL_INVENTORY | EXECUTED | `tc_004` | `tc_003`, VALID |
| `P06-COIL-001-V4I` | COIL_INVENTORY | EXECUTED | `tc_004` | `tc_003`, VALID |
| `P06-COIL-001-V4R3` | COIL_INVENTORY | EXECUTED | `tc_004` | `tc_003`, VALID |
| `P06-EXACT-001-LEGACY` | EXACT_RECIPE_COST | EXECUTED | `tc_024` | `tc_024`, VALID |
| `P06-EXACT-001-V4I` | EXACT_RECIPE_COST | EXECUTED | `tc_024` | `tc_024`, VALID |
| `P06-EXACT-001-V4R3` | EXACT_RECIPE_COST | STOP_TRIGGER | `tc_024` | no Interpreter outcome; V4 path UNAVAILABLE |
| `P06-FLATBLADE-001-LEGACY` | FLAT_BLADE_PRICE | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-FLATBLADE-001-V4I` | FLAT_BLADE_PRICE | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-FLATBLADE-001-V4R3` | FLAT_BLADE_PRICE | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-INVENTORY-001-LEGACY` | PART_INVENTORY_PRIMARY | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-INVENTORY-001-V4I` | PART_INVENTORY_PRIMARY | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-INVENTORY-001-V4R3` | PART_INVENTORY_PRIMARY | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-SIMPLE-001-LEGACY` | PART_INVENTORY_REPEAT | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-SIMPLE-001-V4I` | PART_INVENTORY_REPEAT | NOT_EXECUTED | `tc_002` | NOT_RUN |
| `P06-SIMPLE-001-V4R3` | PART_INVENTORY_REPEAT | NOT_EXECUTED | `tc_002` | NOT_RUN |

- Paths attempted/observed: 6
- Paths with completed Interpreter outcomes: 5
- Remaining paths never evaluated under Protocol V2: 9
- Stop path: `P06-EXACT-001-V4R3`

## 4. SHADOW_INCOMPARABLE Semantics

`aiShadowComparisonV4.runShadowComparisonSuite()` creates an `INCOMPARABLE` case when the Oracle prerequisite is missing or invalid and explicitly continues its internal case loop. `rolloutReadiness()` then sets blocker `SHADOW_INCOMPARABLE`; the returned report status becomes `INCOMPLETE`. The frozen runner writes that report and maps `INCOMPLETE` to process exit status 2.

Therefore:

- Producer: V4 comparison/readiness layer (`aiShadowComparisonV4.rolloutReadiness`), encoded by the runner as exit 2.
- Underlying semantic unit: valid **CASE_LEVEL** outcome.
- Suite effect: the selected runner invocation cannot be PASS and is labeled INCOMPLETE.
- It is not an environment or child-process launch failure.

The frozen tests confirm that Oracle prerequisites yield `INCOMPLETE` plus an `INCOMPARABLE` count; the implementation explicitly records the case and continues.

## 5. Evaluator Control Flow

The Protocol V2 evaluator calls the frozen runner once per source case and uses `run(..., allowedStatuses=[0,1])`. Its status contract in practice is:

| Exit status | Frozen runner result | Evaluator behavior | Audit judgment |
| --- | --- | --- | --- |
| 0 | selected suite PASS | continue | correct |
| 1 | completed selected suite with non-incomparable gate failure | continue | correct for collection |
| 2 | selected suite INCOMPLETE, including case-level SHADOW_INCOMPARABLE | throw and abort all remaining cases | incorrect for corpus collection |
| other/null | unexpected process failure | throw | correct |

The exact control flow is `spawnSync -> status not in [0,1] -> throw -> main catch -> process exit 1`; the `for (caseKey of prior.caseKeys)` loop has no per-case containment. The evaluation stop root cause is `EVALUATOR_DESIGN_FAILURE`, not `V4_RUNNER_FAILURE`, `ENVIRONMENT_FAILURE`, or a Protocol failure.

## 6. Evaluation Resume Integrity

`One-Shot Evaluation Integrity=YES_BUT_INCOMPLETE`. The formal V2 run started once; all six freeze hashes still match; no Interpreter implementation tuning occurred after the first six paths; and the remaining nine paths have no Protocol V2 evaluation evidence.

`REMAINING_CORPUS_RESUME_ALLOWED=YES`, subject to these exact constraints:

1. apply only an `EVALUATOR_CONTINUATION_FIX` that records case-level status 2 and continues;
2. preserve the six frozen observed records exactly as-is;
3. do not rerun the first six paths, including the stop path;
4. execute only:
   - `P06-FLATBLADE-001-{LEGACY,V4I,V4R3}`;
   - `P06-INVENTORY-001-{LEGACY,V4I,V4R3}`;
   - `P06-SIMPLE-001-{LEGACY,V4I,V4R3}`;
5. merge new safe results with the frozen partial evidence without replacing it;
6. retain `P06-EXACT-001-V4R3` as a recorded unavailable case unless separately authorized by the Supervisor.

The continuation fix also needs a deterministic representation for a missing independent outcome; merely adding status 2 to the allowlist is insufficient because the existing full-dataset builder requires every path to have an independent record.

## 7. Task Class Catalog Audit

The catalog contains 27 globally exposed read-only classes. Every request sees all 27. Each tuple maps deterministically to one current Capability candidate; no Tool name is present in the model view.

| Ref | Domain / operation / entity | Semantic description | Capability candidate |
| --- | --- | --- | --- |
| `tc_001` | business_history / read / business_record | Historical business change and audit records. Read a specific domain object or list; not free-text search and not a specialized inventory operation. Referenced object: A business change or audit record. | `business_history.read` |
| `tc_002` | catalog / read_inventory / part | Part catalog facts, including a part model, current catalog price, or current stock. Read current part-catalog facts, including stock and current catalog price. Referenced object: A generic component or part catalog item; not a coil unless explicitly a coil scheme. | `inventory.read` |
| `tc_003` | coil / cost / coil | Coil and winding-scheme specifications, inventory, and coil-material cost. Calculate coil or winding material cost. Referenced object: a specialized coil or winding scheme. | `coil.cost` |
| `tc_004` | coil / read / coil | Coil and winding-scheme specifications, inventory, and coil-material cost. Read a specific object/list; not free-text search and not a specialized inventory operation. Referenced object: a specialized coil or winding scheme. | `coil.read` |
| `tc_005` | cost / calculate / cost_context | Generic cost calculation not bound to a named recipe or business document. Calculate a generic unbound cost context. | `cost.calculate` |
| `tc_006` | drawing / read / drawing | Rotor drawing records and drawing generation or printing. Read a specific object/list. | `drawing.read` |
| `tc_007` | file / search / file | Factory file archive discovery and archiving. Search the archive for matching file targets. | `file.search` |
| `tc_008` | knowledge / read / knowledge | Factory knowledge entries and knowledge-index maintenance. Read a specific object/list. | `knowledge.read` |
| `tc_009` | management / plan_workflow / workflow | Factory-wide management summaries, alerts, and workflow control. Plan a workflow without executing it. | `management.workflow.plan` |
| `tc_010` | management / read / global | Factory-wide management summaries, alerts, and workflow control. Read at global management scope. | `management.read` |
| `tc_011` | order / build_draft / order | Orders, purchasing, order readiness, and order-scoped work. Build a non-executing order draft. | `order.draft` |
| `tc_012` | order / plan_readiness / order | Orders, purchasing, order readiness, and order-scoped work. Plan readiness without executing it. | `order.readiness.plan` |
| `tc_013` | order / read / order | Orders, purchasing, order readiness, and order-scoped work. Read a specific order/list. | `order.read` |
| `tc_014` | order / read_knowledge / order | Orders, purchasing, order readiness, and order-scoped work. Read the knowledge package attached to an order. | `order.knowledge.read` |
| `tc_015` | order / read_purchase / purchase | Orders, purchasing, order readiness, and order-scoped work. Read purchasing status or overview. | `purchase.read` |
| `tc_016` | order / read_readiness / order | Orders, purchasing, order readiness, and order-scoped work. Read order-readiness status. | `order.readiness.read` |
| `tc_017` | quality / analyze_recipe / recipe | Factory data and recipe-configuration quality analysis. Analyze a named recipe's coherence. | `quality.recipe.analyze` |
| `tc_018` | quality / read / factory | Factory data and recipe-configuration quality analysis. Read at factory scope. | `quality.read` |
| `tc_019` | quotation / build_draft / quotation | Quotations and quotation drafts. Build a non-executing quotation draft. | `quotation.draft` |
| `tc_020` | quotation / explain_cost / quotation | Quotations and quotation drafts. Explain a quotation cost change. | `quotation.cost.explain` |
| `tc_021` | quotation / inspect_file / file | Quotations and quotation files. Inspect a quotation file without archiving. | `quotation.file.inspect` |
| `tc_022` | quotation / read / quotation | Quotations and quotation drafts. Read a specific quotation/list. | `quotation.read` |
| `tc_023` | quotation / read_customer / customer | Quotations and customer history. Read quotation-customer records/history. | `quotation.customer.read` |
| `tc_024` | recipe / preview_cost / recipe | Named pump recipes, BOM, and recipe-level cost preview. Preview or compare complete named-recipe cost. | `recipe.cost.preview` |
| `tc_025` | recipe / read / recipe | Named pump recipes, BOM, files, templates, and cost preview. Read a specific recipe/list. | `recipe.read` |
| `tc_026` | recipe / read_files / recipe | Named pump recipes and files. Read technical files attached to a named recipe. | `recipe.files.read` |
| `tc_027` | recipe / read_template / template | Named pump recipes and templates. Read pump-shell templates used by recipes. | `recipe.template.read` |

The machine-readable dataset preserves the exact current semantic description for every class and its projected candidate list.

## 8. Coil Read vs Coil Cost

| Dimension | Expected `tc_004` | Actual `tc_003` |
| --- | --- | --- |
| Domain | coil | coil |
| Operation | read | cost |
| Entity type | coil | coil |
| Capability | `coil.read` | `coil.cost` |
| Allowed Tool boundary | coil specification/search | copper price/coil cost calculation |

The three paths have the same input fingerprint, all selected `tc_003` and the same valid exact source span, and all produced `V5_FALSE_BLOCK`. This is `CONSISTENT_WRONG_CLASSIFICATION`. Consistency is 100% for this fingerprint but accuracy is 0%; consistency must not be treated as correctness.

The locally inspected frozen source is `SEMANTICALLY_EXPLICIT`: it asks for current coil inventory, not material-cost calculation. No raw request or entity value is reproduced in this report or dataset.

## 9. Semantic Overlap / Granularity

Deterministic description comparison found:

- same domain: YES;
- same entity type: YES;
- different operation: YES;
- token Jaccard similarity: 70.97%;
- overlap coefficient: 95.65% (22 shared tokens out of 23 in the smaller vocabulary);
- classification: OVERLAPPING.

The decisive description defect is not only lexical overlap. The shared coil-domain sentence advertises both inventory and cost, while the generic `read` sentence excludes “specialized inventory operation.” The registry has no separate coil-inventory operation; authoritative coil inventory is owned by `coil.read`. Thus the model-facing description contradicts the current capability ownership boundary.

`GRANULARITY=CORRECT`: read/specification retrieval and material-cost calculation have different capabilities and disjoint bounded Tool sets, so merging them would erase a real business distinction. This is not `TASK_CLASS_GRANULARITY_FAILURE` or `CAPABILITY_TAXONOMY_FAILURE`.

## 10. Pre-Routing Context

The frozen runner calls the V4 runtime with messages, version, environment, write flag, and request ID, but no `pageContext`. The preload forwards `input.pageContext ?? null`; therefore the V5 input envelope used `safePreRoutingContext=null` for this source group.

No existing safe authoritative pre-routing structural fact is available for a deterministic coil read/cost prefilter in this frozen path. The current envelope can retain only normalized order-surface context when present, which is irrelevant and absent here. Downstream V4 Tool, capability, resolver, verification, and result facts remain correctly forbidden.

Because the source semantics already distinguish retrieval from cost, the root cause is not `INSUFFICIENT_PRE_ROUTING_CONTEXT`. The absence of context neither excuses nor creates the wrong class selection.

## 11. False Block Root Cause

- False-block paths: 3
- Unique false-block source groups: 1 (`COIL_INVENTORY`)
- V4 result: PASS on all three paths
- First divergence: legal but wrong Task Class ref (`tc_003` instead of `tc_004`)
- Blocking gate: independent Oracle/task-class/capability comparison
- Primary root cause: `TASK_CLASS_DESCRIPTION_FAILURE`
- Secondary: `TASK_CLASS_SEMANTIC_OVERLAP`, then `MODEL_SELECTION_FAILURE`

The model complied with Protocol V2: it emitted a valid catalog ref and existing span ref. Therefore this is not model noncompliance. Identical input yielded the same wrong output, so it is not model nondeterminism.

## 12. Exact Entity Partial Result

Three exact paths were observed at the V4-runner level:

- two completed Interpreter outcomes selected `tc_024`, selected the correct existing exact span, passed unchanged Source Anchor, and matched the expected capability/Tool exposure;
- `P06-EXACT-001-V4R3` was V4 `UNAVAILABLE`, produced no independent Interpreter outcome, and triggered the corpus stop.

Accordingly: executed/attempted 3, correct 2, actual Interpreter failures 0, stop-trigger/no-outcome 1, remaining exact paths 0. The third result is `EVALUATION_NOT_INTERPRETER_FAILURE`, not a wrong class, wrong span, or Source Anchor failure.

The correct exact span exists for the stop path: its interpreter-input fingerprint is identical to the two completed exact variants, Source Span generation is deterministic, and both completed variants selected the same correct exact ref. This establishes catalog availability without rerunning the model.

## 13. Source Span Protocol

The observed five Protocol-valid Interpreter outcomes all selected existing exact span refs and all five passed exact Source Anchor. The coil group also selected a correct source span despite its wrong class. The sixth observed path had no Interpreter call.

- Source Span Catalog failures: 0
- Model wrong-span selections: 0
- Correct exact span missing: 0
- Source Anchor implementation defects: 0
- Decision: `KEEP_EXACT`

The partial 5/6 metric in P15R-C used the full observed path denominator and counted the unavailable path as not correct; it does not imply a lexical catalog or anchor defect.

## 14. Router / Tool Exposure Exoneration

`tc_003` deterministically projects to `coil/cost/coil`. The existing Capability Router correctly maps that tuple to `coil.cost`; bounded Tool exposure correctly exposes the cost capability's Tool set. Neither layer is authorized to reinterpret or repair a wrong-but-valid class.

- Router root cause: NO
- Tool exposure root cause: NO
- Capability mapping failure: NO

Changing either downstream layer to accommodate this case would corrupt the existing safety boundary and is not recommended.

## 15. Candidate Selection Space

`GLOBAL_CLASS_SELECTION_SPACE=27`: every request is shown the full 27-class model view. A read-only/exposable registry filter is already applied, but no request-specific deterministic structural prefilter is applied.

For the frozen coil group, a safe deterministic prefilter cannot currently be built from authoritative pre-routing metadata: `pageContext` is absent, and no pre-routing entity/domain/risk fact identifies a coil family. Raw-text keyword routing and V4 downstream facts are forbidden. Therefore `Deterministic Structural Prefilter Available=NO` for this failure.

## 16. V2.1 Mechanism Options

Recommended, audit-only, in minimum order:

1. `EVALUATOR_CONTINUATION_FIX`: treat case-level status 2 as record-and-continue, preserve unavailable evidence, and resume only the nine never-run paths.
2. `TASK_CLASS_DESCRIPTION_REVISION`: align coil-read description with the actual `coil.read` ownership of coil inventory and keep cost limited to calculation semantics.
3. `TASK_CLASS_LOCAL_CONTRAST`: present an explicit local read-vs-cost distinction without case examples, keywords, Tool names, or frozen literals.

`TASK_CLASS_HIERARCHICAL_SELECTION` is not recommended yet. No deterministic coarse prefilter input exists for the frozen coil request, and adding another model-selected hierarchy would expand protocol scope before the direct semantic contradiction is corrected. `SOURCE_SPAN_SELECTION_REVISION` is not supported by evidence.

Maximum V2.1 scope: evaluator continuation plus Task Class semantic descriptions/local contrasts. No Protocol schema, model, model-call count, Contract V1, Capability IDs/mappings, bounded Tool sets, Source Span algorithm, or Source Anchor change.

## 17. Contract Decision

External `V5TaskInterpretation` Contract V1 remains sufficient. Both the authoritative coil-read result and the observed coil-cost result can be represented; the failure is selection between valid classes, not representational inability. `External Contract V1 Sufficient=YES`.

## 18. Source Anchor Decision

`Source Anchor Decision=KEEP_EXACT`. Protocol V2 removed free candidate text, correct source spans exist, and every observed Interpreter output with a span passed exact anchoring. There is no deterministic bug evidence that could justify relaxing exact identity.

## 19. Model Decision

`Interpreter Model Decision=KEEP`. The model selected a legal ref consistently, but it was presented a globally flat 27-class space containing contradictory/overlapping coil descriptions. This is not evidence that the unchanged model fails after a reasonable semantic boundary. A model change should only be reconsidered if a separately frozen V2.1 with corrected local semantics still fails.

## 20. P15R-C-B Preconditions

`P15R_C_B_READY=YES` for Supervisor review and a separately authorized next phase:

- evaluation stop root cause: known (`EVALUATOR_DESIGN_FAILURE`);
- resume eligibility and exact nine-path scope: known;
- coil-read to coil-cost root cause: known;
- all three false blocks: one source-group selection failure;
- Router and Tool exposure: exonerated;
- correct exact-span availability: confirmed;
- minimal V2.1 classes: evaluator continuation, description revision, local contrast;
- model calls in this audit: 0;
- Tool/business API/write calls in this audit: 0;
- production/Interpreter changes: 0;
- business database and backup inventory: unchanged.

This readiness does not authorize the continuation run or any V2.1 implementation. P16 remains out of scope.
