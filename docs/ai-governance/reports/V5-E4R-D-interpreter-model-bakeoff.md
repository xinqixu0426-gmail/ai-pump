# V5-E4R-D Frozen Interpreter Model Bake-off

## 1. Executive Result

P15R-D is **PARTIAL** and `P16_READY=NO`. Two already-authorized DeepSeek alternate models passed their single synthetic canary and each completed exactly one 15-path frozen evaluation. Neither improved the frozen `9/15` Task Class or Capability result, neither fixed coil-read or 800平刀, and both retained three false blocks. No model reached the absolute promotion gate; `RECOMMENDED_INTERPRETER_MODEL=NONE` and `INTERPRETER_MODEL_ROOT_CAUSE=REJECTED`.

The Interpreter-layer conclusion is evidence-backed because it is calculated against frozen expected values and the Interpreter runs before V4 execution. A strict evaluation-isolation limitation was nevertheless found: the evaluator's process-level `DEEPSEEK_MODEL` override also selected the candidate for the later V4 replay calls. This did not alter the Interpreter input or its authoritative accuracy metrics, but it means V4-dependent comparison counts are not a pure “Interpreter-only variable” comparison. No candidate was rerun to correct this because the one-shot rule takes precedence.

## 2. Frozen Architecture

The following B2 hashes matched before and after all candidate evaluations:

| Surface | SHA-256 |
| --- | --- |
| Prompt V2 | `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3` |
| Task Class Semantics 1.1 | `c120fc465004c0424260cf04fdac4d58ef489439fc51264f49e50d53de5121f1` |
| Protocol V2 | `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad` |
| Source Span | `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8` |
| Input Envelope | `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded` |
| Model settings template | `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398` |
| Capability Registry | `c2e9c428c348866d4417a5934d7ec9d36b2d8b85cf147d95e299da8b80b8fc40` |
| Capability Router | `9a13f47414a306a11e62015865162f82098c434a85c1cd17aaa2e026ee7fce55` |
| Tool Exposure | `d4f4ce7caa7c12172b42375350d66843f4337e86b9484f360dc9c42e5850e2e4` |
| Frozen corpus | `315a21d96fdd84f0ecb253772ae942b2cbbfd56842c2a8858e378693f444d4df` |
| Frozen expected results | `6980ffb284a8d82543cb1337dbe4cc9ff70ee5ab3aec59438daf0f39f8ee5590` |

No Interpreter, Prompt, Task Class, Protocol, source, capability, Tool-exposure, V4, dependency, or default-model file was changed.

## 3. Model Availability Audit

The existing DeepSeek credential and client were available. A read-only `/models` inventory returned the configured baseline plus two alternate identifiers: `deepseek-v4-pro` and `deepseek-v4-flash-vision-exp`. Both use the existing OpenAI-compatible provider client and require no new account, key, SDK, dependency, or configuration write.

Kimi was not eligible: its runtime secret row was present but not decryptable in this local environment, so it was treated as unconfigured. No secret values were printed or persisted.

## 4. Candidate Eligibility

Both DeepSeek alternates passed one non-business canary with JSON mode and a valid Protocol V2 result:

| Candidate | Canary | Calls | Duration | Usage |
| --- | --- | ---: | ---: | --- |
| `deepseek-v4-pro` | PASS | 1 | 1390.97 ms | 4032 prompt / 64 completion / 4096 total |
| `deepseek-v4-flash-vision-exp` | PASS | 1 | 1125.01 ms | 4032 prompt / 42 completion / 4074 total |

Both formal results met the model-eligibility gate: `15/15` protocol-valid, zero noncompliance, `15/15` anchor accuracy, and `3/3` Exact identity preservation.

## 5. Evaluation Integrity

- Baseline `deepseek-v4-flash` was loaded from the B2 artifact and was not rerun.
- Each alternate received one canary and one formal 15-path evaluation; there was no retry or resampling.
- The frozen corpus remained 15 paths, 5 source groups, and 4 fingerprints.
- Candidate work directories, Phoenix projects, and datasets were isolated.
- Every pre/post architecture, corpus, and expected-result hash matched.
- The model settings template remained temperature `0`, top-p omitted, JSON-object response mode, maximum output tokens `512`, retry `0`, and one Interpreter call per request.
- Evaluation purity limitation: the candidate model environment variable also applied to V4 replay calls in the same child process. Interpreter inputs were captured before V4 and remained frozen, so semantic accuracy is valid; V4-dependent overall-comparison counts should not be treated as a fully isolated model-only result.

## 6. Baseline Model

Frozen B2 baseline `deepseek-v4-flash`: Task Class `9/15`, Capability `9/15`, Expected Tool Exposure `9/15`, Source Span/Anchor `15/15`, Exact Entity `3/3`, coil-read `0/3`, 800平刀 Task Class `0/3`, same-input consistency `4/4`, and `V5_FALSE_BLOCK=3`.

## 7. Candidate Results

| Model | Valid | Task Class | Capability | Exact | 800平刀 | False Block | Consistency | Promotion |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| `deepseek-v4-pro` | 15/15 | 9/15 | 9/15 | 3/3 | 0/3 | 3 | 3/4 | FAIL |
| `deepseek-v4-flash-vision-exp` | 15/15 | 9/15 | 9/15 | 3/3 | 0/3 | 3 | 4/4 | FAIL |

Both candidates also scored `9/15` for projected domain, operation, entity type, and expected Tool exposure; Source Span and Anchor remained `15/15`; R02 wrong Tool exclusion remained `3/3`.

## 8. Task Class Accuracy

Neither alternate improved the baseline's `9/15` path accuracy, `3/5` source-group accuracy, or `2/4` fingerprint accuracy. The identical error families persisted. This rejects a simple “replace flash with another already-available DeepSeek model” explanation for the frozen semantic failures.

## 9. Coil Read

For both candidates, all three coil-read paths were protocol-valid and exactly anchored, but Task Class, Capability, and Expected Tool Exposure were each `0/3`. Each candidate retained three false blocks on this successful frozen source group.

## 10. Exact Entity

Both candidates passed all three Exact Entity paths for Task Class, Source Span, Anchor, identity preservation, Capability, and Expected Tool Exposure (`3/3` each). The exact-source identity mechanism remained model-independent and intact.

## 11. 800平刀

Both candidates achieved Source Span and Anchor `3/3` but Task Class, Capability, and Expected Tool Exposure `0/3`. Model substitution did not recover the B2 semantic regression.

## 12. R02 Wrong Tool Exclusion

Both candidates excluded the frozen wrong V4 Tool on all three applicable R02 paths (`3/3`). Capability Registry, Router, and Tool Exposure were unchanged.

## 13. Same-Input Consistency

`deepseek-v4-flash-vision-exp` achieved `4/4 (100%)`. `deepseek-v4-pro` achieved `3/4 (75%)`, below both the baseline and promotion requirement. Consistency did not imply correctness: the vision candidate was consistently wrong on the same two source families.

## 14. False Blocks

Each alternate recorded `V5_FALSE_BLOCK=3`, all tied to the unresolved coil-read classification. Because the V4 replay model was not isolated from the candidate override, these counts have an evaluation-purity caveat; however, the affected coil-read V4 paths completed successfully, so the three observed false blocks remain directly supported.

## 15. Protocol Compliance

Both candidates produced `15/15` valid outputs, zero invalid outputs, and zero model noncompliance. They were eligible for semantic comparison but failed its absolute accuracy gates.

## 16. Latency

Formal Interpreter completion latency:

- `deepseek-v4-pro`: median `1404.34 ms`, p95 `1636.11 ms`.
- `deepseek-v4-flash-vision-exp`: median `905.36 ms`, p95 `1199.71 ms`.

The infrastructure-only async scheduler check used 30 OFF and 30 ON runs after five warmups: OFF median/p95 `20.0624/20.0702 ms`, ON median/p95 `20.2481/20.3232 ms`, for median/p95 overhead `0.9256%/1.2606%`. V4 output remained identical and the latency gate passed.

The highest-ranked non-promotable candidate received ten concurrent synthetic calls. Nine were protocol-valid and one was protocol-invalid; the independent input/catalog boundaries showed zero cross-request contamination. This does not change its failed promotion status.

## 17. Token / Cost

- `deepseek-v4-pro`: 65,292 prompt, 960 completion, 66,252 total tokens.
- `deepseek-v4-flash-vision-exp`: 65,292 prompt, 630 completion, 65,922 total tokens.

There is no frozen, authoritative pricing mapping in the current project for these candidates, so cost is `UNKNOWN`.

## 18. Privacy

The aggregate and per-model datasets contain no raw prompt, response, entity, Source Span text, model raw output, Tool value, business value, PII, or secret fields. Phoenix inspection found all 15 target traces for each candidate, with zero missing traces, orphan spans, invalid parents, cross-request contamination, or forbidden content-bearing attribute keys. All leakage counts are `0`.

## 19. Database Safety

The business database remained SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, and mtime UTC `2026-09-03T08:42:16.3158766Z`. Recursive backup count remained `209`; no startup backup was created or removed to pass validation.

## 20. Model Root-Cause Decision

`INTERPRETER_MODEL_ROOT_CAUSE=REJECTED` for the currently configured alternate set. Both eligible alternates matched, rather than exceeded, the baseline's `9/15` Task Class/Capability accuracy and reproduced both critical semantic failure families. The evidence points back to the architecture/task-class representation or available context rather than the particular `deepseek-v4-flash` model identifier.

The conclusion is scoped to the two models already available through the configured DeepSeek account; it is not a universal claim about all models.

## 21. Promotion Decision

`RECOMMENDED_INTERPRETER_MODEL=NONE`. Neither alternate met 100% Task Class/domain/operation/entity type/Capability/Tool-exposure accuracy, 800平刀 `3/3`, same-input consistency `100%`, or zero false blocks. Relative speed or equal accuracy cannot override the absolute promotion gate. No default model, fallback, ensemble, or production route was changed.

## 22. P16 Preconditions

`P16_READY=NO`.

Passed controls include candidate availability/canaries, 15/15 protocol validity and exact anchoring, Exact Entity `3/3`, R02 exclusion `3/3`, zero model noncompliance, frozen hashes/corpus/expected results, zero V5 Tool/API/write calls, privacy, DB/backup safety, `209/209` combined V5 tests, and the full regression retaining only the known Guardian failure.

Blocking results:

- No candidate passed the absolute promotion gate.
- Both candidates remained at Task Class/Capability/Expected Tool Exposure `9/15`.
- Coil-read and 800平刀 remained `0/3` at the semantic Task Class boundary.
- Both retained `V5_FALSE_BLOCK=3`.
- `deepseek-v4-pro` same-input consistency was only `75%`.
- The evaluator's candidate override also affected V4 replay model selection, so strict Interpreter-only evaluation isolation was not fully achieved; no rerun is permitted in this phase.

Full regression: `1986/1987`, with the sole failure still the missing `.guardian/config.yaml`. No new V4 regression was introduced. Supervisor review is required before returning to architecture decisions.
