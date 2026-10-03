# M5-D1-R5A Rotor Process / Stainless Shaft Joint Closure

## Outcome

`compare_recipe_scenarios` now supports the formal temporary configuration dimension `rotorProcessMode`. The canonical values are `standard_45_steel` and `stainless_shaft_joint`. A caller selects a mode only; it cannot supply a price. The candidate is rebuilt through the existing Cost Engine and returns a normal scenario comparison result.

## Fresh audit

`stainless_shaft_joint_default_cost` was not a new or speculative setting. It is an existing `system_settings` business setting, initialized at 6 CNY and constrained to 5–8 CNY, already used by the shared stainless-shaft configuration service for quotation/order cost snapshots and the legacy dynamic cost preview. In those paths it is added as a process surcharge, not treated as an absolute pump cost.

The gap was narrower: Recipe Scenario Compare did not admit a Rotor Process override and its current-cost basis did not materialize the existing formal rotor-process BOM line. The setting was therefore authoritative but unreachable through the Scenario Preview contract.

## Formal contract

The new contract is `scenarios[].overrides.rotorProcessMode`. The route normalizes and applies it; `stainless_shaft_joint` resolves its amount only through `rotorShaftJoint.defaultStainlessShaftJointCost`, creates a non-inventory `rotorProcess` BOM line, and lets `costEngine.calculateRecipeCost` compute the candidate. The response exposes the applied override, Rotor Process detail, source setting in its read set, candidate cost, and formal comparison delta.

Missing or invalid formal settings fail with stable 422 codes and never become a zero surcharge. `standard_45_steel` is a true zero-cost formal baseline mode, not a missing-value fallback.

## Persistence boundary

There is no current persisted Recipe Rotor Process column. Existing legacy snapshot/dynamic-preview shapes have transient `has_stainless_shaft_joint` and `stainless_shaft_joint_cost` compatibility fields, but this closure does not create a Recipe migration or write path. An unconfigured Recipe Scenario baseline is deterministically `standard_45_steel`; `stainless_shaft_joint` is preview-only. A future saved Recipe feature needs a separately reviewed persistence and write contract.

## Why this is not a Part replacement

The generated item is a formal non-inventory process BOM line (`costRole: rotorProcess`, `processCode: stainless_friction_weld`). It has no Part identity, does not use the Parts catalog or Knowledge Base as its price authority, and does not participate in inventory/purchasing. This retains the Company Business Model classification: stainless shaft joint is Rotor Process.

## Direct API evidence

The Express integration test uses a temporary DB, a formal setting of 6.5 CNY, and a recipe without any Rotor Process Part. `standard_45_steel` costs 20 CNY; the `stainless_shaft_joint` candidate costs 26.5 CNY; formal comparison delta is 6.5 CNY. The candidate reports `appliedOverrides.rotorProcessMode`, `cost.rotorProcess`, `COMPARABLE`, and the setting in `sourceVersions`. Recipe data and inventory stay unchanged.

## Targeted Agent evidence

Three fresh isolated-runtime D1-07 runs completed successfully. Each has an `APPLIED`/`COMPARABLE` formal scenario receipt with `rotorProcessMode` applied, a formally sourced candidate and delta, and no write. The controlled fixture's configured price is 6 CNY, producing its formal 224 → 230 CNY candidate transition and 6 CNY delta.

The requested protection samples also completed: D1-06 ×2 and D1-08 ×2. One additional D1-06 diagnostic run, started independently while the specified protection sequence was still running, did not load the scenario tool and safely returned `UNAVAILABLE`; it is retained as an exploratory model-selection failure and is not represented as a passing sample or an unsafe completion.

## Compatibility and safety

The formal capability remains `recipes.scenario_compare_preview`; no single-purpose capability was added. API Index exposure stays 31 entries. Its fingerprint and the Scenario schema fingerprint change because the canonical schema and description correctly changed. Float, cable, packing, coil, and surface-treatment scenario regressions pass. Preview produces no Recipe write, inventory mutation, operation, or audit record.

The formal outcome/delivery safeguards from D1-R4 remain intact. They will still close future truly unsupported configuration requests; D1-07 no longer falls into that path because this configuration is now formally representable and applied.

## Validation

The focused deterministic suite covering formal schema-to-adapter compatibility, policy validation, current-cost rebuilding, scenario route integration, setting failures, no-write behavior, and legacy cost-query compatibility passed 56 tests. The full repository test rerun passed 2281/2281. The first full run exposed two fixture/guard assumptions, both corrected before the authoritative rerun: a legacy cost-query fixture now provides the formally required setting, and the A3 historical guard explicitly recognizes this later reviewed schema extension. API contract verification (29/29), deep API smoke (486/486), lint, build, AI architecture acceptance (9/9), and the assistant release gate all pass.

See [cost authority evidence](./M5-D1-R5A-Rotor-Process-Cost-Authority.json) and [contract evidence](./M5-D1-R5A-Rotor-Process-Contract.json).
