# V5-E4R-C-B1 Complete Frozen Protocol V2 Evaluation

## 1. Executive Result

P15R-C-B1 is **PASS**. The evaluator continuation control flow was corrected without changing the frozen Protocol V2 interpreter. The original six records were preserved byte-semantically by canonical hash, and exactly the nine never-evaluated frozen paths were executed once. The resulting dataset contains a final case-level outcome for all 15 paths.

The complete corpus confirms that the Protocol V2 identity mechanism remains sound and that all nine continuation paths selected the correct task class, exact source span, capability, and bounded Tool exposure. It also preserves the earlier evidence that the three coil-read paths consistently select the valid but wrong coil-cost class. V2.1 is therefore recommended, limited to task-class description revision and local semantic contrast; it is not implemented here.

## 2. Evaluation Integrity

- Start commit: `58600c9a97a9df0773d89e0155488afa69e6a31d`
- Frozen paths: 15
- Original evaluated paths: 6
- Previously unevaluated paths: 9
- Formal continuation runs: 1
- First-six reruns during B1: 0
- V5 Interpreter calls on first six during B1: 0
- V5 Interpreter calls during continuation: 9
- Original record hash before: `0fae3e8d694efdb99f88350a282123a25fb8dbfa56e725331478e16eb3b749ae`
- Original record hash after: `0fae3e8d694efdb99f88350a282123a25fb8dbfa56e725331478e16eb3b749ae`
- Frozen corpus changed: no
- Frozen expected results changed: no

The formal continuation used explicit frozen path IDs. It did not infer a starting array offset, cache paths, or rewrite the partial dataset. A later analysis-only aggregation pass consumed the already-produced evidence and made no provider call.

## 3. Evaluator Continuation Fix

The evaluator now distinguishes runner outcomes by both process status and the validated one-case report:

- Status 0 or 1 with a valid one-case report: record and continue.
- Status 2 with `INCOMPLETE`, blocker `SHADOW_INCOMPARABLE`, and case comparison `INCOMPARABLE`: record the case-level outcome and continue.
- Process launch errors, malformed/missing reports, missing-credential status 2, unknown statuses, and other invariant failures: stop the suite.

Resume planning compares explicit `executedPathIds` and `remainingFrozenPathIds`. Duplicate paths, unknown paths, duplicate result records, and incomplete merged results are rejected. Deterministic tests prove that a true fatal result stops subsequent cases.

## 4. Frozen Interpreter Verification

The following hashes matched the P15R-C frozen values before and after continuation:

| Surface | Frozen / Post-Run SHA-256 |
| --- | --- |
| Prompt V2 | `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3` |
| Task Class Catalog semantic value | `c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9` |
| Source Span code | `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8` |
| Protocol V2 code | `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad` |
| Model settings semantic value | `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398` |
| Input Envelope code | `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded` |

No interpreter, Task Class Catalog, Source Span Catalog, input-envelope, capability, Tool exposure, ontology, contract, prompt, or model-setting file was changed.

## 5. First 6 Preservation

All six original safe records are present unchanged, including their status, match fields, reason codes, trace IDs, shadow task IDs, and comparison outcome. Their canonical record-set hash is identical before and after merge. No first-six path was passed to the V4 runner or V5 Interpreter during B1.

## 6. Remaining 9 Execution

Exactly these nine frozen paths were executed once:

- `P06-FLATBLADE-001-LEGACY`
- `P06-FLATBLADE-001-V4I`
- `P06-FLATBLADE-001-V4R3`
- `P06-INVENTORY-001-LEGACY`
- `P06-INVENTORY-001-V4I`
- `P06-INVENTORY-001-V4R3`
- `P06-SIMPLE-001-LEGACY`
- `P06-SIMPLE-001-V4I`
- `P06-SIMPLE-001-V4R3`

All nine produced Protocol-valid V2 output and matched the frozen expected task class, domain, operation, entity type, exact source span, anchor, capability, and expected Tool exposure. The continuation consumed 27,063 prompt tokens and 378 completion tokens (27,441 total). Median shadow completion was 620.94 ms and p95 was 881.31 ms. These are asynchronous shadow-completion measurements, not V4 user-visible latency.

## 7. Complete 15-Path Metrics

| Metric | Result |
| --- | --- |
| Protocol valid | 14/15 (93.33%) |
| Protocol invalid | 0 |
| Interpreter outcome unavailable | 1 |
| Model noncompliance | 0 |
| Task Class accuracy | 11/15 (73.33%) |
| Projected domain accuracy | 14/15 (93.33%) |
| Projected operation accuracy | 11/15 (73.33%) |
| Projected entity-type accuracy | 14/15 (93.33%) |
| Source Span selection accuracy | 14/15 (93.33%) |
| Entity Anchor accuracy | 14/15 (93.33%) |
| Capability accuracy | 11/15 (73.33%) |
| Expected Tool exposure accuracy | 11/15 (73.33%) |
| Replay-applicable wrong Tool exclusion | 1/1 (100%) |
| Frozen R02 wrong Tool exclusion | 3/3 (100%) |
| Identical-input consistency | 4/4 (100%) |
| `V5_FALSE_BLOCK` | 3 |
| `V5_BLOCKS_V4_FAILURE` | 5 |
| `V5_INSUFFICIENT_DATA` | 1 |
| `NOT_COMPARABLE` | 0 |

The 14/15 valid metric treats the preserved V4-unavailable Exact path as `NOT_AVAILABLE`, not as a fabricated Protocol result. The underlying Protocol invalid count remains zero.

## 8. Source-Group Metrics

Across five frozen source groups:

- Task Class: 3/5 (60%)
- Projected domain: 4/5 (80%)
- Projected operation: 3/5 (60%)
- Projected entity type: 4/5 (80%)
- Capability: 3/5 (60%)
- Expected Tool exposure: 3/5 (60%)

The two non-passing groups are the preserved coil-read group and the Exact group containing one V4-unavailable path.

## 9. Input-Fingerprint Metrics

Across four distinct Interpreter input fingerprints:

- Task Class: 2/4 (50%)
- Projected domain: 3/4 (75%)
- Projected operation: 2/4 (50%)
- Projected entity type: 3/4 (75%)
- Capability: 2/4 (50%)
- Expected Tool exposure: 2/4 (50%)
- Same-input structured-output consistency: 4/4 (100%)

Consistency records repeatability only; it does not convert the consistently wrong coil-cost selection into an accurate result.

## 10. Exact Entity

Final Exact Entity outcomes are 2/3 correct with one case-level unavailable path. The two evaluated paths have correct Task Class, exact Source Span selection, anchor, capability, and Tool exposure. The third path preserves the original `V4_PATH_UNAVAILABLE` / `SHADOW_INCOMPARABLE` evidence and was not rerun. No Source Anchor implementation failure was found or modified.

## 11. 800平刀

All three frozen 800平刀 paths completed in the continuation:

- Task Class: 3/3
- Source Span: 3/3
- Exact anchor: 3/3
- Capability: 3/3
- Expected Tool exposure: 3/3
- Replay-applicable wrong Tool exclusion: 1/1

No raw entity text is stored in the complete dataset or trace attributes; the label appears here only as the Supervisor-required case-family name.

## 12. Inventory / Coil Read

Six inventory/coil-read paths are represented across the coil-read and part-inventory source groups. All three newly continued part-inventory paths have correct Protocol V2 classification and exposure. The three preserved coil-read paths consistently select actual class `tc_003` instead of expected class `tc_004`, producing three false blocks. The separate three simple-success controls also classify correctly. This is the same previously audited Task Class description failure, not a router or Tool-exposure failure.

## 13. R02 Wrong Tool Exclusion

The frozen P06 corpus identifies three R02 paths. All three frozen wrong V4 Tools are excluded from the V5 allowed Tool sets: 3/3. The current replay produced an out-of-Oracle Tool on only one R02 path, so the replay-applicable runtime metric is separately reported as 1/1. Keeping both denominators avoids overstating or obscuring the evidence.

## 14. False Blocks

`V5_FALSE_BLOCK=3`, all from one coil-read source group repeated across three runtime variants. There are no new false blocks in the nine continuation paths. The complete corpus therefore strengthens the V2.1 diagnosis: Task Class descriptions/local contrast require revision, while the deterministic router, bounded Tool exposure, exact Source Anchor, and external Contract V1 remain exonerated.

## 15. Privacy / Trace Integrity

Phoenix project `pump-ai-v5e4r-protocol-v2-shadow` was inspected for the nine new shadow tasks:

- Root shadow spans: 9
- Interpreter child spans: 9
- Orphan spans: 0
- Invalid parent relations: 0
- Cross-request contamination: 0
- Missing source trace correlation: 0
- V5 `execute_tool` spans: 0

Value-level inspection found zero occurrences of prompts, responses, raw entities, Source Span text, Tool values, business values, PII, or secrets. The complete dataset contains only the approved safe structural fields. Phoenix remained healthy and `/healthz` returned HTTP 200 after validation.

## 16. Database Safety

Business database evidence was identical before and after the B1 run:

- SHA-256: `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`
- Size: 35,323,904 bytes
- mtime UTC: `2026-09-03T08:42:16.3158766Z`
- Recursive backup-file count: 209
- Unexpected backup created: no

V5 Tool calls, V5 Business API calls, and V5 writes were all zero.

## 17. Regression

The evaluator continuation suite passed 12/12 tests. The full deterministic suite with V5 Shadow and observability disabled finished at 1,970/1,971. Its sole failure remains the frozen `missing .guardian/config.yaml` failure. No new regression was introduced.

## 18. V2.1 Decision Evidence

`V2_1_RECOMMENDED=YES`.

Recommended mechanism classes, not implemented in B1:

- `TASK_CLASS_DESCRIPTION_REVISION`
- `TASK_CLASS_LOCAL_CONTRAST`

Evidence: every newly executed path classified correctly, while all three existing false blocks share one input fingerprint and consistently select the same valid but semantically wrong coil-cost class. The correction scope should stay within semantic description and local contrast; it must not change Source Anchor, router, Tool exposure, Contract V1, model, or frozen evaluation evidence.

## 19. P15R-C-B2 Preconditions

`P15R_C_B2_READY=YES`.

All 15 frozen paths have a final recorded case-level outcome; the original six were neither rerun nor changed; the remaining nine were executed exactly once; the evaluator now continues only on validated case-level incomparability while retaining fatal-stop behavior; interpreter hashes and production implementation remain unchanged; full V2 metrics, 800平刀, R02, inventory/coil-read, privacy, trace integrity, database safety, and regression evidence are complete. The minimal V2.1 mechanism can now be judged from the full frozen corpus.
