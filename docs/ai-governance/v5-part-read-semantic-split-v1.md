# Part read semantic split V1

P16-I-R4 changes local semantic identity only. It does not enable owner-default routing.

| Local class | Semantic identity | Semantic operation | Required fact | Existing execution projection |
| --- | --- | --- | --- | --- |
| tc_002 | part.inventory.read | read_inventory | inventory.quantity | catalog/read_inventory/part |
| tc_028 | part.price.read | read_price | price.current | catalog/read_inventory/part |
| tc_004 | existing coil read | read | coil.inventory | coil/read/coil |
| tc_024 | existing recipe cost preview | preview_cost | recipe.cost.preview | recipe/preview_cost/recipe |

The distinct semantic operation is catalog metadata, not a new Capability operation. Both part classes still project to the same `inventory.read` capability and unchanged `search_parts` schema/binder. No Capability, Tool, entity type, or factKey is added. The first 27 routing tuples and refs are preserved; `tc_028` is appended. Catalog structure remains V1, with an explicit `semanticSplitVersion=1` on the two revised part classes.

The existing local-intent stage selects the class. No extra classifier, model stage, retry, or budget is introduced. A previously singleton part catalog now has two choices, so such requests use the existing Stage2 slot instead of skipping it. Maximum Interpreter calls remains two; literal per-path call counts can therefore increase relative to a singleton baseline.

`requiredFactScope.cjs` accepts only the four registered class identities with matching valid domain, execution operation, and finalized entity type. It does not inspect raw request text or Tool results. Risk preflight stays before Interpreter; rejected risk never reaches derivation. Unknown or inconsistent semantics fail closed before execution.

Candidate and the explicit owner gateway accept an omitted `x-pump-v5-fact`. A supplied header is only an equality assertion: equal passes, mismatched fails closed before Tool/Answer. No client override or automatic owner admission exists. Historical in-process P16-C/D preview behavior is unchanged. Actual deployed P16-H binaries remain frozen unless separately replaced; source compatibility does not assert deployment.

Runtime values, answers, identities and credentials remain transient. Only selected class, derived fact, assertion status, counters, boolean verdicts and duration are recorded. Resolver/finalization/router/exposure/binder/evidence/composer/auth and Candidate lifecycle are unchanged.

Certification uses the original 15 requests and Oracle facts. The sole expected semantic revision is the three price paths from `tc_002` to `tc_028`; historical artifacts are not overwritten. Local certification must pass before any isolated Mac mini Candidate validation. Neither validation authorizes default routing or Legacy restart.
