'use strict';
/**
 * ONT-P7 HTTP runtime corpus.
 *
 * Validated through the real `POST /api/ai/chat` SSE entry point. Each positive case is a two-turn
 * conversation because the canary can only bind from server-owned verified receipts already present in
 * the same assistant session: the seed turn establishes the canonical receipt, the question turn is the
 * relation request whose routing OFF/ON is compared.
 *
 * The frozen P6 28-case corpus stays the regression corpus; this one is deliberately expressed in
 * ordinary owner language and exercised over HTTP.
 */
// The seed turn only exists to establish a canonical receipt in the server-owned session, so it must
// be answerable from the formal catalogue (spec / scheme-code / recipe name). The question turn is the
// relation request under test and is left exactly as an owner would phrase it.
const positives = [
    { caseId: 'http-coil-explicit', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '12-120 线圈已登记哪些正式方案？', question: '12-120线圈用在哪些配方？' },
    { caseId: 'http-coil-name', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '12-120 线圈的规格、片数、材质和槽眼分别是什么？', question: 'Shadow线圈甲装在哪些产品里？' },
    { caseId: 'http-coil-short', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '12-120 线圈的槽眼和材质分别是什么？', question: '12-120线圈被哪些配方使用？' },
    { caseId: 'http-coil-scheme-code', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '查询线圈方案编码 SHADOW-501 的档案信息', question: '线圈ID 501被哪些配方使用？' },
    { caseId: 'http-coil-pronoun', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '12-120 线圈有哪些方案？', question: '这个线圈用在哪些配方？' },
    { caseId: 'http-coil-boss', rootEntityType: 'coil', expectedRelationId: 'coil.used_by_recipe', expectedTargets: ['301'],
      seed: '12-120 线圈的方案编码和方案状态是什么？', question: 'Shadow线圈甲都用在哪几个配方上？' },
    { caseId: 'http-recipe-winding', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲的配件明细有哪些？', question: '配方ID 301配的什么绕组？' },
    { caseId: 'http-recipe-name', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲的配件明细有哪些？', question: 'Shadow配方甲使用哪个线圈？' },
    { caseId: 'http-recipe-boss', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲用了哪个泵壳模板？', question: 'Shadow配方甲的绕组是什么？' },
    { caseId: 'http-recipe-pronoun', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲用了哪个泵壳模板？', question: '这个配方使用哪个线圈？' },
    { caseId: 'http-recipe-part', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲的配件明细有哪些？', question: 'Shadow配方甲配的线圈是哪个？' },
    { caseId: 'http-recipe-template', rootEntityType: 'recipe', expectedRelationId: 'recipe.uses_coil', expectedTargets: ['501'],
      seed: 'Shadow配方甲用了哪个泵壳模板？', question: 'Shadow配方甲的线圈是哪一只？' },
];

const negatives = [
    { caseId: 'http-neg-coil-cost', reason: 'cost query is not a relation query', question: '12-120线圈成本多少？' },
    { caseId: 'http-neg-coil-stock', reason: 'inventory query', question: '12-120线圈库存多少？' },
    { caseId: 'http-neg-coil-compare', reason: 'comparison', question: '比较12-120线圈和13-120线圈成本' },
    { caseId: 'http-neg-recipe-cost', reason: 'cost query', question: 'Shadow配方甲成本是多少？' },
    { caseId: 'http-neg-write-coil', reason: 'write request', question: '把12-120线圈的库存改成100' },
    { caseId: 'http-neg-write-recipe', reason: 'write request', question: '修改Shadow配方甲使用的线圈' },
    { caseId: 'http-neg-similar', reason: 'similarity, not a formal relation', question: '和Shadow线圈甲类似的线圈有哪些？' },
    { caseId: 'http-neg-semantic', reason: 'vague semantic association', question: 'Shadow线圈甲相关的配方有哪些？' },
    { caseId: 'http-neg-two-coils', reason: 'ambiguous root', question: '12-120线圈和13-120线圈用在哪些配方？' },
    { caseId: 'http-neg-two-recipes', reason: 'ambiguous root', question: 'Shadow配方甲和Shadow空配方使用哪些线圈？' },
    { caseId: 'http-neg-ambiguous-root', reason: 'ambiguous canonical root', question: 'Shadow歧义配方使用哪个线圈？' },
    { caseId: 'http-neg-unsupported-relation', reason: 'recipe→part is outside the promoted family', question: 'Shadow配方甲用了哪些零件？' },
];

/** Post-write style requests must never be canary-routed even when the text looks relational. */
const writeLookalikes = [
    '把Shadow配方甲的线圈换成13-120',
    '新增一条12-120线圈的配方关联',
];

/**
 * Canonical display aliases for the expected targets, so an answer that names the entity is recognised
 * as identifying it just as a bare numeric id would be.
 */
const targetAliases = {
    '301': ['Shadow配方甲'],
    '501': ['Shadow线圈甲', 'SHADOW-501'],
};

module.exports = { positives, negatives, writeLookalikes, targetAliases };
