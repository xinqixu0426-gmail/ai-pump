# First Relation Routing Migration V1 — ONT-P6R / P6D / P7

**Gates are tracked separately and must never be merged into one PASS.**

| Gate | Scope | Status |
| --- | --- | --- |
| Deterministic Canary Gate | Frozen Legacy Oracle, 28-case corpus, OFF/ON equivalence, dependency trap, non-eligible fallback, evidence isolation | **PASS** |
| DeepSeek Real-AI Canary Gate (ONT-P6D / P6D-R1) | Real DeepSeek provider, paired A/B over the frozen corpus | **PASS** |
| DeepSeek Authoritative Routing Promotion (ONT-P7) | Production provider eligibility + real `POST /api/ai/chat` SSE OFF/ON gate + rollback | **PASS** |
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

The **DeepSeek Real-AI Canary Gate is PASS** (ONT-P6D-R1, §13) and resolves the two P6D blockers. The **strict-local gate remains DEFERRED** because the local model host is on another LAN; it is not a blocker for the current DeepSeek path, DeepSeek is not part of production canary eligibility, and re-enabling `local`/`local-first` later requires re-running the strict-local gate. Before P7, the following still hold: the canary stays default OFF; any later discovery admission or legacy hard-code cleanup needs separately authorized design and tests; P2/P5 remain shadow-only fact sources.

P6D-R1 verification: P1–P6 ontology **360/360** (including the new repeated-read and completion-enforcement suites), full npm regression **2506/2506**, API contract 26/26, Web build PASS, changed-file ESLint PASS, frozen corpus hash unchanged. A separate-process API fixture exercises all eight positive pairs through the actual executor and existing Business APIs, with byte-identical DB and unchanged total_changes. Default Date construction is frozen for provenance fetchedAt equivalence while Date.now/session TTL/timeouts remain real; no business field is normalized away.

Feature-flag parsing is centralized: `api/services/environment.cjs` exports `isEnvFlagEnabled(env, name)`, the strict-`true` project convention, and all ontology flags use it. Previously the canary privately accepted `1`/`yes`/`on` while the shadow flags accepted only `true`; a regression test asserts the strict convention and rejects a reintroduced private value list. Because the canary is default OFF and no released configuration used those looser values, this only tightens fail-safe behaviour.

When the canary flag is OFF, `withOntologyRoutingSpan` still emits an `ontology_relation_routing_canary` span with `canary_enabled=false`. This is retained deliberately as **disabled observation only**: it changes no answer, tool, argument, evidence or model-call behaviour and is fail-open. Removing it would widen the change surface for no gate benefit.

The original master and user-owned untracked `docs/ontology-preimplementation-audit.md` are preserved; SHA-256 is `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`. No production configuration changes, merge, push or deployment.

## 13. DeepSeek Real-AI Gate (ONT-P6D)

`scripts/run-ontology-routing-deepseek-ab.cjs` runs the same frozen 28-case corpus against the **real DeepSeek provider** (requested = actual = `deepseek`, cloud fallback count 0 required; any fallback invalidates the run). Both sides use the same corpus, model, runtime config, fixture database and prompt baseline:

- **A — Legacy routing**: exactly production DeepSeek behaviour. The canary flag is OFF, `AI_LOCAL_TOOL_SHORTLIST_ENABLED=false`, so the model receives the full 48-tool read catalog and chooses freely. The legacy relation pair is never forced, because in production it is gated on the local shortlist.
- **B — Ontology routing**: the real canary's routing decision applied to the same request. Side B installs a **process-local `require.cache` overlay** that delegates to the genuine canary module and lifts only the provider-mode and shortlist gates, then relabels `providerMode` back to the true provider. No file on disk changes, and `productionEligibilityUnchanged` re-reads the untouched module from disk and asserts `profiles[].providerModes` is still exactly `['local','local-first']`. **Production canary eligibility is NOT widened to DeepSeek by this gate.**

Measured result (final run after ONT-P6D-R1, `--rounds=2`, 110 executions) is **PASS** — all fifteen gate conditions hold:

| Metric | Value |
| --- | ---: |
| Executions / completed | 110 / 110 |
| Provider seen | `deepseek` only, fallbacks 0 |
| Wrong root / relation / direction | 0 / 0 / 0 |
| Unauthorized tool calls / writes | 0 / 0 |
| **Ontology-induced additional provider calls** | **0** |
| Canonical regressions / unexplained mismatches | 0 / 0 |
| Business-fact answer regressions | 0 |
| Legacy positive correct | 13 / 16 |
| Ontology positive correct | **16 / 16** |
| Positive pairs with B more calls / equal / fewer | 0 / 1 / 15 |
| Legacy total model calls vs ontology total | 136 vs **109** |
| Legacy total tool calls vs ontology total | 111 vs 102 |
| Deterministic reads executed by the canary | 32 (16 pairs × 2 reads) |
| Production canary eligibility | unchanged (`local`, `local-first` only) |

### 13.1 Completion enforcement: extra model rounds → deterministic software reads

Previously the canary knew which formal reads certified the relation but still relied on the model to
produce them: when the model omitted one, the runtime pushed a repair reminder and spent another
provider round, and when the deterministic fallback could not build `search_coils` arguments (it only
knew the `规格-片数` shorthand) it fell back to that reminder. That is why P6D measured +1..+2 provider
calls on 10/16 positive pairs.

Now relation evidence planning is software work. `relationRoutingCanary.cjs` declares per-direction
`requiredReads`, and `runAiAssistant` queues them for deterministic execution before the first provider
call:

- `coil.used_by_recipe` → `get_all_recipes` (unfiltered collection) + `search_coils` with arguments
  derived from the **already-verified** root row (`root_identity`, e.g. its `schemeCode`), so no
  `规格-片数` shorthand is needed.
- `recipe.uses_coil` → `get_all_recipes` + the coil catalogue read. A recipe root cannot know the target
  coil's identity before reading the collection, so no filter arguments are invented. This read exists
  for answer/observation parity: the answer composer's winding-identity suffix and the P3 observer both
  need a coil row.

The planned calls travel through the **unchanged** per-call guards — allowlist, tool schema validation,
identifier grounding, read-only executor and execution-evidence verification — and are rejected if the
capability is not a read `query`. They never touch preview/command capabilities, and the model is only
asked to synthesise the final answer. Result: **0 ontology-induced provider calls**, and side B needs
fewer model calls than legacy (109 vs 136) because legacy spends rounds rediscovering evidence it cannot
guarantee.

`Ontology-Induced Additional Provider Calls` counts only provider invocations caused by canary completion
work (`completionModelRounds`, i.e. the reminder branch). Deterministic reads are counted separately as
formal tool executions, which the gate explicitly allows to differ.

### 13.2 Shadow projection: repeated complete reads

The one reproducible P6D canonical mismatch (`coil-explicit`, side A `[get_all_recipes]` certified `301`,
side B `[get_all_recipes → search_coils → get_all_recipes]` certified nothing) was a defect in the shadow
current-facts projection, not in routing. `bindingCurrentFacts.cjs` selected the **first** complete read
but then compared rows from **every** invocation of that capability against that one read's data length,
so reading the same complete collection twice produced `8 !== 4` and reported "incomplete".

Certification is now keyed on the semantic source snapshot rather than raw invocation count:

- every complete unfiltered read of the projection's source capability is considered;
- reads are grouped by snapshot identity (their record-id set, order-independent);
- a single distinct snapshot is required — materially different collections are a conflict and cannot
  certify, and the last result is never silently taken;
- each complete read must contribute exactly one full row block, so a filtered, truncated or partial
  read of the same capability still suppresses certification.

So `complete + complete = complete`, duplicate pagination pages stay complete, and
complete+filtered / complete+truncated / conflicting-collections remain incomplete. Semantics are frozen
by `tests/ontologyCurrentFactsRepeatedRead.test.cjs`, including the exact P6D sequence as a permanent
regression whose expected value is `['301']` — never relaxed to match the bug. This changes measurement
only: no Business API output, tool result, final answer, resolver, binding or DB content changed.

### 13.3 Gate status

Both P6D blockers are closed: completion enforcement now costs zero provider calls, and the projection
false mismatch is eliminated. Deterministic gates (P1–P6 ontology, canary, preflight, frozen Oracle,
dependency trap, non-eligible fallback) remain green, and the frozen 28-case corpus is untouched
(hash `1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8`). The strict-local gate stays
**DEFERRED**; DeepSeek remains an isolated counterfactual harness and is **not** part of production
canary eligibility.

### 13.4 Superseded P6D REWORK result (retained for the record)

Before P6D-R1, two independent P6D runs measured the same picture and were correctly reported as REWORK:
side B was canonically correct on 13/16 and 14/16 positive pairs against side A's 10/16 and 12/16, with
zero wrong bindings, zero false routes, zero writes and zero fallbacks, but `noModelCallIncrease` failed
(9/16 and 10/16 pairs cost +1..+2 provider calls) and `zeroCanonicalRegression` failed on one reproducible
case. Neither was a provider, safety or evidence failure. §13.1 and §13.2 record how each was closed; the
expected values were not relaxed to match either defect.

DeepSeek gate requirements: `ONT_SHADOW_CONFIG_ROOT=<config checkout> node scripts/run-ontology-routing-deepseek-ab.cjs --rounds=2`. `--only=<caseId>` narrows the corpus for a cheap wiring smoke test and writes only to `logs/`, never over the committed manifest.

## 14. DeepSeek Authoritative Routing Promotion (ONT-P7)

P7 turns the validated `recipe <-> coil` canary into a production-capable routing path behind the
existing default-OFF flag. It adds no entity, no relation family and deletes no legacy code.

### 14.1 Provider eligibility

`recipe_coil` `providerModes` is now `['local', 'local-first', 'deepseek']`. Two gates had to be opened,
not one:

- `deepseek` was absent from `providerModes`;
- eligibility also required `shortlistEnabled`, which is a **local-model** optimisation and is therefore
  false under production DeepSeek configuration. The profile now declares
  `shortlistRequiredProviderModes: ['local', 'local-first']`, so only the local providers require it.

`AI_PROVIDER=auto` — the actual deployment value — previously left the canary permanently ineligible
because it reasoned about the literal string. The canary now resolves `auto` to the provider that will
actually serve the request (`effectiveProviderMode`), keeping `local`/`local-first` verbatim because they
gate the shortlist. Unvalidated providers (`kimi`) stay outside.

The flag remains `AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false` by default, asserted against
`.env.example` in the test suite, and no code path enables it implicitly.

### 14.2 Authoritative path and fallbacks

When the flag is ON and a request is eligible, ontology routing is the authoritative relation router:
relation intent, the required formal reads and completion are decided by the canary profile, the reads go
through the unchanged Tool validation/executor and Business APIs, and the model only synthesises the
answer. Legacy detector/repair are not run for those requests (`legacyDetectorCalls = 0`,
`legacyRepairCalls = 0`) — there is no double-run of legacy routing.

Every other path resolves to legacy: flag OFF, non-eligible question, missing/ambiguous canonical root,
unsupported relation, and an ontology-internal failure before the reads (explicit
`ONTOLOGY_CANARY_FALLBACK`). A failed required formal query is never reported as a relational success —
with no verified evidence, the canonical target is not asserted.

### 14.3 HTTP/SSE runtime gate

`scripts/run-ontology-routing-http-runtime.cjs` drives the real `POST /api/ai/chat` SSE endpoint on an
isolated temporary database (business surface restricted to GET plus the existing read-only previews), with
real DeepSeek, and compares flag OFF against flag ON over a new corpus
(`tests/helpers/ontologyHttpRuntimeCorpus.cjs`, 12 positive / 12 negative). Positives are two-turn
conversations because the canary binds only from server-owned verified receipts already present in the same
assistant session: the seed turn establishes the canonical receipt, the question turn is the request under
test. Routing is observed through the production telemetry span (`ontology_relation_routing_canary`), not a
test-only hook.

Result (`docs/ontology-p7-http-runtime-gate.json`), all sixteen conditions met:

| Metric | Value |
| --- | ---: |
| Positive / negative cases | 12 / 12 |
| Provider seen | `deepseek` only, fallbacks 0 |
| Eligible ON → ontology authoritative | 7 (of 12 positives) |
| Non-eligible routed by ontology | **0** (10 legacy + 2 protected-command-channel) |
| Wrong root / relation / direction | 0 / 0 / 0 |
| Unauthorized tools / writes | 0 / 0 |
| Legacy detector / repair calls under eligible ON | 0 / 0 |
| Ontology-induced provider calls | **0** |
| Provider calls OFF vs ON | 56 vs 47 |
| Tool calls OFF vs ON | 49 vs 46 |
| Business-fact answer regressions | **0** |
| Canonical mismatches / unexplained | 2 / **0** (both explained: legacy wrong, ontology right) |

Rollback was exercised inside the same process: with the flag ON the question turn reports
`ONTOLOGY_RELATION_BINDING`, and after flipping the flag to false the same corpus reports
`NON_RELATION_SPECIALIZED_PATH`. No restart, no DB change, no schema migration.

The frozen P6 28-case corpus was re-run unchanged (hash
`1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8`) and still passes: ontology 16/16
positive correct vs legacy 12/16, 0 wrong bindings, 0 writes, 0 explanation-free mismatches, 0
ontology-induced provider calls, 111 vs 126 provider calls.

### 14.4 Known coverage gap

Eligibility is deliberately recall-limited, not widened for the gate. On the HTTP corpus only 5–7 of 12
positives became eligible across runs, for two reasons that are both by design: (a) the canary binds only
from a prior-turn canonical receipt, and (b) some owner phrasings fall outside the frozen P4 binding
grammar. Non-eligible requests fall back to legacy safely, so this is a recall limitation rather than a
safety or correctness gap. Widening binding grammar or discovery is out of P7 scope and would need its own
authorisation. Seed turns in the corpus were revised to be answerable from the formal catalogue; the
question turns under test were not tuned.

P7 conclusion: `recipe_coil` ontology routing is **PRODUCTION-CAPABLE BEHIND A DEFAULT-OFF FLAG**. Legacy
removal is explicitly not authorised here and belongs to a separate P8.

P7 requirements: `ONT_SHADOW_CONFIG_ROOT=<config checkout> node scripts/run-ontology-routing-http-runtime.cjs` (add `--only=<caseId>` for a cheap wiring smoke test, which writes only to `logs/`).

## 15. ONT-P8 production canary acceptance — defect found, mitigation landed

P8 moved the promotion to a real acceptance run. The deterministic gates all passed and the deployment
itself was never started: a **local, real-data acceptance** (same code, real database, real DeepSeek, real
`POST /api/ai/chat` SSE) found a production-blocking defect before anything reached the Mac Mini.

### 15.1 Defect

With the canary ON, three of four relation questions degraded from a correct answer to "无法确认", while the
same questions answered correctly with the canary OFF on the same data.

Root cause, measured against the real database:

- the runtime caps a single read tool result at **96 KB** (`enforceAiToolResultBudget(..., 96 * 1024)`), and
  additionally caps the cumulative synthesis evidence per turn;
- the canary's required source-collection read was an **unfiltered `get_all_recipes` (`omitArguments:
  ['keyword']`)**;
- on this database that payload is **121,038 bytes → always rejected** as `AI_QUERY_RESULT_TOO_LARGE`;
- a *filtered* read (43 KB) is deliverable, which is how the legacy path succeeded.

So the canary was requiring a read the runtime can never deliver. The model, constrained to the two-tool
profile and shown a failed catalogue read, thrashed on further filtered retries until the cumulative budget
was exhausted, and finally answered "cannot confirm".

The frozen P6D/P7 gates could not catch this because their fixture database has four recipes — the payload
never approaches the cap. Real-data acceptance exists precisely for this class of defect.

### 15.2 Mitigation

A canary-queued read that the runtime cannot deliver now **revokes the canary for that turn**:

- `canaryRevoked` is distinct from `canaryActive` (an inactive canary must still keep the legacy repair
  path; a revoked one must stop constraining the turn at all);
- the turn's read surface is handed back to the legacy tool set, and the allowlist is extended to match, so
  the model works with exactly what the deployment had before the canary existed;
- the routing record reports `ONTOLOGY_CANARY_FALLBACK` with `fallbackReason` (for example
  `AI_QUERY_RESULT_TOO_LARGE`), keeping the failure visible in telemetry;
- the legacy tool set is computed lazily and memoised, so an eligible canary turn still never consults the
  legacy shortlist or detector while it governs the turn (the dependency trap stays valid).

Regression tests: `tests/ontologyRoutingCompletion.test.cjs` covers revocation, the restored surface, the
recorded fallback reason, and that a revoked pre-read does not become an extra model planning round.

Measured effect on the same local acceptance corpus:

| Metric | Before fix | After fix |
| --- | ---: | ---: |
| Relation cases answered correctly (ON) | 1 / 4 | **3 / 4** |
| Relation cases answered correctly (OFF) | 4 / 4 | 4 / 4 |
| Business writes / DB change | 0 | 0 |
| Errors | 0 | 0 |

### 15.3 Per-direction required reads (option 1)

The revocation above removes the systematic blow-up but not its cause: the canary still *issued* a read it
could not use. Reads are therefore declared **per direction**, because the deliverable payload differs by
an order of magnitude:

| Direction | Required reads | Why |
| --- | --- | --- |
| `recipe -> coil` | `get_recipe_detail{recipeId: <bound root>}` + `search_coils` (catalogue, ~9 KB) | The root recipe is already canonical, so ONE bounded detail read certifies the forward projection. Reading the whole catalogue here was unnecessary and, on a real-sized database, undeliverable. |
| `coil -> recipes` | `get_all_recipes` (unfiltered) + `search_coils` (root identity) | Inverse membership genuinely needs the complete unfiltered collection (`projections.recipe_coil` reads `recipe.coilId`), which cannot be bounded with the current tool schema. On a large catalogue this exceeds the per-result budget, so §15.2's revocation hands the turn back to legacy. |

The recipe-root arguments come from the bound canonical root (`root_detail`), never from the user's wording.
`get_recipe_detail` joins the canary shortlist so the planned call passes the unchanged allowlist, schema,
grounding, read-only-executor and execution-evidence guards.

No Tool schema, Business API or DB change was needed: the bounded read already existed, it simply was not
being used for this direction.

### 15.4 Alternative tested and rejected: dropping the undeliverable read

Since the inverse read is undeliverable, the obvious next step was to stop *requiring* it: keep only the
coil identity read for `coil -> recipes` and let the model fetch the collection as legacy does. **This was
implemented, measured, and reverted** — it made the inverse direction strictly worse:

| Relation case | OFF | ON requiring the read | ON without requiring it |
| --- | --- | --- | --- |
| 12-120 线圈用在哪些配方 | ✅ | ✅ | 1/2 |
| 12-140 线圈被哪些配方使用 | ✅ | ✅ | **❌** |
| 12-160 线圈用在哪些配方 | ✅ | ✅ | **❌** |
| **relation cases correct** | **7/8** | 6/8 | **5/8** |

The reason is visible in the tool traces: with no requirement, two of the inverse cases answered from
`[search_coils]` alone and never fetched the recipe collection at all. The completion requirement is what
makes the model actually gather the evidence.

A repair round instead is not available either: the promotion gate requires **zero** ontology-induced
provider calls, and one repair prompt per inverse question would break it.

So the inverse direction keeps the requirement, and relies on §15.2's revocation to hand the turn back to
legacy when the collection cannot be delivered. Closing it properly needs a bounded or aggregate
collection read — a Tool schema change, outside this phase.

### 15.5 Final acceptance result

Local, real-data, real-DeepSeek acceptance over an extended corpus (eight two-turn relation cases covering
both directions, plus cost, stock, ambiguous, unrelated-order, unsupported-relation and write-protection),
repeated across five phases:

| Relation case | OFF base | ON (before fix) | ON (dropped read) | ON (final) | OFF rollback |
| --- | --- | --- | --- | --- | --- |
| `12-120 线圈用在哪些配方` | ✅ | ✅ | 1/2 | ✅ | ✅ |
| `12-140 线圈被哪些配方使用` | ✅ | ❌ | ❌ | ✅ | ✅ |
| `12-160 线圈用在哪些配方` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `12-200 线圈被哪些配方使用` | ❌ | ❌ | ❌ | ✅ | ✅ |
| `v750-tokoy 用的是哪个线圈` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `V1100-2寸 配的什么绕组` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `v1500-DY-ml 用的是哪个线圈` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `800直出水切割泵 配的什么线圈` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **relation correct** | 7/8 | 6/8 | 5/8 | **8/8** | 7/8 |
| canary-routed relation cases | 0 | 7 | 7 | 6 | 0 |
| completed / errors | 13/14 · 1 | 13/14 · 1 | 14/14 · 0 | 14/14 · 0 | 14/14 · 0 |
| business DB change | none | none | none | none | none |
| writes | confirm-card only | confirm-card only | confirm-card only | confirm-card only | confirm-card only |

Forward direction (`recipe -> coil`) is deterministic and stable: every run routed it through the bounded
`get_recipe_detail{recipeId}` + coil-catalogue reads and answered correctly.

Inverse direction (`coil -> recipes`) remains the variable part, and the variance is a property of the
platform rather than of the canary: across runs the **legacy** path itself failed different inverse cases
(R4 in the baseline, R1 and R7 in the rollback run), because the 121 KB collection read exceeds the 96 KB
per-result budget on both paths and each side has to improvise with keyword searches.

One transient fault was observed and characterised: `AI_INTENT_PLAN_INVALID` on the write request in two of
five phases. Retrying that request three times produced the confirmation card every time, and no write ever
occurred, so it is a fail-safe intent-parsing flake rather than a regression.

Verification: ontology P1–P7 focused **371/371**, full regression **2517/2517**, API contract 26/26, web
build PASS.

### 15.6 Status

The forward direction is closed. The inverse direction is fail-safe and now measures at or above legacy on
the acceptance corpus, but it is not *guaranteed* at parity: it depends on the model improvising a
deliverable (filtered) collection read after the canary revokes itself, and on this database size the legacy
path has the same limitation. Both paths share one root cause — the collection read cannot be delivered
within the 96 KB per-result budget — and closing that requires a Tool schema change.

The promotion therefore remains **PRODUCTION-CAPABLE BEHIND A DEFAULT-OFF FLAG**, still undeployed:
production is untouched (`master @ 24106a1b`), the branch is not pushed, legacy code is not removed, and the
canary flag is at its default OFF with the local environment restored byte-identically. Deployment requires
supervisor authorisation, and P9's legacy-cleanup entry gate is still unmet.
