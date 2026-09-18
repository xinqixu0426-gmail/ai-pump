# First Relation Routing Migration V1 — ONT-P6R / ONT-P6D

**Gates are tracked separately and must never be merged into one PASS.**

| Gate | Scope | Status |
| --- | --- | --- |
| Deterministic Canary Gate | Frozen Legacy Oracle, 28-case corpus, OFF/ON equivalence, dependency trap, non-eligible fallback, evidence isolation | **PASS** |
| DeepSeek Real-AI Canary Gate (ONT-P6D) | Real DeepSeek provider, paired A/B over the frozen corpus, harness-isolated ontology routing decision | see [DeepSeek gate](#13-deepseek-real-ai-gate-ont-p6d) |
| Local Provider Gate (strict local) | `AI_PROVIDER=local`, real local model host | **DEFERRED — LOCAL PROVIDER NOT CURRENTLY REQUIRED** |

**Local Provider Gate: DEFERRED.** Reason: the local model host (`192.168.31.111`) sits on another LAN — this workstation's wired NIC is disconnected and only a different subnet is reachable, so the strict-local gate cannot execute from here. It is **not** a blocker for Ontology V1 on the current DeepSeek path, and it was never reported as PASS. Re-enabling local/local-first later requires re-running the original strict-local gate.

Gate provenance is committed per gate: [`ontology-p6r-real-local-gate.json`](./ontology-p6r-real-local-gate.json) (strict-local, BLOCKED evidence) and [`ontology-p6d-deepseek-gate.json`](./ontology-p6d-deepseek-gate.json) (DeepSeek). Full raw per-case evidence stays in the gitignored `logs/`; the committed manifests are sufficient to prove what was and was not run. `commit` records the branch HEAD at execution time; the authoritative record of exactly which code was probed is `artifactHashes`.

P6 remains an audit/semantic-decomposition result, committed at `31cac79170802f508c7e904258770b31fd186737`; it was REWORK before a Canary existed, not a failed Canary implementation. Its 24-case frozen corpus and preflight tests are retained unchanged. P6R continues `codex/ont-p1-thin-contract`, without rollback, merge, push or deployment.

## 0. Formal gate runner and preserved exploratory runner

ONT-P6 scope is the `recipe <-> coil` Controlled Routing Canary only. P6 does **not** remove legacy hard-code: `isCoilRecipeRelationQuery`, the legacy shortlist, legacy relation repair and `requiredCoilRecipeToolCall` are all retained and remain authoritative while the canary flag is OFF. P6 only has to show that `Legacy OFF` and `Ontology Canary ON` are safely equivalent for the same real model requests.

- **`scripts/run-ontology-routing-real-local-ab.cjs` — the formal, tracked gate.** Strict local only: `AI_PROVIDER=local` is forced, `local-first` is not a gate mode, and any reported fallback invalidates the whole run as `CLOUD_FALLBACK_PRESENT`. A fail-closed preflight (`/v1/models`, one minimal chat completion, one minimal tool-call request using the project's real registered read tool schema) runs before any corpus work; when the local provider is unhealthy the run exits `2`, executes **zero** corpus cases and writes the BLOCKED manifest rather than a gate result.
- **`scripts/run-ontology-routing-real-ab.cjs` — preserved exploratory evidence, superseded.** Untracked when it produced its 72-execution run. It hardcoded `local-first`, required a cloud API key and asserted a DeepSeek fallback chain (`fallbackChainVerified`), so it structurally could never establish a local baseline — its 194 cloud fallbacks are exactly why its own `primaryBlocker` was `REAL_AI_EQUIVALENCE_GATE_NOT_MET`. It is retained unmodified and is **not** a gate. No formal gate may depend on an untracked script. Content hash (working tree, CRLF): `8194e3a48c24b29fe1a227ac42a65c45386fd797894b2b0d2e27280d8699f04f`; committed blob (LF, per repo checkout normalisation): `481793abf0a3b6be49aee34b1ff35b5e85276b33dde9bf1fc0009df2b0930b54`.

Legacy hard-code removal/convergence is a later phase and is out of scope here.

## 1. P6 REWORK root cause and existing hard-code

The existing co-occurrence detector combines pure relation requests with cost, inventory, comparison and configuration/command requests. The actual forced shortlist/completion special case runs only when the local shortlist is enabled and provider mode is `local` or `local-first`.

The six audited sites remain available for OFF/fallback:

| Site | Existing behavior | Eligible Canary replacement |
| --- | --- | --- |
| `aiToolShortlist.cjs:isCoilRecipeRelationQuery` | Coil/recipe co-occurrence regex | Existing P4 metadata + canonical Binder, behind centralized semantic boundary |
| `aiToolShortlist.cjs:selectLocalAssistantTools` | Fixed offered tool pair | Generic execution profile shortlist |
| `aiAssistantRuntime.cjs:requiredCoilRecipeToolCall` | Numeric shorthand/empty-argument builders | Profile argument policies |
| `aiAssistantRuntime.cjs:runAiAssistant` relation admission | Local detector enables relation completion | PURE_RELATION_QUERY + BOUND + compatible provider/read profile |
| `aiAssistantRuntime.cjs` missing-relation completion | Fixed names, relationQueryRepair and repair prompt | Generic requirements/completed/missing state and separate repair state |
| `aiAssistantRuntime.cjs` recipe keyword clearing | Detector-specific argument mutation | Profile-declared omitted arguments |

`aiCapabilityGraphV3.cjs` has generic discovery and cost-target metadata; no dedicated coil↔recipe detector, pairing or repair was found. No invented migration site was added there. `coilCostComparisonPairs`, calculate_coil_cost shortlist/forced calls, configuration normalization and `formatCoilCostComparison` are preserved as non-relation business logic.

## 2. Mixed semantic decomposition and PURE_RELATION_QUERY

`api/ontology/relationRoutingCanary.cjs:classifyCoilRecipeLegacyIntentV1` is a centralized, temporary migration adapter. Its business exclusion rules are not an ontology fact source. Pure relation expressions come from unchanged P4 `bindingMetadata.cjs`; canonical identity and direction come from unchanged P4 `bindRelation`.

Supported semantic classes:

- PURE_RELATION_QUERY: exclusively who uses which coil, which recipes use a coil, or which coil a recipe uses.
- COIL_COST_QUERY, COIL_COMPARISON, COIL_INVENTORY_QUERY, RECIPE_COST_QUERY.
- RECIPE_CONFIGURATION_QUERY, BOM_CONFIGURATION_QUERY.
- WRITE_OR_COMMAND, AMBIGUOUS, OTHER.

Pure classification alone never admits routing. A current canonical P4 BOUND result is also mandatory. Unsupported relationships, similarity, hypothetical/negative/historical questions and absent/ambiguous canonical roots remain outside Canary. This metadata never proves an actual relation edge.

## 3. Specialized semantic precedence and negative isolation

Explicit commands precede configuration/BOM, comparison, inventory, costs, ambiguity and finally pure relation intent. Changing a configuration in a read-only cost question (e.g. “配方换成12-120线圈成本多少”) is configuration, whereas explicit “修改…” remains command. Coil cost wins over recipe cost when a recipe's coil cost is the requested goal.

| Example | Class |
| --- | --- |
| 12-120线圈成本多少？ | COIL_COST_QUERY |
| 12-120线圈库存多少？ | COIL_INVENTORY_QUERY |
| 比较12-120线圈和13-120线圈成本 | COIL_COMPARISON |
| Shadow配方甲成本多少？ | RECIPE_COST_QUERY |
| Shadow配方甲换成12-120线圈成本多少？ | RECIPE_CONFIGURATION_QUERY |
| 用Shadow配方甲和12-120线圈构建BOM试算 | BOM_CONFIGURATION_QUERY |
| 修改Shadow配方甲使用的线圈 | WRITE_OR_COMMAND |
| 12-120线圈和13-120线圈用在哪些配方？ | AMBIGUOUS |
| Shadow线圈甲相关的配方有哪些？ | OTHER |

These are admission boundaries, not changes to existing cost/inventory/configuration implementations. OFF and ON noneligible requests execute the original paths, including existing broad legacy behavior. In particular the mixed cost-comparison/relation completion inconsistency audited in P6 remains legacy debt; it is not silently fixed or copied into Ontology.

## 4. Provider-specific behavior and why DeepSeek is not a baseline

`shouldUseLocalToolShortlist` gates the actual detector-driven offered pair and completion on local/local-first. DeepSeek receives the existing full read-tool catalog and does not run this forced relation path. Its reuse of shortlist relevance for generic evidence requirements is not equivalent to the local special case.

Consequently only real local/local-first runs can certify Legacy/Ontology A/B. DeepSeek compatibility would be an additional test, never a replacement baseline. No DeepSeek Compatibility run was conducted in P6R.

## 5. Local/local-first Canary design and canonical binding

`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false` is independent from shadow flags and defaults to OFF. It is an environment-only private experiment, not a new client field or public runtime configuration API.

ON admission requires all of:

1. PURE_RELATION_QUERY.
2. Unchanged P4 BOUND, unique canonical root and directional relation.
3. Authoritative `recipe_coil` family (`coil.used_by_recipe` / `recipe.uses_coil`).
4. Provider mode local/local-first with the existing local shortlist enabled.
5. Every required tool is already offered by the existing registered read/query catalog.

The runtime supplies only server-owned, same-user, same-conversation, unexpired session formal receipts. Client persisted conversation payloads, page data, ordinary assistant history and fuzzy names cannot establish identity. Typed IDs/names/shorthand still require existing formal canonical receipts. Pronouns additionally require the P4 trusted-session contract. No P4 grammar, exclusion, probability or identity rule is weakened.

P6R deliberately does not preselect discovery using the legacy detector and relabel it Ontology. Fresh requests with no existing canonical receipt remain CANARY_NOT_ELIGIBLE; their current legacy discovery is preserved. No mid-turn promotion is claimed. Source/target entity types are read from the authoritative directional RelationDefinition.

## 6. Generic compatibility execution profile and completion

A version-1 data profile selects only sourceId `recipe_coil`; the router has no directional if/else branches. Future profiles may use the same required capability, argument policy and completion state structure, but no second family is enabled here.

The offered order remains `[get_all_recipes, search_coils]`. Missing requirements are evaluated in legacy repair order `[search_coils, get_all_recipes]`. Discovery requirements explicitly demand already verified context and identify existing discovery capabilities by entity type. Profile rules specify empty recipe arguments, explicit numeric-pair coil arguments, and recipe keyword omission.

Completion uses a generic observed-capability compatibility state, preserving the legacy rule that a tool attempt satisfies the routing/completion requirement. **This is not evidence readiness or business truth.** Failed tools still fail the unchanged executor/evidence/answer gates. Numeric shorthand permits deterministic missing-tool calls; otherwise the exact existing repair message is reused. No new prompt instruction or model call is introduced. Canary uses a separate completion-repair state and never calls legacy relationQueryRepair or requiredCoilRecipeToolCall for eligible requests.

Formal facts still come from actual existing tools, executor and Business APIs. P2 Resolver/P5 traversal data never enters model messages, answer facts or EvidenceBundle.

## 7. OFF/ON behavior, markers and fallback

OFF executes the original detector, shortlist, argument normalization and completion. ON noneligible requests also preserve that path. ON eligible requests bypass both legacy shortlist/detector and legacy relation repair, using the profile instead.

Version-1 private metadata distinguishes LEGACY_RELATION_SPECIAL_CASE, ONTOLOGY_RELATION_BINDING, NON_RELATION_SPECIALIZED_PATH, CANARY_NOT_ELIGIBLE and ONTOLOGY_CANARY_FALLBACK. It records eligibility, relationId/direction, provider mode, source, fallback, legacy participation and duration; it does not record canonical IDs, full user text or business payloads. The existing privacy-filtered observability system emits `ontology.routing.*` attributes. Private sink/exporter failures are swallowed. No HTTP/tool response field was added.

An eligible unavailable/read-invalid profile or technical profile validation failure explicitly emits ONTOLOGY_CANARY_FALLBACK and runs the original read path. A technical admission failure is also explicit fallback; an ordinary missing root/unsupported relation is not fallback. Frozen positives have zero unexpected fallback. Tests separately inject an internal failure and demonstrate equivalent fallback behavior.

## 8. Frozen Legacy Behavior Oracle and deterministic A/B

`tests/fixtures/ontology-coil-recipe-legacy-oracle-v1.json` was generated by compiling the exact assistant source from start commit `31cac79170802f508c7e904258770b31fd186737`, with existing modules and controlled formal fixture receipts. It freezes offered catalogs, selected/executed tools and arguments, deterministic repair, repair instructions, model-call count, formal results, EvidenceBundle and full final answer. This is an actual legacy runtime oracle with a deterministic Provider fixture, not real AI evidence.

The original P6 corpus (8 positives/16 negatives) is unchanged. Four additional negative boundary cases cover recipe configuration, BOM, non-cost coil comparison and configuration queries, giving **8 positive + 20 negative unique cases**. Positive context includes explicit IDs/names, shorthand,老板语言 and trusted coil/recipe pronouns. Ambiguous fixtures retain both canonical candidates.

Both local and local-first deterministic envelopes were checked. Per envelope: 8/8 pure positive classifications and bindings/routings, 20/20 negative classifications, zero false Ontology routes, wrong roots/relations/directions or unexpected fallbacks. OFF matches the frozen start-commit Oracle; ON matches OFF for required tool behavior, sequence, arguments, canonical targets, evidence, full answer, completion instructions and model budget. All positive fixture sequences are get_all_recipes → search_coils. Counts are unique cases, not inflated by two provider envelopes.

An isolated dependency trap replaces legacy shortlist/detector with throwing functions; all 8 eligible positives still complete. Legacy repair is also a throwing dependency for these tests. This proves the marker is not a label attached after legacy selection.

## 9. Real Local AI Canary Gate and current blocker

Required schedule: the same 8 pure positives OFF/ON for two paired rounds, and the 20 negatives OFF/ON for at least one round, all on **strict local**. Compare actual canonical roots/directions/targets, required tools, model budget and answer business facts — not natural-language wording, which legitimately varies between real runs. Context seeds must come from actual verified formal reads, identically on both sides, and are counted separately.

Gate pass conditions are recorded explicitly in the manifest's `gatePassConditions`: preflight OK, actual provider `local`, zero cloud fallback, every case completed, every eligible positive routed by `ONTOLOGY_RELATION_BINDING`, zero legacy detector/repair participation under eligible ON, zero wrong binding, zero negative false route, zero canonical/tool-sequence/tool-argument mismatch, zero answer-fact regression, zero model-call increase, and unchanged fixture database bytes. A non-zero cloud fallback count forces `CLOUD_FALLBACK_PRESENT` and cannot pass.

**Completed valid real local corpus runs: 0.** The committed manifest records the strict-local preflight result for this run: `modelsEndpoint=false`, `httpError=ECONNRESET`, `actualProvider=null`, `pairedRoundsCompleted=0`, `resultClassification=BLOCKED`, `primaryBlocker=ECONNRESET`. The runner executed zero corpus cases, by design.

Independent network diagnosis of the blocker (2026-09-18):

- Config-resolved endpoint `192.168.31.111:8080/v1` (from current runtime config; not assumed).
- ICMP to the host fails; TCP to port 8080 connects, but every HTTP request is reset by the peer.
- TCP also "connects" on ports that cannot be open (9, 12345, 54321, 65000), and the same pattern applies to the known-good production host on that subnet, while a real LAN host correctly refuses a closed port. The `192.168.31.0/24` path from this workstation is currently accepting all TCP and forwarding nothing, so TCP reachability is not evidence that the model host is up.
- No SSH access to `192.168.31.111` is configured on this workstation, so the model service itself could not be inspected or restarted from here.

This is `LOCAL_PROVIDER_UNHEALTHY` at the environment level. No Ontology semantics, binding rule, canonical identity rule, Legacy Oracle, business Tool, business API, endpoint, model setting, database or secret was modified to work around it.

Reproduce readiness from this worktree with `ONT_SHADOW_CONFIG_ROOT` pointing to the existing config checkout, then `node scripts/check-ontology-routing-local-provider.cjs` (connectivity only) and `node scripts/run-ontology-routing-real-local-ab.cjs --rounds=2` (the gate itself). Credentials remain in process memory and are never emitted.

The real gate is unfulfilled, so the overall status is **BLOCKED** despite successful deterministic validation. Restoring local connectivity is required before any PASS/promotion decision.

## 10. P3/P4/P5 shadow coexistence and safety

One-hop, Binding and bounded two-hop modules/flags remain unchanged. A runtime test enables all three observers alongside Canary, gets a one-hop MATCH and a P4 BOUND, rejects inapplicable two-hop intent, and proves identical business calls/model budget with byte-identical fixture DB and unchanged total_changes. Existing full P1–P5 test suites retain 12-direction/8-path coverage.

No routing observation triggers business execution, writes or recursive model calls. No new capability/tool/API, dependency, schema/migration, evidence contract or answer composer is introduced. No second family or Resolver evidence promotion is authorized.

## 11. Remaining hard-code and known coverage gaps

All six legacy sites are retained for OFF/current/fallback. Costs, comparisons, inventory and configuration retain their existing ownership; legacy mixed-semantic defects remain outside this stage's narrow routing migration.

Fresh requests without already verified canonical context are intentionally not Canary opportunities in this implementation. Ambiguous/rootless/unsupported requests remain rejected. Real local model behavior, latency and answer-fact stability remain unverified due to connectivity; deterministic success cannot establish that gate. A `local-first` run that fell back to a cloud model is not evidence about the local model, and the formal gate therefore refuses to score it.

## 12. ONT-P7 entry criteria and validation

P7 cannot begin until the **Real Local AI Canary Gate** completes on strict local with canonical/answer-fact equivalence, no false routes, no wrong roots/directions, zero legacy participation under eligible ON and zero cloud fallback. `local-first` results and DeepSeek results are not evidence for this gate. Default remains OFF. Any later discovery admission or legacy cleanup needs separately authorized design and tests. P2/P5 remain shadow-only fact sources.

P6R verification (deterministic gate): 38/38 Canary tests, 26/26 preflight tests, P1–P6 ontology 341/341, focused ontology/AI/identity/relationRead set 482/482, full npm regression **2488/2488**, API contract 26/26, Web build PASS, changed-file ESLint PASS. A separate-process API fixture exercises all eight positive pairs through the actual executor and existing Business APIs, with byte-identical DB and unchanged total_changes. Default Date construction is frozen for provenance fetchedAt equivalence while Date.now/session TTL/timeouts remain real; no business field is normalized away.

Feature-flag parsing is now centralized: `api/services/environment.cjs` exports `isEnvFlagEnabled(env, name)`, the strict-`true` project convention, and all four ontology flags (canary plus the three shadow flags) use it. Previously the canary privately accepted `1`/`yes`/`on` while the shadow flags accepted only `true`; a regression test asserts the strict convention and rejects a reintroduced private value list. Because the canary is default OFF and no released configuration used those looser values, this only tightens fail-safe behaviour.

When the canary flag is OFF, `withOntologyRoutingSpan` still emits an `ontology_relation_routing_canary` span with `canary_enabled=false`. This is retained deliberately as **disabled observation only**: it changes no answer, tool, argument, evidence or model-call behaviour and is fail-open. Removing it would widen the change surface for no gate benefit.

The original master and user-owned untracked `docs/ontology-preimplementation-audit.md` are preserved; SHA-256 is `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`. No production configuration changes, merge, push or deployment.

## 13. DeepSeek Real-AI Gate (ONT-P6D)

`scripts/run-ontology-routing-deepseek-ab.cjs` runs the same frozen 28-case corpus against the **real DeepSeek provider** (requested = actual = `deepseek`, cloud fallback count 0 required; any fallback invalidates the run). Both sides use the same corpus, model, runtime config, fixture database and prompt baseline:

- **A — Legacy routing**: exactly production DeepSeek behaviour. The canary flag is OFF, `AI_LOCAL_TOOL_SHORTLIST_ENABLED=false`, so the model receives the full 48-tool read catalog and chooses freely. The legacy relation pair is never forced, because in production it is gated on the local shortlist.
- **B — Ontology routing**: the real canary's routing decision applied to the same request. Side B installs a **process-local `require.cache` overlay** that delegates to the genuine canary module and lifts only the provider-mode and shortlist gates, then relabels `providerMode` back to the true provider. No file on disk changes, and `productionEligibilityUnchanged` re-reads the untouched module from disk and asserts `profiles[].providerModes` is still exactly `['local','local-first']`. **Production canary eligibility is NOT widened to DeepSeek by this gate.**

Measured result (two independent full runs, `--rounds=2`, 110 executions each) is stable and reported as **REWORK**, not PASS:

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Executions / completed | 110 / 110 | 110 / 110 |
| Provider seen | `deepseek` only | `deepseek` only |
| Cloud fallbacks | 0 | 0 |
| Wrong root / relation / direction | 0 / 0 / 0 | 0 / 0 / 0 |
| Unauthorized tool calls | 0 | 0 |
| Writes | 0 | 0 |
| Negative cases falsely ontology-routed | 0 | 0 |
| Positive pairs where side A was canonically correct | 10 / 16 | 12 / 16 |
| Positive pairs where side B was canonically correct | 13 / 16 | 14 / 16 |
| Positive pairs where side B needed more model calls | 9 / 16 | 10 / 16 |
| Canonical regressions (A correct, B not) | 1 | 1 |
| Business-fact answer regressions | 0 | 0 |

Two PASS conditions are unmet, and neither is a provider, safety or evidence failure:

1. **`noModelCallIncrease` — systematic, inherent to the canary.** The profile enforces that both required capabilities (`search_coils`, `get_all_recipes`) are observed. Side A can answer from a single `get_recipe_detail`, so side B costs +1 to +2 model calls on 10 of 16 positive pairs. This is the price of the guaranteed relation pair, but the gate explicitly requires no additional calls caused by Ontology, so it does not pass as written.
2. **`zeroCanonicalRegression` — 1 reproducible regression, with an important qualification.** Both runs produced the *same* case with the *same* signature: `coil-explicit` round 1, side A `[get_all_recipes]` certifies target `301`, side B `[get_all_recipes → search_coils → get_all_recipes]` certifies nothing. The cause is the shadow current-facts projection, not the routing: `bindingCurrentFacts.cjs` requires an unambiguous unfiltered full source collection, and a **duplicate `get_all_recipes` invocation leaves it unable to certify completeness**. Verified in a 3-round focused reproduction: side B was incomplete whenever `get_all_recipes` appeared twice and complete when it appeared once. Crucially, **the user-visible answer was substantively correct in every round** — side B still reported that only recipe 301 references coil 501, and `answerFacts` matched side A. So this is a **certification/measurement gap in the shadow projection**, not a wrong answer: the metric under-reports correctness rather than detecting a defect.

Net reading: on DeepSeek, ontology routing is *more* canonically reliable than legacy free choice (13–14 of 16 vs 10–12 of 16), with zero wrong bindings, zero false routes, zero writes and zero fallback, at the cost of more model calls on relation questions and one reproducible projection-certification gap.

Open items for supervisor decision: whether the completion enforcement's model-call cost is acceptable, and whether the duplicate-source-collection certification gap should be fixed in the shadow projection (shadow-only; no production answer path depends on it).

DeepSeek gate requirements: `ONT_SHADOW_CONFIG_ROOT=<config checkout> node scripts/run-ontology-routing-deepseek-ab.cjs --rounds=2`. `--only=<caseId>` narrows the corpus for a cheap wiring smoke test and writes only to `logs/`, never over the committed manifest.
