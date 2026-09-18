# V5-E4R-B Task Interpreter V1.1

## 1. Executive Result

P15R-B is `PARTIAL`. The approved one-shot V1.1 revision was implemented without changing Contract V1, the exact Source Anchor, the model, Registry/Ontology IDs, V4 behavior, or execution authority. Deterministic tests, isolation, latency, privacy, trace integrity, and database safety pass. The single frozen 15-path Real Evaluation does not pass the semantic gate: 12/15 outputs are valid, core path metrics are 8/15, Exact Entity anchoring is 0/3, identical-input consistency is 3/4, and two successful V4 paths are false-blocked. No post-evaluation tuning or second evaluation occurred. `P16_READY=NO`.

## 2. Frozen P15 / P15R-A Evidence

- P15 commit: `009b50547a1c3d690b7b01f86545b49183959dcd`
- P15R-A commit / P15R-B start: `d68925a46423dddf8fba34767b132727831c01dc`
- P15R-A findings: Prompt failure 3, domain-taxonomy failure 3, insufficient context 3; Router and Tool Exposure were not root causes; Source Anchor was correct; Contract V1 could represent every frozen case; model decision was KEEP.
- Frozen corpus: 15 paths, five source groups, four distinct Interpreter inputs.
- Frozen corpus SHA-256: `0C2929647DBA224CD9D9984083F454EE654D644A9EE199577F869BCAB6FF8618` before and after.

## 3. Approved Change Scope

Only Prompt V1.1, an isolated semantic taxonomy, explicit deterministic model settings, a minimal authoritative pre-routing context envelope, safe evaluation metadata, tests, and documentation were added. No dependency, Contract field, capability/ontology ID, exact-anchor rule, V4 decision, Tool executor, Business API, write path, or production V5 route changed.

## 4. Prompt V1.1

Prompt version is `1.1`; Interpreter and output Contract remain version `1`. The instruction now provides concise semantics and general contrasts, restricts output to Contract V1, forbids Tool/capability/answer fields, and requires character-for-character source copying. It includes no frozen-case string and no keyword-specific rule.

## 5. Semantic Taxonomy

`taskInterpreterSemantics.cjs` defines all 12 current domains, 28 current operations, and 19 current ontology entity types. Its validator requires an exact ID-set match with Capability Registry V1 and Business Ontology V1, preventing missing or stale semantics. IDs and deterministic routing are unchanged.

## 6. Pre-Routing Context Envelope

The internal envelope contains the transient raw request, optional safe structural context, and an evaluation-only SHA-256 input fingerprint. The only approved context is validated order-page `surfaceType` and `view`; the business resource ID is omitted. V4 Tool, capability, resolver, normalized entity, verification, answer, and business-result facts are rejected. The frozen corpus had no eligible page context, so context remained explicitly unavailable rather than fabricated.

## 7. Deterministic Model Settings

- Provider/model: DeepSeek / `deepseek-v4-flash`
- Temperature: `0`
- Top P: omitted
- Response format: `{"type":"json_object"}`
- Max output tokens: `512`
- Thinking: disabled
- Streaming: false
- Retry: `0`
- Maximum calls per request: `1`

The current wrapper supports the selected fields; no provider or dependency was added. References: official DeepSeek [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) and [JSON Output guide](https://api-docs.deepseek.com/guides/json_mode/).

## 8. Source Anchor — Unchanged

The source-anchor file is byte-identical to the start commit (`git blob d4eece285c192787ea0d07a9ccd066ca943df90c`). Zero/one/multiple exact matches still produce invalid/anchored/ambiguous outcomes. No fuzzy match, punctuation repair, case conversion, normalization fallback, or numeric coercion was introduced.

## 9. Pre-Eval Freeze Hashes

- Prompt: `e06a462603eb87ed0161f7ad5d234b842f60ee3111fb9b11f82f9ab0b03020ac`
- Semantic taxonomy: `d2ae5fd41ae52d7c6f9ea4501e9d6c1b59ad2d42733219cd829fb250347914bc`
- Model settings: `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398`
- Input-envelope implementation: `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded`

These hashes were recorded after all implementation and deterministic-test work, before the real evaluation.

## 10. Deterministic Tests

V1.1 tests cover all original fake-model failures, strict extra-field rejection, exact and numeric-like anchoring, complete semantic-ID validation, deterministic request parameters, safe/missing context, rejection of downstream/business fields, immutability, four-level evaluation aggregation, and frozen R02 denominator rules. Focused V1.1/independent tests pass 53/53; combined V5 tests pass 171/171.

## 11. Frozen One-Shot Real Evaluation

Exactly one formal V1.1 run executed all 15 frozen paths. It made 15 V5 Interpreter model calls, zero V5 Tool calls, zero V5 Business API calls, and zero V5 writes. Results: 12 valid, three invalid anchor outcomes, no timeout, and no provider error. The evaluation was not rerun and implementation was not changed afterward.

## 12. Path-Level Metrics

| Metric | Result |
| --- | ---: |
| Domain | 8/15 (53.33%) |
| Operation | 8/15 (53.33%) |
| Entity type | 8/15 (53.33%) |
| Entity anchor | 12/15 (80.00%) |
| Capability | 8/15 (53.33%) |
| Expected Tool exposure | 8/15 (53.33%) |

Compared with Prompt V1, the core semantic metrics rose from 6/15 to 8/15 and anchor accuracy from 10/15 to 12/15, but every required gate remains below 15/15.

## 13. Source-Group Metrics

Strict aggregation requires every runtime variant in a source group to pass. Domain, operation, entity type, capability, and expected Tool exposure are each 2/5 (40%); anchor is 4/5 (80%).

## 14. Input-Fingerprint Metrics

Strict aggregation over four actual envelope fingerprints gives domain, operation, entity type, capability, and expected Tool exposure each 2/4 (50%); anchor is 3/4 (75%). Fingerprints contain no raw request or entity value.

## 15. Same-Input Consistency

Three of four identical-input groups produced the same validated structural output: 3/4 (75%). One shared input produced both catalog/part and coil interpretations across runtime paths despite identical envelope fingerprints and temperature zero. This is observational model inconsistency and independently blocks P16.

## 16. Exact Entity

All three paths selected the correct domain, operation, and entity type, but the model changed the candidate text; the unchanged exact anchor correctly rejected all three. Anchor accuracy and identity preservation are both 0/3. This is three model-noncompliance outcomes, not a Source Anchor defect.

## 17. 800平刀

All three paths achieved exact anchor 3/3, expected capability 3/3, and expected Tool exposure 3/3. The value remained transient and is not stored in the evaluation dataset or Phoenix attributes.

## 18. Wrong Tool Exclusion

The authoritative R02 denominator is three frozen paths. The independent allowlist excludes the observed wrong V4 Tool on two; one inventory path is itself misinterpreted as the wrong coil capability and therefore exposes that wrong Tool. Result: 2/3 (66.67%). This safe denominator correction was applied only to the post-evaluation dataset metadata; no model result or expected result changed.

## 19. V5 False Block

Two V4 PASS paths with the shared inventory input were interpreted as coil reads, producing `V5_FALSE_BLOCK=2`. Four failed V4 paths are classified `V5_BLOCKS_V4_FAILURE`; three remain `V5_INSUFFICIENT_DATA`; six agree. False blocks are a hard P16 blocker.

## 20. Privacy

Phoenix contains the expected 15 Agent roots, 15 Interpreter model spans, 15 projection spans, and 15 comparison spans for the formal evaluation. Inspection found no prompt/response, raw entity, candidate text, Tool value, business value, PII, or secret attribute keys or values. All leakage counts are zero. The safe dataset contains only enums, booleans, reason codes, hashes, trace IDs, task IDs, and aggregate metrics.

## 21. Performance / Concurrency

The deterministic V4 result is byte-equivalent with Shadow OFF and ON. Ten concurrent requests created ten isolated shadow tasks/model calls with zero contamination. After five warmups, 30 OFF runs measured 20.0668 ms median and 20.0764 ms p95; 30 ON runs measured 20.2694 ms median and 20.3322 ms p95. Median overhead is 1.0096% and p95 overhead is 1.2741%, passing the 5%/10% gate. Real Shadow completion median is 570.25 ms and p95 is 840.43 ms.

## 22. Database Safety

The source business database remains SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, with recursive backup count `209`. Hash, mtime, size, and backup count match the start baseline; no startup backup was created.

## 23. Regression

With observability and V5 Shadow disabled, the full deterministic suite is 1948/1949. The sole failure is the pre-existing missing `.guardian/config.yaml`; no new regression was introduced. The total exceeds the frozen 1916/1917 baseline because existing user work and new P15R-B tests are present, while the failure identity remains unchanged.

## 24. Post-Eval Hash Verification

Post-evaluation hashes exactly match the four pre-evaluation hashes in section 9. The frozen corpus hash is also unchanged. No Interpreter, Prompt, semantics, context, settings, Contract, Router, Ontology, Registry, or Source Anchor file changed after the formal run.

## 25. Known Limitations

- Prompt V1.1 does not meet the frozen semantic, exact-identity, consistency, wrong-Tool exclusion, or false-block gates.
- Three otherwise semantically correct Exact Entity interpretations still alter the source candidate.
- Identical requests can produce different structural interpretations even with temperature zero; provider-side determinism is not guaranteed by the client setting.
- The approved pre-routing context cannot disambiguate the frozen shared inventory input because those paths contain no eligible authoritative page context; no context was fabricated.
- Aggregate token usage is 30,621 prompt, 889 completion, and 31,510 total tokens. Cost is `UNKNOWN` because the project has no verified price mapping for this exact configured model.
- Shadow scheduling remains process-local.

## 26. P16 Preconditions

`P16_READY=NO`. The failed gates are: 15/15 valid outputs, all semantic metrics 100%, Exact Entity 3/3, R02 wrong Tool exclusion 3/3, zero false blocks, and 100% same-input consistency. P15R-B stops without a second Prompt revision, a second Real Evaluation, V5 Tool/API/write authority, production routing, cutover, or P16 work.
