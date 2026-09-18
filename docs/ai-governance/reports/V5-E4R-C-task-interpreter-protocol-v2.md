# V5-E4R-C Task Interpreter Protocol V2

## 1. Executive Result

P15R-C is **PARTIAL** and `P16_READY=NO`. Protocol V2, its deterministic catalogs, strict ref validation, Contract V1 projection, privacy boundary, concurrency isolation, and performance gate were implemented and passed deterministic verification. The one permitted formal real evaluation was started once, but the frozen V4 runner returned exit status `2` (`SHADOW_INCOMPARABLE`) during the second source case, so the harness stopped after 6/15 paths. It was not modified or rerun after results were observed.

Five interpreter outcomes were captured. All five were Protocol-valid and source-anchored, but the first three identical coil-read inputs consistently selected the coil-cost task class. This produced three observed `V5_FALSE_BLOCK` results. Two exact-identity paths selected the correct recipe-cost class and exact source span; their third runtime variant did not create an independent shadow outcome because the V4 path was unavailable. These facts independently fail the P16 gate even without the harness abort.

## 2. Frozen Prior Evidence

- Start commit: `90cb1127a765d939be297eb94d529b6329baa8b2`
- P15R-B: PARTIAL
- Frozen corpus: 15 paths, five source groups, four interpreter-input fingerprints
- Frozen expected results: unchanged
- External `V5TaskInterpretation` Contract: version 1, unchanged
- Source Anchor exact semantics: unchanged
- Model: DeepSeek `deepseek-v4-flash`, unchanged
- Worktree was not clean; all pre-existing user-owned V4/AI changes were preserved and excluded from this commit.

## 3. Protocol Revision Rationale

V1/V1.1 allowed the model to independently emit domain, operation, entity type, and candidate text. Frozen evidence showed coupled semantic errors, non-verbatim entity output, inconsistent repeated outputs, and false blocks. Protocol V2 instead lets the model select existing opaque task-class and exact source-span refs. This eliminates model-owned identity rewriting and free enum composition without adding keyword or frozen-case rules.

## 4. Task Class Catalog

`V5_TASK_CLASS_CATALOG_VERSION=1`. The catalog deterministically derives 27 read-only/exposable task classes from existing Capability Registry tuples and the frozen semantic taxonomy. Equal domain/operation/entity-type tuples collapse into one sorted class and receive stable `tc_NNN` refs. The model view contains semantic descriptions and class-local entity slots, but no Tool names, Tool schemas, capability IDs, arguments, business values, or case examples.

Validation covers unique refs, valid domain/operation/entity IDs, correspondence to an existing registry tuple, deterministic ordering, and Tool-name exclusion. A class ref does not bypass the existing Capability Router.

## 5. Source Span Catalog

The catalog uses source-exact Unicode segmentation, bounded adjacent segment combinations, quoted substrings, and generic identifier-like runs preserving `-`, `_`, `+`, `.`, and `/`. It never normalizes, lowercases, strips punctuation, translates, corrects spelling, or coerces numbers. Duplicate boundaries are removed and ordering is deterministic.

- Maximum spans: 128
- Maximum segment combination: 6
- Overflow: `SPAN_CATALOG_LIMIT`, fail closed

All required deterministic examples, including punctuation-heavy, CJK/numeric-like, and quoted numeric strings, produced their full exact spans. Every stored boundary was verified against `source.slice(start, end)`, including surrogate-pair safety.

## 6. Protocol V2 Schema

The strict top-level fields are `protocolVersion`, `taskClassRef`, `entitySelections`, and `needsClarification`. Each selection contains only `slotRef` and `spanRef`. Unknown class/span/slot refs, missing required slots, duplicate slots, versions other than 2, invalid JSON, and extra fields fail closed.

The model cannot output domain, operation, entity type, candidate text, raw or normalized mention, capability, Tool, answer, or reasoning. Retry remains zero and maximum calls remain one.

## 7. Projection To Contract V1

Validated refs project deterministically to the unchanged Contract V1:

1. class ref supplies domain and operation;
2. class-local slot supplies ontology entity type;
3. span ref supplies the exact transient source substring;
4. the projected object passes the existing Contract V1 validator;
5. the unchanged exact Source Anchor validates it;
6. the existing deterministic Capability Router and bounded Tool exposure run independently.

No V5 Tool, business API, or write execution exists in this path.

## 8. Exact Identity Guarantee

The model has no candidate-text field, so it cannot submit a rewritten entity string. `rawMention` comes only from the selected exact catalog span and then passes the unchanged exact Source Anchor. Tests confirmed exact source spans for all required punctuation and numeric-like fixtures. This guarantees source provenance; it does not guarantee that the model selects the semantically intended span or task class.

## 9. Deterministic Tests

- Protocol V2 focused suite: 40/40 passed.
- Combined V5 A–E4R-C suites: 181/181 passed.
- Tests cover stable catalogs, taxonomy validity, Tool-free task classes, exact spans, bounds, determinism, invalid refs, extra fields, wrong-class non-correction, Contract V1 projection, unchanged anchor behavior, no-op/error/timeout paths, privacy, ten-request isolation, and no V5 execution.

## 10. Pre-Eval Freeze

- Prompt V2: `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3`
- Task Class Catalog: `c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9`
- Source Span code/config: `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8`
- Protocol V2: `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad`
- Model settings: `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398`
- Input envelope: `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded`

Before the formal run, all deterministic V5 tests passed and the full regression was 1958/1959 with only the frozen `.guardian/config.yaml` failure.

## 11. Frozen One-Shot Real Evaluation

Exactly one formal V2 run was started. The first source case completed all three runtime variants. In the second source case, the V4R3 path was `UNAVAILABLE` and the frozen runner returned status `2` with `SHADOW_INCOMPARABLE`; the evaluator treated only statuses 0/1 as admissible and stopped. No implementation, runner, setting, prompt, catalog, contract, router, ontology, or anchor change was made afterward, and no second run was attempted.

- Frozen paths targeted: 15
- Paths attempted/observed: 6
- Independent interpreter outcomes: 5
- V5 interpreter model calls: 5
- Protocol-valid observed outputs: 5/6 (five valid, one outcome unavailable)
- Protocol-invalid observed outputs: 0
- Model noncompliance observed: 0

## 12. Protocol Accuracy

Observed partial metrics only; they are not a substitute for the 15-path frozen denominator:

- Protocol valid: 5/6
- Projected domain: 5/6
- Projected operation: 2/6
- Projected entity type: 5/6
- Entity anchor: 5/6

## 13. Task Class Accuracy

Observed task-class accuracy was 2/6. The three identical coil-read inputs all selected the coil-cost class rather than the authoritative coil-read class. The two completed exact-identity interpretations selected the authoritative recipe-cost class. The sixth path had no independent outcome.

## 14. Source Span Accuracy

Five observed Protocol-valid outcomes selected existing exact refs and all five passed exact anchoring. The unavailable sixth path was not run, so observed source-span and anchor accuracy are 5/6. The full 15-path and full exact-identity gates remain unverified.

## 15. Capability / Tool Exposure Accuracy

Observed capability and expected Tool-exposure accuracy were both 2/6. Incorrect coil-cost task classes deterministically routed to the coil-cost capability and its bounded Tools; the router did not override or repair the model’s wrong but valid class. This confirms Router and Tool exposure behaved as designed while exposing an Interpreter classification failure.

The three R02 paths were not reached, so wrong-Tool exclusion is `NOT_RUN` with denominator 0.

## 16. Exact Entity

Three exact paths were attempted. Two produced correct task class, selected source ref, exact anchor, preserved identity, correct capability, and expected Tool exposure. The V4R3 path produced no independent shadow outcome. Observed result: 2/3 for each exact gate, not the required 3/3.

## 17. 800平刀

The three frozen 800 flat-blade paths were not reached after the runner abort. All 800-specific real metrics are `NOT_RUN`. Deterministic numeric/CJK exact-span tests passed.

## 18. Same-Input Consistency

Among the two fingerprints with repeated interpreter outcomes, each observed structured output was internally consistent: 2/2 fingerprints, 100%. This does not satisfy the complete frozen-corpus gate because one runtime variant had no interpreter outcome and three source groups were never reached.

## 19. False Blocks

Three observed successful V4 coil-read paths were assigned the wrong coil-cost task class, yielding `V5_FALSE_BLOCK=3`. This is a hard P16 blocker. The partial sample contains two `AGREE` failed-V4 exact paths and one `V5_INSUFFICIENT_DATA`; `V5_BLOCKS_V4_FAILURE=0` in the observed partial set.

## 20. Privacy

Phoenix project `pump-ai-v5e4r-protocol-v2-shadow` contained 80 spans after the run. Inspection of the five V2 shadow traces found no input/output message attributes, raw mention, candidate text, span text, Tool argument values, or Tool result payloads. Known exact-entity/flat-blade business literals had zero occurrences. Structural fields such as argument key counts and result type remain allowed metadata.

Leakage counts are zero for prompt, response, raw entity, source span text, Tool values, business values, PII, and secrets. The repository evaluation dataset contains only safe refs, booleans/statuses, reason codes, fingerprints, trace IDs, and shadow task IDs.

## 21. Performance / Concurrency

Before the one-shot freeze, five warmups plus 30 OFF and 30 ON deterministic runs measured:

- OFF median: 20.0677 ms; p95: 20.0809 ms
- ON median: 20.2574 ms; p95: 20.2892 ms
- Median overhead: 0.9453%
- p95 overhead: 1.0373%

The 5%/10% performance gate passed. Ten concurrent eligible requests produced ten independent model calls with zero cross-request, span-catalog, task-class-catalog, input-fingerprint, or shadow-task contamination. Observed real V2 shadow completion median was 611.323 ms and p95 was 1472.7216 ms.

## 22. Database Safety

Before and after all P15R-C work:

- SHA-256: `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`
- Size: 35,323,904 bytes
- mtime UTC: `2026-09-03T08:42:16.3158766Z`
- Recursive backup count: 209

Hash, size, mtime, and backup count are unchanged. No startup backup was created.

## 23. Regression

With observability and V5 shadow disabled, the full deterministic regression was 1958/1959. The sole failure remains `businessTerminologyContract.test.cjs` because `.guardian/config.yaml` is absent. No new regression was introduced. The combined V5 suite was 181/181.

## 24. Post-Eval Hash Verification

All six post-eval hashes exactly match the pre-eval values in section 10. `Pre/Post Eval Hashes Match=YES`. There were no post-eval interpreter implementation changes. Frozen corpus and expected results were unchanged.

## 25. Known Limitations

- The formal one-shot run stopped after 6/15 paths because the frozen V4 runner emitted status 2 on an unavailable/incomparable path. Per the one-shot rule, the evaluator was not changed or rerun.
- Observed task-class semantics still confuse coil read with coil cost despite the ref-only protocol; Protocol V2 constrains output shape and identity ownership but does not ensure semantic class selection.
- Exact-identity real evidence is 2/3, 800 flat-blade and R02 evidence are not run, and complete 15-path privacy/trace evidence is unavailable.
- Source-span accuracy means a valid exact catalog ref selected and exact anchor passed. Correct business-target selection still depends on the frozen Oracle and task-class/capability comparisons.

## 26. P16 Preconditions

`P16_READY=NO`.

Blocking gates:

- Formal frozen corpus incomplete: 6/15 attempted, five interpreter outcomes.
- Task class, operation, capability, and expected Tool exposure metrics are below 100% in observed evidence.
- `V5_FALSE_BLOCK=3`.
- Exact Entity is 2/3 rather than 3/3.
- 800 flat-blade and R02 wrong-Tool exclusion were not run.
- Complete 15-path Protocol validity, model compliance, same-input consistency, privacy, and semantic metrics are not established.

V5 Tool calls, V5 business API calls, V5 writes, and production V5 routing remain zero. P16 must not begin without Supervisor review.

