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

    const normalizedQuery = normalizeResourceText(query);
    const exactMatches = normalizedQuery
        ? resources.filter(row => nameKeys.some(key => (
            normalizeResourceText(row?.[key]) === normalizedQuery
        )))
        : [];
    const matches = exactMatches.length > 0
        ? exactMatches
        : resources.filter(row => nameKeys.some(key => (
            normalizedQuery && normalizeResourceText(row?.[key]).includes(normalizedQuery)
        )));

    if (matches.length === 0) {
        return {
            code: 'AI_RESOURCE_NOT_FOUND',
            entityType,
            query,
            error: `未找到${entityLabel}：${query || '-'}`,
        };
    }
    if (matches.length > 1) {
        return ambiguousResourceResolution({
            entityType,
            query,
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
        const selectedText = normalizeResourceText(args?.[fields.name]);
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
    normalizeResourceText,
    normalizeResolutionContext,
    normalizeToolClarification,
    resolutionContextPrompt,
    resolveUniqueResource,
};
