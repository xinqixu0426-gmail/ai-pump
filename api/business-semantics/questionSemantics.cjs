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
        .replace(/(?:的)?(?:当前|现在)?(?:完整|整机)?(?:成本|价格|多少钱|库存|有货|缺货|没货).*$/u, '')
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

function classifyQuestion(userText) {
    const text = String(userText || '').trim();
    const coil = parseCoilShorthand(text);
    const inventory = /库存|有货|缺货|没货/u.test(text);
    const configurationOverride = /换成|换为|替换|线圈(?:改|换|用)|改用/u.test(text);
    const hypothetical = /假如|假设|如果|按照|按(?:铜价|线重)/u.test(text);
    const cost = /成本|价格|多少钱|重新算|核算/u.test(text);
    const aliasConcern = /老|旧名|曾用名|历史名称/u.test(text);
    const requestedVariantScope = /所有方案|全部方案|所有线圈|全部线圈/u.test(text)
        ? 'ALL_ACTIVE' : /测试方案|测试线圈|\btesting\b/iu.test(text) ? 'TESTING' : 'OFFICIAL';
    let kind = 'OUT_OF_SCOPE', operation = 'NONE';
    if (inventory) { kind = 'INVENTORY_QUERY'; operation = 'READ_INVENTORY'; }
    else if (configurationOverride) { kind = 'CONFIGURATION_OVERRIDE'; operation = /算|成本|价格/u.test(text) ? 'PREVIEW_CONFIGURATION_COST' : 'DESCRIBE_CONFIGURATION'; }
    else if (hypothetical && cost) { kind = 'HYPOTHETICAL_COST_QUERY'; operation = 'READ_OR_PREVIEW_COST'; }
    else if (cost) { kind = 'COST_QUERY'; operation = 'READ_COST'; }
    else if (text) { kind = 'CATALOG_LOOKUP'; operation = 'LOOKUP'; }
    const requestedType = coil && !/V\d+/iu.test(text) ? 'coil' : /V\d+/iu.test(text) ? 'recipe' : 'unknown';
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
        hypotheticalCopperPrice: parseUserNumber(text, '铜价'),
        wireWeight: parseUserNumber(text, '线重'),
        configurationOverride,
        requestedVariantScope,
    };
}

module.exports = { classifyQuestion, extractAliasMention, extractRequestedTarget, parseCoilShorthand, parseUserNumber };
