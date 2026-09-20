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
    if (!/零件|配件|物料/.test(text)) return null;
    if (/^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|重新|继续|立即|现在)?(?:录入|新增|新建|创建|添加)/.test(text)) {
        return /批量|多个|多条|以下|这些/.test(text) ? 'batch_create_parts' : 'create_part';
    }
    if (/^(?:请|麻烦|烦请|帮我|替我|给我|我要|我需要|需要)?(?:先|直接|批量|重新|继续|立即|现在)?(?:删除|移除)/.test(text)) {
        return 'delete_part';
    }
    if (/调价|批量修改价格|批量更新价格/.test(text)) return 'batch_update_prices';
    if (/库存|入库|出库/.test(text)) return 'adjust_part_stock';
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
    if (!EXPLICIT_COMMAND_RE.test(text)) return null;

    const domains = SUPPORTED_COMMAND_DOMAINS
        .filter(([, pattern]) => pattern.test(text))
        .map(([domain]) => domain)
        .slice(0, 4);
    if (domains.length === 0) return null;

    return Object.freeze({
        mode: 'command',
        domains: Object.freeze(domains),
        preferredCapability: preferredCapability(text),
        recentPartWrite: options.recentPartWrite || null,
        source: 'explicit_user_command',
    });
}

module.exports = {
    buildProtectedCommandIntent,
    buildProtectedCommandToolCall,
    detectProtectedCommandRoute,
    extractSinglePartCreateArgs,
    extractSingleCoilStockAdjustmentArgs,
    extractSinglePartUpdateArgs,
    latestUserText,
    normalizeCommandText,
};
