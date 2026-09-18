# First Relation Routing Migration V1 — ONT-P6R

**Status: BLOCKED at the real local/local-first A/B gate.** The pure-relation canary is implemented, default OFF, with deterministic equivalence verified. The configured local endpoint returned `ECONNRESET` in two independent readiness probes (fetch and direct native HTTP). No completed real local corpus run, or DeepSeek substitute, is claimed.

P6 remains an audit/semantic-decomposition result, committed at `31cac79170802f508c7e904258770b31fd186737`; it was REWORK before a Canary existed, not a failed Canary implementation. Its 24-case frozen corpus and preflight tests are retained unchanged. P6R continues `codex/ont-p1-thin-contract`, without rollback, merge, push or deployment.

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

## 9. Real AI A/B and environmental blocker

Required schedule: the same 8 pure positives OFF/ON for two rounds, and 20 negatives OFF/ON for at least one round, on real local/local-first. Compare actual canonical roots/directions/targets, required tools/model budget and answer business facts (not only string equality). Context seeds must use actual verified formal reads identically on both sides and be counted separately.

Completed real corpus runs: **0**. Two independent probes of the currently configured local `/models` endpoint returned ECONNRESET. Since local and local-first share that local endpoint, cloud fallback cannot stand in for a successful local baseline. No endpoint, model setting, database or secret was modified.

Reproduce readiness from this worktree with `ONT_SHADOW_CONFIG_ROOT` pointing to the existing config checkout, then `node scripts/check-ontology-routing-local-provider.cjs`. The report is `logs/ont-p6r-local-provider-readiness.json`; READY_FOR_REAL_AI_AB means only connectivity, not acceptance. Credentials remain in process memory and are never emitted.

The real A/B gate is unfulfilled, so the overall status is BLOCKED despite successful deterministic validation. Restoring local connectivity is required before any PASS/promotion decision.

## 10. P3/P4/P5 shadow coexistence and safety

One-hop, Binding and bounded two-hop modules/flags remain unchanged. A runtime test enables all three observers alongside Canary, gets a one-hop MATCH and a P4 BOUND, rejects inapplicable two-hop intent, and proves identical business calls/model budget with byte-identical fixture DB and unchanged total_changes. Existing full P1–P5 test suites retain 12-direction/8-path coverage.

No routing observation triggers business execution, writes or recursive model calls. No new capability/tool/API, dependency, schema/migration, evidence contract or answer composer is introduced. No second family or Resolver evidence promotion is authorized.

## 11. Remaining hard-code and known coverage gaps

All six legacy sites are retained for OFF/current/fallback. Costs, comparisons, inventory and configuration retain their existing ownership; legacy mixed-semantic defects remain outside this stage's narrow routing migration.

Fresh requests without already verified canonical context are intentionally not Canary opportunities in this implementation. Ambiguous/rootless/unsupported requests remain rejected. Real local model behavior, latency and answer-fact stability remain unverified due to connectivity; deterministic success cannot establish that gate. Local-first real acceptance must distinguish successful local execution from a cloud fallback.

## 12. ONT-P7 entry criteria and validation

P7 cannot begin until actual local/local-first frozen A/B completes with canonical/answer-fact equivalence, no false routes, no wrong roots/directions, no unexpected fallback and no eligible legacy participation. Default remains OFF. Any later discovery admission or cleanup needs separately authorized design and tests. P2/P5 remain shadow-only fact sources.

P6R verification: 37/37 Canary tests and 568/568 focused ontology/AI/identity/relationRead/observability/API tests PASS; Web build PASS. Full npm regression 2487/2487 and API contract 26/26 PASS; ESLint, strict UTF-8/JSON and whitespace checks PASS. A separate-process API fixture exercises all eight positive pairs through the actual executor and existing Business APIs, with byte-identical DB and unchanged total_changes. Default Date construction is frozen for provenance fetchedAt equivalence while Date.now/session TTL/timeouts remain real; no business field is normalized away. Initial checks found JSON undefined-field/Windows newline differences in test comparisons; those test defects were corrected without relaxing business gates.

The original master and user-owned untracked `docs/ontology-preimplementation-audit.md` are preserved; SHA-256 is `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`. No production configuration changes, merge, push or deployment.
