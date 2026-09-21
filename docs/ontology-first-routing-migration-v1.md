# First Relation Routing Migration V1 — ONT-P6R / P6D / P7

**Gates are tracked separately and must never be merged into one PASS.**

| Gate | Scope | Status |
| --- | --- | --- |
| Deterministic Canary Gate | Frozen Legacy Oracle, 28-case corpus, OFF/ON equivalence, dependency trap, non-eligible fallback, evidence isolation | **PASS** |
| DeepSeek Real-AI Canary Gate (ONT-P6D / P6D-R1) | Real DeepSeek provider, paired A/B over the frozen corpus | **PASS** |
| DeepSeek Authoritative Routing Promotion (ONT-P7) | Production provider eligibility + real `POST /api/ai/chat` SSE OFF/ON gate + rollback | **PASS** |
| Local Provider Gate (strict local) | `AI_PROVIDER=local`, real local model host | **PASS — ONT-P8L forward closure** |

**Local Provider Gate: PASS.** The model host (`192.168.31.111:8080`) became reachable and the formal
strict-local runner was executed on the Mac Mini isolated validation instance against the real production
data shape. The accepted run is recorded in §17.6. Historical DEFERRED/BLOCKED evidence below remains
unchanged as provenance; it no longer describes the current gate status.

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

`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false` is independent from shadow flags and defaults to OFF. It is an environment-only private experiment, not a new client field or public runtime configuration API. The flag does not grant request authority by itself: the HTTP chat boundary must also prove the existing formal Owner JWT or the existing exact internal secret, then pass a server-owned eligibility boolean to the runtime. Shared-admin cookies, `req.user` fields, client-declared owner headers/query fields and invalid owner configuration all fail closed to Legacy.

ON admission requires all of:

1. Environment flag exactly `true` and server-verified Owner/Internal request eligibility.
2. PURE_RELATION_QUERY.
3. Unchanged P4 BOUND, unique canonical root and directional relation.
4. An explicitly promoted authoritative relation family.
5. Provider mode in that relation profile; local/local-first also require the existing local shortlist.
6. Every required tool is already offered by the existing registered read/query catalog.

The runtime supplies only server-owned, same-user, same-conversation, unexpired session formal receipts. Client persisted conversation payloads, page data, ordinary assistant history and fuzzy names cannot establish identity. Typed IDs/names/shorthand still require existing formal canonical receipts. Pronouns additionally require the P4 trusted-session contract. No P4 grammar, exclusion, probability or identity rule is weakened.

For `recipe.uses_coil`, a model answer that already contains only the verified numeric coil identity is preserved. If it omits that identity or appends another numeric coil identity, the server replaces the prose with the deterministic result derived from the mutually agreeing recipe-detail and coil-catalogue receipts. This is presentation enforcement only: it adds no read, provider round, relation, or cost rule.

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

## 16. ONT-P8R Bounded Reverse Read — closing the inverse-direction root cause

§15 left exactly one open item: the inverse direction (`coil -> recipes`) had no deliverable read. This
section closes it. P8R does **not** deploy anything; it removes the reason deployment was unsafe.

### 16.1 What was missing

`coil -> recipes` is the `recipe_coil` family's inverse direction. Its only evidence was the COMPLETE
unfiltered recipe collection (`get_all_recipes`), whose payload on the real database is **121,038 bytes**
against the runtime's per-result budget of **96 KB** (`enforceAiToolResultBudget(name, result, toolResults,
96 * 1024)` → `AI_QUERY_RESULT_TOO_LARGE`). So the canary could never obtain its own evidence for that
direction, revoked itself (`ONTOLOGY_CANARY_FALLBACK`) and handed the read surface back to legacy. §15
already measured that neither dropping the requirement nor adding a repair round was better than legacy.

The capability was also missing at the data layer in a second sense: ONT-P2 already resolved the relation
canonically (`FK_PLANS.recipe_coil`, keyset plan over `recipes.coil_id`), but that path is internal to the
ontology resolver and had no formal, bounded, AI-reachable read. The fix is therefore a thin **adapter** over
existing deterministic logic, not a new business rule.

### 16.2 What was added

| Layer | Addition | Note |
| --- | --- | --- |
| Relation read contract | relation `coil.recipes` (`root: coil`, `result: recipe`, semantics `CURRENT_RECIPE_COIL_REFERENCES`) | caller submits only `relation/rootId/pageSize/afterId`; SQL stays server-side |
| Relation read service | bounded keyset branch + `ROOT_SQL.coil`, `deleted_at IS NULL`, `id DESC` | verified-empty vs `RELATION_NOT_FOUND` are distinguished |
| HTTP route | the existing `createRelationReadRouter({db})` is now mounted at `/api/relations` in `api.cjs` | mounted **after** the authenticated `/api` section; `x-internal-secret` covers internal AI calls; not publicly reachable |
| AI capability | `recipes.by_coil` (read/query, `callers: ['ai','internal']`) + registry lists + executor `query` | registered in `DOMAIN_CAPABILITY_NAMES`, display names, executor names, formal ids, live sets |
| AI tool | `get_recipes_by_coil({coilId, limit?, afterId?})` | re-validates the HTTP payload with `validateResult` from the same contract; refuses a payload that fails it |
| Ontology contract | `relationReadMapping` entry `coil.recipes -> coil.used_by_recipe` (`ADAPTER_REQUIRED`), validator reader count 7 → 8 | the canonical-only adapter is the identity restriction; no legacy fallback exists to strip |
| Canary profile | `coil.used_by_recipe` required reads = `[get_recipes_by_coil{root_id}, search_coils{root_identity}]`; per-direction `shortlistByRelation` | `rootId` comes from the already-bound canonical coil root, so no extra discovery round |
| Shadow projection | `claimsBoundedInverseRead` / `isCanonicalInverseRead` in `bindingCurrentFacts.cjs` | a complete page IS the authoritative membership; a claiming read with non-canonical ids sets `canonical=false` |
| Legacy surface | `EXPLICIT_ONLY_TOOL_NAMES` in `aiToolShortlist.cjs` | keeps the legacy auto-shortlist byte-identical; see §16.4 |

### 16.3 Evidence

Reader, against the real development database (read-only):

| Coil root | Bounded result | Bytes | Legacy aggregate |
| --- | --- | --- | --- |
| coil 1 (12-120) | 2 recipes: `V12-120-DY-ml`, `v550-tokoy` | 782 | 121,317 |
| coil 2 (12-140) | 3 recipes: `V750-大脚板-2寸`, `v750-tokoy-`, `v750-tokoy` | 865 | 121,317 |
| coil 3 (12-160) | 1 recipe: `V1100-2寸` | 703 | 121,317 |
| **coil 5 (12-200)** | **1 recipe: `800直出水切割泵`** | **714** | 121,317 |
| coil 6 (12-220) | 1 recipe: `v1500-DY-ml` | 704 | 121,317 |
| coil 99 (absent) | `404 RELATION_NOT_FOUND` | — | — |

This is ~150× smaller than the aggregate, ~135× below the 96 KB budget, and it answers the exact case
(`12-200` → `800直出水切割泵`) that failed on **both** paths in §15.5.

Executed through the real AI tool executor: `{coilId:5}` → recipe 7 `800直出水切割泵`; `{coilId:2,limit:1}`
→ `hasMore=true, nextAfterId=5`; `{coilId:99}` → `RELATION_NOT_FOUND`; `{}`/`{coilId:0}` →
`INVALID_AI_TOOL_INPUT`. Evidence is `POST /api/relations/read` with no payload in the receipt.

Tests (each assertion is a bounded, falsifiable claim):

- `tests/ontologyBoundedReverseRead.test.cjs` **8/8** — contract strictness (caller SQL/filter keys rejected),
  bounds and keyset pagination, verified-empty vs not-found, route mounting through a real Express server,
  tool refusal of a missing root id, the inverse-membership certification matrix (8 incomplete variants,
  wrong root, conflicting snapshots, repeated reads, non-canonical ids), the permanent large-fixture
  regression (400 referencing recipes → aggregate still refused by the budget, bounded page delivered at
  < 4 KB), and behavioural equivalence of the shared routing stub.
- Ontology P1–P7 focused suite **371/371**.
- Frozen P6 corpus hash unchanged:
  `1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8`
  (`tests/helpers/ontologyRoutingCorpus.cjs`, LF-canonical, compared by both P6D and P7 gate scripts).

### 16.4 Two behavioural changes P8R had to make, and why they are safe

1. **The canary offers a per-direction tool list.** Surfacing the new tool changed the locally scored legacy
   shortcut: scoring is score-then-index ordered under a `maxTools` cap, so adding any recipe-domain read tool
   silently displaced an existing entry and broke the frozen P6 `recipe-write` shortlist. Fixed by making the
   tool *explicit-demand only* (`EXPLICIT_ONLY_TOOL_NAMES`) so the legacy auto-shortlist is unchanged, and by
   declaring the canary's offered surface per direction — which is what the reads already were.
2. **The test fixture server had to parse JSON.** `tests/helpers/runOntologyRoutingApiFixture.cjs` served GET
   only; the new read is a POST. It now parses JSON and exposes exactly one write-shaped path
   (`POST /api/relations/read`) while every other non-GET stays refused.

Neither change touches prompts, the answer composer, the binder, the capability graph, DB schema, business
WRITE APIs, dependencies, or any legacy code path.

### 16.5 Canary inventory hardening (phase review follow-up)

A second pass against the phase instruction found four gaps that the first implementation had left open.
All four are now closed and covered by tests.

1. **§9 — the system owns pagination, not the model.** The first implementation returned a single page and
   left paging to the model. `get_recipes_by_coil` now drains the relation itself inside a bounded budget
   (max 8 pages, 50 rows each, `< 32 KB`), and its tool schema exposes **only `coilId`** — no `limit`, no
   `afterId`. `complete` is set-level: true only when the whole relation was drained AND every reference was
   confirmable. A coil with 61 referencing recipes returns all 61 in ONE call with `pagesFetched=2`.
2. **§8 — a relation-specific size bound.** `MAX_RESULT_BYTES` (256 KB) is shared with the resolver and
   traversal aggregate budgets, so tightening it would have silently shrunk the P5 traversal budget. The
   relation read now has its own `MAX_RELATION_RESULT_BYTES = 32 KB`, well under the 96 KB AI budget.
3. **§10 — legacy coil references are no longer silently dropped.** `recipes` carries denormalized
   `coil_spec`/`coil_sheets` alongside the canonical `coil_id` (real database: recipe 4 `V12-100-DY-ml` has
   `coil_id = NULL`). The read now classifies every recipe that declares a coil only through those columns
   and reports `setCompleteness` plus a bounded `legacyReferences` list:

   | Situation | Classification |
   | --- | --- |
   | Complete legacy identity equal to this coil | `AMBIGUOUS_LEGACY_REFERENCE` — listed, never dropped |
   | Complete legacy identity naming a different coil | confirmed non-match, excluded |
   | Partial declaration that cannot be compared | `REFERENCE_INCOMPLETE` |
   | Every reference confirmable and page drained | `COMPLETE` |
   | More matching rows than the drain budget | `PARTIAL` |

   `coil_sheets` defaults to `0` and `coil_material`/`coil_slot_type` have non-empty defaults, so "declares a
   coil" is defined as a non-empty spec **or** a positive sheet count; treating the defaults as references
   made every unrelated recipe look unconfirmed and every answer permanently incomplete.
   The shadow only certifies inverse membership from a `COMPLETE` read.
4. **§16 — the large fixture now exceeds 128 KB** (20-part BOMs, 400 recipes) instead of 96 KB.

Measured on the real AI tool-result layer (not the raw HTTP response):

| Path | Tool result | Budget verdict |
| --- | --- | --- |
| `get_all_recipes` (whole catalogue) | **120,990 B** | `AI_QUERY_RESULT_TOO_LARGE` at 96 KB |
| `get_recipes_by_coil` (coil 5) | **644 B** | delivered, `complete=true` |

### 16.6 §11/§12 shared fact layer, and the one residual it leaves

§11 is satisfied: there is exactly **one** implementation of this relation (`relationReadService` + the
relation read contract), and both routing paths reach it — the legacy model-driven turn calls the same
registered read tool the canary plans, so no second SQL or filter implementation exists.

One part of §12 was **attempted and deliberately reverted**, and is reported as a residual rather than
worked around: the **legacy deterministic plan** for local models still names `get_all_recipes` in
`aiAssistantRuntime.legacyRelationMissingTools`. Reasons, in order of weight:

1. `get_recipes_by_coil` needs a canonical coil root. The frozen P6 corpus's repair hook calls
   `requiredCoilRecipeToolCall(name, userText)` with two arguments, so it can never forward already-verified
   tool results; deriving the root in the runtime instead needs one earlier iteration, which converts the
   current zero-provider-call legacy plan into a model repair round (a provider call).
2. That plan only runs for **local** models with the local shortlist enabled. Production DeepSeek never
   takes it, and the real acceptance measured the production legacy path at **4/4 correct with 0
   payload-limit failures** on the inverse direction — including the previously failing `12-200` case.

So changing it is an optional local-mode optimisation with a real cost, not a correctness fix. The
frozen legacy oracle fixture is **unchanged** (`selectedTools` for the relation cases is still
`["get_all_recipes","search_coils"]`), and the schema/artefact hashes below are untouched.

### 16.7 P8R acceptance result

Real DeepSeek, real-scale database, 14 cases, three phases. The harness takes a byte copy of the database
first and verifies the copy hash against the source; the source database is opened read-only throughout.

| Phase | Relation total | `coil -> recipes` | `recipe -> coil` | reverse authoritative | max aggregate seen | payload-limit failures | done | errors | DB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OFF (canary off) | 6/8 | **4/4** | 2/4 | 0 | 30,040 B | 0 | 14/14 | 0 | unchanged, delta 0 |
| **ON (canary on)** | **8/8** | **4/4** | **4/4** | 3 | **0 B** | 0 | 14/14 | 0 | unchanged, delta 0 |
| OFF rollback | 6/8 | 4/4 | 2/4 | 0 | 30,040 B | 0 | 14/14 | 0 | unchanged, delta 0 |

`aggregateMax = 0 B` on the ON phase is the headline: with the canary routing, the whole-recipe aggregate is
never read for this relation at all. The two `recipe -> coil` OFF failures (R5, R8) are the model reaching
for `get_all_recipes`, receiving a truncated catalogue, and answering from it — the pre-existing legacy
weakness that ON removes by planning bounded `get_recipe_detail` reads in software.

Read the OFF columns with the §16.9 caveat: OFF is no longer a pure "unchanged legacy" baseline, because
this version also adds the bounded reverse read that legacy itself can now use.

Bounds observed: bounded projection max **134 B** across the corpus (real database, five coils, one to
three recipes each); `tooLarge` errors **0** in every phase; write request produced the confirmation card
only.

Verification: ontology P1–P7 focused plus the new P8R suite **386/386**, full regression **2527/2527**, API
contract 26/26, deep API PASS, web build PASS. Frozen artefacts unchanged: P6 corpus hash
`1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8`, legacy oracle fixture unmodified.

### 16.8 口径修正：canary=false 不等于"零行为变化"

P8R 之后必须按这个事实判断生产验收，不能再说 canary 关闭就等于整个版本无行为变化：

```text
Canary=false  →  Ontology routing 不接管该请求
              但  本版本仍新增了 bounded reverse-read 能力（get_recipes_by_coil），
                  Legacy AI 也可能在完整工具目录下使用它
```

证据：OFF 相位的反向方向是 **4/4 正确、0 超限失败**，包括此前两个方向都会失败的 `12-200`。这个改善来自新能力本身，不是来自 routing，因此**必须记为 Legacy 能力改善，不能伪装成 Ontology 收益**。反过来，正向方向的 2/4 才是 canary 关闭时的真实 legacy 水平。

对应的验收口径：

| 相位 | 该相位真正在测的东西 |
| --- | --- |
| canary OFF | legacy 能力基线（已含 bounded reverse read 带来的改善）+ 全部安全不变量 |
| canary ON | ontology routing 是否在不增加 provider call、不产生错误 root/relation/direction 的前提下与 legacy 事实一致 |

### 16.9 Status

The inverse direction is no longer dependent on a read the runtime cannot deliver, and the `coil -> recipes`
relation now has a formal bounded authoritative read with explicit set-level completeness and documented
legacy-reference handling. P8R is still **branch-only**: production is untouched (`master @ 24106a1b`),
nothing is pushed, the canary flag remains default OFF, no production `.env` was modified, and every change
is confined to the phase branch. Deployment and the P9 legacy-cleanup gate remain supervisor decisions.

## 17. ONT-P8L Bounded Legacy Relation Repair (local convergence)

Supervisor ruling A + B. The legacy local-mode `coil <-> recipes` repair used to demand the COMPLETE
unfiltered recipe catalogue; on a real-sized database that AI tool result is **120,990 bytes against a
96 KB budget**, so the model received a truncated catalogue and could answer incompletely. It is now an
explicit bounded state machine:

```text
NONE -> COIL_ID_DISCOVERY -> BOUNDED_REVERSE_READ -> DONE
Max software repair steps = 2      Max legacy model-prompted repair rounds = 1
```

Invariants enforced, and pinned by `tests/ontologyLegacyRelationRepair.test.cjs`:

- step 2 is eligible only after step 1 produced a VERIFIED canonical coil id (execution evidence, single
  row, positive integer). Zero candidates, several candidates, an unverified receipt or a failed step 1 all
  refuse the second hop: the turn continues with the evidence it has and never guesses a root;
- step 2's only argument is that canonical id, read from the step-1 receipt. Verified by a negative
  control: a question naming 12-200 against a receipt for coil 501 still plans `{coilId:501}`;
- the whole-recipe aggregate can never be demanded again. `requiredCoilRecipeToolCall` returns `null` for
  it, so a reintroduced demand degrades to a model round instead of silently reading the catalogue;
- the two bounds are independent on purpose: software steps are free (no provider call) while model rounds
  keep the historical one-shot bound. Gating both behind one flag previously produced a **+3 provider-call
  regression** (coil-explicit 4 -> 7);
- the planned step is added to `allowed` only, never to `offered`, so this repair cannot widen what the
  model may choose.

### 17.1 Shortlist (Supervisor ruling B)

The coil<->recipe relation shortlist is now `search_coils` + `get_recipes_by_coil` + `get_recipe_detail`.
The first attempt was the literal minimal subset, removing the aggregate only, and it **broke the legacy
FORWARD direction**: that branch historically held exactly two tools, so removing the aggregate left the
model with nothing able to read which coil a recipe uses (measured: forward canonical targets became empty
in the API fixture). Ruling B replaced it with bounded readers for both directions.

### 17.2 Evidence

| Gate | Result |
| --- | --- |
| aggregate reads on coil-relation cases | 18 -> **0** |
| provider calls | 0 change across all 28 corpus cases, and lower after ruling B (3/4 -> 2); never higher |
| bounded projection size, real DB | 86-134 B against the aggregate 120,990 B |
| large fixture | aggregate > 128 KB and refused at the 96 KB budget; bounded page < 8 KB; a page with more rows reports PARTIAL and only the drained set reports COMPLETE |
| negatives (absent coil, ambiguous coil, unrelated question, write request) | no second hop generated; write request still confirmation-card only |
| ontology / full regression / API contract / deep API / web build | 388/388, 2534/2534, 26/26, PASS, PASS |
| DeepSeek real-DB regression | 14/14 done, reverse 4/4, forward 3/4, 0 errors, 0 payload-limit failures, business DB unchanged (delta 0) |
| Frozen Legacy Oracle V1 | **unmodified** (git diff 0 lines); Oracle V2 added as the current baseline |

Oracle V2 deliberately keeps `sourceCommit` pointing at the P6 baseline commit, because that field is what
the canary suite resolves `git show <commit>:<file>` against. Recording the generating commit there silently
turned "compare against the frozen baseline" into "compare against my own changes". The generating commit is
recorded separately as `generatedFromCommit`.

### 17.3 Sanctioned semantic change to the OFF baseline

After ruling B, when a question carries no coil shorthand or other unambiguous identity, the legacy side can
only certify NOTHING: the bounded repair refuses to pick a root out of several candidates. The ontology route
still certifies the correct target. For `coil ID 501 is used by which recipes`, the ontology route certifies
`301` and complete while legacy certifies nothing.

That is the designed fail-safe rather than a defect, but it changes what an OFF baseline means: not "legacy
always answers" but "legacy does not guess". The tests therefore assert "the ontology route must certify the
correct target; legacy must certify the correct target or nothing, never a wrong target" instead of "both
sides must agree".

### 17.4 The one gate that is still open

The Supervisor requires a real LOCAL-model acceptance before it will lift the production freeze:
`AI_PROVIDER=local`, actual provider local, cloud fallback 0, 8 relation cases x 2 rounds, both directions
8/8. The local model is deployed in a **different work LAN** and is not reachable from this development
network (verified: `192.168.31.111:8080` accepts TCP but every HTTP request fails with ECONNRESET).

This gate is therefore reported as **PENDING, not passed**. No substitution was used to fake it. Pointing
`LOCAL_AI_BASE_URL` at DeepSeek would have exercised the repaired code path with a real model but mislabelled
the provider, and that was rejected as dishonest.

When the machine is on that LAN the run is one command each for the two phases:

```text
node logs/p8l-local-acceptance.cjs --phase baseline --rounds 2
node logs/p8l-local-acceptance.cjs --phase on --rounds 2        # with the canary flag enabled
```

That harness preflights rather than assumes: it refuses to run unless `AI_PROVIDER` resolves to the LOCAL
provider and the endpoint answers, so a cloud run can never be reported as a local acceptance. Required
numbers: reverse 8/8, forward 8/8, cloud fallback 0, aggregate calls 0, payload-limit failures 0,
unauthorized writes 0, business DB unchanged with a zero `total_changes` delta.

### 17.5 Status

Supervisor ruling on this phase: **FREEZE**. Production stays frozen until the local acceptance above has
been run and reported. Production is untouched (`master @ 24106a1b`), nothing is pushed, the canary flag is
default OFF, no production `.env` was modified, and every change is confined to the phase branch.

### 17.6 Strict-local closure and read-authority boundary

The previously deferred Gate A was run on the Mac Mini isolated instance at
`/Users/dan/pump-p8l-validation`, port `3012`, with the real local Ornith model and an isolated database.
The first real run proved that reverse reads were already complete but forward `recipe -> coil` questions
still depended on model tool selection (forward 1/8). The closure therefore grants the registered,
read-only relation layer enough authority to do three things even while the routing canary flag is OFF:

1. parse the existing registered relation intent (no second grammar);
2. resolve an exact recipe name through the existing formal bounded identity reader;
3. execute the relation profile's existing `get_recipe_detail` + `search_coils` reads before synthesis.

This is a deliberate landing-oriented permission change for **read-only registered relations**. It does
not authorize fuzzy identity, first-row selection, business arithmetic, schema changes or writes. An
absent or ambiguous canonical recipe exposes no model-selectable relation reader. The deterministic answer
is emitted only when the recipe detail's canonical `coilId` agrees with exactly one verified catalogue row.

The gate's protected-write negative was also corrected to use the formal tool's supported delta semantics
(`增加100套`). The previous phrase `改成100` was an absolute target that cannot be represented by the
existing `changeQty` contract without a prior authoritative calculation; silently treating it as `+100`
would have made the acceptance test approve a false operation. The supported delta request is routed
deterministically to the existing Preview/confirmation path and never executes the write.

Accepted evidence (branch commit `1d14156`, production untouched):

| Metric | Result |
| --- | --- |
| Actual provider / model | `local` / `/var/opt/models/Ornith-1.5-35B-A3B-APEX-i-compact.gguf` |
| Forward `recipe -> coil` | **8/8** |
| Reverse generated cases | **4/4** (two real occupied coils × two rounds) |
| Verified empty relations | **4/4 COMPLETE** |
| Wrong root / wrong direction | **0 / 0** |
| Routed correct / Legacy fallback | **12/12 / 0** |
| Aggregate reads / payload failures | **0 / 0** |
| Cloud fallback / additional provider rounds | **0 / 0** |
| Protected writes / unauthorized writes | **2/2 confirmation only / 0** |
| Business tables / audit / operations | **unchanged / 0 / 0** |

Raw report:
`/Users/dan/pump-p8l-validation/logs/gates/ont-p8l-local-final-pass-20260920.json`.
The validation instance ran commit `1d14156`; production remained ready on commit `78de920` and was not
restarted, reconfigured or migrated. Gate A is now PASS, but this branch has not been promoted to production.

## 18. Next family: recipe ↔ part (development gate)

After the accepted P8L release, the next controlled family reuses the already registered
`recipe.contains_part` and `part.contained_in_recipe` relations. It does not add an entity, relation,
cost rule, schema field or write capability.

The private assistant receives two explicit-only read capabilities: `get_recipe_parts(recipeId)` and
`get_recipes_by_part(partId)`. Both call the authenticated `POST /api/relations/resolve` boundary with a
canonical root, validate every `OntologyRelationResultV1` page, and stop after eight pages or 32 KB. Recipe
identity continues to use the exact recipe identity reader; part identity uses one exact, part-only
`POST /api/entity-lookup` request. A substring, fuzzy hit, cross-type name, missing target or ambiguous
target never becomes a root.

The relation grammar contains intentionally similar inverse wording for coils and parts. Pre-binding now
rejects an intent when the mention explicitly names another entity type, so “12-120线圈用在哪些配方”
continues to select the coil family while “某零件用在哪些配方” selects the part family. The legacy/OFF
tool shortlist remains unchanged. The new tools are private-assistant-only and do not expand MCP.

Development status: deterministic HTTP, routing, fail-closed, pagination-budget and frozen P6/P7/P8
compatibility tests pass. Production remains on the accepted P8L release with
`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false`. The controlled real-model result below closes the
development gate; production authority still requires a separate merge/release decision.

### 18.1 Real-local development acceptance

Commit `7ac028a` was checked on the Mac Mini in the isolated `/Users/dan/pump-p8l-validation` instance,
port `3012`, against its production-data copy and the actual `local` provider. The canary was enabled only
for that isolated process. Two recipe-to-part and two part-to-recipe questions ran twice:

| Metric | Result |
| --- | --- |
| Real local executions | **8/8 PASS** |
| `recipe -> part` | **4/4**, each returned the exact 21 canonical saved parts |
| `part -> recipe` | **4/4**, exact one-recipe and two-recipe sets |
| Wrong root / wrong target | **0 / 0** |
| Foreign/cloud provider | **0** |
| Unauthorized writes | **0** |
| `audit_log` / `api_operations` delta | **0 / 0** |

The first exploratory run exposed a presentation-only defect: a correctly resolved `轴承-202` result was
rewritten by the model as `轴承-2022`. Commit `7ac028a` closes that gap by making every verified
`recipe_part` tool receipt use the deterministic presenter, including questions that name the concrete
part without the literal words “零件/配件”. The final 8/8 run contains no model-rewritten part identity.

This proves the branch's controlled real-local development gate. It is not a production promotion:
the isolated process was stopped, production remained ready on `28a3741`, and production has no enabled
`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED` value.

## 19. Owner/Internal production canary and strict target accounting

Production authority is restricted by two independent server-side gates: the environment flag must be
exactly enabled, and the request must carry either a formally verified Owner JWT or the existing exact
internal secret. Shared-admin sessions, request-body fields, query parameters, arbitrary owner headers
and forged `req.user` state cannot grant eligibility. The repository default remains OFF.

For a bound `recipe.uses_coil` answer, the canonical recipe detail and the canonical coil catalogue must
agree on one coil ID before the relation is treated as verified. Once that agreement exists, the legacy
same-specification variant completer is excluded from the answer: it describes catalogue alternatives,
not the recipe's bound relation, and may not append a different coil identity to an otherwise correct
answer.

The production acceptance runner enforces the same invariant. A forward answer is correct only when it
contains the expected canonical coil and contains no other coil-shaped identity. “Correct target plus a
foreign target” is therefore a failure and contributes to `wrongRoot`; the presence of the correct target
can no longer hide an overclaim.
