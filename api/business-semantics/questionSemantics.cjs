'use strict';

function parseCoilShorthand(text) {
    const match = String(text || '').match(/(?:^|[^\d])(\d{1,3})\s*[-－]\s*(\d{2,4})(?:[^\d]|$)/u);
    return match ? { spec: match[1], sheets: Number(match[2]) } : null;
}

function parseUserNumber(text, label) {
    const match = String(text || '').match(new RegExp(`${label}[^\\d]{0,8}(\\d+(?:\\.\\d+)?)`, 'u'));
    return match ? Number(match[1]) : null;
}

function extractAliasMention(text) {
    return String(text || '')
        .replace(/^(?:请问|麻烦|帮我|请)?(?:查一下|查查|查询)?\s*/u, '')
        .replace(/(?:现在|当前)?的?(?:正式|当前)?名称(?:是什么|是哪个)?[?？。]*$/u, '')
        .replace(/(?:的)?(?:当前|现在)?(?:完整|整机)?(?:单位)?(?:成本|价格|多少钱|库存|有货|缺货|没货).*$/u, '')
        .trim();
}

function extractRequestedTarget(text) {
    return extractAliasMention(String(text || '')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' '))
        .replace(/[，。！？,.!?：:；;]+$/gu, '')
        .trim()
        .slice(0, 80);
}

function catalogAdmissionSignals(userText) {
    const text = String(userText || '').trim();
    if (!text) return [];
    const signals = [];
    if (/\bV\d+[\p{L}\p{N}_\-]*/iu.test(text)) signals.push('RECIPE_IDENTIFIER');
    if (parseCoilShorthand(text)) signals.push('COIL_SHORTHAND');
    if (/\b[A-Z]+\d[A-Z0-9]*(?:[-－][\p{L}\p{N}]+)+/iu.test(text)) signals.push('BUSINESS_IDENTIFIER');
    if (/(?:轴承|油封|电容|电缆|浮球|螺丝|叶轮|泵壳)[\s_\-－]*[\p{L}\p{N}]+/iu.test(text)) signals.push('CATALOG_IDENTIFIER');
    if (/(?:配方|线圈方案|零件|配件|泵壳模板)/u.test(text)) signals.push('SUPPORTED_RESOURCE_TERM');
    if (/(?:型号|目录|方案)/u.test(text) && /[\p{L}\p{N}][\p{L}\p{N}_\-－]{1,}/u.test(text)) signals.push('STRUCTURED_CATALOG_TERM');
    if (/(?:旧名|曾用名|历史名称|(?:^|\s)老[\p{L}\p{N}_\-－]{2,})/u.test(text)) signals.push('FORMAL_ALIAS_REFERENCE');
    if (/(?:找|查|查询|查看|看看|看一下|搜索|搜一下|是什么型号|有哪些方案|哪些方案)/u.test(text)) signals.push('LOOKUP_OPERATION');
    if (/(?:这个|该|当前|这些)(?:配方|线圈方案|零件|配件|泵壳模板)/u.test(text)) signals.push('EXPLICIT_RESOURCE_REFERENCE');
    return [...new Set(signals)];
}

function positivelyAdmittedBusinessRequest(text) {
    const signals = catalogAdmissionSignals(text);
    const genericKnowledge = /(?:工作原理|基本原理|原理是什么|科普|讲讲|介绍一下|怎么工作|如何工作)/u.test(text);
    if (genericKnowledge) return { admitted: false, signals };
    const hasIdentity = signals.some(item => ['RECIPE_IDENTIFIER', 'COIL_SHORTHAND', 'BUSINESS_IDENTIFIER',
        'CATALOG_IDENTIFIER', 'STRUCTURED_CATALOG_TERM', 'FORMAL_ALIAS_REFERENCE'].includes(item));
    const hasResourceLookup = signals.includes('SUPPORTED_RESOURCE_TERM')
        && (signals.includes('LOOKUP_OPERATION') || signals.includes('EXPLICIT_RESOURCE_REFERENCE'));
    return { admitted: hasIdentity || hasResourceLookup, signals };
}

function classifyQuestion(userText, options = {}) {
    const text = String(userText || '').trim();
    const coil = parseCoilShorthand(text);
    const inventory = /库存|有货|缺货|没货/u.test(text);
    const configurationOverride = /换成|换为|替换|线圈(?:改|换|用)|改用/u.test(text)
        || Boolean(coil && /(?:改成|改为)[^,，。？?]{0,32}(?:\d{1,3}\s*[-－]\s*\d{2,4}|线圈|正式方案|测试方案|钢带|冷轧|小眼|国标眼|大眼|小槽|大槽|圆槽)/u.test(text));
    const hypothetical = /假如|假设|如果|按照|按(?:铜价|线重)/u.test(text);
    const cost = /成本|价格|多少钱|重新算|核算/u.test(text);
    const hypotheticalCopperPrice = parseUserNumber(text, '铜价');
    const copperBasisRequested = /铜价/u.test(text) && hypotheticalCopperPrice == null
        && /(?:当前|现在|系统|正式|基准|采用|使用|多少|什么)/u.test(text);
    const aliasConcern = /老|旧名|曾用名|历史名称/u.test(text);
    const requestedVariantScope = /所有方案|全部方案|所有线圈|全部线圈/u.test(text)
        ? 'ALL_ACTIVE' : /测试方案|测试线圈|\btesting\b/iu.test(text) ? 'TESTING' : 'OFFICIAL';
    const admission = positivelyAdmittedBusinessRequest(text);
    const admitted = admission.admitted || copperBasisRequested || options.admittedCatalogLookup === true;
    let kind = 'OUT_OF_SCOPE', operation = 'NONE';
    if (admitted && inventory) { kind = 'INVENTORY_QUERY'; operation = 'READ_INVENTORY'; }
    else if (admitted && configurationOverride) { kind = 'CONFIGURATION_OVERRIDE'; operation = /算|成本|价格/u.test(text) ? 'PREVIEW_CONFIGURATION_COST' : 'DESCRIBE_CONFIGURATION'; }
    else if (admitted && hypothetical && cost) { kind = 'HYPOTHETICAL_COST_QUERY'; operation = 'READ_OR_PREVIEW_COST'; }
    else if (admitted && copperBasisRequested && !cost) { kind = 'COST_QUERY'; operation = 'READ_COPPER_PRICE'; }
    else if (admitted && cost) { kind = 'COST_QUERY'; operation = 'READ_COST'; }
    else if (admitted) { kind = 'CATALOG_LOOKUP'; operation = 'LOOKUP'; }
    const requestedType = aliasConcern ? 'recipe'
        : coil && !/V\d+/iu.test(text) ? 'coil' : /V\d+/iu.test(text) ? 'recipe' : 'unknown';
    return {
        kind,
        operation,
        requestedType,
        requestedIdentity: {
            token: (aliasConcern ? extractAliasMention(text) : '') || text.match(/V\d+/iu)?.[0]
                || (coil ? `${coil.spec}-${coil.sheets}` : '') || extractRequestedTarget(text),
            ...(coil || {}),
            aliasConcern,
        },
        requestedPriceContext: /铜价/u.test(text) && hypothetical ? 'USER_HYPOTHETICAL_PRICE' : 'CURRENT_FORMAL_PRICE',
        hypotheticalCopperPrice,
        copperBasisRequested,
        wireWeight: parseUserNumber(text, '线重'),
        configurationOverride,
        requestedVariantScope,
        admissionSignals: admission.signals,
    };
}

module.exports = { catalogAdmissionSignals, classifyQuestion, extractAliasMention, extractRequestedTarget,
    parseCoilShorthand, parseUserNumber, positivelyAdmittedBusinessRequest };
