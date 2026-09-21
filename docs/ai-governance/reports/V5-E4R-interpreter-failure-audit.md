# V5-E4R Task Interpreter Failure Audit

## 1. Executive Result

P15R-A completed a no-model, no-production-change audit of all 15 frozen P15 paths. Six paths have no Interpreter divergence. All nine incorrect paths first diverge in the model-produced `domain`; none first diverges in JSON parsing, contract validation, deterministic routing, source-anchor implementation, or Tool exposure. Primary causes are `PROMPT_FAILURE=3`, `DOMAIN_TAXONOMY_FAILURE=3`, and `INSUFFICIENT_CONTEXT=3`. Two of the Prompt failures also show explicit model noncompliance with the verbatim candidate requirement.

The core mechanism is sound after a correct tuple: all 6/6 correct `domain + operation + entityType` inputs route to the frozen expected capability and expose the expected Tool. The P0 false block is caused by an incorrect `coil/read/coil` interpretation, after which the deterministic boundary correctly excludes the expected part Tool. `P15R_B_READY=YES`; no V1.1 change is implemented here.

## 2. Frozen P15 Baseline

- P15 commit: `009b50547a1c3d690b7b01f86545b49183959dcd`
- Interpreter version: 1
- Prompt version: 1
- P15 paths: 15
- P15 path metrics: domain/operation/entity type/capability/exposure 6/15; anchor 10/15
- Worktree clean at start: NO; all pre-existing user changes were preserved and excluded.
- Business DB baseline: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, recursive backup count `209`.

## 3. Case-Level Failure Map

Expected enum fields are derived deterministically from each frozen P06 primary Tool through the P15-commit Capability Registry reverse index. Actual enum fields come from the retained P15 safe Interpreter outcomes. Candidate text and source content are not persisted.

| Case | V4 | Interpreter | Expected domain/op/type/capability/Tool | Actual domain/op/type/capability/exposure | Candidate | Wrong Tool excluded | First divergence | Primary | Secondary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P06-COIL-001-LEGACY | PASS | VALID | coil/read/coil/coil.read/search_coils | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | YES | NONE | NONE | — |
| P06-COIL-001-V4I | PASS | VALID | coil/read/coil/coil.read/search_coils | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | YES | NONE | NONE | — |
| P06-COIL-001-V4R3 | PASS | VALID | coil/read/coil/coil.read/search_coils | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | YES | NONE | NONE | — |
| P06-EXACT-001-LEGACY | FAIL | INVALID | recipe/preview_cost/recipe/recipe.cost.preview/preview_recipe_cost | cost/calculate/cost_context/none/none | ALTERED | YES | MODEL_OUTPUT_DOMAIN | PROMPT_FAILURE | MODEL_NONCOMPLIANCE, DOMAIN_TAXONOMY_FAILURE |
| P06-EXACT-001-V4I | FAIL | INVALID | recipe/preview_cost/recipe/recipe.cost.preview/preview_recipe_cost | cost/calculate/cost_context/none/none | ALTERED | YES | MODEL_OUTPUT_DOMAIN | PROMPT_FAILURE | MODEL_NONCOMPLIANCE, DOMAIN_TAXONOMY_FAILURE |
| P06-EXACT-001-V4R3 | FAIL | VALID | recipe/preview_cost/recipe/recipe.cost.preview/preview_recipe_cost | cost/calculate/none/none/none | NOT_PROVIDED | YES | MODEL_OUTPUT_DOMAIN | PROMPT_FAILURE | DOMAIN_TAXONOMY_FAILURE |
| P06-FLATBLADE-001-LEGACY | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | cost/calculate/cost_context/cost.calculate/full_calculate+dynamic_config_cost | PRESERVED | YES | MODEL_OUTPUT_DOMAIN | DOMAIN_TAXONOMY_FAILURE | PROMPT_FAILURE |
| P06-FLATBLADE-001-V4I | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | cost/calculate/cost_context/none/none | NOT_EVALUATED | YES | MODEL_OUTPUT_DOMAIN | DOMAIN_TAXONOMY_FAILURE | PROMPT_FAILURE |
| P06-FLATBLADE-001-V4R3 | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | coil/read/coil/none/none | NOT_EVALUATED | YES | MODEL_OUTPUT_DOMAIN | DOMAIN_TAXONOMY_FAILURE | PROMPT_FAILURE |
| P06-INVENTORY-001-LEGACY | PASS | VALID | catalog/read_inventory/part/inventory.read/search_parts | catalog/read_inventory/part/inventory.read/search_parts | PRESERVED | YES | NONE | NONE | — |
| P06-INVENTORY-001-V4I | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | NO | MODEL_OUTPUT_DOMAIN | INSUFFICIENT_CONTEXT | PROMPT_FAILURE, ENTITY_TYPE_TAXONOMY_FAILURE |
| P06-INVENTORY-001-V4R3 | PASS | VALID | catalog/read_inventory/part/inventory.read/search_parts | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | YES | MODEL_OUTPUT_DOMAIN | INSUFFICIENT_CONTEXT | PROMPT_FAILURE, ENTITY_TYPE_TAXONOMY_FAILURE |
| P06-SIMPLE-001-LEGACY | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | coil/read/coil/coil.read/get_coil_specs+search_coils | PRESERVED | NO | MODEL_OUTPUT_DOMAIN | INSUFFICIENT_CONTEXT | PROMPT_FAILURE, ENTITY_TYPE_TAXONOMY_FAILURE |
| P06-SIMPLE-001-V4I | FAIL | VALID | catalog/read_inventory/part/inventory.read/search_parts | catalog/read_inventory/part/inventory.read/search_parts | PRESERVED | YES | NONE | NONE | — |
| P06-SIMPLE-001-V4R3 | PASS | VALID | catalog/read_inventory/part/inventory.read/search_parts | catalog/read_inventory/part/inventory.read/search_parts | PRESERVED | YES | NONE | NONE | — |

## 4. First Divergence Analysis

The pipeline was evaluated in order: model output → parse → schema → enum validation → source anchor → Router → Tool exposure. Every incorrect path first differs at `MODEL_OUTPUT_DOMAIN`. Because the Contract accepts only registered domain/operation pairs, the wrong domain also selects a coherent but semantically wrong operation and entity type. Anchor failures in two Exact paths are later failures, not the first divergence. There are zero parse failures, unknown enums, extra Tool fields, Router failures after a correct tuple, or exposure failures after a correct capability.

`VALID_BUT_WRONG_COUNT=7`: of 13 structurally valid outputs, 7 are semantically wrong. The two P15-invalid outputs first passed parse/schema/enum validation and became invalid only when altered candidate text could not be anchored.

## 5. Prompt V1 Audit

| Question | Result |
| --- | --- |
| Allowed domains/operations supplied | YES, only as route tuples |
| Allowed entity types supplied | YES, only as enum names |
| Domain definitions supplied | NO |
| Operation definitions supplied | NO |
| Entity-type definitions supplied | NO |
| Ambiguous terms contrasted | NO |
| Entity candidate required | YES unless clarification is asserted |
| Verbatim source substring required | YES, explicitly and repeatedly |
| Tool selection forbidden | YES |
| Business answer forbidden | YES |
| Examples biasing the model | NO; there are no examples |

Prompt V1 is structurally strict but semantically under-specified. It lists 41 route tuples and 19 entity-type symbols without descriptions or contrast rules. It does not explain generic cost calculation versus recipe cost preview, catalog price lookup versus inventory lookup, or how an opaque model identifier distinguishes a part from a coil. The verbatim rule itself is clear; two violations are model noncompliance, not missing wording.

## 6. Contract Audit

Contract V1 can represent the correct interpretation for all 15 frozen paths: each has one registered domain/operation pair, a valid ontology entity type, source-anchorable entity candidate, and a Boolean clarification status. No case requires a Tool field, business ID, policy decision, evidence judgment, or free-text reasoning. Therefore `Contract V1 Can Represent All Frozen Cases=YES` and a version bump is not justified by this audit.

One limitation affects reliability rather than representability: the Contract requires the model to assign final `entityType` before any deterministic business identity lookup. Opaque identifiers can therefore be under-contextualized. This should be addressed through semantic ontology input and model settings before changing the contract.

## 7. Domain Taxonomy

Mismatch confusion matrix:

```text
recipe -> cost: 3
catalog -> cost: 2
catalog -> coil: 4
```

`cost.calculate` and `recipe.cost.preview` overlap in ordinary language but have no prompt-visible definitions. The current-price paths also expose a deeper taxonomy problem: the Oracle-authoritative `search_parts` maps only to `inventory.read`, even when the requested fact is current catalog price rather than inventory. This is classified as `DOMAIN_TAXONOMY_FAILURE` for the three flat-blade paths, not as a Router defect or an Oracle rewrite request.

## 8. Operation Taxonomy

Mismatch confusion matrix:

```text
preview_cost -> calculate: 3
read_inventory -> calculate: 2
read_inventory -> read: 4
```

All operation mismatches co-occur with an earlier domain mismatch. No case first diverges only at operation, so `OPERATION_TAXONOMY_FAILURE` is not assigned as a primary cause. The semantic overlap remains a Prompt/Taxonomy contributor and should not be “fixed” by merging enum values.

## 9. Entity Type Taxonomy

Mismatch confusion matrix:

```text
recipe -> cost_context: 2
recipe -> NOT_AVAILABLE: 1
part -> cost_context: 2
part -> coil: 4
```

The false block and two other wrong part interpretations use `coil`. The ontology definitions are internally valid, but Prompt V1 exposes only the symbols, not their identity sources or business meanings. For opaque model identifiers, the raw request alone does not reliably establish `part` versus `coil`; identical inputs produced both answers. This is `INSUFFICIENT_CONTEXT` primary with `PROMPT_FAILURE` and `ENTITY_TYPE_TAXONOMY_FAILURE` secondary, not a capability mapping defect.

## 10. Exact Entity Failures

All three paths already differ at domain (`recipe` expected, `cost` actual) and operation (`preview_cost` expected, `calculate` actual). In Legacy and V4I, the model also altered the candidate characters; punctuation/length no longer matched the source, so exact anchoring correctly rejected both. The selected entity type was `cost_context`, not the expected `recipe`. If those candidates had been byte-for-byte source substrings, the anchor algorithm would have accepted them, but the domain/entity semantics would still have been wrong. V4R3 supplied no candidate and asserted clarification, so anchoring never ran. The primary cause for the family is `PROMPT_FAILURE`; two paths additionally show `MODEL_NONCOMPLIANCE`.

## 11. 800平刀 Failures

The three runtime variants must remain separate:

- Legacy: `cost/calculate/cost_context`, candidate preserved and anchored, routed to `cost.calculate`, exposing `full_calculate` and `dynamic_config_cost`. First failure: domain.
- V4I: `cost/calculate/cost_context`, clarification asserted; anchoring and routing did not run. First failure: domain.
- V4R3: `coil/read/coil`, clarification asserted; anchoring and routing did not run. First failure: domain.

The expected primary Tool is `search_parts`, whose only V5 reverse mapping is `catalog/read_inventory/part`. That mapping does not distinguish price lookup from inventory lookup. The family primary cause is `DOMAIN_TAXONOMY_FAILURE`, with Prompt semantics as a contributor.

## 12. Source Anchor Audit

Decision: `KEEP_EXACT`. The implementation accepts a unique exact source substring, rejects absent/duplicate references, rejects ASCII/numeric token continuations, and creates `rawMention` only from the source slice. Deterministic P15 tests prove verbatim punctuation, case, CJK, slash, dot, underscore, plus, dash, and numeric-like identities anchor correctly. No P15 artifact shows a verbatim candidate rejected. The two observed anchor failures are correct rejection of model-altered text. Source Anchor is `CORRECT`, not too strict and not buggy.

## 13. Capability Mapping

For all 6 paths where `domain + operation + entityType` match the expected tuple, the deterministic Router selected the frozen expected capability. Correct-tuple Router failures: 0. The nine remaining paths already contain wrong structured input, so the Router is not assigned blame. `CAPABILITY_MAPPING_FAILURE=0`.

## 14. Tool Exposure

For all 6 correctly selected capabilities, the expected Tool is present in the bounded exposure. Correct-capability exposure failures: 0. Where exposure is wrong or empty, the cause is an upstream wrong tuple or clarification. The Capability Registry is not silently changed, and no exposure error is classified as a registry failure.

## 15. V5 False Block Root Cause

P0 case: `P06-INVENTORY-001-V4R3`.

- V4 succeeded by executing the expected `search_parts` path.
- V5 first diverged at model output: expected `catalog/read_inventory/part`, actual `coil/read/coil`.
- The deterministic Router then correctly selected `coil.read`.
- Bounded exposure correctly excluded `search_parts`, creating the false block.
- Primary root cause: `INSUFFICIENT_CONTEXT`; contributors: missing Prompt-visible entity semantics and entity-type taxonomy ambiguity.

The gate behaved correctly on incorrect input. Relaxing the Router or exposure would hide the classification error and weaken safety.

## 16. Unique Request vs Path Metrics

The runner defines five case groups × three runtime paths. Code inspection shows `PART_INVENTORY_PRIMARY` and `PART_INVENTORY_REPEAT` construct the same request from the same database row, so the evidence contains five frozen groups but only four distinct input fingerprints.

| Metric | Path-level | Strict five-group accuracy |
| --- | ---: | ---: |
| Domain | 6/15 (40%) | 1/5 (20%) |
| Operation | 6/15 (40%) | 1/5 (20%) |
| Entity type | 6/15 (40%) | 1/5 (20%) |
| Anchor | 10/15 (66.67%) | 3/5 (60%) |
| Capability | 6/15 (40%) | 1/5 (20%) |
| Expected Tool exposure | 6/15 (40%) | 1/5 (20%) |

Strict group accuracy requires every one of the three identical-input calls in a frozen case group to be correct; it therefore does not conceal nondeterminism with majority voting. At the distinct-input level, only 1/4 input fingerprints is fully consistent and semantically correct; 2/4 have all candidates anchored.

## 17. Observed Model Consistency

Every runtime variant inside one case received the identical `testCase.userQuestion`; V4 runtime choice is downstream and does not alter Interpreter input. Observed structured output consistency is:

```text
COIL_INVENTORY: 1 output shape across 3 calls (consistent)
EXACT_RECIPE_COST: 2 output shapes across 3 calls
FLAT_BLADE_PRICE: 3 output shapes across 3 calls
PART_INVENTORY_PRIMARY: 2 output shapes across 3 calls
PART_INVENTORY_REPEAT: 2 output shapes across 3 calls
```

Only 1/5 case groups (20%), or 1/4 distinct input fingerprints (25%), is consistent. This is observational evidence, not a formal Repeat Stability result. The request omits `temperature`, `top_p`, `response_format`, and `max_tokens`; provider defaults therefore control sampling and output constraints. It sets `stream=false` and disables DeepSeek thinking. The missing explicit deterministic settings plausibly contribute to variation but do not alone prove a model defect.

## 18. Oracle Authority Audit

Frozen P06 case contracts authoritatively provide terminal expectation, primary Tool, and allowed Tool set. P15 does not use the V4 actual Tool as the answer. It derives expected domain, operation, entity type, and capability by requiring the frozen primary Tool to have exactly one Capability Registry reverse mapping. All 15 mappings are unique at commit `009b505`.

No case-scoring Oracle mismatch was found. However, expected enum fields are derived rather than explicitly frozen, and two case groups duplicate the same input. A future evaluation-only revision should persist the registry version, explicit expected enum tuple, and a privacy-safe input fingerprint. This preserves all frozen results while making authority and deduplication explicit.

## 19. Root Cause Pareto

Primary roots cover the nine incorrect Interpreter paths; the six correct paths have `NONE`.

| Primary class | Count | Share of incorrect paths |
| --- | ---: | ---: |
| PROMPT_FAILURE | 3 | 33.33% |
| DOMAIN_TAXONOMY_FAILURE | 3 | 33.33% |
| INSUFFICIENT_CONTEXT | 3 | 33.33% |

Primary counts for `MODEL_NONCOMPLIANCE`, `CONTRACT_TAXONOMY_FAILURE`, `OPERATION_TAXONOMY_FAILURE`, `ENTITY_TYPE_TAXONOMY_FAILURE`, `CAPABILITY_MAPPING_FAILURE`, `SOURCE_ANCHOR_FAILURE`, `ORACLE_EXPECTATION_MISMATCH`, `EVALUATION_HARNESS_FAILURE`, and `OTHER` are zero. `MODEL_NONCOMPLIANCE` occurs as a secondary behavior in two Exact paths. `VALID_BUT_WRONG_COUNT=7`; `INVALID_OUTPUT_COUNT=2`.

## 20. V1.1 Recommendation

Recommended change classes, without implementation:

1. `PROMPT_CLARIFICATION`: expose short, registry-owned semantic definitions and explicit contrasts for overlapping route tuples; preserve the existing no-Tool/no-answer boundary and strengthen the already-correct verbatim instruction structurally rather than adding entity keywords.
2. `TAXONOMY_REVISION`: distinguish catalog price/read semantics from inventory and make generic cost calculation versus recipe cost preview ownership explicit.
3. `ONTOLOGY_REVISION`: supply model-facing, machine-readable meanings for entity types and identity-source distinctions, especially part versus coil; do not add product-name special cases.
4. `MODEL_SETTING_REVISION`: evaluate explicit deterministic sampling, provider-supported JSON structured output, and bounded output tokens before considering a model change.
5. `NO_CHANGE_SOURCE_ANCHOR`: retain exact anchoring unchanged.
6. `EVALUATION_FIX`: freeze the explicit expected enum/capability tuple and privacy-safe input fingerprint, and report both case-group and distinct-input metrics without changing Oracle outcomes.

## 21. Contract Version Decision

`Contract Version Bump Recommended=NO`. V1 can express every correct frozen task. Poor model classification and missing semantic definitions are not evidence that the data shape is incapable. Revisit versioning only if a later controlled experiment proves that reliable interpretation requires a provisional/untyped entity reference that V1 cannot express.

## 22. Model Decision

`KEEP deepseek-v4-flash`. The corpus proves low consistency and two explicit constraint violations, but Prompt V1 has no semantic definitions and model sampling/JSON settings are unspecified. That is insufficient evidence to attribute the primary problem to the provider/model. Test the minimal Prompt/Taxonomy/setting revision under the same frozen corpus before recommending a model change.

## 23. Source Anchor Decision

`KEEP_EXACT`. There is no deterministic bug evidence. Model alteration is precisely the condition the boundary is designed to reject and is not a reason to weaken it.

## 24. Evaluation Preservation

```text
Frozen Evaluation Corpus Must Not Change=YES
Frozen Expected Results Must Not Change=YES
```

The evaluation harness may add explicit versioned expected enum tuples and safe input fingerprints, but they must be derived from and checked against the same frozen Oracle. Any proposed change to the authoritative Tool/result expectation requires separate Supervisor approval.

## 25. P15R-B Preconditions

`P15R_B_READY=YES`. All 15 paths, the P0 false block, Exact family, and three flat-blade variants are explained; Prompt, Contract, Taxonomy, Model settings, Router, exposure, anchor, Oracle, and harness responsibilities are separated. The minimal V1.1 ceiling is `Prompt + Taxonomy/Ontology descriptions + Model settings + Evaluation metadata`; it excludes Contract V2, source-anchor changes, provider replacement, production routing, Tool execution, and any keyword special case.

P15R-A made zero real model calls, Tool calls, Business API calls, writes, production-code changes, dependency changes, database changes, or backup changes.
