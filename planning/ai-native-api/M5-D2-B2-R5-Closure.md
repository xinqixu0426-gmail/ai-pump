# D2-B2-R5 Closure — Supervisor Decision Required

Status: `SUPERVISOR_DECISION_REQUIRED`.

R5 successfully added the mechanical declared-relevant-tool gate and normalized operational evidence across direct and embedded formal producers. All deterministic and repository pre-model gates passed. The implementation is frozen at `45a88c8ad62215c0a68c8a35c3f78c1a8a56c708`; no product or harness behavior was changed after model samples began.

## Facts

- W1-06: 4/5 semantic pass. Four runs had full declared coverage and correct shortage/procurement evidence. The fifth added `preview_virtual_readiness`, included an unrelated 5-unit hypothetical result, then failed validation and fell back to `UNAVAILABLE`.
- Shortage-only: failed. The Main Agent declared and executed order-detail, knowledge-package, purchase-overview, and virtual-readiness capabilities in addition to readiness, then returned a mixed-scope PARTIAL answer.
- Order-products-only: passed. It declared and executed only `get_order_detail`.
- Pending-purchase-only: failed. It executed only `get_purchase_overview`, but without `pendingOnly=true`; the answer nevertheless represented the unfiltered complete set as all pending tasks.
- No isolated-fixture database changed; write executions were zero; secret scan passed for every R5 staging artifact.

## Decision required

The owner requirement says relevant APIs must be identified by Main LLM, yet the fresh samples show the agent's relevance declarations are both over-inclusive and semantically insufficient for a filtered-purchase request. A mechanical “execute what was loaded” gate cannot resolve this distinction.

### Options

1. Define a product-level relevance contract for capability *dimensions* and filtered collections, then have Main Agent explicitly justify declarations against those dimensions. This retains one Main LLM and no router, but changes the native planning/finalization contract.
2. Treat a sufficiently authoritative aggregate capability (for example the formal order knowledge package) as satisfying specific sub-dimensions, with explicit formal scope rules. This reduces duplicate calls but requires Owner/Supervisor decisions about authority overlap.
3. Permit a dedicated relevance adjudicator or structured planner. This is architecturally clearer but conflicts with the current no-extra-model/no-planner constraint and therefore requires explicit approval.

Recommendation: choose option 1 only after Supervisor and Owner define the business boundary for “necessary current cross-context” versus “unrelated domain data,” including whether “all pending” must always map to `pendingOnly=true`. Do not add a tool-name-specific chain or prompt blacklist.

## Next status

`READY_FOR_D2_B2_FULL_RERUN: NO` until that policy decision is made and implemented in a subsequent phase. D2 Wave 1 is not complete.
