# L5OffCompatibilityV1

> **已退役（NATIVE-HC2）**：本文描述的 Legacy AI 编排组件已从仓库物理删除，生产 AI 为 Native-only。本文仅作历史记录保留；请勿据此启用旧运行时或旧开关。


## Scope

This contract repairs only the L5-P3 default-OFF canonical recipe identity regression. It does not make the current full-cost preview available and does not add cost arithmetic, ontology relations, fuzzy identity, aliases, or provider rounds.

## Root-cause audit

The exact production failure question was compared on the same read-only production-shaped database with `3a230b1` and `f85aac9`.

The first provider tool proposal and first formal result were equivalent in both runs:

- the model appended `当前完整` to the formal recipe name;
- the resulting recipe-cost read returned a verified `AI_RESOURCE_NOT_FOUND` for that malformed model-derived argument.

The first observed state divergence occurred on the next provider decision:

- pre-L5 continued with a bounded `get_all_recipes(keyword=V550)` read and recovered canonical recipe ID 12;
- the L5 candidate accepted a final false-not-found answer.

No enabled Impact path caused this query: both Impact flags were false, Impact eligibility was false, and projection calls were zero. The defective runtime contract was that a verified miss for a model-derived argument could become the final identity conclusion without reconciling an exact complete formal current-name span already present in the user's question.

## Repair

For a non-impact recipe cost query containing a complete descriptor beyond its structured key, the runtime performs one bounded formal `get_all_recipes` keyword read before model synthesis. Identity is accepted only when:

- the result has verified execution evidence;
- the query receipt is authoritative and complete;
- exactly one positive canonical ID has its full persisted current name present character-for-character in the user text.

Blank `recipe.spec` does not invalidate that exact current-name route. Structured-key descriptor matching remains a separate contract. Zero or multiple exact current-name candidates fail closed. The repair does not use fuzzy matching, first-result selection, substring candidates, embeddings, or LLM identity authority.

If the model still claims the unique verified canonical recipe is missing, the answer boundary replaces that claim. When current full-cost evidence is unavailable, a saved amount may appear only as a saved/historical snapshot.

## Frozen compatibility suite

- Version: `L5OffCompatibilityV1`
- Fixture: `tests/fixtures/l5-off-compatibility-v1.json`
- Fixture SHA-256: `76e2f31869c434f08f68c88592f3ebb7f8626638dd10ee5e192d50a49c4e305d`
- Frozen production failure wording: `V550大脚板-2寸-经典款当前完整成本是多少`
- Synthetic recipe ID: 501
- Cases: OC-01 through OC-08

The runtime integration test proves the compatibility read executes before the model, the blank-spec recipe remains canonical, a false-not-found answer is blocked, the saved cost is labelled historical, and Impact projection calls remain zero.

## Explicitly deferred

Current full-cost preview availability is a pre-existing L1-L4 capability gap. L5-P3R records it but does not change the preview service, cost engine, API, or cost formula.
