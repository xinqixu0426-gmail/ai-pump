const RESOURCE_LABELS = Object.freeze({
    recipe: '配方',
    order: '订单',
    customer: '客户',
    part: '零件',
    coil: '线圈方案',
    template: '泵壳模板',
    quotation: '报价',
    resource: '业务对象',
});

function normalizeResourceText(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

/**
 * 用户口语会把语气助词和标点粘在对象名后面（"V550的"、"V550 吧"、"V550呢？"）。
 * 这些噪声不是任何正式名称的一部分：不剥离就会让一个本来能唯一命中的简称
 * 退化成 `未找到配方：V550的`，把用户原话当成实体名回显给用户。
 * 只剥离查询串末尾的语气助词、标点和空白，不改动名称本身的归一化。
 */
const QUERY_TRAILING_NOISE_RE = /(?:[的了吧呢啊吗呀嘛哦喔噢哈哪啦嘞么]|[。，、；：？！,.;:?!~～\s])+$/u;

function stripQueryNoise(value) {
    return String(value ?? '').replace(QUERY_TRAILING_NOISE_RE, '');
}

/** 查询串的候选形态，原样优先（正式名称可能真的以这些字符结尾），剥离后兜底。 */
function queryCandidates(value) {
    const raw = String(value ?? '').trim();
    const stripped = stripQueryNoise(raw).trim();
    return [...new Set([raw, stripped].filter(Boolean))];
}

/** 查询串归一化：先剥离口语噪声再归一，用于匹配用户输入而不是资源名称。 */
function normalizeResourceQuery(value) {
    const candidates = queryCandidates(value);
    return normalizeResourceText(candidates[candidates.length - 1] || '');
}

/**
 * 用户会用"变更描述"提问（"12-120换成12-140"、"550的重新核算"），模型有时把整句话塞进型号字段。
 * 这句话不是任何正式名称：把它当成名称去查，只能得到"未找到配方：<整句话>"——那等于把用户的
 * 变更意图误报成"这个对象不存在"，还会污染回答。
 * 判定只在"所有名称形态都没命中"之后执行，所以任何原本能解析的输入行为不变。
 */
const INSTRUCTION_MARKERS_RE = /(?:换成|换为|改为|改成|替换|换掉|重新核算|重新算|核算|算一下|是多少|多少钱|的成本|的价格|去掉|不要|加装|减少|增加|我要找|我想找|帮我|麻烦|查一下|查询|看看|看一下|列出|有哪些|哪个|哪些|是什么|怎么样)/u;
const INSTRUCTION_SEPARATORS_RE = /[\s，,。；;：:、]/u;

function looksLikeInstructionFragment(value) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    if (text.length > 40) return true;
    if (!INSTRUCTION_MARKERS_RE.test(text)) return false;
    // 短型号（"加装件-X"）不按句子处理；变更描述通常是完整短句或多段。
    return text.length >= 8 || INSTRUCTION_SEPARATORS_RE.test(text);
}

const NOT_A_NAME_HINTS = Object.freeze({
    recipe: '这是对已有配方的变更或追问，不是配方名称。请用已确认的 recipeId；已有在售配方可作基准（baseRecipeId）配合 overrides 试算，不要拿整句话去查名称。',
    template: '这是对已有泵壳模板的变更或追问，不是模板型号。请用已确认的 templateId 读取或试算，不要拿整句话去查型号。',
    coil: '这是对已有线圈方案的变更或追问，不是方案编码。请先用 search_coils 取得正式方案 ID，不要拿整句话去查方案名。',
    default: '这是变更或提问描述，不是业务对象名称。请改用已确认的对象 ID 继续原目标，不要拿整句话去查名称。',
});

function notANameFailure(entityType, entityLabel, query) {
    return {
        code: 'AI_RESOURCE_QUERY_NOT_A_NAME',
        entityType,
        query,
        error: `“${query}”是变更或提问描述，不是${entityLabel}名称`,
        hint: NOT_A_NAME_HINTS[entityType] || NOT_A_NAME_HINTS.default,
    };
}

function firstText(candidate, keys) {
    for (const key of keys) {
        const value = String(candidate?.[key] ?? '').trim();
        if (value) return value;
    }
    return '';
}

function inferEntityType(toolName = '') {
    const name = String(toolName || '');
    if (name.includes('recipe')) return 'recipe';
    if (name.includes('order')) return 'order';
    if (name.includes('customer')) return 'customer';
    if (name.includes('coil')) return 'coil';
    if (name.includes('template') || name.includes('pump_shell')) return 'template';
    if (name.includes('quotation')) return 'quotation';
    if (name.includes('part')) return 'part';
    return 'resource';
}

function candidateLabel(candidate, entityType = 'resource') {
    if (entityType === 'order') {
        const contractNo = firstText(candidate, ['contractNo']);
        const customerName = firstText(candidate, ['customerName', 'name']);
        return [contractNo, customerName].filter(Boolean).join(' · ')
            || firstText(candidate, ['title', 'model'])
            || '未命名订单';
    }
    if (entityType === 'coil') {
        const spec = firstText(candidate, ['schemeName', 'model', 'spec']);
        const sheets = firstText(candidate, ['sheets']);
        const variant = [candidate?.material, candidate?.slotType].filter(Boolean).join('/');
        return `${spec}${sheets && !spec.includes(sheets) ? `-${sheets}` : ''}${variant ? `（${variant}）` : ''}`;
    }
    return firstText(candidate, [
        'name', 'recipeName', 'model', 'shellModel', 'customerName', 'contractNo', 'title', 'label',
    ]) || '未命名对象';
}

function candidateDescription(candidate, entityType = 'resource') {
    const values = [];
    const append = (label, value) => {
        const text = String(value ?? '').trim();
        if (text && !values.some(item => item.endsWith(text))) values.push(`${label}${text}`);
    };
    if (entityType === 'recipe') append('规格：', candidate?.spec);
    if (entityType === 'order') {
        append('状态：', candidate?.status);
    } else {
        append('供应商：', candidate?.supplier);
        append('状态：', candidate?.status);
    }
    return values.join('；');
}

function clarificationCandidate(candidate, index, entityType) {
    return {
        index: index + 1,
        label: candidateLabel(candidate, entityType),
        description: candidateDescription(candidate, entityType),
        canonicalId: candidate?.id ?? candidate?.Id ?? null,
        canonicalName: firstText(candidate, [
            'name', 'recipeName', 'model', 'shellModel', 'contractNo', 'customerName', 'title',
        ]),
    };
}

function ambiguousResourceResolution(input = {}) {
    const entityType = RESOURCE_LABELS[input.entityType] ? input.entityType : 'resource';
    const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
        .slice(0, 10);
    const label = RESOURCE_LABELS[entityType];
    const query = String(input.query || '').trim();
    return {
        code: 'AI_RESOURCE_AMBIGUOUS',
        entityType,
        query,
        error: query
            ? `“${query}”匹配到 ${candidates.length} 个${label}，需要确认具体对象`
            : `匹配到 ${candidates.length} 个${label}，需要确认具体对象`,
        requiresClarification: true,
        candidates,
        clarification: {
            version: 3,
            kind: 'resource_selection',
            entityType,
            entityLabel: label,
            query,
            prompt: `请确认要查询哪个${label}`,
            candidates: candidates.map((candidate, index) => (
                clarificationCandidate(candidate, index, entityType)
            )),
            acceptedReplies: ['序号', '完整名称', '能唯一识别的名称或规格'],
        },
    };
}

function resolveUniqueResource(rows, options = {}) {
    const resources = Array.isArray(rows) ? rows : [];
    const idKeys = options.idKeys || ['id', 'Id'];
    const nameKeys = options.nameKeys || ['name'];
    const entityType = options.entityType || 'resource';
    const entityLabel = RESOURCE_LABELS[entityType] || RESOURCE_LABELS.resource;
    const explicitId = Number.parseInt(options.explicitId, 10);
    const query = String(options.query || '').trim();

    if (Number.isInteger(explicitId) && explicitId > 0) {
        const resource = resources.find(row => idKeys.some(key => Number(row?.[key]) === explicitId));
        return resource
            ? { resource }
            : {
                code: 'AI_RESOURCE_NOT_FOUND',
                entityType,
                query: String(explicitId),
                error: `未找到${entityLabel}：${explicitId}`,
            };
    }

    // 原样查询优先（正式名称可能真的以语气助词结尾），剥离口语噪声后的形态兜底。
    const candidates = queryCandidates(query);
    let matches = [];
    let matchedQuery = query;
    for (const candidate of candidates) {
        const normalizedQuery = normalizeResourceText(candidate);
        if (!normalizedQuery) continue;
        const exactMatches = resources.filter(row => nameKeys.some(key => (
            normalizeResourceText(row?.[key]) === normalizedQuery
        )));
        const found = exactMatches.length > 0
            ? exactMatches
            : resources.filter(row => nameKeys.some(key => (
                normalizeResourceText(row?.[key]).includes(normalizedQuery)
            )));
        if (found.length > 0) {
            matches = found;
            matchedQuery = candidate;
            break;
        }
    }

    if (matches.length === 0) {
        // 确实不存在时，用剥离噪声后的查询回答"不存在"，不把用户原话片段当实体名回显。
        const reported = candidates[candidates.length - 1] || query;
        // 变更描述不是"不存在"：分开回答，并给出可执行的下一步。
        if (looksLikeInstructionFragment(reported)) {
            return notANameFailure(entityType, entityLabel, reported);
        }
        return {
            code: 'AI_RESOURCE_NOT_FOUND',
            entityType,
            query: reported,
            error: `未找到${entityLabel}：${reported || '-'}`,
        };
    }
    if (matches.length > 1) {
        return ambiguousResourceResolution({
            entityType,
            query: matchedQuery,
            candidates: options.candidateView
                ? matches.map(options.candidateView)
                : matches,
        });
    }
    return { resource: matches[0] };
}

function normalizeToolClarification(toolName, result = {}) {
    if (!result || typeof result !== 'object') return null;
    if (result.clarification?.kind === 'resource_selection') return result.clarification;
    const variants = result?.data?.requiresVariantSelection
        ? result.data.variants
        : null;
    const candidates = Array.isArray(result.candidates)
        ? result.candidates
        : Array.isArray(variants)
            ? variants
            : [];
    if (candidates.length === 0) return null;
    if (
        result.requiresClarification !== true
        && result.success !== false
        && result?.data?.requiresVariantSelection !== true
    ) return null;
    return ambiguousResourceResolution({
        entityType: result.entityType || inferEntityType(toolName),
        query: result.query || '',
        candidates,
    }).clarification;
}

function findToolClarification(toolResults = []) {
    for (const item of Array.isArray(toolResults) ? toolResults : []) {
        const clarification = normalizeToolClarification(item?.name, item?.result);
        if (clarification) return { item, clarification };
    }
    return null;
}

function buildResourceClarificationReply(clarification = {}) {
    const candidates = Array.isArray(clarification.candidates)
        ? clarification.candidates
        : [];
    const lines = candidates.map(candidate => {
        const suffix = candidate.description ? ` — ${candidate.description}` : '';
        return `${candidate.index}. **${candidate.label}**${suffix}`;
    });
    const query = clarification.query ? `“${clarification.query}”` : '你的描述';
    const accepted = (clarification.acceptedReplies || []).join('、');
    return [
        `${query}匹配到 ${candidates.length} 个${clarification.entityLabel || '业务对象'}，请确认具体是哪一个：`,
        '',
        ...lines,
        '',
        `回复${accepted || '序号或完整名称'}即可。确认后我会继续查询正式结果。`,
    ].join('\n');
}

function normalizeResolutionContext(input = {}) {
    if (!input || input.version !== 3 || input.kind !== 'resource_selection') return null;
    const sourceTool = String(input.sourceTool || '').trim().slice(0, 80);
    const entityType = RESOURCE_LABELS[input.entityType] ? input.entityType : 'resource';
    const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
        .slice(0, 10)
        .map((candidate, index) => ({
            index: Number.isInteger(candidate?.index) ? candidate.index : index + 1,
            label: String(candidate?.label || '').trim().slice(0, 160),
            description: String(candidate?.description || '').trim().slice(0, 240),
            canonicalId: Number.isInteger(Number(candidate?.canonicalId))
                ? Number(candidate.canonicalId)
                : null,
            canonicalName: String(candidate?.canonicalName || '').trim().slice(0, 160),
        }))
        .filter(candidate => candidate.label || candidate.canonicalName || candidate.canonicalId);
    if (!sourceTool || candidates.length < 2) return null;
    return {
        version: 3,
        kind: 'resource_selection',
        sourceTool,
        entityType,
        entityLabel: RESOURCE_LABELS[entityType],
        query: String(input.query || '').trim().slice(0, 160),
        candidates,
    };
}

function resolutionContextPrompt(context) {
    const normalized = normalizeResolutionContext(context);
    if (!normalized) return '';
    const candidates = normalized.candidates.map(candidate => (
        `${candidate.index}. ${candidate.canonicalName || candidate.label}${candidate.description ? `（${candidate.description}）` : ''}`
    ));
    return [
        '上一轮执行层已通过正式 API 返回以下待确认候选。当前回复若是在选择候选，必须保持原能力和原目标：',
        ...candidates,
        `原能力：${normalized.sourceTool}。不得选择候选列表之外的对象，不得生成内部 ID。`,
    ].join('\n');
}

const RESOLUTION_ARG_FIELDS = Object.freeze({
    recipe: { id: 'recipeId', name: 'recipeName' },
    order: { id: 'orderId', name: 'orderQuery' },
    customer: { id: 'customerId', name: 'customerName' },
    part: { id: 'partId', name: 'model' },
    coil: { id: 'coilId', name: 'model' },
    template: { id: 'templateId', name: 'shellModel' },
    quotation: { id: 'quotationId', name: 'quotationNo' },
});

function bindResolutionToolCalls(toolCalls = [], context) {
    const normalized = normalizeResolutionContext(context);
    if (!normalized) return { toolCalls };
    const fields = RESOLUTION_ARG_FIELDS[normalized.entityType];
    if (!fields) return { toolCalls };

    let issue = null;
    const boundCalls = toolCalls.map(toolCall => {
        if (toolCall?.function?.name !== normalized.sourceTool) return toolCall;
        let args;
        try {
            args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
            issue = '候选选择参数不是有效 JSON';
            return toolCall;
        }
        const explicitId = Number(args?.[fields.id]);
        const selectedText = normalizeResourceQuery(args?.[fields.name]);
        const matches = normalized.candidates.filter(candidate => {
            if (Number.isInteger(explicitId) && explicitId > 0) {
                return Number(candidate.canonicalId) === explicitId;
            }
            if (!selectedText) return false;
            const names = [candidate.canonicalName, candidate.label]
                .map(normalizeResourceText)
                .filter(Boolean);
            return names.some(name => name === selectedText || name.includes(selectedText));
        });
        if (matches.length !== 1) {
            issue = '当前回复未能唯一绑定到上一轮正式候选';
            return toolCall;
        }
        const selected = matches[0];
        const nextArgs = { ...args };
        if (selected.canonicalId) {
            nextArgs[fields.id] = selected.canonicalId;
            delete nextArgs[fields.name];
        } else {
            nextArgs[fields.name] = selected.canonicalName || selected.label;
        }
        return {
            ...toolCall,
            function: {
                ...toolCall.function,
                arguments: JSON.stringify(nextArgs),
            },
        };
    });
    return { toolCalls: boundCalls, issue };
}

module.exports = {
    RESOURCE_LABELS,
    ambiguousResourceResolution,
    buildResourceClarificationReply,
    bindResolutionToolCalls,
    findToolClarification,
    inferEntityType,
    looksLikeInstructionFragment,
    normalizeResourceQuery,
    normalizeResourceText,
    normalizeResolutionContext,
    normalizeToolClarification,
    queryCandidates,
    resolutionContextPrompt,
    resolveUniqueResource,
    stripQueryNoise,
};
