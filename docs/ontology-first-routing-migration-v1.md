# First Relation Routing Migration V1 — ONT-P6 preflight

**Status: REWORK. Canary routing is not implemented or enabled.** This is a concrete preflight result under the requested section 24: do not force a migration where the current special case is not semantically equivalent to pure relation routing. No runtime, prompt, tools, evidence, flags or configuration changed. The semantic split below is for supervisor review; it is not a claim of delivered routing.

## 1. Existing hard-code being migrated

Live baseline: `1664b8beebe9528c00e12142d7ac2afe67f60189`, existing `codex/ont-p1-thin-contract` worktree. Source inspection confirmed six pure/mixed special-case sites across two files:

- `aiToolShortlist.cjs:136`: bidirectional co-occurrence detector, with no direction, read/write or intent classification.
- `aiToolShortlist.cjs:162`: fixed offered-tool pairing `[get_all_recipes, search_coils]`.
- `aiAssistantRuntime.cjs:46`: required query builder; search_coils repair only derives arguments from a numeric shorthand; no generic reverse root binding.
- `aiAssistantRuntime.cjs:212`: relation detector enabled only with local shortlist.
- `aiAssistantRuntime.cjs:319`: fixed missing-tool completion/repair, model repair prompt and relation failure answer.
- `aiAssistantRuntime.cjs:429`: removes recipe keyword for any query matching that detector, regardless of relation direction.

`aiCapabilityGraphV3.cjs` was fully inspected: it has generic entity discovery descriptors and calculate_coil_cost target metadata; it has no coil↔recipe pairing/detector/repair. No missing special case is invented there. Graph metadata is not the current relation authority.

Adjacent non-relation sites are `coilCostComparisonPairs`, cost-first shortlist at line157, required calculate_coil_cost calls in the assistant, and final `formatCoilCostComparison`. These remain outside the migration candidate.

## 2. Why this family was selected

The user selected exactly coil↔recipe. Ontology V1 contains `coil.used_by_recipe` and `recipe.uses_coil`, both CANONICAL_DIRECT. Other five families are not substituted. Existing P4 formal root binding correctly distinguishes both directions on the frozen preflight fixture.

## 3. Ontology replacement path and semantic split

Proposed pure scope is current unique relation intent → P4 canonical binding → generic compatibility profile → existing formal read tools. Costs, inventory facts, comparisons, writes/configuration, similarity and semantic relatedness stay in current runtime and must not become relation-routing profiles.

The live detector is broader than that scope. Reproduced counterexamples:

| User text | Current detector | Current local shortlist | P4 outcome |
| --- | --- | --- | --- |
| 查询Shadow配方甲的线圈成本 | true | get_all_recipes, search_coils | NO_RELATION_INTENT |
| 查询Shadow配方甲使用的线圈库存 | true | get_all_recipes, search_coils | RELATION_NOT_SUPPORTED |
| 修改Shadow配方甲使用的线圈 | true | get_all_recipes, search_coils | NOT_ELIGIBLE |
| 比较12-120线圈和13-120线圈成本，哪些配方在用 | true | calculate_coil_cost | AMBIGUOUS_RELATION |

The last question's shortlist and completion requirements are inconsistent: cost selection exposes calculate_coil_cost, while the broad relation detector still asks for search_coils/get_all_recipes. Repair is not an equivalent pure relational behavior that should be copied into Ontology.

## 4. Compatibility execution profile

Not implemented. Profiles must separately specify root discovery, subsequent required formal reads, readiness from verified results, permitted argument normalization and completion status. The old offered-tool order `[get_all_recipes, search_coils]` differs from repair order `[search_coils, get_all_recipes]`; the actual tool sequence is model-dependent. Blanket keyword removal must not silently become canonical-root discovery policy for recipe→coil.

Cost profile/comparison, inventory and configuration behavior must remain independently owned by current business capabilities. No synthetic business fact or P2 result promotion is permitted.

## 5. Two-stage canonical binding

Proposed: unique pure directional intent can admit discovery, without claiming an ID. Existing formal discovery must then yield the exact unique canonical root and P4 BOUND before relation completion is attributed to Ontology. Ambiguous candidates/pronouns and multiple roots reject. Trusted same-user/server session receipts are allowed, ordinary assistant history is not.

The frozen corpus already contains explicit names, shorthand, typed IDs and trusted pronouns for both directions, plus ambiguous roots. No new model output is requested.

## 6. OFF/ON behavior and provider mismatch

No canary flag exists yet; legacy/current runtime remains untouched. Proposed flag is `AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false`.

Current pure relation shortlist, keyword clearing and relation completion repair apply only to `AI_PROVIDER=local/local-first`. `shouldUseLocalToolShortlist` is false for the requested real Provider DeepSeek. DeepSeek receives the current full read-tool catalog and has no forced relation completion branch; the shortlist function is also reused for generic business-query evidence relevance, which does not make the local pairing active.

Enabling forced discovery/completion for DeepSeek would introduce a decision previously absent on its OFF path. Before a semantic-equivalence migration, supervisor must resolve whether P6 is a local-path migration with real local-provider acceptance, or a separately measured cloud behavior change. The prescribed DeepSeek run cannot be presented as validation of an old forced route it never executes.

## 7. Fallback

Not implemented/tested. A future eligible internal failure must emit ONTOLOGY_CANARY_FALLBACK; initial lack of unique intent/root is CANARY_NOT_ELIGIBLE, not an unexplained fallback. No silent legacy detector call is allowed to decide an eligible canary route.

## 8. Deterministic A/B

Not completed. `tests/fixtures/ontology-coil-recipe-canary-v1.json` freezes 24 preflight questions: eight directional positives and sixteen negatives, with legacy detector/shortlist characterization and provenance requirements for context. `ontologyRoutingMigrationPreflight.test.cjs` checks actual legacy selection, actual P4 binding and provider gating. It does not pretend an ON implementation exists or claim runtime A/B equivalence.

The pure/mixed boundary and provider contract must be resolved before wiring an ON path. Legacy implementation is preserved, including its current broad behavior, to avoid changing OFF during preflight.

## 9. Real AI A/B

Not run. No functional ON path exists, so spending Provider calls would not produce valid A/B evidence. The prior P5 DeepSeek evidence is not reused as P6 routing acceptance.

## 10. Shadow coexistence

P3/P4/P5 remain unchanged, with their existing default-OFF flags, resolver budgets and independent observation. Baseline regression can validate preservation, but cannot establish correctness of an unimplemented canary.

## 11. Remaining legacy code

All six sites and adjacent cost/comparison/configuration logic remain unchanged. There is no production routingSource marker, compatibility router, new canary flag or contract version. No API, schema, dependencies, writes, merge, push or deployment were added.

## 12. ONT-P7 entry criteria

P6 must be reworked and then pass actual ON/OFF deterministic and real Provider A/B, canonical root/direction/negative gates, zero unexpected fallback, no eligible legacy detector/repair reliance, unchanged evidence/answer/model calls and full regression/build. P7 is not authorized by this preflight. P2/P5 remain unsuitable for direct final-answer evidence promotion here.

## Validation

Final preflight verification on 2026-09-18: 26/26 characterization tests; P1–P5/current AI/relationRead/identity/observability focused 452/452; full npm test 2450/2450 with no failures/skips; Web build PASS; new test ESLint/UTF-8/whitespace PASS. The frozen eight P4 positive bindings have correct roots/directions; sixteen negatives do not bind. These are preflight checks, not proof of a canary ON route or A/B equivalence.

Readonly live configuration verification confirmed DeepSeek / deepseek-v4-flash and legacyRelationPathEnabled=false. Credentials stayed in process memory and are not recorded. No Provider inference was called for this preflight. Real routing A/B, canary isolation and fallback telemetry remain unimplemented/unverified, so overall P6 is REWORK despite passing preservation tests.

Original master remains 24106a1b41baa11a7a3e64e0fc78efa28121b271; its sole user-owned untracked P0 audit is unchanged (SHA-256 8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b). Only this document, the frozen preflight corpus and characterization tests are delivered on the existing branch. No runtime or production configuration changes, new branch, merge, push or deployment.
