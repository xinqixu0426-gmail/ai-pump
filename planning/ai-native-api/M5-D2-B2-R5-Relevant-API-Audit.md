# D2-B2-R5 Relevant API Audit

## Current behavior before R5

The candidate prompt and completion review previously rewarded stopping whenever existing formal evidence appeared sufficient. Tool descriptions for order detail, order knowledge package, readiness, and readiness actions also contained wording that could be read as excluding other tools. The valid part of that policy was avoiding repeat calls to an already successful identical query. The invalid part was allowing one tool to suppress investigation of a second owner-requested business dimension.

## R5 implementation audit

The Main Agent remains the sole relevance selector. The runtime adds no intent model, router, slots, regex routing, or tool-name-specific chain. `load_tools` now declares each loaded read/preview business capability relevant. Runtime records required, executed, failed, and blocked declared tools; a no-tool response with a missing declared tool receives `RELEVANT_API_COVERAGE_INCOMPLETE` and continues the same conversation.

The order tool descriptions now preserve their individual authority while saying that other directly requested business dimensions remain selectable from the API Index. The narrow registry gate accepts only the reviewed R3/R5 description deltas and still rejects every other `api/routes/ai/tools.cjs` drift.

## Formal producer audit

`check_order_readiness.shortages[].procurementStage` was already a formal producer field but was only a quantity qualifier. R5 copies it to canonical `purchase_status`; it does not derive stage from quantities. `get_order_knowledge_package.data.readiness` now shares the direct readiness projector, and its `data.order` shares the direct order-detail projector. Source provenance and scope remain in the ledger; model projection removes internal numeric scope keys.

## Semantic result and decision boundary

Mechanical declared-tool completion worked in all eight samples. It did not ensure that the Main Agent's declared set itself was relevant:

- W1-06 was 4/5. One run treated unrelated virtual readiness as relevant, overanswered, then lost a deliverable answer after a goal-cardinality repair failure.
- A shortage-only request expanded to order/purchase/virtual-readiness calls and was downgraded to PARTIAL despite a direct formal shortage result.
- The order-products-only request correctly used only order detail.
- The pending-purchase request called unfiltered purchase overview and reported it as a pending-only complete set.

This is a product-policy decision, not a safe candidate for another local prompt patch: enforcing the desired relevance set would require either a product-level definition that distinguishes necessary current cross-context from unrelated domain calls, or a deliberate change to how Main Agent declares relevance. R5 stops here without a router or case-specific chain.
