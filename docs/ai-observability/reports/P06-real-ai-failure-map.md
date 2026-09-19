# P06 Real AI Replay + Failure Taxonomy

## 1. Executive Result

P06 replayed five existing read-only R4-B cases across Legacy V3, V4 Investigation, and V4+R3 with the real configured DeepSeek provider. The 15-path analysis corpus produced 15 valid Phoenix traces: 8 failed and 7 passed. No trace was excluded, no business database or backup changed, and privacy leakage remained zero.

The primary failure map is `C02=3`, `R02=3`, and `A01=2`. The most important distinction is that `failed_unverified` was not treated as an automatic verifier root cause. Exact Entity Identity first diverged before resolver entry in two paths; the resolver exact-matched the already-altered identity. The third exact-identity path preserved the expected input shape and exact identity, then continued into unrelated routes instead of terminating. The 800 flat-blade case exhibited three different structural failures across the three runtime paths.

```text
P06_STATUS=PASS
P07_READY=YES
NO_AI_FIX_INTRODUCED=YES
```

## 2. Frozen Baseline

```text
P05_COMMIT=da51742e42256c92aaa919ef5710a8798224229a
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
TRACE_SCHEMA_VERSION=1
REGRESSION_BASELINE=1777/1778
KNOWN_FAILURE=missing .guardian/config.yaml
PHOENIX_INITIAL_STATUS=HEALTHY
```

All pre-existing user-owned V4/AI changes remained in place and were excluded from the P06 commit.

## 3. Replay Inventory

All selected cases came from the current `scripts/run-ai-shadow-evaluation.cjs` Oracle definitions. The runner enforces `read_only`, rejects write capabilities, passes `allowWrite=false`, snapshots `pump.db`, and runs formal APIs against an isolated temporary database.

| Frozen case | Stable P06 case family | Legacy | V4 Investigation | V4+R3 |
| --- | --- | --- | --- | --- |
| Simple current inventory control | `P06-SIMPLE-001` | FAIL / running | PASS / completed | PASS / completed |
| Exact Entity Identity current cost | `P06-EXACT-001` | FAIL / running | FAIL / budget_exhausted | FAIL / budget_exhausted |
| 800 flat blade | `P06-FLATBLADE-001` | FAIL / running | FAIL / budget_exhausted | FAIL / needs_clarification |
| Part inventory numeric fact | `P06-INVENTORY-001` | PASS / completed | FAIL / needs_clarification | PASS / completed |
| Coil stable identity and inventory | `P06-COIL-001` | PASS / completed | PASS / completed | PASS / completed |

Focused R4-B and Real AI Shadow therefore remain `FAIL`. Inventory Numeric Facts are mixed at 5/6 path passes; Coil Stable Identity passed 3/3. Both V4 Investigation and V4+R3 real Oracle paths were exercised. The formal five-run Repeat Stability suite was not run because it would add fifteen paid model paths per group and was not required to identify the requested key failures.

## 4. Valid / Invalid Trace Counts

```text
Phoenix project=pump-ai-p06-real-replay
span_count=199
trace_count=15
root_count=15
orphan_count=0
duplicate_span_id_count=0
invalid_parent_count=0
span_after_root_end_count=0
invalid_name_count=0
trace_id_consistency=PASS
schema_version=1
TRACE_INVALID=0
```

The P05 validator checked each case trace and the complete P06 project. Every critical case entered the failure statistics.

## 5. Failure Taxonomy

P06 freezes these primary classes without changing their meanings:

```text
I01 INTENT_FAILURE
E01 ENTITY_EXTRACTION_FAILURE
E02 ENTITY_NORMALIZATION_FAILURE
E03 ENTITY_RESOLUTION_FAILURE
E04 ENTITY_IDENTITY_LOSS
R01 ROUTING_FAILURE
R02 TOOL_SELECTION_FAILURE
A01 ARGUMENT_GENERATION_FAILURE
A02 ARGUMENT_NORMALIZATION_FAILURE
T01 TOOL_EXECUTION_FAILURE
T02 TOOL_RESULT_HANDLING_FAILURE
V01 EVIDENCE_MISSING
V02 PREMATURE_VERIFICATION
V03 FALSE_NEGATIVE_VERIFICATION
V04 FALSE_POSITIVE_VERIFICATION
C01 CONTEXT_CONTAMINATION
C02 STATE_TRANSITION_FAILURE
S01 SYNTHESIS_FAILURE
ST01 REPEAT_INSTABILITY
D01 DATA_CONTRACT_FAILURE
U01 UNCLASSIFIED
```

The classifier uses the frozen Oracle trajectory, the first structural divergence, and Phoenix span metadata. It records one `ROOT_CAUSE`, optional `CONTRIBUTOR` classes, and downstream symptoms. No LLM judge is used.

## 6. Failure Map

The denominator is the eight valid failed path cases.

| Primary class | Count | Percentage | Affected suites | Representative cases |
| --- | ---: | ---: | --- | --- |
| C02 | 3 | 37.5% | Exact Identity, 800 flat blade | `P06-EXACT-001-V4R3`, `P06-FLATBLADE-001-LEGACY`, `P06-FLATBLADE-001-V4I` |
| R02 | 3 | 37.5% | 800 flat blade, part inventory, simple control | `P06-FLATBLADE-001-V4R3`, `P06-INVENTORY-001-V4I`, `P06-SIMPLE-001-LEGACY` |
| A01 | 2 | 25.0% | Exact Identity | `P06-EXACT-001-LEGACY`, `P06-EXACT-001-V4I` |

Contributor/downstream counts overlap primary cases: routing classes (`R01` or `R02`) occur in 6 failures; verification/evidence classes (`V01` or `V03`) occur in 6; Exact Identity loss (`E04`) occurs in 2. There were no observed primary Entity normalization, Entity resolution, Tool execution, or argument-normalization failures.

## 7. Root Cause Pareto

```text
#1 C02 STATE_TRANSITION_FAILURE: 3 / 8 = 37.5%
#2 R02 TOOL_SELECTION_FAILURE: 3 / 8 = 37.5%; cumulative 75.0%
#3 A01 ARGUMENT_GENERATION_FAILURE: 2 / 8 = 25.0%; cumulative 100.0%
```

This Pareto describes only the valid focused replay corpus and must not be generalized to every V4 request.

## 8. Exact Entity Identity Analysis

The frozen target is `v750-tokoy-`; no raw value was exported to Phoenix or the machine-readable dataset.

| Path | Raw-stage structural evidence | Resolver outcome | Tool path | First divergence |
| --- | --- | --- | --- | --- |
| Legacy | resolver input shape length/punctuation `10/1`, expected `11/2`; fuzzy probe normalization delta `-1/-1` | exact match, 2 candidates, resolved hash identifies the alternate collision | discovery then `preview_recipe_cost` | `pump.ai.entity.normalize` is the first observable span; its input proves identity loss already occurred in model-generated arguments. Root `A01`, contributor `E04`. |
| V4 Investigation | input shape `10/1`, delta `-1/-1` | exact match, 2 candidates, same alternate hash | expected cost tool followed by unrelated part/coil/template routes | same first divergence as Legacy. Root `A01`; contributors `E04`, `R01`; downstream `V01`. |
| V4+R3 | input shape `11/2`, delta `-2/-2` | exact match, 1 candidate, expected stable hash | expected cost tool succeeded, then routing continued into unrelated capabilities | first divergence is the first subsequent `pump.ai.route` selecting `search_parts`. Root `C02`; contributor `R01`; downstream `V01`. |

The normalization span observes fuzzy search-probe normalization; it does not prove that normalization rewrote tool arguments. The decisive evidence is the shape entering that span plus the resolver's exact-match hash. Therefore `E02` is not assigned as root cause.

## 9. 800平刀 Analysis

No independent entity-normalization stage was invoked for these keyword search tool calls; Entity Resolution reported `not_applicable`, which is expected for this tool shape.

| Path | Routing/tool/verification evidence | First divergence |
| --- | --- |
| Legacy | executed the expected `search_parts`; verification was `verified`, after one tool; projected terminal remained `running` | post-verification state transition, `C02` with `S01` contributor |
| V4 Investigation | first routed to and executed `search_parts`, then continued to coil/template/recipe routes and ended `budget_exhausted` | first unrelated route after required evidence, `C02` with `R01` contributor and `V01` downstream |
| V4+R3 | first routed to `search_templates`; later reached `search_parts`; ended `needs_clarification` | first route selected the wrong tool, `R02` with `V01` downstream |

No premature verification occurred in this case.

## 10. Routing / Tool Selection Analysis

Definitions used by the report:

- Tool Selection Accuracy: the frozen expected primary tool was actually executed at least once.
- Routing Accuracy: for V4 paths with an independent routing span, the expected tool was selected and no route escaped the Oracle-approved tool set.

```text
Tool Selection Accuracy=14/15 (93.33%)
Routing Accuracy=5/10 (50.00%)
Routing Failure Count=6
Tool Selection Failure Count=3
```

Legacy paths have no independent routing span and are excluded from the routing denominator.

## 11. Argument Analysis

```text
argument generation failures=2
argument normalization failures=0
numeric type failures=0
string/number coercion failures=0
```

Both argument-generation failures are the Exact Identity Legacy and V4 Investigation paths. The current metadata contains no evidence of numeric coercion or type failure.

## 12. Verification Analysis

```text
premature verification=0
false negative verification=1 contributor occurrence
false positive verification=0
missing evidence/state downstream=5 contributor occurrences
verification.before_any_tool_execution=true count=0
```

The only observed `failed_unverified` path had already executed two tools (`tool_execution_count_before_verify=2`) and reported `observed_count=2`, `required_count=1`, and `missing_count=0`. It is classified as `V03` downstream of wrong tool selection, not as premature verification. V4 budget/clarification failures without a verification span are represented as evidence/state downstream symptoms, not invented verifier decisions.

## 13. Repeat Stability

Formal five-run Repeat Stability: `NOT_RUN` due material paid-provider cost. P06 did run the same simple inventory fixture once ON and once OFF. Its Legacy and V4 Investigation classifications changed between runs, while V4+R3 stayed equivalent, so one instability observation is recorded as `ST01` evidence but is not presented as a completed repeat-stability suite.

Trajectory hashes contain only span name/kind, root-child relation, tool names, route decisions, safe entity metadata, and verification decisions. They exclude prompts, responses, business values, timestamps, span IDs, and trace IDs.

## 14. Success Trajectory Comparison

The coil stable-identity case passed all three paths with the expected `search_coils` tool, completed terminal state, valid trace hierarchy, and no route escape. The part inventory case passed Legacy and V4+R3 with `search_parts`; its V4 Investigation path instead selected only coil tools and failed. The success controls therefore show that the span shapes themselves are not being treated as failures: classification changes only when the frozen Oracle trajectory diverges.

## 15. Observability OFF/ON Comparison

The coil stable-identity case produced the same classifications, terminal states, and selected tool sequence across all three paths with observability OFF and ON:

```text
Legacy=PASS/completed/search_coils
V4 Investigation=PASS/completed/search_coils
V4+R3=PASS/completed/search_coils
OBSERVABILITY_OFF_ON_STRUCTURAL_EQUIVALENCE=PASS
```

The simple inventory comparison varied between runs, but variation occurred in model-selected trajectories rather than in an observability error path. It is retained as nondeterminism evidence and is not used to override the stable coil equivalence result.

## 16. Privacy Verification

The analysis fetched every page of the 199-span P06 project and scanned attributes/events against configured secret values, PII fields read from the business database, known exact/flat-blade identities, and business catalog identity values. Only counts were emitted.

```text
Secret leakage=0
PII leakage=0
Business value leakage=0
Prompt/response leakage=0
Tool argument/result leakage=0
```

The dataset contains only stable case IDs, suite labels, Oracle expectations, taxonomy codes, safe structural metadata, trace IDs, trajectory hashes, and diagnostic notes.

## 17. Database Safety

Before and after real replay plus full regression:

```text
business DB SHA-256=09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E
size=35323904
mtime UTC=2026-09-03T08:42:16.3158766Z
backup file count=209
```

The user-owned `output/ai-r4b-shadow-latest.json` hash also remained unchanged. P06 redirected each focused runner report to a system-temporary evidence directory and committed none of those raw runner artifacts.

## 18. Regression Comparison

```text
AI_OBSERVABILITY_ENABLED=false
EXPECTED=1777/1778
ACTUAL=1777/1778
SAME_KNOWN_FAILURE=YES
NEW_REGRESSION_INTRODUCED=NO
```

The only failure remains `businessTerminologyContract.test.cjs` reading the absent `.guardian/config.yaml`.

## 19. Architecture Implications

- The focused failure corpus is distributed across state transition, tool selection, and model argument generation rather than one verifier-only failure layer.
- Exact Entity Identity can diverge before resolver entry; a correct resolver exact match does not prove that the intended identity survived upstream.
- A path can obtain the expected evidence and still continue routing or remain in a non-terminal state.
- The same frozen request can vary across real-provider runs, so structural trajectory hashes and Oracle states are more reliable comparison units than final text.
- Verification metadata is most useful when interpreted as downstream state evidence together with prior tool count and route history.

These are diagnostic implications only. P06 proposes no patch, prompt change, fallback, or special-case design.

## 20. Limitations

- This was a focused 5-case, 15-path corpus, not the full 35-case R4-B suite.
- Formal five-run Repeat Stability was not executed; one cross-mode instability observation is retained without claiming a stability rate.
- Metadata-only privacy means the first divergence is the earliest observable structural boundary; raw model arguments and content were intentionally unavailable.
- The current user-owned R4-B runner directly invokes the runtime and is untracked. P06 used a separate focused launcher/preload to initialize tracing, wrap the real runtime in existing Agent/LLM helpers, inject safe request correlation, and redirect output without editing or committing that runner.
- Legacy has no independent routing span; routing accuracy covers only the 10 V4 paths.
- Percentages describe this replay only and do not estimate production prevalence.

## 21. P07 Preconditions

```text
key real failures replayed=PASS
critical traces valid=PASS
failure taxonomy produced=PASS
key first divergences identified=PASS
failure map produced=PASS
exact identity analyzed=PASS
800 flat blade analyzed=PASS
premature verification measured=PASS
business DB unchanged=PASS
privacy=PASS
no AI fix introduced=PASS
no new regression=PASS
P07_READY=YES
```

STOP — WAIT FOR SUPERVISOR REVIEW.
