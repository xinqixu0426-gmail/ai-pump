const SUPPORTED_COMMAND_DOMAINS = Object.freeze([
    ['catalog', /零件|配件|物料|库存|调价|单价|价格/],
    ['coil', /线圈|绕组|铜线/],
    ['recipe', /配方|物料清单|bom/i],
    ['order', /订单|采购|待办|客户要求|执行档案/],
    ['drawing', /转子|图纸|出图|打印/],
    ['file', /文件|附件|资料|归档/],
    ['knowledge', /知识库|工厂知识|业务规则/],
    ['quality', /候选规则|检查反馈|质量规则/],
    ['management', /工作流|处理步骤/],
]);

const COMMAND_ACTION = '(?:录入|新增|新建|创建|添加|修改|更新|改|删除|移除|调整|增加|减少|设置|保存|提交|生成|打印|归档|同步|审核|批准|驳回|恢复|确认|取消|关闭|完成|入库|出库|调价)';
const COMMAND_PREFIX = '(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|批量|重新|继续|立即|现在)?';
const EXPLICIT_COMMAND_RE = new RegExp(`^(?:(?:${COMMAND_PREFIX})${COMMAND_ACTION}|(?:请|麻烦|烦请|帮我|替我|给我)?(?:将|把).{1,80}${COMMAND_ACTION})`);
const NEGATED_COMMAND_RE = new RegExp(`(?:不要|不用|无需|别|禁止|暂不|先不|不需要|不想).{0,8}${COMMAND_ACTION}`);
const QUESTION_RE = /(?:吗|么|呢|嘛|是否|能否|能不能|可不可以|行不行|如何|怎么|怎样|为什么|什么(?:方式|方法|资料|参数)|有哪些)(?:[？?。！!])?$/;

function latestUserText(messages = []) {
    return [...messages].reverse().find(message => (
        message?.role === 'user' && typeof message.content === 'string'
    ))?.content?.trim() || '';
}

function normalizeCommandText(value) {
    return String(value || '')
        .trim()
        .replace(/[，,。.!！；;：:\s]+/g, '')
        .toLocaleLowerCase('zh-CN');
}

function preferredCapability(text) {
    if (/(?:线圈|绕组)/.test(text) && /库存/.test(text)
        && /(?:增加|减少|入库|出库)/.test(text)) return 'adjust_coil_stock';
    // NATIVE-W1.5：零件库存调整族不再要求出现「零件/配件/物料」字样，
    // 目标身份交给 canonical resolver，这里只认「库存 + 明确增减动作」。
    if (isPartStockMutationIntent(text)) return 'adjust_part_stock';
    if (!/零件|配件|物料/.test(text)) return null;
    if (/^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|重新|继续|立即|现在)?(?:录入|新增|新建|创建|添加)/.test(text)) {
        return /批量|多个|多条|以下|这些/.test(text) ? 'batch_create_parts' : 'create_part';
    }
    if (/^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|批量|重新|继续|立即|现在)?(?:删除|移除)/.test(text)) {
        return 'delete_part';
    }
    if (/调价|批量修改价格|批量更新价格/.test(text)) return 'batch_update_prices';
    if (
        /^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|重新|继续|立即|现在)?(?:修改|更新|改|设置)/.test(text)
        || /^(?:请|麻烦|烦请|帮我|替我|给我)?(?:将|把).{1,80}(?:修改|更新|改|设置|调整)/.test(text)
    ) {
        return 'update_part';
    }
    return null;
}

function extractSingleCoilStockAdjustmentArgs(userText) {
    const text = String(userText || '').trim();
    const modelMatch = text.match(/(?<!\d)(\d{1,3})\s*[-－×xX*]\s*(\d{2,4})(?!\d)/u);
    const quantityMatch = text.match(/(?:增加|入库|加)\s*(\d+)\s*(?:套|个)?/u)
        || text.match(/(?:减少|出库|减)\s*(\d+)\s*(?:套|个)?/u);
    if (!modelMatch || !quantityMatch) return null;
    const quantity = Number(quantityMatch[1]);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
    const negative = /(?:减少|出库|减)/u.test(quantityMatch[0]);
    return {
        items: [{
            model: `${modelMatch[1]}-${modelMatch[2]}`,
            changeQty: negative ? -quantity : quantity,
        }],
    };
}

function extractLabeledValue(text, labels, followingLabels) {
    const labelPattern = labels.join('|');
    const boundaryPattern = followingLabels.length > 0
        ? `(?=\\s*(?:[,，;；]|${followingLabels.join('|')})|$)`
        : '(?=\\s*[,，;；]|$)';
    const match = String(text || '').match(new RegExp(
        `(?:${labelPattern})\\s*[:：]?\\s*(.+?)${boundaryPattern}`,
        'i'
    ));
    return match?.[1]?.trim() || '';
}

function extractSinglePartCreateArgs(userText) {
    const text = String(userText || '').trim();
    const model = extractLabeledValue(text, ['型号', '名称'], ['单价', '价格', '供应商', '库存', '数量'])
        .replace(/\\([*])/g, '$1');
    const priceText = extractLabeledValue(text, ['单价', '价格'], ['供应商', '库存', '数量']);
    const priceMatch = priceText.match(/-?\d+(?:\.\d+)?/);
    if (!model || !priceMatch) return null;

    const category = extractLabeledValue(text, ['类型', '类别'], ['型号', '名称', '单价', '价格', '供应商', '库存', '数量']);
    const supplier = extractLabeledValue(text, ['供应商'], ['库存', '数量']);
    const stockText = extractLabeledValue(text, ['库存', '数量'], []);
    const stockMatch = stockText.match(/-?\d+(?:\.\d+)?/);
    return {
        model,
        price: Number(priceMatch[0]),
        ...(category ? { category } : {}),
        ...(supplier ? { supplier } : {}),
        ...(stockMatch ? { stock: Number(stockMatch[0]) } : {}),
    };
}

// ── NATIVE-W1.5：唯一获批写能力（零件库存调整）的确定性语义 ─────────────────────────
//
// 目标：让一句自然的库存调整请求进入 W1 提案，而**不**要求用户说出「零件」二字，
// 也不引入宽泛的动词正则动物园。判据只有三件事：
//   库存语义（库存/入库/出库） + 明确的增减动作 + 明确的数量
// 目标身份由既有 canonical resolver 决定（W1 正式预览负责 0/多匹配判定），这里只做
// 「提到的是哪个短语」与「加还是减、多少」的确定性抽取。
const PART_STOCK_STOCK_RE = /(?:库存|入库|出库)/u;
const PART_STOCK_COIL_RE = /(?:线圈|绕组|铜线)/u;
const PART_STOCK_INCREASE_SOURCE = '(?:增加|加|入库|补充|上调)';
const PART_STOCK_DECREASE_SOURCE = '(?:减少|减|出库|扣减|下调)';
const PART_STOCK_SIGNED_ACTION_SOURCE = `(?:${PART_STOCK_INCREASE_SOURCE}|${PART_STOCK_DECREASE_SOURCE})`;
/** 只表示「调到某个值」的动词：方向不明，必须澄清，不能猜成增减。 */
const PART_STOCK_ABSOLUTE_ACTION_SOURCE = '(?:调整|改成|改为|调成|设为|设成|设置|变成|定为)';
const PART_STOCK_UNIT_SOURCE = '(?:个|件|套|只|条|台|pcs)?';
const PART_STOCK_MULTI_TARGET_RE = /(?:和|与|、|跟|以及|还有|并且)/u;
const PART_STOCK_REQUEST_PREFIX_RE = /^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要|先|直接|批量|重新|继续|立即|现在)+/u;

/** 目标提及：库存锚点左侧、去掉请求语与「把/将/给」后的短语。 */
function partStockTargetMention(text) {
    const anchor = String(text || '').search(PART_STOCK_STOCK_RE);
    if (anchor < 0) return '';
    let prefix = String(text).slice(0, anchor);
    prefix = prefix.replace(PART_STOCK_REQUEST_PREFIX_RE, '');
    prefix = prefix.replace(/^(?:把|将|给)/u, '');
    prefix = prefix.replace(/[的\s]+$/u, '');
    return prefix.trim();
}

// NATIVE-W1.5-R1：**绝对目标值**语法（「增加到 30」= 最终值 30，不是 +30）。
// Delta-only V1 必须先识别这些写法并明确拒绝，绝不能把它们当成增量。
// 有界确定性语法：<增减/赋值动词> + (到|至|为|成) + 数字，以及无动词的「库存到 30」。
const PART_STOCK_ABSOLUTE_VERB_SOURCE = '(?:增加|加|提高|上调|减少|减|降低|降|下调|调整|改变|改成|改为|调成|设为|设成|设置|变成|变为|定为|变)';
const PART_STOCK_ABSOLUTE_MARK_SOURCE = '(?:到|至|为|成)';
const PART_STOCK_ABSOLUTE_RE = new RegExp(
    `(?:${PART_STOCK_ABSOLUTE_VERB_SOURCE})\\s*${PART_STOCK_ABSOLUTE_MARK_SOURCE}\\s*\\d+`, 'u'
);
const PART_STOCK_ABSOLUTE_BARE_RE = new RegExp(`库存\\s*${PART_STOCK_ABSOLUTE_MARK_SOURCE}\\s*\\d+`, 'u');
/** 本身就表示「赋值为某最终值」的动词，不需要额外的「到/为」标记。 */
const PART_STOCK_ABSOLUTE_ASSIGN_RE = /(?:改成|改为|调成|设成|设为|设置|变成|变为|定为)\s*\d+/u;
/** 二选一/并列数量：「增加 100 还是 200」必须澄清，不能取第一个。 */
const PART_STOCK_QUANTITY_CHOICE_RE = /^\s*(?:还是|或者|或|、|，|,|\/)\s*-?\d+/u;

function isAbsoluteStockTarget(text) {
    return PART_STOCK_ABSOLUTE_RE.test(text) || PART_STOCK_ABSOLUTE_BARE_RE.test(text) || PART_STOCK_ABSOLUTE_ASSIGN_RE.test(text);
}

/** 该文本是否属于「零件库存调整」语义族（与线圈分支互斥）。 */
function isPartStockMutationIntent(text) {
    const value = String(text || '');
    if (!PART_STOCK_STOCK_RE.test(value) || PART_STOCK_COIL_RE.test(value)) return false;
    return new RegExp(PART_STOCK_SIGNED_ACTION_SOURCE, 'u').test(value)
        || new RegExp(PART_STOCK_ABSOLUTE_ACTION_SOURCE, 'u').test(value)
        || isAbsoluteStockTarget(value);
}

/** 明确的 <动作><数量> 配对。**只允许「了」**：`到/至/为` 是绝对目标标记，绝不能当增量。 */
function partStockQuantityMatches(text) {
    const pattern = new RegExp(`(${PART_STOCK_SIGNED_ACTION_SOURCE})\\s*(?:了)?\\s*(-?\\d+)\\s*${PART_STOCK_UNIT_SOURCE}`, 'gu');
    return [...String(text || '').matchAll(pattern)].map(match => ({
        action: match[1],
        literal: match[2],
        value: Number(match[2]),
        end: match.index + match[0].length,
    }));
}

/**
 * 抽取一次零件库存调整。绝不猜方向或数量：
 * 绝对目标值 / 缺数量 / 多数量 / 方向冲突 / 缺目标 / 多目标一律返回可澄清的原因。
 * **解析顺序**：绝对目标值 → 增量；顺序本身是安全契约（ticket §5）。
 * @returns {{ok:true,args:{items:Array<{model:string,changeQty:number}>},mention:string}|{ok:false,reason:string}}
 */
function parsePartStockAdjustment(userText) {
    const text = String(userText || '').trim();
    if (!text || !PART_STOCK_STOCK_RE.test(text)) return { ok: false, reason: 'not_stock_intent' };
    // 1) 绝对目标值语法优先：V1 只支持 delta，绝不把「增加到 30」当成 +30。
    if (isAbsoluteStockTarget(text)) return { ok: false, reason: 'absolute_target' };
    const mention = partStockTargetMention(text).replace(/\s+/gu, '');
    if (!mention) return { ok: false, reason: 'target_required' };
    if (PART_STOCK_MULTI_TARGET_RE.test(mention)) return { ok: false, reason: 'target_multi' };
    // 2) 同一句里同时出现增加与减少 → 方向冲突，必须澄清。
    const hasIncrease = new RegExp(PART_STOCK_INCREASE_SOURCE, 'u').test(text);
    const hasDecrease = new RegExp(PART_STOCK_DECREASE_SOURCE, 'u').test(text);
    if (hasIncrease && hasDecrease) return { ok: false, reason: 'sign_conflict' };
    // 3) 增量抽取。
    const matches = partStockQuantityMatches(text);
    if (!matches.length) {
        const absoluteVerb = new RegExp(PART_STOCK_ABSOLUTE_ACTION_SOURCE, 'u').test(text);
        const hasAnyNumber = /\d/u.test(text);
        return { ok: false, reason: absoluteVerb && hasAnyNumber ? 'action_ambiguous' : 'quantity_required' };
    }
    // 「增加 100 还是 200」：配对之后紧跟选择连词 + 另一个数字 → 必须澄清。
    const tail = text.slice(matches[matches.length - 1].end);
    if (PART_STOCK_QUANTITY_CHOICE_RE.test(tail)) return { ok: false, reason: 'quantity_ambiguous' };
    if (matches.some(match => !Number.isSafeInteger(match.value))) return { ok: false, reason: 'quantity_invalid' };
    if (matches.some(match => match.literal.startsWith('-'))) return { ok: false, reason: 'sign_conflict' };
    if (matches.some(match => match.value <= 0)) return { ok: false, reason: 'quantity_zero' };
    const distinct = [...new Set(matches.map(match => `${match.action}:${match.value}`))];
    if (distinct.length > 1) return { ok: false, reason: 'quantity_ambiguous' };
    const separator = distinct[0].lastIndexOf(':');
    const action = distinct[0].slice(0, separator);
    const magnitude = Number(distinct[0].slice(separator + 1));
    const signed = /^(?:减少|减|出库|扣减|下调)$/u.test(action) ? -magnitude : magnitude;
    return { ok: true, mention, args: { items: [{ model: mention, changeQty: signed }] } };
}

function extractSinglePartStockAdjustmentArgs(userText) {
    const parsed = parsePartStockAdjustment(userText);
    return parsed.ok ? parsed.args : null;
}

/** 面向用户的稳定能力描述：绝不把内部路由对象/枚举塞进正文（修复 [object Object]）。 */
const COMMAND_ROUTE_LABELS = Object.freeze({
    adjust_part_stock: '零件库存调整',
    adjust_coil_stock: '线圈库存调整',
    create_part: '零件建档',
    batch_create_parts: '零件批量建档',
    update_part: '零件资料修改',
    delete_part: '零件删除',
    batch_update_prices: '零件批量调价',
});

function describeCommandRoute(route) {
    const capability = route?.preferredCapability;
    if (capability && COMMAND_ROUTE_LABELS[capability]) return COMMAND_ROUTE_LABELS[capability];
    return '受保护的业务变更';
}

function extractNumberAfterField(text, labels) {
    const match = String(text || '').match(new RegExp(
        `(?:${labels.join('|')})(?:修改|更新|调整|设置|改)?(?:成|为|至|到)?\\s*[:：]?\\s*(-?\\d+(?:\\.\\d+)?)`,
        'i'
    ));
    return match ? Number(match[1]) : undefined;
}

function extractTextAfterField(text, labels, followingLabels) {
    const boundary = followingLabels.length > 0
        ? `(?=\\s*(?:[,，;；]|${followingLabels.join('|')})|$)`
        : '(?=\\s*[,，;；]|$)';
    const match = String(text || '').match(new RegExp(
        `(?:${labels.join('|')})(?:修改|更新|调整|设置|改)?(?:成|为|至|到)?\\s*[:：]?\\s*(.+?)${boundary}`,
        'i'
    ));
    return match?.[1]?.trim() || '';
}

function extractExplicitUpdateModel(text) {
    const labeled = extractLabeledValue(
        text,
        ['型号', '名称'],
        ['单价', '价格', '供应商', '类别', '类型', '二级分类']
    );
    if (labeled) return labeled.replace(/[的\s]+$/u, '').replace(/\\([*])/g, '$1');
    const match = String(text || '').match(
        /(?:将|把|修改|更新|调整|设置)\s*(?:零件|配件|物料)?\s*(.+?)\s*(?:的)?(?:单价|价格|供应商|类别|类型|二级分类)/u
    );
    const model = match?.[1]?.trim() || '';
    if (!model || /^(?:刚才|刚刚|上一个|这个|该)(?:录入|新增|新建|创建|修改|更新)?(?:的)?零件$/u.test(model)) {
        return '';
    }
    return model.replace(/\\([*])/g, '$1');
}

function extractSinglePartUpdateArgs(userText, recentPartWrite = null) {
    const text = String(userText || '').trim();
    const relativeCreateTarget = /(?:刚才|刚刚|上一个)(?:录入|新增|新建|创建)(?:的)?零件/u.test(text);
    const model = extractExplicitUpdateModel(text)
        || (relativeCreateTarget && recentPartWrite?.toolName === 'create_part'
            ? String(recentPartWrite.part?.model || '').trim()
            : '');
    if (!model) return null;

    const price = extractNumberAfterField(text, ['单价', '价格']);
    const supplier = extractTextAfterField(
        text,
        ['供应商'],
        ['单价', '价格', '类别', '类型', '二级分类']
    );
    const category = extractTextAfterField(
        text,
        ['类别', '类型'],
        ['单价', '价格', '供应商', '二级分类']
    );
    const subcategory = extractTextAfterField(
        text,
        ['二级分类'],
        ['单价', '价格', '供应商', '类别', '类型']
    );
    if (price === undefined && !supplier && !category && !subcategory) return null;
    return {
        model,
        ...(price !== undefined ? { price } : {}),
        ...(supplier ? { supplier } : {}),
        ...(category ? { category } : {}),
        ...(subcategory ? { subcategory } : {}),
    };
}

function buildProtectedCommandToolCall(messages = [], route = null) {
    const userText = latestUserText(messages);
    const args = route?.preferredCapability === 'create_part'
        ? extractSinglePartCreateArgs(userText)
        : route?.preferredCapability === 'update_part'
            ? extractSinglePartUpdateArgs(userText, route.recentPartWrite)
            : route?.preferredCapability === 'adjust_coil_stock'
                ? extractSingleCoilStockAdjustmentArgs(userText)
                : route?.preferredCapability === 'adjust_part_stock'
                    ? extractSinglePartStockAdjustmentArgs(userText)
            : null;
    if (!args) return null;
    return {
        id: `protected-command-${route.preferredCapability.replaceAll('_', '-')}`,
        type: 'function',
        function: {
            name: route.preferredCapability,
            arguments: JSON.stringify(args),
        },
    };
}

function buildProtectedCommandIntent(messages = [], route = null) {
    const toolCall = buildProtectedCommandToolCall(messages, route);
    if (!toolCall) return null;
    return Object.freeze({
        version: 3,
        goal: latestUserText(messages),
        mode: 'command',
        domains: Object.freeze([...(route.domains || [])]),
        needsBusinessData: true,
        contextMode: 'current_turn',
        answerShape: 'confirmation',
        entityScope: 'single',
        requiresClarification: false,
        ambiguities: Object.freeze([]),
        confidence: 1,
        requiredFactIntents: Object.freeze([]),
        steps: Object.freeze([Object.freeze({
            capabilityName: toolCall.function.name,
            objective: latestUserText(messages),
        })]),
    });
}

function detectProtectedCommandRoute(messages = [], options = {}) {
    const originalText = latestUserText(messages);
    const text = normalizeCommandText(originalText);
    if (!text || NEGATED_COMMAND_RE.test(text) || QUESTION_RE.test(text)) return null;
    // NATIVE-W1.5：唯一获批写能力允许「不带把/将前缀」的自然说法（如「6202库存加100」），
    // 因此对库存调整语义族放宽显式命令前缀要求；其余能力保持原有严格判据。
    const partStockIntent = isPartStockMutationIntent(text);
    if (!EXPLICIT_COMMAND_RE.test(text) && !partStockIntent) return null;

    const domains = SUPPORTED_COMMAND_DOMAINS
        .filter(([, pattern]) => pattern.test(text))
        .map(([domain]) => domain)
        .slice(0, 4);
    if (domains.length === 0) return null;

    return Object.freeze({
        mode: 'command',
        domains: Object.freeze(domains),
        preferredCapability: preferredCapability(text) || (partStockIntent ? 'adjust_part_stock' : null),
        recentPartWrite: options.recentPartWrite || null,
        source: 'explicit_user_command',
    });
}

module.exports = {
    buildProtectedCommandIntent,
    buildProtectedCommandToolCall,
    describeCommandRoute,
    detectProtectedCommandRoute,
    extractSingleCoilStockAdjustmentArgs,
    extractSinglePartCreateArgs,
    extractSinglePartStockAdjustmentArgs,
    extractSinglePartUpdateArgs,
    isPartStockMutationIntent,
    latestUserText,
    normalizeCommandText,
    parsePartStockAdjustment,
    partStockTargetMention,
};
