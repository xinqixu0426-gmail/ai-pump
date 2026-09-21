# V5-E4R-C-B2 Task Class Semantics V1.1

## 1. Executive Result

P15R-C-B2 is **PARTIAL**. The approved Task Class semantic layer was revised without changing class identities, Protocol V2, Prompt V2, source-span/source-anchor behavior, model settings, capability routing, or Tool exposure. The single formal 15-path evaluation completed, but Task Class, projected semantics, capability, and expected Tool exposure were only `9/15`. Coil-read remained `0/3`, and 800平刀 regressed from the frozen Protocol V2 baseline to `0/3` at the Task Class boundary. `P16_READY=NO`; the one-shot rule prohibits further semantic tuning or a second modified evaluation in this phase.

## 2. Frozen Complete Protocol V2 Baseline

- Start commit: `c66977a3c5d77fea1a5c843e970b79f452f0d703`.
- Frozen corpus: 15 paths, 5 source groups, 4 input fingerprints.
- Baseline: Protocol valid `14/15`, Task Class `11/15`, projected domain `14/15`, operation `11/15`, entity type `14/15`, source span and anchor `14/15`, capability and expected Tool exposure `11/15`.
- Baseline special results: 800平刀 `3/3`, R02 wrong Tool exclusion `3/3`, and `V5_FALSE_BLOCK=3`.
- Known deterministic regression failure: missing `.guardian/config.yaml`.
- The worktree was not clean at start. Pre-existing user V4/AI and documentation changes were preserved and excluded from the B2 commit.

## 3. Approved Change Scope

The implementation changes only the model-facing Task Class semantic layer and adds evaluation/test infrastructure. It does not change the external Contract V1, internal Protocol V2 schema, Prompt V2, Task Class identity fields, source mechanisms, capability registry/router, Tool exposure, V4 behavior, model/provider/settings, or dependencies.

The evaluation-only preload now records an independent Interpreter result before the V4 comparison so a case-level V4 outcome cannot suppress authoritative Interpreter accuracy. This is test/evaluation control flow only and is not a production routing hook.

## 4. Task Class Semantics V1.1

`api/services/ai-v5/taskClassSemantics.cjs` defines `V5_TASK_CLASS_SEMANTICS_VERSION="1.1"`. All 27 unchanged classes receive a compact `primaryMeaning` based on the expected result type plus deterministic local alternatives. The class identity hash remains `0149514aca7bbca5124ad069d6925e113209cb8c85f7f82cc7e9840d3b18ef02`.

The model-facing catalog contains class references, primary meanings, local alternatives, and entity slots. It contains no Tool names, frozen request examples, raw business values, or keyword-routing rules.

## 5. Local Contrast Design

Sibling discovery is generic: classes are compared when entity types overlap and either the domain matches or the complete entity-type tuple matches. Alternatives are deterministic, deduplicated, never self-referential, and describe the alternative expected result without bypassing the existing router. The catalog contains 42 local alternatives, with at most 4 alternatives per class.

The coil read/cost pair is structurally identified as siblings. Their meanings distinguish non-monetary factual retrieval from monetary/cost/accounting results without mentioning the frozen request or using a business keyword rule.

## 6. Class Identity Preservation

All 27 `classRef`, domain, operation, and entity-type tuples are unchanged. The semantic revision does not add, remove, merge, or reorder class identities. Validation rejects missing meanings, stale/duplicate alternative references, self-references, contradictory duplicate operation meanings, and Tool-name leakage.

## 7. Unchanged Components

The following frozen hashes remained unchanged before and after evaluation:

| Component | SHA-256 |
| --- | --- |
| Prompt V2 | `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3` |
| Source Span code | `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8` |
| Protocol V2 | `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad` |
| Model settings | `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398` |
| Input envelope | `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded` |
| Source Anchor | `f31564536b806fd3f3261f4d19d7fd3623726a967204379fc5e633154107a339` |
| Capability Registry | `c2e9c428c348866d4417a5934d7ec9d36b2d8b85cf147d95e299da8b80b8fc40` |
| Capability Router | `9a13f47414a306a11e62015865162f82098c434a85c1cd17aaa2e026ee7fce55` |
| Tool Exposure | `d4f4ce7caa7c12172b42375350d66843f4337e86b9484f360dc9c42e5850e2e4` |

No dependency changed. The provider remains DeepSeek, model `deepseek-v4-flash`, temperature `0`, top-p omitted, JSON-object response format, maximum output tokens `512`, retry `0`, and one model call per request.

## 8. Pre-Eval Freeze

The new Task Class Semantics hash was frozen as `c120fc465004c0424260cf04fdac4d58ef489439fc51264f49e50d53de5121f1`. Frozen corpus and expected-result hashes were respectively `315a21d96fdd84f0ecb253772ae942b2cbbfd56842c2a8858e378693f444d4df` and `6980ffb284a8d82543cb1337dbe4cc9ff70ee5ab3aec59438daf0f39f8ee5590`.

Focused semantic/evaluator tests passed `29/29`; all V5 tests passed `200/200` before the formal evaluation. The implementation, tests, documentation, and evaluator were frozen before the first real call.

## 9. Deterministic Tests

Coverage includes all 27 descriptions; identity preservation; deterministic sibling discovery; valid, non-self and non-duplicate alternatives; coil read/cost distinction; no Tool-name or frozen-example leakage; unchanged frozen surfaces; independent Interpreter evaluation despite V4 incomparability; and the corrected case-level continuation behavior inherited from B1.

Final combined V5 result after evaluation: `200/200 PASS` across all `tests/aiV5*.test.cjs` suites.

## 10. Frozen One-Shot Full Evaluation

Exactly one formal B2 run evaluated all 15 frozen paths and recorded all 15. It made 15 V5 Interpreter model calls and zero V5 Tool, Business API, or write calls. No Interpreter implementation changed after the run.

The safe dataset is `docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json`. It stores structural IDs, match states, correlations, and safe reason codes only.

## 11. Path-Level Metrics

| Metric | Result |
| --- | --- |
| Protocol valid | `15/15` |
| Protocol invalid | `0/15` |
| Model noncompliance | `0` |
| Task Class | `9/15` |
| Projected domain | `9/15` |
| Projected operation | `9/15` |
| Projected entity type | `9/15` |
| Source-span selection | `15/15` |
| Exact anchor | `15/15` |
| Capability routing | `9/15` |
| Expected Tool exposure | `9/15` |
| R02 wrong Tool exclusion | `3/3` |

## 12. Source-Group Metrics

Task Class and capability accuracy were each `3/5`. Source-span and anchor accuracy were each `5/5`. The two incorrect groups were the coil-read group and the 800平刀 group; each produced the same classification across its three runtime variants.

## 13. Input-Fingerprint Metrics

Task Class and capability accuracy were each `2/4`. Source-span and anchor accuracy were each `4/4`. Structured-output consistency for identical input fingerprints was `4/4 (100%)`, demonstrating consistent classification but not semantic correctness.

## 14. Coil Read / Coil Cost

All three coil-read paths expected `tc_004` but selected `tc_002`; Task Class, capability, and expected Tool exposure were each `0/3`. Source span, anchor, and identity preservation remained `3/3`. The approved semantic revision therefore did not resolve the frozen coil-read false blocks; it shifted the wrong selection away from coil-cost but still failed the authoritative Task Class boundary.

## 15. Exact Entity

All three frozen Exact Entity paths achieved `3/3` for Task Class, source span, exact anchor, identity preservation, capability, and expected Tool exposure. Their V4 comparisons were all available in this run (`0` incomparable). Exact Source Anchor behavior was unchanged.

## 16. 800平刀

All three paths selected exact source spans and preserved exact identity (`3/3`), but selected `tc_003` instead of the expected `tc_002`. Task Class, capability, and expected Tool exposure were therefore each `0/3`. This is a new semantic-classification regression relative to the frozen complete Protocol V2 baseline, not a Source Span, Source Anchor, Router, or Tool-exposure defect.

## 17. R02 Wrong Tool Exclusion

All three applicable R02 paths excluded the frozen wrong V4 Tool (`3/3`). No capability registry, router, or bounded Tool-exposure changes were made.

## 18. Same-Input Consistency

All four repeated Interpreter input fingerprints produced the same task class, span references, and projected interpretation: `4/4 (100%)`. The coil-read and 800平刀 errors are stable wrong classifications, not observed nondeterminism.

## 19. False Blocks

`V5_FALSE_BLOCK=3`, all in the coil-read success group. The run also recorded `V5_BLOCKS_V4_FAILURE=4`, `V5_INSUFFICIENT_DATA=3`, and `NOT_COMPARABLE V4 Comparison=0`. Because false blocks remain, the P16 gate fails.

## 20. Model Noncompliance

Model noncompliance was `0`: no invalid class reference, invalid span reference, unexpected field, or invalid JSON was recorded. All failures were valid Protocol V2 selections that were semantically wrong against the frozen authority.

## 21. Privacy

Phoenix project `pump-ai-v5e4r-task-class-semantics-v1-1` contains all 15 correlated traces. Attribute-key inspection found only approved metadata/structural fields; no prompt/response, raw entity, candidate/source-span text, Tool values, business values, PII, or secret-bearing content fields were exported. The evaluation dataset contains none of the prohibited raw-content keys. Leakage counts are all `0`.

Trace inspection found 15/15 target trace IDs, with `0` orphan spans, `0` invalid parents, and `0` cross-request contamination.

## 22. Performance / Concurrency

The deterministic runtime check used 5 warmups plus 30 OFF and 30 ON measurements. OFF median/p95 were `20.0586 ms` / `20.0687 ms`; ON median/p95 were `20.2472 ms` / `20.2638 ms`. Median overhead was `0.940245%` and p95 overhead `0.972161%`, both within the 5%/10% gates.

Ten concurrent eligible requests produced 10 Interpreter calls with `0` cross-request contamination. The real evaluation's V5 shadow completion median/p95 were `628.9995 ms` / `944.5273 ms`; these asynchronous completion times are not user-visible V4 latency.

## 23. Database Safety

The business database remained SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, and mtime UTC `2026-09-03T08:42:16.3158766Z`. Recursive backup count remained `209`. No startup backup was created or deleted to pass validation.

## 24. Regression

With V5 shadow and observability disabled, the full deterministic regression produced `1977/1978`: the sole failure was the frozen missing `.guardian/config.yaml` failure. There was no new deterministic V4 regression. Phoenix remained healthy.

## 25. Post-Eval Freeze Verification

Every pre-evaluation frozen hash, including the new semantic hash, matched after the real evaluation. The corpus and expected-result hashes also matched. No implementation file changed after evaluation; only the safe evaluation dataset and this report were produced afterward.

## 26. P16 Preconditions

`P16_READY=NO`.

Failed gates:

- Task Class, projected domain/operation/entity type, capability, and expected Tool exposure were `9/15`, not 100% on authoritative fields.
- Coil-read Task Class/capability/exposure remained `0/3`, with three false blocks.
- 800平刀 Task Class/capability/exposure regressed to `0/3`.
- `V5_FALSE_BLOCK` remained `3`.

Passed safety/integrity gates include one-shot completion, unchanged freeze hashes, 15/15 protocol validity, 15/15 source span and anchor, Exact Entity `3/3`, R02 exclusion `3/3`, 100% same-input consistency, zero model noncompliance, zero V5 execution/write calls, privacy, trace integrity, concurrency, performance, DB/backup safety, combined V5 tests, and unchanged known regression status.

Per the one-shot rule, no further semantic edits or modified real evaluation were performed. Supervisor review is required before any subsequent interpreter revision.
