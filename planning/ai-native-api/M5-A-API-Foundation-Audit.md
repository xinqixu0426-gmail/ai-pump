# M5-A — AI-Native API Foundation Audit

## Boundary and fresh audit

Start HEAD `e3c61bbb73a11c6ee87758733f31f2d7461a4f86`, branch `ai-native/m3-optimization-v1`. Existing owner edits in `docs/README.md` and `docs/ai-assistant.md` were left untouched. This phase changes the current assistant's tool contract/validation boundary, not Planner, Capability Broker selection policy, Main Agent architecture, Business Understanding, Domain Policy, Ontology, business calculation, DB schema or write authorization. No deployment or live business mutation was performed.

Read paths: `tools.cjs` (80 generic definitions), `aiFormalToolDefinitions.cjs` (4 private formal definitions), `aiToolInputValidator.cjs`, `registry.cjs`, `executor.cjs`, `internalApiClient.cjs`, five domain executor modules, `agentTools.cjs`, `capabilityBroker.cjs`, `mainAgent.cjs`, `factLedger.cjs`, `answerValidator.cjs` and `protectedWriteBroker.cjs`. The private formal tools are registered but are not part of the generic 80-tool surface. The formal business registry has 147 capabilities; it is not an 147-tool Main Agent surface. The exact matrix is in `M5-A-API-Foundation-Contract-Matrix.json`.

## Findings and corrections

| Finding | Fresh-code evidence | Correction / boundary |
|---|---|---|
| A: same-name schema drift | Broker exposed formal nested `preview_profitability` and `preview_virtual_readiness` schemas, while `executeAgentTool` excluded those names from broker dispatch and sent them to simplified adapters. Broker also required a spurious top-level `recipeId`. | Selected formal tools now dispatch to the broker; `basisRef.recipeId` is the identity path for those two. Simplified legacy prototype adapters were given distinct `_legacy` names and remain outside the current registered Main Agent surface. A compatibility test sends valid formal schema inputs through adapter to mocked executor. |
| B: incomplete result projection | Fact projection clipped arrays at 12, hid business IDs and could leave `complete:true`. | Small arrays are returned whole; model projection gives `projection.truncated` plus per-collection `totalCount`, `returnedCount`, `hasMore`, `complete`, optional cursor. Parent `complete` is lowered on truncation. Formal business IDs survive; tokens, hashes and operation secrets remain hidden. Original formal result remains complete in tool results. |
| C: nested dedup collision | Top-level `JSON.stringify` replacer discarded nested values. | Recursive sorted-key canonical JSON preserves arrays and nested values. |
| D: formal errors flattened | Broker and adapter replaced most failures with one generic sentence/code; Main Agent catch conflated all thrown errors. | A narrow sanitized error projection preserves stable code/category/recoverability and safe missing/allowed fields. Internal response details pass through the executor. Secret, raw server error, stack and token content are not forwarded. |
| E: null numeric facts | `Number(null)` and `Number('')` were treated as 0 in `finite()`; legacy part stock projection had the same pattern. | Null/undefined/empty/whitespace/NaN do not become zero facts; actual numeric zero still does. |
| F: claim binding | Answer parity searched all ledger amounts, regardless of cited fact/entity/basis; nested formal `basisRef.recipeId` was not attached to ledger entities. | Nested recipe identity now binds to verified ledger facts. Every money-bearing answer clause must be covered by a cited claim; amounts are checked against its cited facts and high-confidence explicit entity/current/scenario qualifiers. Wrong-entity or wrong-basis claims fail; no cost arithmetic was added. This is a minimum binding guard, not a full natural-language proof engine. |
| G: schema feature gaps | Exposed formal schemas use `exclusiveMinimum` and `pattern`, but validator ignored both. | Both are enforced; test scans the actual schema keyword vocabulary and exercises `const` as well. |
| H: scenario boundary | Formal `compare_recipe_scenarios` accepts float, cable, formal coil, barrel length, formal `packingParts` with `partId/model/supplier/qty/packingRole`, and surface treatment. There is no rotor-process override field. | Raw “木箱” string is rejected as `PACKING_FORMAL_BINDING_REQUIRED`; formal packing structure passes schema. Rotor process remains unsupported; no fallback mapping to surface treatment. Formal API/business semantics untouched. |
| I: registry/dispatcher | 80 generic + 4 private definitions, 84 registered AI capabilities, 84 unique domain-executor actions. | Automated test checks exact definition/action set equality, schema, registry, executor family and private formal links. No tool or executor orphan. Of the 84 AI capabilities, 48 have explicit formal links and 36 legacy/composite entries do not declare one; these are recorded rather than inventing links. All declared links resolve. |

## Write boundary

No change to `allowWrite`, confirmation, preflight, frozen identity, idempotency, readback, stale proposal, `UNKNOWN_EFFECT`, `x-internal-secret` or `x-internal-write-secret`. New regression tests invoke only schema validation or mocked read tool calls. Write execution count: 0.

## Verification

`tests/aiNativeApiFoundation.test.cjs` covers A–I with isolated fixtures; existing M1 and model projection assertions were updated to the corrected formal schema and explicit completeness contract. `docs/api-reference.md` now states the current same-name private formal input contract and model projection boundary. Gate outcomes and test counts are recorded in `M5-A-API-Foundation-Regression.json`.

## Recommendation

The existing AI tool foundation is suitable for supervised API Index design only after reviewing the 36 pre-existing legacy/composite AI actions without explicit formal capability links. This phase did not add an API Index, change the broker's selection policy, or authorize new tools. Preserve the distinction between a declared-link failure (zero) and an undeclared composite mapping (36) in subsequent work.
