'use strict';

const { IMPACT_ELIGIBILITY_VERSION } = require('./enforcementContract.cjs');

function result(eligible, reason, changeType = null, slice = null, unsupportedDomain = null) {
    return Object.freeze({ version: IMPACT_ELIGIBILITY_VERSION, eligible, reason,
        changeType, slice, unsupportedDomain });
}

function impactEligibility({ userText, semanticEligible = true } = {}) {
    const text = String(userText || '').trim();
    if (!semanticEligible || !text) return result(false, 'SEMANTIC_REQUEST_INELIGIBLE');
    const consequenceIntent = /(?:影响|变化|变动|涨价|降价|不足|换|改了|变更|自动变|跟着变|区别|差异|过期|作废|还能.*用|增加多少|提高多少)/u.test(text);
    if (!consequenceIntent) return result(false, 'NO_IMPACT_CONSEQUENCE_INTENT');

    if (/(?:供应商).*(?:影响).*(?:所有|哪些).*(?:订单|采购)/u.test(text)) {
        return result(true, 'UNSUPPORTED_IMPACT_DOMAIN', null, null, 'SUPPLIER_WIDE_CHAIN');
    }
    if (/(?:温升|电流|输入功率|铜耗|扬程|流量|泵曲线)/u.test(text)) {
        return result(true, 'UNSUPPORTED_IMPACT_DOMAIN', 'ENGINEERING_PREDICTION', null, 'ENGINEERING_PREDICTION');
    }
    if (/(?:测试|检测|性能).*(?:报告).*(?:还能|能否|直接用|有效|作废|失效)/u.test(text)) {
        return result(true, 'SUPPORTED_BOUNDARY_ONLY', 'TEST_REPORT_VALIDITY', null, 'REPORT_APPLICABILITY');
    }
    if (/(?:报价).*(?:过期|有效|失效|作废)/u.test(text)) {
        return result(true, 'SUPPORTED_BOUNDARY_ONLY', 'QUOTATION_FRESHNESS', null, 'QUOTATION_FRESHNESS');
    }
    if (/(?:当时|之前|已有|历史|这个订单).*(?:配置|配方).*(?:区别|差异|现在)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'ORDER_CONFIGURATION_COMPARE', 'IP-02_RECIPE_SNAPSHOT_COMPARISON');
    }
    if (/(?:涨价|降价|价格变化|价格变动)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'PART_PRICE_CHANGE', 'IP-05_PART_PRICE_RECIPES');
    }
    if (/(?:库存不足|库存变化|库存变动|库存少了)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'PART_INVENTORY_CHANGE', 'IP-03_INVENTORY_READINESS');
    }
    if (/(?:模板).*(?:变更|修改|改了|变化).*(?:影响)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'TEMPLATE_CHANGE', 'IP-04_TEMPLATE_RECIPES');
    }
    if (/(?:自动变|自动更新|跟着变)/u.test(text) && /(?:订单)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'RECIPE_CONFIGURATION_CHANGE', 'IP-01_CONFIGURATION_CHANGE');
    }
    if (/(?:换|配置变更|改了配置|改配方|配方变更).*(?:影响|还影响|除了)/u.test(text)) {
        return result(true, 'SUPPORTED_IMPACT_SLICE', 'RECIPE_CONFIGURATION_CHANGE', 'IP-01_CONFIGURATION_CHANGE');
    }
    return result(false, 'UNSUPPORTED_OR_NON_IMPACT_WORDING');
}

module.exports = { impactEligibility };
