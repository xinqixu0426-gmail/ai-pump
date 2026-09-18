# V5-E4R-E-B1-C Ambiguity + Regression Audit

## 1. Executive Result

Status: PASS. The three `800平刀` paths expose a true authoritative cross-type ambiguity: the governed lookup returns one complete `EXACT` candidate for `part` and one for `template`, backed by distinct type-scoped canonical identities. The resolver is correct to return `AMBIGUOUS`; choosing `part` inside the resolver would improperly mix intent classification with identity authority.

The recommended architecture is `CANDIDATE_SET_THEN_LOCAL_TASK_CLASS`. The authoritative candidate set remains software-owned, the model selects only a local task class, and software then narrows candidates by that class's entity type. This simulation preserves the frozen expected class in 15/15 paths and produces one final candidate in 15/15 paths. It is architecture evidence only, not a claim that a local-intent model has passed.

The focused Deep API gate fails identically in the dirty main worktree, clean B1-B commit `4354e116`, and clean pre-B1B commit `9eb355bd`. Attribution is `PRE_EXISTING_COMMITTED_FAILURE`, with a test-harness timing race between the formal API snapshot and the independently fetched MCP snapshot while the asynchronous startup copper-price update is still able to mutate `copperBase`. B1-B introduced no call/import/state path into `search_coils` or copper calculation.

## 2. Frozen B1-B Evidence

- Frozen resolver paths: 15.
- Unique correct resolutions: 12.
- Cross-type ambiguities: 3, all in `FLAT_BLADE_PRICE`.
- Wrong entity type: 0.
- False unique resolutions: 0.
- Candidate responses were complete.
- The audit did not call a model, Tool, or mutable business endpoint.

## 3. 800 Cross-Type Collision

Transient read-only reconstruction found exactly one `part` candidate and one `template` candidate. Both use `EXACT` matching and the response is complete. Their canonical records are distinct when identity is scoped by `entityType + canonicalId`; the underlying IDs are also different. Classification: `TRUE_AUTHORITATIVE_AMBIGUITY`.

This is not a canonicalization failure: punctuation, whitespace, spelling, and case were not rewritten. It is not a data duplicate: the records belong to different formal entity types and represent distinct formal views in the business model.

## 4. Part / Template Identity Authority

`part` exact lookup uses the active part model field and the stable `parts.id` canonical source. `template` exact lookup uses the shell-model field and the stable `pump_shell_templates.id` canonical source. Both field classes legitimately participate in entity resolution. The existing capability graph explicitly recognizes a pump-shell catalog part and pump-shell template as two formal views of the same business object, which explains why a shared exact identity can be valid without making either lookup field non-authoritative.

## 5. Resolver Correctness

The resolver correctly preserves the complete authoritative candidate set and fails closed on two cross-type candidates. It must not infer operation or select `part` from request wording. No resolver, lookup API, match field, alias policy, or exact-match rule should change for this case.

## 6. Candidate-Set Architecture

Recommended flow:

1. Exact source span supplies the immutable raw mention.
2. Governed lookup returns an authoritative candidate set.
3. Software builds the union of task classes compatible with candidate entity types.
4. One local-intent model call selects only a local task-class reference.
5. Software uses the selected class's entity type to narrow the authoritative candidate set.
6. One remaining candidate becomes resolved; zero or multiple candidates remain fail-closed.

The model must not receive canonical IDs and must not output canonical entity, entity type, capability, Tool, or raw mention.

## 7. Local Task-Class Union

The frozen real candidate types reduce the 27 global classes as follows:

| Source group | Candidate types | Local classes | Expected class |
|---|---|---:|---|
| `COIL_INVENTORY` | `coil` | 2 | survives |
| `EXACT_RECIPE_COST` | `recipe` | 4 | survives |
| `FLAT_BLADE_PRICE` | `part`, `template` | 2 | survives |
| `PART_INVENTORY_PRIMARY` | `part` | 1 | survives |
| `PART_INVENTORY_REPEAT` | `part` | 1 | survives |

Across 15 paths, the local class count is min 1, median 2, max 4. Frozen expected-class survival is 15/15.

## 8. Coil

The unique candidate type is `coil`. The local union is `tc_003` (`cost`) and `tc_004` (`read`). The expected `tc_004` survives. The model still must distinguish the two local intents; entity resolution does not decide that operation.

## 9. 800平刀

The candidate types are `part` and `template`. Their local union is:

- `tc_002`: `read_inventory`, entity type `part`.
- `tc_027`: `read_template`, entity type `template`.

The expected `tc_002` survives. Applying that frozen expected class narrows the authoritative candidates to the single `part` candidate. This is `SIMULATION_ONLY` and does not report local-model success.

## 10. Exact Entity

All three exact-entity paths have a unique `recipe` candidate. Their four-class local union contains expected `tc_024`; applying it leaves one canonical entity. Expected-class survival is 3/3.

## 11. Final Entity Disambiguation Simulation

Applying each frozen expected task class to the real candidate set yields one compatible candidate in 15/15 paths. The selected class provides a deterministic entity-type constraint; the model does not select an ID. If a future request leaves multiple candidates of the compatible type, the result remains `AMBIGUOUS`.

## 12. Multi-Entity Extension

The architecture can be extended per source span: each span owns an independent authoritative candidate set and local-intent decision. Comparison and compound requests can form multiple task nodes without merging canonical identities. Contract/state support for multi-node orchestration remains future work and was not implemented here.

## 13. Architecture Decision

Decision: `CANDIDATE_SET_THEN_LOCAL_TASK_CLASS`.

`REQUIRE_UNIQUE_ENTITY_BEFORE_LOCAL_INTENT` would deadlock on a legitimate cross-type identity collision even though the intended local task class safely disambiguates the entity type. Candidate ownership stays deterministic and authoritative; only local intent is model-selected.

## 14. Deep API Gate

Focused command: `node scripts/run-deep-api-smoke.cjs --scope=mcp`, using the same Node runtime, environment file, source database snapshot, and isolated test-database mechanism for all three comparisons.

| State | Result |
|---|---|
| Dirty main worktree | FAIL: `search_coils.copperBase` differs from formal API snapshot |
| Clean B1-B commit `4354e116` | same FAIL |
| Clean pre-B1B commit `9eb355bd` | same FAIL |

## 15. Clean Worktree Attribution

Attribution: `PRE_EXISTING_COMMITTED_FAILURE`. The failure exists before B1-B and remains byte-for-byte equivalent at B1-B and in the dirty main worktree. Therefore `B1B New Regression Confirmed=NO` and `User Dirty Worktree Effect=NO`.

Temporary detached worktrees were created under the system temporary directory, linked to the existing dependency installation, supplied the same environment configuration without printing secrets, then removed. The main worktree was not stashed, reset, cleaned, or overwritten.

## 16. search_coils / copperBase Divergence

The first observable divergence is between two snapshots, not between two field mappings:

1. `waitForMcpCoilProfileStable()` stores a formal `/api/coils` response after only three short identical polls.
2. API startup launches `runCopperPriceUpdate()` asynchronously without awaiting it.
3. The MCP test performs several calls before invoking `search_coils`, which independently fetches `/api/coils` through `internalApiClient`.
4. If startup copper sync commits after the formal snapshot but before the MCP fetch, `copperBase` is the first compared mutable field to differ.

Both formal API and `search_coils` map `coils.copper_base` through the same `coilRow` and `/api/coils` path. The gate's stability check can therefore observe a temporarily stable pre-update value and later compare it with a post-update value. This is a pre-existing `TEST_HARNESS_EFFECT` underlying the committed gate failure; the requested regression attribution remains `PRE_EXISTING_COMMITTED_FAILURE`.

## 17. B1-B Interference Analysis

`B1B_INTERFERENCE_PATH=NONE`. B1-B added the entity-lookup route/service, one internal client wrapper, V5 resolver components, tests, and documentation. It did not change `search_coils`, `coilQueries`, `coilRow`, copper-price calculation, or startup market sync. The new endpoint is not imported or called by the MCP coil path.

## 18. Regression Decision

- Deep API regression attribution: `PRE_EXISTING_COMMITTED_FAILURE`.
- New B1-B regression: NO.
- Dirty-worktree effect: NO.
- No production fix was authorized or made.
- The pre-existing harness issue remains detectable and should be corrected in a separately authorized regression task.

## 19. P15R-E-B2 Preconditions

`P15R_E_B2_READY=YES` for architecture implementation planning because:

- the 800 collision root cause is known;
- resolver behavior is correct;
- expected class survives the candidate-set local union in 15/15 frozen paths;
- the expected class safely narrows to one entity in 15/15 simulation paths;
- the recommended architecture is explicit;
- the Deep API failure is proven pre-existing, not a B1-B regression;
- no production code, model, Tool, API behavior, business database, or dependency changed.

The readiness does not waive the existing Deep API failure. B2 must preserve it as a known pre-existing gate issue and must not claim a clean full regression until that harness race is separately resolved.
