# V5-E4 Independent Task Interpreter + Capability Shadow

## 1. Executive Result

P15 implements the isolated V5 Task Interpreter V1, strict structured validation, source-only entity anchoring, deterministic V5-B routing, bounded Tool exposure, and asynchronous production shadow integration. Deterministic contracts, privacy, trace correlation, concurrency, latency, and zero-execution invariants pass. The single frozen Prompt V1 real evaluation does not meet the accuracy gate: capability routing and expected Tool exposure are 6/15 (40%), entity anchor accuracy is 10/15 (66.67%), and one of six current V4 success controls is a V5 false block. P15 is therefore PARTIAL and `P16_READY=NO`; Prompt V1 was not tuned after evaluation.

## 2. Frozen Baseline

- P14 commit: `858bafc01cc77c25eec8400e97542ccb9f87e650`
- Regression baseline: 1916/1917
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: NO; pre-existing user V4/AI changes remain excluded.
- Business DB baseline: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, recursive backup count `209`.

## 3. Remaining V5 Gap

P14 compared V4-produced structure. It did not independently interpret a request. P15 supplies this missing boundary without using V4 routing as the answer and without authorizing execution.

## 4. Task Interpreter V1

The interpreter and Prompt are both version 1. It reuses configured DeepSeek `deepseek-v4-flash`, performs one non-streaming model request, sends zero Tool definitions, uses one provider attempt (`retry=0`), and has an independent 20,000ms timeout. Its role is limited to domain, operation, entity candidates, and clarification.

## 5. Structured Output Contract

The exact-key contract is implemented in `taskInterpretationContract.cjs`. Unknown/mismatched domain, operation, entity type, version, reason code, malformed JSON, and extra fields fail closed. A model-produced `toolName` is rejected.

## 6. Source-Anchored Entity Identity

`candidateText` is transient. Deterministic anchoring creates `rawMention` only from the original source slice after a unique exact non-prefix match. It performs no fuzzy match, normalization, punctuation removal, repair, or numeric coercion. Deterministic preservation tests cover `v750-tokoy-`, `V750-A`, `800平刀`, `abc-`, `-a-`, `a/b`, `a.b`, `a_b`, `a+b`, and `800`.

## 7. Validation Pipeline

The fixed pipeline is parse → strict schema → registry enums → ontology entity type → source anchor → V5Task state transitions → V5-B Router. Failure at any step exposes no Tool.

## 8. Capability Routing

Only validated source-anchored interpretations reach the unchanged deterministic V5-B Router. Real evaluation authority is the frozen Oracle expected primary Tool mapped through the registry reverse index, never the current V4 Tool.

## 9. Limited Tool Exposure

Only a `SELECTED` route returns the capability allowlist. Tool definition count supplied to the interpreter itself is always zero. All projected exposure remains `executionAllowed=false`.

## 10. Independent Shadow Architecture

The existing bounded Shadow scheduler receives the raw request as a transient runtime-only argument after V4 completes. The request is neither added to `V5ShadowFacts` nor returned in the outcome. V4 never awaits Shadow completion. Capacity, timeout, error containment, and process-local bounded scheduling remain unchanged in authority.

## 11. Deterministic Tests

Focused P15 and adjacent Shadow tests pass 48/48. The combined V5 A-E4, AI runtime, and SSE suite passes 163/163. Coverage includes valid output, invalid JSON, unknown enums, altered/zero/duplicate anchor, extra Tool field, timeout, model error, exact identity strings, multiple candidates, bounded exposure, privacy, and ten-request isolation.

## 12. P06/P14 Real Corpus

One frozen Prompt V1 evaluation ran all five focused cases across Legacy, V4 Investigation, and V4+R3: 15 interpreter calls, 15 paths, 13 structurally valid interpreter outputs, 2 anchor-invalid outcomes, zero timeouts, and zero provider errors. Current V4 results were 6 PASS and 9 FAIL. The evaluation was not rerun after observing failures.

## 13. Exact Entity Evaluation

The three Exact Identity paths anchored 0/3. Two outputs copied an altered identity candidate and were correctly rejected by source anchoring; the third requested clarification without a candidate. Exact identity preservation therefore failed the real gate even though the deterministic boundary correctly prevented silent mutation.

## 14. 800平刀 Evaluation

The three paths anchored 1/3. None selected the Oracle-authoritative `inventory.read` capability, and none exposed expected `search_parts`. The source boundary preserved the one anchored value as a string, but real capability interpretation failed.

## 15. Success Controls

The current replay contained six V4 PASS controls. Five agreed; one part-inventory success was independently classified as `coil.read`, producing one `V5_FALSE_BLOCK`. This is a P16 blocker.

## 16. Failure Controls

Nine current V4 paths failed. P15 independently blocked three: two Exact Identity A01 paths at the source anchor and one wrong-Tool path through correct bounded capability exposure. Six remained insufficient at the interpreter/capability layer. No state/evidence gate was misrepresented as an interpreter fix.

## 17. Routing / Exposure Accuracy

- Domain accuracy: 6/15 (40%)
- Operation accuracy: 6/15 (40%)
- Entity type accuracy: 6/15 (40%)
- Entity anchor accuracy: 10/15 (66.67%)
- Capability routing accuracy: 6/15 (40%)
- Expected Tool exposure accuracy: 6/15 (40%)
- Wrong V4 Tool exclusion accuracy: 13/15 (86.67%)

Invalid/clarification outcomes remain in the denominator; they are not excluded to inflate accuracy.

## 18. Real Interpreter Metrics

- Calls: 15
- Valid outputs: 13
- Invalid outputs: 2
- Timeouts: 0
- Errors: 0
- Provider/model: DeepSeek / `deepseek-v4-flash`
- Outcomes: `AGREE=5`, `V5_BLOCKS_V4_FAILURE=3`, `V5_FALSE_BLOCK=1`, `V5_INSUFFICIENT_DATA=6`

## 19. Privacy

Phoenix correlation covers 15/15 real interpreter spans with orphan=0, invalid parent=0, missing=0, and cross-request contamination=0. Secret, PII, business, Tool value, raw entity, candidate text, prompt, and response sentinels each occur zero times.

## 20. Concurrency / Performance

Deterministic ten-request concurrency produced ten tasks and ten interpreter calls with zero contamination. V4 OFF/ON results are byte-equivalent. After five warmups per mode, 30 OFF runs measured 20.0611ms median and 20.0714ms p95; 30 ON runs measured 20.2225ms median and 20.2670ms p95. Median overhead was 0.8045% and p95 overhead was 0.9745%, both within the gate. Real interpreter completion median was 649.87ms and p95 was 952.42ms.

## 21. Cost

Provider-reported aggregate usage was 14,226 prompt tokens, 948 completion tokens, and 15,174 total tokens. The project has no verified price mapping for this exact configured model, so Interpreter cost is `UNKNOWN` rather than guessed.

## 22. Database Safety

After all validation, the source DB still has SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, and recursive backup count `209`. Real replay and all deterministic suites used isolated test databases. No startup backup side effect, V5 Tool, Business API, or write call occurred.

## 23. Regression

Focused tests pass 48/48 and combined V5 A-E4/runtime/SSE tests pass 163/163. The full Shadow-OFF deterministic regression is 1936/1937; its sole failure is the frozen missing `.guardian/config.yaml` failure. No new regression was introduced.

## 24. Production Isolation

V4 remains authoritative. Production requests routed to V5, V5 Tool calls, V5 Business API calls, and V5 writes are zero. The only newly allowed V5 external action is one bounded interpreter model call per sampled eligible Shadow request.

## 25. Known Limitations

- Prompt V1 real semantic accuracy is below every requested accuracy target except zero timeout/error.
- Exact Identity and 800平刀 real gates fail despite deterministic source anchoring behaving safely.
- One real V4 success control is falsely blocked.
- The focused 15-path set repeats five source requests over three V4 runtime variants and is not a production prevalence estimate.
- Shadow capacity and scheduling remain process-local.

## 26. P16 Preconditions

`P16_READY=NO`. Required 100% entity anchoring, capability routing, expected Tool exposure, wrong-Tool exclusion, and zero false blocks were not achieved. P15 stops without Prompt tuning, Tool execution, production routing, or cutover.
