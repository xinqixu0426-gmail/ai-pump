'use strict';

function exact(mention, entityType, canonicalId, canonicalName) {
    return Object.freeze({ mention, entityType, status: 'EXACT', canonicalId, canonicalName, candidates: Object.freeze([{ canonicalId, canonicalName }]), source: 'FROZEN_GROUNDING_V1_FIXTURE' });
}
function multiple(mention, entityType, candidates) {
    return Object.freeze({ mention, entityType, status: 'MULTIPLE', canonicalId: null, canonicalName: null, candidates: Object.freeze(candidates), source: 'FROZEN_GROUNDING_V1_FIXTURE' });
}

const recipeGeneric = multiple('V750', 'recipe', [
    { canonicalId: 11, canonicalName: 'V750-通用款' },
    { canonicalId: 12, canonicalName: 'V750-豪贝款' },
]);
const coilGeneric = multiple('12-120', 'coil', [
    { canonicalId: 1, canonicalName: '12-120 普通小眼' },
    { canonicalId: 2, canonicalName: '12-120 加强大眼' },
]);

function fixture({ groundingResult = 'EXACT', targets = [], ambiguity = 'NONE', candidateSetComplete = 'UNKNOWN', businessMemo, policyMemo } = {}) {
    return Object.freeze({
        groundingResult,
        finalGroundedTargets: Object.freeze(targets),
        groundingAmbiguity: ambiguity,
        candidateSetComplete,
        businessMemo: businessMemo || '业务模型说明：Template 是可复用结构；Recipe 是具体产品配置。木箱、浮球、电泳、不锈钢接轴和电缆长度属于可配置成本/工艺描述，不是顶层正式实体。',
        policyMemo: policyMemo || '规则：多候选不得静默选择；未明确保存时仅允许临时读取或试算；正式写入必须受到保护。',
    });
}

const UPSTREAM_FIXTURES = Object.freeze({
    CONCEPT: fixture({ groundingResult: 'NOT_REQUIRED', targets: [] }),
    TEMPLATE: fixture({ targets: [exact('通用款模板', 'template', 21, '通用款模板')] }),
    V750_GENERIC: fixture({ groundingResult: 'MULTIPLE', targets: [recipeGeneric], ambiguity: 'V750 has multiple recipe candidates' }),
    V750_GENERIC_NO_AMBIGUITY: fixture({ targets: [recipeGeneric] }),
    V750_GENERIC_QUALIFIED: fixture({ targets: [exact('V750通用款', 'recipe', 11, 'V750-通用款')] }),
    V110: fixture({ targets: [exact('V110', 'recipe', 14, 'V110-通用款')] }),
    COIL_GENERIC: fixture({ groundingResult: 'MULTIPLE', targets: [coilGeneric], ambiguity: '12-120 has multiple coil candidates', candidateSetComplete: 'YES' }),
    COIL_A: fixture({ targets: [exact('12-120-A', 'coil', 1, '12-120 普通小眼')] }),
    COIL_130_A: fixture({ targets: [exact('12-130-A', 'coil', 3, '12-130 普通小眼')] }),
    UNRESOLVED: fixture({ groundingResult: 'UNRESOLVED', targets: [], ambiguity: 'unresolved owner reference' }),
    QUALIFIED_STYLES: fixture({ targets: [
        exact('V750通用款', 'recipe', 11, 'V750-通用款'),
        exact('V750豪贝款', 'recipe', 12, 'V750-豪贝款'),
    ] }),
});

module.exports = { UPSTREAM_FIXTURES, exact, multiple };
