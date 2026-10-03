# M5 D1-R3 Evidence Fidelity & Task Completion

Status: **REWORK**. Source commit for the final controlled baseline: `91fd54be9967f113d6ed8181235c9aa908394e62`.

## D1-04 evidence audit

The isolated formal `GET /api/coils` result contains a record-local `cost`: `12-120-A` is 66 and `12-120-B` is 71, both with `pricingMode: kit`. It does not contain `totalCost` or `unitCost`; `unitPrice` is a pricing parameter, not a completed scheme cost. The original loss was at the Candidate fact-catalog boundary: generic array traversal produced unbound fields and the catalog did not expose ordinary `cost` as a claimable cost fact.

R3 adds a candidate opt-in `coil_directory_cost` projection. It binds every formal list record to its own coil identity, preserves `FORMAL_COIL_DIRECTORY_COST` and `pricingMode`, and marks only the contract's `cost` field as `CURRENT_FORMAL`. Equal values are not deduplicated across entities. The formal coil calculation route also projects its authoritative `totalCost` as a distinct `FORMAL_COIL_COST_CALCULATION` fact. No ledger arithmetic was added.

## Completion closure

A no-tool investigation response is now a candidate answer, followed by one same-conversation, budgeted completion review with already-loaded tools still available. It is not a router and does not name tools, cases, or tool order. Finalization remains tool-free and retains its two-call validation-repair budget.

## Validator correction

Recipe differences keep two formal participants. Scenario differences are instead bound to one entity plus formal base/candidate scenario keys; they no longer incorrectly require two recipe participants. This preserved wrong-pair protection for recipe comparisons while allowing a valid scenario delta.

## Final controlled result

The final fresh ten-case run was executed against the temporary fixture database through the real Executor and formal HTTP routes. It produced 8/10 semantic pass. D1-04 completed with two separately cited formal coil costs. D1-06 and D1-07 remained model/finalization reliability failures in this fresh run, so no historical targeted success was merged into the baseline.

The real-catalog suite and full repository gates were not run after this final controlled REWORK result. They are explicitly recorded as not run rather than reported as green.

## Safety

The controlled fixture is isolated and does not access a local or production business database. The candidate tool surface remains read/preview-only; no write execution was observed. Existing deterministic regressions continue to reject wrong entity, wrong money role, unsupported no-op scenario deltas, and loaded write tools.

## Recommendation

The evidence-fidelity fixes are valid and D1-04 now closes. Do not advance to D2: investigate the remaining finalization/model reliability for D1-06 and the unsupported-capability delivery path for D1-07 using the retained final traces, then repeat the full controlled/repetition/real-catalog matrix on one frozen source manifest.
