const { getAiCapability } = require('../capabilities/registry.cjs');
const {
    ambiguousResourceResolution,
    normalizeResourceText,
} = require('./aiResourceResolutionV3.cjs');
const {
    ENTITY_DESCRIPTORS,
    TOOL_TARGETS,
} = require('./aiCapabilityGraphV3.cjs');

const MAX_PROBES = 5;
const MAX_CANDIDATES = 10;
const AUTO_BIND_SCORE = 0.6;
const AUTO_BIND_MARGIN = 0.12;

function normalizedIdentity(value) {
    return normalizeResourceText(value)
        .normalize('NFKC')
        .replace(/[\s._+#/()（）\-－]/gu, '');
}

function isCjkText(value) {
    return /^[\p{Script=Han}]+$/u.test(value);
}

function buildSearchProbes(value) {
    const original = String(value || '').trim();
    const normalized = normalizedIdentity(original);
    const probes = [];
    const append = probe => {
        const text = String(probe || '').trim();
        if (text && !probes.includes(text)) probes.push(text);
    };
    append(original);
    if (isCjkText(normalized)) {
        for (let length = normalized.length - 1; length >= 1; length -= 1) {
            append(normalized.slice(0, length));
        }
    } else {
        // 型号中的分隔符经常被模型或用户省略，例如
        // V750-大脚板-2寸 -> V750大脚板2寸。先用稳定型号前缀调查正式目录，
        // 再用忽略分隔符的完整身份评分选择，避免依赖脆弱的逐字符截断。
        append(original.match(/^[A-Za-z]+\d+/)?.[0]);
        const tokens = original.split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);
        tokens.sort((left, right) => right.length - left.length).forEach(append);
        for (let length = normalized.length - 1; length >= 2; length -= 1) {
            append(normalized.slice(0, length));
        }
    }
    return probes.slice(0, MAX_PROBES);
}

function editDistance(left, right) {
    const a = [...left];
    const b = [...right];
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const saved = row[j];
            row[j] = Math.min(
                row[j] + 1,
                row[j - 1] + 1,
                previous + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            previous = saved;
        }
    }
    return row[b.length];
}

function commonPrefixLength(left, right) {
    const size = Math.min(left.length, right.length);
    let index = 0;
    while (index < size && left[index] === right[index]) index += 1;
    return index;
}

function candidateScore(query, candidateText) {
    const needle = normalizedIdentity(query);
    const value = normalizedIdentity(candidateText);
    if (!needle || !value) return 0;
    if (needle === value) return 1;
    if (value.includes(needle)) return 0.9;
    if (needle.includes(value)) return 0.82;
    const maxLength = Math.max(needle.length, value.length);
    const editSimilarity = 1 - (editDistance(needle, value) / maxLength);
    const prefixSimilarity = commonPrefixLength(needle, value) / maxLength;
    return Math.max(
        0.4 + (editSimilarity * 0.4),
        0.45 + (prefixSimilarity * 0.35)
    );
}

function firstCandidateText(candidate, keys) {
    for (const key of keys || []) {
        const value = String(candidate?.[key] || '').trim();
        if (value && value !== '-') return value;
    }
    return '';
}

function candidateId(candidate, keys) {
    for (const key of keys || []) {
        const value = Number(candidate?.[key]);
        if (Number.isSafeInteger(value) && value > 0) return value;
    }
    return null;
}

function candidateView(candidate, descriptor, query) {
    const compositeNames = (descriptor.candidateCompositeKeys || [])
        .map(keys => keys.map(key => String(candidate?.[key] || '').trim()).filter(Boolean).join('-'))
        .filter(Boolean);
    const names = [
        ...(descriptor.candidateNameKeys || [])
        .map(key => String(candidate?.[key] || '').trim())
        .filter(value => value && value !== '-'),
        ...compositeNames,
    ]
        .map(name => ({ name, score: candidateScore(query, name) }))
        .sort((left, right) => right.score - left.score);
    const name = names[0]?.name || firstCandidateText(candidate, descriptor.candidateNameKeys) || '';
    const id = candidateId(candidate, descriptor.candidateIdKeys);
    return {
        id,
        name,
        label: name,
        score: names[0]?.score || candidateScore(query, name),
        matchedText: names[0]?.name || name,
        raw: candidate,
    };
}

function resultRows(result) {
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

function rowsMatchingTarget(rows, target, args) {
    const filters = Object.entries(target.candidateFilters || {}).filter(([argumentField]) => (
        args?.[argumentField] !== undefined && args?.[argumentField] !== null && args?.[argumentField] !== ''
    ));
    if (filters.length === 0) return rows;
    return rows.filter(row => filters.every(([argumentField, candidateField]) => (
        normalizedIdentity(row?.[candidateField]) === normalizedIdentity(args[argumentField])
    )));
}

function mergeCandidates(target, rows, descriptor, query) {
    for (const row of rows) {
        const view = candidateView(row, descriptor, query);
        if (!view.name && !view.id) continue;
        const key = `${view.id || ''}\u0000${view.name}`;
        const current = target.get(key);
        if (!current || view.score > current.score) target.set(key, view);
    }
}

function resolutionReceipt(input = {}) {
    const selected = input.selected
        ? {
            id: input.selected.id || null,
            name: String(input.selected.name || ''),
            score: Math.round(Number(input.selected.score || 0) * 1000) / 1000,
        }
        : null;
    return {
        version: 3,
        kind: 'entity_resolution',
        entityType: input.entityType,
        originalMention: input.originalMention,
        probes: input.probes,
        status: input.status,
        selected,
        candidates: (input.candidates || []).map(candidate => ({
            id: candidate.id,
            name: candidate.name,
            score: Math.round(candidate.score * 1000) / 1000,
        })),
        sourceCapability: input.sourceCapability,
        sourceEvidence: input.sourceEvidence || [],
    };
}

function clarificationResource(candidate, entityType) {
    const raw = candidate.raw || {};
    if (entityType === 'order') {
        return {
            id: candidate.id,
            customerName: raw.customer || candidate.name,
            contractNo: raw.contract === '-' ? '' : raw.contract || '',
            status: raw.status || '',
        };
    }
    if (entityType === 'template') {
        return { id: candidate.id, shellModel: raw.shellModel || candidate.name };
    }
    if (entityType === 'part') {
        return {
            id: candidate.id,
            model: raw.model || candidate.name,
            supplier: raw.supplier || '',
        };
    }
    if (entityType === 'coil') {
        return {
            id: candidate.id,
            model: raw.model || candidate.name,
            spec: raw.spec || '',
            sheets: raw.sheets || '',
            material: raw.material || '',
            slotType: raw.slotType || '',
        };
    }
    return { id: candidate.id, name: raw.name || candidate.name, spec: raw.spec || '' };
}

async function resolveAiToolTargetV3(input = {}) {
    const target = TOOL_TARGETS[input.toolName];
    if (!target) return { status: 'not_applicable', args: input.args };
    const descriptor = ENTITY_DESCRIPTORS[target.entityType];
    const inputFields = Array.isArray(target.inputFields)
        ? target.inputFields
        : [target.inputField];
    const mention = String(inputFields
        .map(field => input.args?.[field])
        .find(value => String(value || '').trim()) || '').trim();
    if (!descriptor || !mention) return { status: 'not_applicable', args: input.args };
    const capability = getAiCapability(input.toolName);
    const discoveryCapability = descriptor.discoveryCapability;
    const probes = buildSearchProbes(mention);
    const candidates = new Map();
    const sourceEvidence = [];

    for (const probe of probes) {
        for (const discoveryArg of descriptor.discoveryArgs || [null]) {
            const discoveryArgs = discoveryArg ? { [discoveryArg]: probe } : {};
            const result = await input.executeToolCall(discoveryCapability, discoveryArgs, {
                allowWrite: false,
                confirmationSubject: input.confirmationSubject,
            });
            sourceEvidence.push({
                capabilityName: discoveryCapability,
                probe,
                arguments: discoveryArgs,
                executionEvidence: result?.executionEvidence || null,
                count: Number(result?.count ?? resultRows(result).length),
            });
            if (result?.success === false && result?.executionEvidence?.verified !== true) {
                return {
                    status: 'system_error',
                    args: input.args,
                    error: result.error || `${descriptor.label}候选查询失败`,
                    result,
                };
            }
            mergeCandidates(
                candidates,
                rowsMatchingTarget(resultRows(result), target, input.args),
                descriptor,
                mention
            );
            if (candidates.size > 0) break;
        }
        if (candidates.size > 0) break;
    }

    const ranked = [...candidates.values()]
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'zh-CN'))
        .slice(0, MAX_CANDIDATES);
    if (ranked.length === 0) {
        return {
            status: 'not_found',
            args: input.args,
            receipt: resolutionReceipt({
                entityType: target.entityType,
                originalMention: mention,
                probes,
                status: 'not_found',
                candidates: [],
                sourceCapability: discoveryCapability,
                sourceEvidence,
            }),
        };
    }

    const selected = ranked[0];
    if (selected.score < AUTO_BIND_SCORE) {
        return {
            status: 'not_found',
            args: input.args,
            receipt: resolutionReceipt({
                entityType: target.entityType,
                originalMention: mention,
                probes,
                status: 'not_found',
                candidates: ranked,
                sourceCapability: discoveryCapability,
                sourceEvidence,
            }),
        };
    }
    const exact = selected.score === 1;
    const uniqueExact = exact && ranked.filter(candidate => candidate.score === 1).length === 1;
    const margin = selected.score - Number(ranked[1]?.score || 0);
    const uniqueEnough = ranked.length === 1
        ? selected.score >= AUTO_BIND_SCORE
        : selected.score >= AUTO_BIND_SCORE && margin >= AUTO_BIND_MARGIN;
    const canAutoBind = uniqueExact || (capability?.access === 'read' && uniqueEnough);
    const receipt = resolutionReceipt({
        entityType: target.entityType,
        originalMention: mention,
        probes,
        status: canAutoBind ? (uniqueExact ? 'exact' : 'unique_candidate') : 'ambiguous',
        selected: canAutoBind ? selected : null,
        candidates: ranked,
        sourceCapability: discoveryCapability,
        sourceEvidence,
    });
    if (!canAutoBind) {
        const ambiguous = ambiguousResourceResolution({
            entityType: target.entityType,
            query: mention,
            candidates: ranked.map(candidate => clarificationResource(candidate, target.entityType)),
        });
        return {
            status: 'ambiguous',
            args: input.args,
            receipt,
            result: { success: false, ...ambiguous, resolutionReceipt: receipt },
        };
    }

    const args = { ...input.args };
    if (target.outputFields) {
        for (const [outputField, candidateField] of Object.entries(target.outputFields)) {
            if (selected.raw?.[candidateField] !== undefined && selected.raw?.[candidateField] !== null) {
                args[outputField] = selected.raw[candidateField];
            }
        }
    } else if (target.outputIdField && selected.id) {
        args[target.outputIdField] = selected.id;
        inputFields.forEach(field => delete args[field]);
    } else {
        args[target.outputField || target.inputField] = selected.name;
    }
    return { status: receipt.status, args, receipt };
}

module.exports = {
    AUTO_BIND_MARGIN,
    AUTO_BIND_SCORE,
    buildSearchProbes,
    candidateScore,
    editDistance,
    resolveAiToolTargetV3,
};
