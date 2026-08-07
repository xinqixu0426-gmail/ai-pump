const QUERY_TOOL_NAMES = new Set([
    'search_parts',
    'get_recent_orders',
    'get_order_detail',
    'get_order_readiness_overview',
    'check_order_readiness',
    'plan_order_readiness_actions',
    'get_order_knowledge_package',
    'get_purchase_overview',
    'search_coils',
    'get_all_recipes',
    'get_recipe_detail',
    'get_recipe_technical_files',
    'preview_recipe_cost',
]);

const PART_CATALOG_TERMS = [
    '包装材料', '电源线', 'O型圈', '说明书',
    '电缆', '轴承', '油封', '密封', '叶轮', '电容', '保护器', '接线',
    '泵体', '泵盖', '泵壳', '机筒', '螺丝', '螺杆', '螺母', '垫片', '纸箱',
    '泡沫', '铭牌', '转轴', '刀片',
];
const ORDER_STATUSES = ['待确认', '待采购', '采购中', '采购完成', '生产中', '已完成', '已关闭', '已取消'];
const PART_STOCK_STATUSES = new Set(['low', 'out', 'attention', 'ok']);
const READINESS_INTENT_RE = /能不能生产|是否能生产|可以生产|可否生产|不能生产|生产准备|是否齐料|齐料了吗|还缺(?:什么|哪些)?(?:物料|材料|配件|料)|缺(?:哪|哪些)?料/;
const READINESS_PLAN_INTENT_RE = /怎么处理|如何处理|处理方案|解决方案|下一步|先做什么|怎么解决|如何解决|执行.*(?:步骤|方案)|处理第[一二三四五六七八九十\d]+步/;
const READINESS_OVERVIEW_INTENT_RE = /哪些订单|所有订单|全部订单|订单准备总览|订单生产准备总览|不能生产的订单|可以生产的订单|多少订单.*(?:缺料|能生产|不能生产)|订单.*(?:汇总|总览)/;
const KNOWLEDGE_PACKAGE_INTENT_RE = /客户要求|包装要求|标识要求|执行档案|执行记录|历史调整|过程调整|供应商调整|产能调整|过程异常|质量(?:结果|追溯|记录)|交付(?:结果|追溯|记录)|追溯|来源文件|依据文件|资料依据|全部已知信息|完整信息|知识包/;

class AiBusinessQueryValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'AiBusinessQueryValidationError';
        this.code = 'INVALID_AI_BUSINESS_QUERY';
        this.details = details;
    }
}

function cleanText(value, maxLength = 80) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (text.length > maxLength) {
        throw new AiBusinessQueryValidationError(`查询字段不能超过 ${maxLength} 个字符`);
    }
    return text;
}

function cleanPositiveInteger(value, field, { defaultValue, max = Number.MAX_SAFE_INTEGER } = {}) {
    if ((value === undefined || value === null || value === '') && defaultValue !== undefined) {
        return defaultValue;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
        throw new AiBusinessQueryValidationError(`${field} 必须是 1 到 ${max} 的整数`);
    }
    return parsed;
}

function rejectUnknownFields(toolName, args, allowed) {
    const unknown = Object.keys(args).filter(key => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new AiBusinessQueryValidationError(
            `${toolName} 不支持查询字段：${unknown.join('、')}`,
            { toolName, unknownFields: unknown }
        );
    }
}

function isFunctionOnlyKeyword(value) {
    const compact = cleanText(value)
        .replace(/[？?！!。，,：:；;“”"'、\s]/g, '')
        .replace(/^(?:请|帮我|麻烦)/, '')
        .replace(/(?:查一下|查询|搜索|显示|列出|给我|告诉我|看一下)/g, '')
        .replace(/(?:有没有|是否有|有哪些|有什么|有多少|多少个|全部|所有|目前|当前|现在|最新)/g, '')
        .replace(/(?:零件|配件|订单|采购|配方|列表|明细|详情|数据|信息|情况)/g, '')
        .replace(/(?:低库存|库存不足|库存预警|库存正常|无库存|零库存|缺货|需要补货|待补货|库存)/g, '')
        .replace(/的/g, '');
    return compact.length === 0;
}

function normalizedStrings(args, fields) {
    return Object.fromEntries(fields
        .map(field => [field, cleanText(args[field])])
        .filter(([, value]) => value));
}

function normalizeBusinessQueryArgs(toolName, rawArgs = {}) {
    if (!QUERY_TOOL_NAMES.has(toolName)) return { ...(rawArgs || {}) };
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? rawArgs
        : {};

    switch (toolName) {
        case 'search_parts': {
            const allowed = ['keyword', 'category', 'supplier', 'stockStatus'];
            rejectUnknownFields(toolName, args, allowed);
            const normalized = normalizedStrings(args, ['keyword', 'category', 'supplier']);
            const stockStatus = cleanText(args.stockStatus, 20);
            if (stockStatus && !PART_STOCK_STATUSES.has(stockStatus)) {
                throw new AiBusinessQueryValidationError('stockStatus 只支持 low、out、attention 或 ok');
            }
            if (stockStatus) normalized.stockStatus = stockStatus;
            if (normalized.keyword && isFunctionOnlyKeyword(normalized.keyword)) {
                if (Object.keys(normalized).length > 1) delete normalized.keyword;
                else throw new AiBusinessQueryValidationError('零件关键词没有包含型号、名称、类别或供应商');
            }
            return normalized;
        }
        case 'get_recent_orders': {
            const allowed = ['limit', 'status', 'customerName', 'contractNo'];
            rejectUnknownFields(toolName, args, allowed);
            return {
                limit: cleanPositiveInteger(args.limit, 'limit', { defaultValue: 10, max: 100 }),
                ...normalizedStrings(args, ['status', 'customerName', 'contractNo']),
            };
        }
        case 'get_purchase_overview': {
            const allowed = ['limit', 'supplier', 'pendingOnly'];
            rejectUnknownFields(toolName, args, allowed);
            const normalized = normalizedStrings(args, ['supplier']);
            if (args.limit !== undefined && args.limit !== '') {
                normalized.limit = cleanPositiveInteger(args.limit, 'limit', { max: 100 });
            }
            if (args.pendingOnly !== undefined) {
                if (typeof args.pendingOnly !== 'boolean') {
                    throw new AiBusinessQueryValidationError('pendingOnly 必须是布尔值');
                }
                normalized.pendingOnly = args.pendingOnly;
            }
            return normalized;
        }
        case 'search_coils': {
            rejectUnknownFields(toolName, args, ['spec', 'sheets', 'material', 'slotType']);
            const normalized = normalizedStrings(args, ['spec', 'material', 'slotType']);
            if (args.sheets !== undefined && args.sheets !== '') {
                normalized.sheets = cleanPositiveInteger(args.sheets, 'sheets', { max: 10000 });
            }
            return normalized;
        }
        case 'get_all_recipes': {
            rejectUnknownFields(toolName, args, ['keyword']);
            const normalized = normalizedStrings(args, ['keyword']);
            if (normalized.keyword && isFunctionOnlyKeyword(normalized.keyword)) {
                throw new AiBusinessQueryValidationError('配方关键词没有包含配方名称或规格');
            }
            return normalized;
        }
        case 'get_order_detail':
            rejectUnknownFields(toolName, args, ['orderId']);
            return { orderId: cleanPositiveInteger(args.orderId, 'orderId') };
        case 'check_order_readiness':
        case 'plan_order_readiness_actions':
        case 'get_order_knowledge_package': {
            rejectUnknownFields(toolName, args, ['orderId', 'orderQuery']);
            if (args.orderId !== undefined && args.orderId !== '') {
                return { orderId: cleanPositiveInteger(args.orderId, 'orderId') };
            }
            const orderQuery = cleanText(args.orderQuery);
            if (!orderQuery || isFunctionOnlyKeyword(orderQuery)) {
                throw new AiBusinessQueryValidationError('请提供有效的订单ID、客户名称或合同号');
            }
            return { orderQuery };
        }
        case 'get_recipe_detail': {
            rejectUnknownFields(toolName, args, ['recipeId', 'recipeName', 'includeCurrentCost']);
            const target = args.recipeId !== undefined && args.recipeId !== ''
                ? { recipeId: cleanPositiveInteger(args.recipeId, 'recipeId') }
                : { recipeName: cleanText(args.recipeName) };
            if (!target.recipeId && (!target.recipeName || isFunctionOnlyKeyword(target.recipeName))) {
                throw new AiBusinessQueryValidationError('请提供有效的配方ID或完整配方名称');
            }
            if (args.includeCurrentCost !== undefined && typeof args.includeCurrentCost !== 'boolean') {
                throw new AiBusinessQueryValidationError('includeCurrentCost 必须是布尔值');
            }
            return {
                ...target,
                ...(args.includeCurrentCost !== undefined
                    ? { includeCurrentCost: args.includeCurrentCost }
                    : {}),
            };
        }
        case 'get_recipe_technical_files':
        case 'preview_recipe_cost': {
            rejectUnknownFields(toolName, args, ['recipeId', 'recipeName']);
            if (args.recipeId !== undefined && args.recipeId !== '') {
                return { recipeId: cleanPositiveInteger(args.recipeId, 'recipeId') };
            }
            const recipeName = cleanText(args.recipeName);
            if (!recipeName || isFunctionOnlyKeyword(recipeName)) {
                throw new AiBusinessQueryValidationError('请提供有效的配方ID或完整配方名称');
            }
            return { recipeName };
        }
        case 'get_order_readiness_overview':
            rejectUnknownFields(toolName, args, []);
            return {};
        default:
            return { ...args };
    }
}

function partStockStatus(text) {
    if (/低库存/.test(text)) return 'low';
    if (/缺货|无库存|零库存|库存\s*(?:为|是|等于|=)\s*0/.test(text)) return 'out';
    if (/库存不足|库存预警|需要补货|待补货/.test(text)) return 'attention';
    if (/库存正常/.test(text)) return 'ok';
    return '';
}

function partCategory(text) {
    return (
        text.match(/零件库(?:中|里)?(?:的)?\s*([^，。？！\s]{1,20}?)(?:类别|分类)/)?.[1]
        || text.match(/(?:类别|分类)\s*(?:为|是|[:：])\s*([^，。？！\s]{1,20}?)(?=(?:的)?(?:低库存|库存不足|库存预警|缺货|无库存|零库存|零件|配件|供应商)|[，。？！\s]|$)/)?.[1]
        || ''
    ).trim();
}

function explicitPartKeyword(text, stockStatus) {
    const quoted = text.match(/[“"]([^”"]{1,80})[”"]/)?.[1]?.trim();
    if (quoted) return quoted;

    const normalizedTarget = text
        .replace(/^(?:请|帮我|麻烦|给我|告诉我)?\s*(?:查一下|查询|搜索|查找|找一下|找|看一下|看看|显示)\s*/, '')
        .replace(/^(?:零件|配件)?\s*型号\s*(?:为|是|[:：])?\s*/, '')
        .match(
            /^(.{1,80}?)(?=(?:的)?(?:当前|现在|目前|实时)?(?:的)?(?:库存|价格|单价|成本|供应商)|现在还剩|还剩多少)/
        )?.[1]?.trim();
    if (
        normalizedTarget
        && !(stockStatus && /^(?:低|缺|无|零|库存不足)$/.test(normalizedTarget))
        && !isFunctionOnlyKeyword(normalizedTarget)
    ) {
        return normalizedTarget;
    }

    const queryTarget = text.match(
        /(?:查一下|查询|搜索|查找|找一下|找|看一下|看看|列出)\s*(?:所有|全部)?\s*(.{1,80}?)(?=(?:的)?(?:价格|单价|成本|库存|供应商|零件|配件)(?:有哪些|有多少|是多少|情况|详情|列表)?[？?。！!]*$)/
    )?.[1]?.trim();
    if (queryTarget && !isFunctionOnlyKeyword(queryTarget)) return queryTarget;

    const factTarget = text.match(
        /^(.{1,80}?)(?:的)?(?:价格|单价|成本|库存|供应商)(?:有哪些|有多少|是多少|情况|详情|列表)?[？?。！!]*$/
    )?.[1]?.trim();
    if (factTarget && !isFunctionOnlyKeyword(factTarget)) return factTarget;

    const existenceTarget = text.match(/(?:有没有|是否有)\s*(.{1,80}?)(?:的)?(?:零件|配件)?[？?。！!]*$/)?.[1]?.trim();
    if (existenceTarget && !stockStatus && !isFunctionOnlyKeyword(existenceTarget)) return existenceTarget;

    return PART_CATALOG_TERMS.find(term => text.includes(term)) || '';
}

function compilePartQuery(text) {
    if (!/(?:零件|配件|零件库)/.test(text) && !PART_CATALOG_TERMS.some(term => text.includes(term))) {
        return null;
    }
    const stockStatus = partStockStatus(text);
    const category = partCategory(text);
    const keyword = category ? '' : explicitPartKeyword(text, stockStatus);
    return {
        name: 'search_parts',
        args: normalizeBusinessQueryArgs('search_parts', {
            ...(keyword ? { keyword } : {}),
            ...(category ? { category } : {}),
            ...(stockStatus ? { stockStatus } : {}),
        }),
        domain: 'parts',
        intent: 'list',
    };
}

function recipeTarget(text) {
    const recipeId = text.match(/配方\s*(?:ID|Id|id|[#＃])\s*(\d+)/)?.[1];
    if (recipeId) return { recipeId: Number(recipeId) };
    const source = text
        .replace(/^(?:请|帮我|麻烦|查一下|查询|搜索|显示|列出|给我|告诉我|看一下|总结)+\s*/, '')
        .trim();
    const named = (
        source.match(/^(?:配方(?:名称)?\s*(?:(?:为|是|[:：])\s*)?)([^，。？！\s]{1,60}?)(?=(?:的)?(?:明细|详情|当前|成本|价格|单价|技术档案|测试报告|附件|文件|BOM|用了|使用|包含|有哪些零件)|[，。？！\s]|$)/)?.[1]
        || source.match(/^([^，。？！\s]{1,60})配方/)?.[1]
        || source.match(/^([^，。？！\s]{1,60}?)(?:性能)?测试报告/)?.[1]
        || ''
    ).trim();
    return named && !isFunctionOnlyKeyword(named) ? { recipeName: named } : {};
}

function compileRecipeQuery(text) {
    if (!/配方|性能测试报告|测试报告/.test(text)) return null;
    const target = recipeTarget(text);
    if (/技术档案|测试报告|附件|Excel|文件/.test(text) && (target.recipeId || target.recipeName)) {
        return {
            name: 'get_recipe_technical_files',
            args: normalizeBusinessQueryArgs('get_recipe_technical_files', target),
            domain: 'recipes',
            intent: 'technical_files',
        };
    }
    const wantsDetail = /明细|详情|BOM|用了|使用.{0,12}零件|包含.{0,12}零件|哪些零件/.test(text);
    const wantsCost = /成本|价格|单价/.test(text);
    if (wantsDetail && (target.recipeId || target.recipeName)) {
        return {
            name: 'get_recipe_detail',
            args: normalizeBusinessQueryArgs('get_recipe_detail', {
                ...target,
                ...(wantsCost ? { includeCurrentCost: true } : {}),
            }),
            domain: 'recipes',
            intent: wantsCost ? 'detail_with_current_cost' : 'detail',
        };
    }
    if (wantsCost && (target.recipeId || target.recipeName)) {
        return {
            name: 'preview_recipe_cost',
            args: normalizeBusinessQueryArgs('preview_recipe_cost', target),
            domain: 'recipes',
            intent: 'cost',
        };
    }
    return {
        name: 'get_all_recipes',
        args: normalizeBusinessQueryArgs('get_all_recipes', target.recipeName ? { keyword: target.recipeName } : {}),
        domain: 'recipes',
        intent: 'list',
    };
}

function compileCoilQuery(text) {
    if (!/线圈|定子/.test(text)) return null;
    if (!/(?:库存|数据|信息|详情|规格|片数|材质|槽眼|方案|列出|显示|查询|查一下|多少|哪些|所有|全部)/.test(text)) {
        return null;
    }
    const model = text.match(/(?:^|[^\d])(\d+)\s*[-－×xX*]\s*(\d+)(?:[^\d]|$)/);
    return {
        name: 'search_coils',
        args: normalizeBusinessQueryArgs('search_coils', model ? {
            spec: model[1],
            sheets: Number(model[2]),
        } : {}),
        domain: 'coils',
        intent: 'list',
    };
}

function orderIdFrom(text) {
    const value = text.match(/订单\s*[#＃]?\s*(\d+)/)?.[1];
    return value ? Number(value) : null;
}

function compileProcurementQuery(text) {
    if (!/采购/.test(text) || orderIdFrom(text)) return null;
    if (/订单/.test(text) && !/采购(?:任务|情况|总览|进度|清单)/.test(text)) return null;
    const supplier = (
        text.match(/供应商\s*(?:为|是|[:：])\s*([^，。？！\s]{1,40})/)?.[1]
        || text.match(/(?:^|[，,。\s])([^，。？！\s]{1,40})供应商/)?.[1]
        || ''
    ).trim();
    const limit = text.match(/(?:最近|前)\s*(\d{1,3})\s*(?:条|项|个)/)?.[1];
    const args = {
        ...(supplier ? { supplier } : {}),
        ...(/待采购|未采购|还需采购|需要采购/.test(text) ? { pendingOnly: true } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
    };
    return {
        name: 'get_purchase_overview',
        args: normalizeBusinessQueryArgs('get_purchase_overview', args),
        domain: 'procurement',
        intent: 'overview',
    };
}

function compileOrderQuery(text) {
    if (!/订单/.test(text)) return null;
    const orderId = orderIdFrom(text);
    if (orderId && READINESS_PLAN_INTENT_RE.test(text)) {
        return { name: 'plan_order_readiness_actions', args: { orderId }, domain: 'orders', intent: 'readiness_plan' };
    }
    if (orderId && READINESS_INTENT_RE.test(text)) {
        return { name: 'check_order_readiness', args: { orderId }, domain: 'orders', intent: 'readiness' };
    }
    if (orderId && KNOWLEDGE_PACKAGE_INTENT_RE.test(text)) {
        return { name: 'get_order_knowledge_package', args: { orderId }, domain: 'orders', intent: 'knowledge' };
    }
    if (orderId) {
        return { name: 'get_order_detail', args: { orderId }, domain: 'orders', intent: 'detail' };
    }
    if (READINESS_OVERVIEW_INTENT_RE.test(text)) {
        return { name: 'get_order_readiness_overview', args: {}, domain: 'orders', intent: 'readiness_overview' };
    }
    const status = ORDER_STATUSES.find(value => text.includes(value)) || '';
    const customerName = (
        text.match(/客户\s*(?:为|是|[:：])\s*([^，。？！\s]{1,40}?)(?=(?:的)?订单|[，。？！\s]|$)/)?.[1]
        || text.match(/([^，。？！\s]{1,40})客户(?:的)?订单/)?.[1]
        || ''
    ).trim();
    const contractNo = text.match(/合同号\s*(?:为|是|[:：])?\s*([A-Za-z0-9_-]{2,40})/)?.[1] || '';
    const limit = text.match(/(?:最近|前)\s*(\d{1,3})\s*(?:条|个|张|笔)?订单/)?.[1];
    return {
        name: 'get_recent_orders',
        args: normalizeBusinessQueryArgs('get_recent_orders', {
            limit: limit ? Number(limit) : 10,
            ...(status ? { status } : {}),
            ...(customerName ? { customerName } : {}),
            ...(contractNo ? { contractNo } : {}),
        }),
        domain: 'orders',
        intent: 'list',
    };
}

function compileBusinessQuery(textValue) {
    const text = cleanText(textValue, 500);
    if (!text) return null;
    const compiled = (
        compileProcurementQuery(text)
        || compileOrderQuery(text)
        || compileCoilQuery(text)
        || compileRecipeQuery(text)
        || compilePartQuery(text)
    );
    return compiled ? {
        ...compiled,
        args: normalizeBusinessQueryArgs(compiled.name, compiled.args),
        source: 'rule',
        validated: true,
    } : null;
}

module.exports = {
    AiBusinessQueryValidationError,
    QUERY_TOOL_NAMES,
    compileBusinessQuery,
    normalizeBusinessQueryArgs,
    isFunctionOnlyKeyword,
};
