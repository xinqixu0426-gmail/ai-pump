'use strict';

const { IMPACT_ANSWER_BOUNDARY_VERSION } = require('./enforcementContract.cjs');

function names(bundle, entityType) {
    return [...new Set(bundle.verifiedImpacts.filter(item => !entityType || item.target.entityType === entityType)
        .map(item => item.target.displayName).filter(Boolean))];
}
function list(values) { return values.length ? values.join('、') : '无'; }
function verifiedCost(toolResults) {
    for (const item of toolResults || []) {
        if (!['preview_recipe_cost','full_calculate','build_recipe_bom_draft'].includes(item.name) || item.result?.success === false) continue;
        const data = item.result?.data || {};
        const candidates = [data.totalCost, data.currentTotalCost, data.costPreview?.currentTotalCost,
            data.recipeCost?.totalCost, data.draft?.totalCost];
        const value = candidates.map(Number).find(Number.isFinite);
        if (value !== undefined) return value.toFixed(2);
    }
    return null;
}
function boundaryFallback({ bundle, userText, toolResults, impactEligibility }) {
    const type = bundle.triggerSummary.changeType;
    const completeness = bundle.completeness;
    const recipes = names(bundle, 'recipe');
    const orders = names(bundle, 'order');
    const partial = completeness === 'PARTIAL' ? '当前结果触及读取上限，所列范围不完整。' : '';
    if (impactEligibility?.unsupportedDomain === 'SUPPLIER_WIDE_CHAIN') {
        return '当前没有可把某个供应商确定性关联到“所有受影响订单”的正式业务关系，因此不能给出权威影响清单。';
    }
    if (type === 'ENGINEERING_PREDICTION') {
        return '系统目前没有与该具体配置变化绑定的正式温升、扬程或性能测试/仿真依据，因此不能给出数值或变化方向。';
    }
    if (type === 'TEST_REPORT_VALIDITY') {
        return '现有测试报告没有配置指纹/配方版本绑定，换线圈后的报告适用性无法从当前正式证据证明；不能直接说仍有效或已作废，需要重新验证。';
    }
    if (type === 'QUOTATION_FRESHNESS') {
        return '现有报价与源配方 revision/成本口径时间没有完整绑定，因此只能建议复核，不能断言报价已过期或仍有效。';
    }
    if (type === 'PART_PRICE_CHANGE') {
        const downstream = /(?:报价|订单)/u.test(userText)
            ? '历史报价和订单保留当时快照；当前没有足够 revision 链证明它们已过期或已被改写。' : '';
        return `已验证需要重新核算当前成本的配方：${list(recipes)}。这是重算要求，不表示配方保存成本已自动改变。${downstream}${partial}`;
    }
    if (type === 'PART_INVENTORY_CHANGE') {
        return orders.length
            ? `已验证需要重新计算生产就绪状态的在手订单：${list(orders)}。库存变化不等于就绪结果已自动更新。${partial}`
            : '已在当前有界在手订单范围内核对，未找到使用该零件的受影响订单。';
    }
    if (type === 'TEMPLATE_CHANGE') {
        return `当前正式受影响配方：${list(recipes)}。${partial || '该集合在当前有界读取内完整。'}`;
    }
    if (type === 'ORDER_CONFIGURATION_COMPARE') {
        return `订单保留下单时配置快照，不会随当前配方自动改写。${recipes.length ? `已取得与当前配方 ${list(recipes)} 的正式对比条件。` : '完整差异仍需正式对比。'}`;
    }
    if (type === 'RECIPE_CONFIGURATION_CHANGE') {
        if (!bundle.triggerSummary.canonicalId) return '目标配置未唯一确定，可能有多套正式方案；需先确认材质/槽型或具体方案，不能默认选第一个。';
        const cost = verifiedCost(toolResults);
        return `${bundle.triggerSummary.mode === 'PROPOSED_CHANGE' ? '这是拟议线圈/配置变更，尚未写入；如果这样修改，会影响当前配方配置。' : '已核对当前线圈/配置变化。'}${cost ? `本轮已用正式成本能力重新计算成本：${cost} 元。` : '当前配方成本需按正式成本能力重新计算。'}${orders.length ? `已保存订单 ${list(orders)} 保留历史快照，不会自动改写。` : ''}${partial}`;
    }
    return '当前影响范围没有可输出的正式结论。';
}

function hasForbiddenClaim(answer, bundle) {
    const text = String(answer || '');
    if (bundle.forbiddenClaims.includes('MUST_NOT_CLAIM_PROPOSED_CHANGE_OCCURRED')
        && /(?:已经|已).*(?:修改|更换|变更|换成|改成|影响)/su.test(text)) return true;
    if (bundle.forbiddenClaims.includes('MUST_NOT_PREDICT_ENGINEERING_NUMBER')
        && /(?:温升|摄氏|℃|电流|扬程)[^\n。；]{0,18}-?\d+(?:\.\d+)?/u.test(text)) return true;
    if (bundle.forbiddenClaims.includes('MUST_NOT_CLAIM_SAVED_ORDER_CHANGED')
        && /订单.*(?:自动|已经).*(?:变更|更新|修改)/su.test(text)) return true;
    if (bundle.forbiddenClaims.includes('MUST_NOT_CLAIM_TEST_REPORT_INVALID')
        && /(?:报告|测试).*(?:已作废|已失效|仍有效|可直接用)/su.test(text)) return true;
    if (bundle.forbiddenClaims.includes('MUST_NOT_CLAIM_QUOTATION_STALE')
        && /报价.*(?:已过期|肯定过期|仍有效|确定有效)/su.test(text)) return true;
    if (bundle.forbiddenClaims.includes('MUST_NOT_CLAIM_RECIPE_COST_ALREADY_CHANGED')
        && /(?:配方|当前).*成本.*(?:已经|已).*(?:改变|变为|更新)/su.test(text)) return true;
    if (bundle.completeness === 'PARTIAL' && /(?:这些|以上).*(?:就是|包含).*(?:全部|所有)/su.test(text)) return true;
    return false;
}

function enforceImpactAnswerBoundary({ answer, bundle, userText, toolResults = [], impactEligibility } = {}) {
    if (!bundle && impactEligibility?.unsupportedDomain === 'SUPPLIER_WIDE_CHAIN') {
        const placeholder = { triggerSummary: { changeType: null }, verifiedImpacts: [], unresolved: [],
            completeness: 'UNSUPPORTED', answerObligations: [], forbiddenClaims: [] };
        return { version: IMPACT_ANSWER_BOUNDARY_VERSION,
            answer: boundaryFallback({ bundle: placeholder, userText: String(userText || ''), toolResults, impactEligibility }),
            replaced: true, fallbackType: 'UNSUPPORTED_IMPACT_DOMAIN', violations: [] };
    }
    if (!bundle) return { version: IMPACT_ANSWER_BOUNDARY_VERSION, answer: String(answer || ''),
        replaced: false, fallbackType: null, violations: [] };
    const unsafe = hasForbiddenClaim(answer, bundle);
    const fallback = boundaryFallback({ bundle, userText: String(userText || ''), toolResults, impactEligibility });
    return { version: IMPACT_ANSWER_BOUNDARY_VERSION, answer: fallback,
        replaced: true, fallbackType: unsafe ? 'UNSAFE_IMPACT_REPLACEMENT' : 'DETERMINISTIC_IMPACT_COMPLETENESS',
        violations: unsafe ? ['FORBIDDEN_IMPACT_CLAIM'] : [] };
}

module.exports = { enforceImpactAnswerBoundary, boundaryFallback, hasForbiddenClaim, verifiedCost };
