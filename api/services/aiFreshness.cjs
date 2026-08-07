const {
    compileBusinessQuery,
} = require('./aiBusinessQueryCompiler.cjs');

const FACT_FIELD_RE = /价格|单价|成本|库存|铜价|铝价|汇率|状态|进度|金额|利润|报价|订单|采购|供应商|客户|配方|零件|线圈|模板|泵壳|用途|适用|专用|配件|刀片|型号|材料|材质|参数|图纸|测试报告|技术档案|质量问题|业务规则/;
const LOOKUP_INTENT_RE = /多少|几个|什么|是否|有没有|哪(?:个|些)?|查(?:一下|询)?|搜索|显示|列出|给我|告诉我|当前|现在|最新|情况|详情|数据|信息|汇总|总览|追溯|依据|为何|为什么|怎么回事|怎么处理|如何处理|处理方案|解决方案|下一步|先做什么|怎么解决|如何解决|执行.*(?:步骤|方案)|处理第[一二三四五六七八九十\d]+步/;
const MANAGEMENT_ACTION_INTENT_RE = /管理待办|待办中心|处理进展|自动归档|反复出现|解决了哪些|最优先|今天.*(?:先做什么|先.*处理|待办|风险|异常)|(?:当前|现在|全部|工厂).*(?:待办|优先事项|风险.*(?:处理|跟进)|异常.*处理|先做什么)/;
const READ_RETRY_INTENT_RE = /^(?:请)?(?:再|重新)?(?:试|查|查询|搜索)(?:一遍|一下|一次)?(?:吧)?[。！!？?]*$|^(?:请)?重试(?:一下|一次)?(?:吧)?[。！!？?]*$/;
const DETERMINISTIC_FRESH_TOOL_NAMES = new Set([
    'search_parts',
    'get_order_detail',
    'get_recent_orders',
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
    'get_copper_price',
]);
const KNOWLEDGE_ENTRY_TYPES = new Set([
    'part',
    'template',
    'recipe',
    'coil',
    'customer',
    'quotation',
    'order',
    'quality_issue',
    'business_rule',
    'document',
]);

/**
 * Dynamic factory data may have changed since an earlier conversation turn.
 * Force the model to consult at least one tool before answering these queries.
 */
function requiresFreshToolLookup(messages = []) {
    const text = resolveFreshLookupText(messages);

    return Boolean(text && (
        MANAGEMENT_ACTION_INTENT_RE.test(text)
        || (LOOKUP_INTENT_RE.test(text) && compileBusinessQuery(text))
        || (FACT_FIELD_RE.test(text) && LOOKUP_INTENT_RE.test(text))
    ));
}

function latestUserText(messages = []) {
    const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find(message => message?.role === 'user' && typeof message.content === 'string');
    return latestUserMessage?.content?.trim() || '';
}

function isFreshReadLookupText(text) {
    return Boolean(text && (
        MANAGEMENT_ACTION_INTENT_RE.test(text)
        || (LOOKUP_INTENT_RE.test(text) && compileBusinessQuery(text))
        || (FACT_FIELD_RE.test(text) && LOOKUP_INTENT_RE.test(text))
        || explicitKnowledgeLookup(text)
    ));
}

function resolveFreshLookupText(messages = []) {
    const userTexts = (Array.isArray(messages) ? messages : [])
        .filter(message => message?.role === 'user' && typeof message.content === 'string')
        .map(message => message.content.trim())
        .filter(Boolean);
    const latest = userTexts.at(-1) || '';
    if (!READ_RETRY_INTENT_RE.test(latest)) return latest;

    return userTexts
        .slice(-6, -1)
        .reverse()
        .find(isFreshReadLookupText) || latest;
}

function freshLookupQuery(text) {
    const cleaned = String(text || '')
        .replace(/[？?！!。，,：:；;“”"']/g, ' ')
        .replace(/请|帮我|麻烦|查一下|查询|搜索|显示|列出|给我|告诉我|看一下|当前|现在|最新/g, ' ')
        .replace(/价格|单价|成本|库存|状态|进度|金额|利润|报价|供应商|详情|数据|信息/g, ' ')
        .replace(/是多少|有多少|多少|怎么样|什么情况|为何|为什么|怎么回事/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || String(text || '').trim();
}

function explicitKnowledgeLookup(textValue) {
    const text = String(textValue || '').trim();
    if (
        !text
        || !/search_factory_knowledge|(?:查询|搜索|查).{0,12}(?:知识库|知识条目)/i.test(text)
    ) {
        return null;
    }

    const quoted = text.match(/[“"]([^”"]{1,120})[”"]/)?.[1]?.trim();
    const entryType = [...KNOWLEDGE_ENTRY_TYPES].find(type => (
        new RegExp(`(?:entryType\\s*[=:]\\s*|\\b)${type}\\b`, 'i').test(text)
    ));
    const query = quoted || freshLookupQuery(text)
        .replace(/search_factory_knowledge|知识库|知识条目|entryType|business_rule/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!query) return null;
    return {
        name: 'search_factory_knowledge',
        args: {
            query,
            ...(entryType ? { entryType } : {}),
            limit: 10,
        },
    };
}

function purposeLookupQuery(text) {
    const source = String(text || '').trim();
    const beforeObject = source.match(/(.{2,40}?)(?:用的|使用的|用途的)(?:泵壳|配件|零件|型号)/);
    if (beforeObject?.[1]) {
        return beforeObject[1]
            .replace(/^(?:哪个|哪些|什么|哪种)/, '')
            .trim();
    }
    const afterIntent = source.match(/(?:适合|适用于|用于|用来)(.{2,40}?)(?:的)?(?:泵壳|配件|零件|型号)?(?:是哪个|是哪一个|有哪些|哪个好|是什么)?[？?]?$/);
    return afterIntent?.[1]?.trim() || '';
}

function coilSpecSheetKey(text) {
    const match = String(text || '').match(/(?:^|[^\d])(\d+)\s*[-－×xX*]\s*(\d+)(?:[^\d]|$)/);
    return match ? `${match[1]}-${match[2]}` : '';
}

function isDeterministicFreshLookupCalls(calls = []) {
    return (
        calls.length === 1
        && DETERMINISTIC_FRESH_TOOL_NAMES.has(calls[0]?.name)
    );
}

function coilInventoryDirection(action) {
    return /出库|减少|减/.test(action) ? -1 : 1;
}

function hasInventoryWriteIntent(textValue) {
    const text = String(textValue || '').trim();
    return Boolean(text && (
        /(?:入库|进(?:货|了)?|出库)/u.test(text)
        || /库存\s*[+＋\-－]\s*\d+/u.test(text)
        || /库存(?:增加|减少|加|减)\s*\d+/u.test(text)
        || /(?:增加|减少|加|减)库存\s*\d+/u.test(text)
    ));
}

function parseCoilInventoryInstruction(textValue) {
    const text = String(textValue || '').trim();
    if (!hasInventoryWriteIntent(text)) return null;
    if (/零件/.test(text) && !/线圈|定子/.test(text)) return null;

    const models = [];
    const modelRe = /(\d+)\s*[-－×xX*]\s*(\d+)/g;
    let match;
    while ((match = modelRe.exec(text)) !== null) {
        const before = text[match.index - 1] || '';
        const after = text[modelRe.lastIndex] || '';
        // 三段及以上的零件型号（如 V750-12-120）不能截取中间两段冒充线圈俗称。
        if (/[\d\-－×xX*]/.test(before) || /[\d\-－×xX*]/.test(after)) continue;
        const model = `${match[1]}-${match[2]}`;
        if (!models.some(item => item.model === model)) {
            models.push({ model, index: match.index, end: modelRe.lastIndex });
        }
    }
    if (models.length === 0) return null;

    const actionPattern = '(入库|出库|库存(?:增加|减少|加|减)|(?:增加|减少|加|减)库存)';
    const sharedSigned = text.match(/库存\s*([+＋\-－])\s*(\d+)\s*(?:套|个|件)?/u);
    const sharedAfterAction = text.match(new RegExp(`各\\s*${actionPattern}\\s*(\\d+)\\s*(?:套|个|件)?`));
    const sharedBeforeAction = text.match(new RegExp(`各\\s*(\\d+)\\s*(?:套|个|件)?\\s*${actionPattern}`));
    let shared = null;
    if (sharedSigned) {
        shared = {
            changeQty: /[+＋]/u.test(sharedSigned[1])
                ? Number(sharedSigned[2])
                : -Number(sharedSigned[2]),
        };
    } else if (sharedAfterAction) {
        shared = {
            changeQty: coilInventoryDirection(sharedAfterAction[1]) * Number(sharedAfterAction[2]),
        };
    } else if (sharedBeforeAction) {
        shared = {
            changeQty: coilInventoryDirection(sharedBeforeAction[2]) * Number(sharedBeforeAction[1]),
        };
    } else {
        const globalRe = new RegExp(`${actionPattern}\\s*(\\d+)\\s*(?:套|个|件)?`, 'g');
        const globalMatches = [...text.matchAll(globalRe)];
        const lastModel = models.at(-1);
        if (globalMatches.length === 1 && globalMatches[0].index >= lastModel.end) {
            shared = {
                changeQty: coilInventoryDirection(globalMatches[0][1]) * Number(globalMatches[0][2]),
            };
        }
    }

    const items = models.map((model, index) => {
        const segmentEnd = models[index + 1]?.index ?? text.length;
        const segment = text.slice(model.end, segmentEnd);
        const signed = segment.match(/库存\s*([+＋\-－])\s*(\d+)\s*(?:套|个|件)?/u);
        const afterAction = segment.match(new RegExp(`${actionPattern}\\s*(\\d+)\\s*(?:套|个|件)?`));
        const beforeAction = segment.match(new RegExp(`(\\d+)\\s*(?:套|个|件)?\\s*${actionPattern}`));
        if (signed) {
            return {
                model: model.model,
                changeQty: /[+＋]/u.test(signed[1])
                    ? Number(signed[2])
                    : -Number(signed[2]),
            };
        }
        if (afterAction) {
            return {
                model: model.model,
                changeQty: coilInventoryDirection(afterAction[1]) * Number(afterAction[2]),
            };
        }
        if (beforeAction) {
            return {
                model: model.model,
                changeQty: coilInventoryDirection(beforeAction[2]) * Number(beforeAction[1]),
            };
        }
        return shared ? { model: model.model, changeQty: shared.changeQty } : null;
    });
    if (items.some(item => !item || !Number.isInteger(item.changeQty) || item.changeQty === 0)) return null;
    return { items };
}

function uniqueInventoryModels(values = []) {
    return [...new Set(values
        .map(value => String(value || '').trim())
        .filter(value => (
            value
            && value.length <= 120
            && !/^(?:这|那|这些|那些)?(?:一|两|二|几|多个)?个?(?:零件|型号|配件)?$/u.test(value)
            && !/库存|入库|出库|进货|增加|减少/u.test(value)
        )))];
}

function quotedPartModels(textValue) {
    const text = String(textValue || '');
    return uniqueInventoryModels([
        ...[...text.matchAll(/`([^`\r\n]{1,120})`/g)].map(match => match[1]),
        ...[...text.matchAll(/[“"]([^”"\r\n]{1,120})[”"]/g)].map(match => match[1]),
    ]);
}

function sharedPartInventoryQuantity(textValue) {
    const text = String(textValue || '').trim();
    const signed = text.match(/库存\s*([+＋\-－])\s*(\d+)\s*(?:个|件|套)?/u);
    if (signed) {
        return (/[+＋]/u.test(signed[1]) ? 1 : -1) * Number(signed[2]);
    }
    const action = text.match(/(?:各|都|我都)?\s*(入库|进(?:货|了)?|出库|库存(?:增加|减少|加|减)|(?:增加|减少|加|减)库存)\s*(\d+)\s*(?:个|件|套)?/u);
    if (!action) return 0;
    return (/出库|减少|减/u.test(action[1]) ? -1 : 1) * Number(action[2]);
}

function explicitSharedPartModels(textValue) {
    const text = String(textValue || '').trim();
    const prefix = text.match(/^(.{1,500}?)(?:各|都|我都)?\s*(?:入库|进(?:货|了)?|出库|库存\s*[+＋\-－]|库存(?:增加|减少|加|减)|(?:增加|减少|加|减)库存|把库存\s*[+＋\-－])/u)?.[1] || '';
    if (!prefix || /这(?:两|二|几|些)个?型号|这些型号|上述型号|上面/u.test(prefix)) return [];
    return uniqueInventoryModels(
        prefix
            .replace(/^(?:请|帮我|麻烦|把|将|给|零件|配件)\s*/u, '')
            .split(/\s*(?:、|，|,|；|;|和|与)\s*/u)
            .map(value => value
                .replace(/^型号\s*/u, '')
                .trim()
                // “型号的库存”中的“的”是自然语言连接词，不属于未加引号的型号。
                // 明确加引号的型号由 quotedPartModels 单独提取并保持原样。
                .replace(/\s*的$/u, '')
                .trim())
            .filter(value => /^[\p{L}\p{N}][\p{L}\p{N}\s._+#/()（）\-－]{0,119}$/u.test(value))
    );
}

function referencedPartModels(messages = [], latestText = '') {
    const count = /这(?:两|二)个(?:型号|零件|配件)?/u.test(latestText) ? 2 : null;
    const hasReference = Boolean(
        count
        || /这(?:几|些)个?(?:型号|零件|配件)|这些型号|上述型号|上面(?:这些|几个|列出)?(?:型号|零件|配件)/u.test(latestText)
    );
    if (!hasReference) return [];

    const priorAssistantMessages = [...messages]
        .slice(0, -1)
        .reverse()
        .filter(message => message?.role === 'assistant' && typeof message.content === 'string');
    for (const message of priorAssistantMessages) {
        const models = quotedPartModels(message.content);
        if (count && models.length === count) return models;
        if (!count && models.length > 0 && models.length <= 100) return models;
    }
    return [];
}

function parsePartInventoryInstruction(messagesValue) {
    const messages = Array.isArray(messagesValue)
        ? messagesValue
        : [{ role: 'user', content: String(messagesValue || '') }];
    const text = latestUserText(messages);
    if (
        !text
        || !hasInventoryWriteIntent(text)
        || (/线圈|定子/u.test(text) && !/零件|配件/u.test(text))
    ) {
        return null;
    }

    const changeQty = sharedPartInventoryQuantity(text);
    if (!Number.isInteger(changeQty) || changeQty === 0) return null;
    const models = uniqueInventoryModels([
        ...quotedPartModels(text),
        ...explicitSharedPartModels(text),
    ]);
    const resolvedModels = models.length > 0
        ? models
        : referencedPartModels(messages, text);
    if (resolvedModels.length === 0) return null;
    return {
        items: resolvedModels.map(model => ({ model, changeQty })),
    };
}

function buildFreshLookupToolCalls(messages = []) {
    const latestText = latestUserText(messages);
    const partInventory = parsePartInventoryInstruction(messages);
    if (partInventory && (/零件|配件/u.test(latestText) || !parseCoilInventoryInstruction(latestText))) {
        return [{ name: 'adjust_part_stock', args: partInventory }];
    }
    const coilInventory = parseCoilInventoryInstruction(latestText);
    if (coilInventory) {
        return [{ name: 'adjust_coil_stock', args: coilInventory }];
    }
    if (partInventory) return [{ name: 'adjust_part_stock', args: partInventory }];
    const text = resolveFreshLookupText(messages);
    const explicitKnowledgeCall = explicitKnowledgeLookup(text);
    if (explicitKnowledgeCall) return [explicitKnowledgeCall];
    if (!requiresFreshToolLookup(messages)) return [];

    if (MANAGEMENT_ACTION_INTENT_RE.test(text)) {
        return [{ name: 'get_management_action_center', args: {} }];
    }
    const purposeQuery = purposeLookupQuery(text);
    if (purposeQuery) {
        return [{
            name: 'search_factory_knowledge',
            args: { query: purposeQuery, limit: 10 },
        }];
    }
    const businessQuery = compileBusinessQuery(text);
    if (businessQuery) {
        return [{ name: businessQuery.name, args: businessQuery.args }];
    }

    if (/铜价/.test(text)) {
        return [{ name: 'get_copper_price', args: {} }];
    }

    const coilKey = /线圈/.test(text) ? coilSpecSheetKey(text) : '';
    if (coilKey) {
        return [{
            name: 'search_factory_knowledge',
            args: { query: coilKey, entryType: 'coil', limit: 10 },
        }];
    }

    const query = freshLookupQuery(text);
    return [{
        name: 'search_factory_knowledge',
        args: { query, limit: 10 },
    }];
}

module.exports = {
    requiresFreshToolLookup,
    buildFreshLookupToolCalls,
    coilSpecSheetKey,
    parseCoilInventoryInstruction,
    parsePartInventoryInstruction,
    hasInventoryWriteIntent,
    explicitKnowledgeLookup,
    purposeLookupQuery,
    isDeterministicFreshLookupCalls,
    resolveFreshLookupText,
    MANAGEMENT_ACTION_INTENT_RE,
};
