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
    // 非 V 前缀的正式名称（例如「Shadow配方甲」）此前无法进入业务分类：
    // 它既没有 V\d+ 也没有线圈简写，于是「Shadow配方甲成本多少？」被判成 OUT_OF_SCOPE。
    // 这里补一条**业务词共现**判据：明确资源词 + 金额或库存词 + 同句中的具体名称标识。
    // 不是关键词意图识别 —— 判据是「已解析出的业务资源 + 名称标识」的结构共现，
    // 且只在资源词已经出现时生效，避免把任意含数字的句子收进来。
    const namedResourceRequest = /(?:配方|线圈方案|零件|配件|泵壳模板)/u.test(text)
        && /(?:成本|价格|多少钱|库存|有货|缺货|没货|核算)/u.test(text)
        && /[\p{L}\p{N}][\p{L}\p{N}_\-－]{1,}/u.test(text);
    if (namedResourceRequest) signals.push('NAMED_RESOURCE_MONETARY_REQUEST');
    const hasIdentity = signals.some(item => ['RECIPE_IDENTIFIER', 'COIL_SHORTHAND', 'BUSINESS_IDENTIFIER',
        'CATALOG_IDENTIFIER', 'STRUCTURED_CATALOG_TERM', 'FORMAL_ALIAS_REFERENCE',
        'NAMED_RESOURCE_MONETARY_REQUEST'].includes(item));
    const hasResourceLookup = signals.includes('SUPPORTED_RESOURCE_TERM')
        && (signals.includes('LOOKUP_OPERATION') || signals.includes('EXPLICIT_RESOURCE_REFERENCE'));
    return { admitted: hasIdentity || hasResourceLookup, signals };
}

// ── E1-B：成本比较语义族 ─────────────────────────────────────────────
// 「A和B成本差多少」「这两个差多少钱」「A比B贵多少」「比较一下A和B成本」
// 「A和B哪个成本高，高多少」必须在语义层归一成同一个 COST_COMPARISON 目标，
// 由软件确定性规划正式 compare 能力 —— 不是五个 regex 补丁、也不交给模型决定。
// 判据：① 比较意图（差额/贵/便宜/比较/对比/哪个更…）② 金额口径词 ③ 至少两个可解析主体。
// S2-R1 §A2：成本时间口径是**显式契约**。只有用户明确问保存/历史/上次/当时成本时才用保存快照；
// 其余（现在/当前/目前/默认）一律要求当前重算权威，禁止互相冒充。
const SAVED_COST_INTENT = /(?:保存(?:的)?成本|历史(?:保存)?成本|上次成本|当时成本|之前(?:的)?成本|旧(?:的)?成本|快照成本)/u;
const COMPARISON_INTENT = /(?:差(?:多少|价|额|了)?|贵多少|便宜多少|高多少|低多少|哪个[^，。？?]{0,12}(?:高|低|贵|便宜)|比较|对比)/u;
const COMPARISON_MONEY = /(?:成本|价格|单价|多少钱|金额|报价|贵|便宜)/u;
// `比` 只有在不是「比较 / 比如」的一部分时才是分隔符。
// `比` 只有在不是「比较 / 比如 / 对比」的一部分时才是分隔符。
const COMPARISON_CONNECTIVE = /\s*(?:和|与|跟|以及|、|,|，|(?<!对)比(?!较|如)|VS|vs)\s*/u;
const SUBJECT_NOISE = /(?:比较|对比|一下|看看|帮我|请|成本|价格|单价|多少钱|金额|报价|差多少|差价|差额|差|哪个|哪一个|哪一款|高多少|低多少|贵多少|便宜多少|高|低|贵|便宜|是|为|分别是|分别|各自|大概|大约|多少|钱|呢|吗|的|了|这两个|那这两个)/gu;

/** 把一句比较问法拆成两个可解析主体；不足两个（或含线圈简写）时返回空数组。 */
function parseComparisonSubjects(text) {
    const source = String(text || '');
    if (!COMPARISON_INTENT.test(source) || !COMPARISON_MONEY.test(source)) return [];
    const subjects = [...new Set(source.split(COMPARISON_CONNECTIVE)
        .map(part => part.replace(SUBJECT_NOISE, ' ').replace(/[?？。.!！,，、;；:：]/gu, ' ').replace(/\s+/gu, ' ').trim())
        .filter(Boolean))];
    if (subjects.length < 2) return [];
    const pair = subjects.slice(0, 2);
    // 线圈域主体（简写、带「线圈/绕组」等）由既有的线圈对比通道负责；
    // 这里只规划**配方级** compare_recipes，避免把线圈比较误路由到配方比较。
    if (pair.some(subject => /^\d{1,3}\s*[-－]\s*\d{2,4}$/u.test(subject)
        || /线圈|绕组|线径|钢带|冷轧|小眼|国标眼|大眼/u.test(subject)
        || Boolean(parseCoilShorthand(subject)))) return [];
    return pair;
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
    const comparisonSubjects = parseComparisonSubjects(text);
    let kind = 'OUT_OF_SCOPE', operation = 'NONE';
    if (admitted && comparisonSubjects.length === 2) { kind = 'COST_COMPARISON'; operation = 'COMPARE_COST'; }
    else if (admitted && inventory) { kind = 'INVENTORY_QUERY'; operation = 'READ_INVENTORY'; }
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
        requestedCostTemporality: SAVED_COST_INTENT.test(text) ? 'SAVED' : 'CURRENT',
        hypotheticalCopperPrice,
        copperBasisRequested,
        wireWeight: parseUserNumber(text, '线重'),
        configurationOverride,
        requestedVariantScope,
        comparisonSubjects,
        admissionSignals: admission.signals,
    };
}

module.exports = { catalogAdmissionSignals, classifyQuestion, extractAliasMention, extractRequestedTarget,
    parseCoilShorthand, parseUserNumber, positivelyAdmittedBusinessRequest, parseComparisonSubjects };
