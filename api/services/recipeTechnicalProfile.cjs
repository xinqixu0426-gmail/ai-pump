const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { BEARING_DB, normalizeBearing } = require('./rotorParameters.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { parsePositiveId } = require('./validation.cjs');
const {
    getFunctionalProfile,
    getTechnicalKnowledge,
    persistFunctionalProfile,
    persistTechnicalKnowledge,
    writeRecipeTechnicalAudit,
} = require('./recipeTechnicalProfileStore.cjs');

const GET_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.get').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.update').capabilityId;
const FUNCTIONAL_FIELDS = Object.freeze([
    'rotorDiameter', 'stackOffset', 'oilSealDiameter', 'impellerBoreDiameter',
    'impellerSpan', 'impellerThickness', 'threadLength', 'threadDiameter',
    'barrelLength', 'openOffset', 'bearingSpanExplicit',
    'upperBearingPartId', 'lowerBearingPartId',
]);
const NUMERIC_RULES = Object.freeze({
    rotorDiameter: value => value > 0,
    stackOffset: value => value >= 0,
    oilSealDiameter: value => value > 0,
    impellerBoreDiameter: value => value > 0,
    impellerSpan: value => value > 0,
    impellerThickness: value => value > 0,
    threadLength: value => value > 0,
    threadDiameter: value => value > 0,
    barrelLength: value => value > 0,
    openOffset: value => value >= 0,
    bearingSpanExplicit: value => value > 0,
});
const PROFILE_COLUMN_BY_FIELD = Object.freeze({
    rotorDiameter: 'rotor_diameter', stackOffset: 'stack_offset',
    oilSealDiameter: 'oil_seal_diameter', impellerBoreDiameter: 'impeller_bore_diameter',
    impellerSpan: 'impeller_span', impellerThickness: 'impeller_thickness',
    threadLength: 'thread_length', threadDiameter: 'thread_diameter',
    barrelLength: 'barrel_length', openOffset: 'open_offset',
    bearingSpanExplicit: 'bearing_span_explicit',
    upperBearingPartId: 'upper_bearing_part_id', lowerBearingPartId: 'lower_bearing_part_id',
});
const KNOWLEDGE_ITEM_FIELDS = new Set(['key', 'label', 'value', 'unit', 'valueType', 'evidence']);
const FORBIDDEN_KNOWLEDGE_FIELDS = new Set([
    'canonicalIdentity', 'candidateSelectionEvidence', 'policyInput', 'costInput',
    'bomInput', 'relationBinding', 'derivation', 'requiredWhen', 'writeCapability',
]);

function error(code, message, statusCode = 409, details) {
    const result = new CommandExecutionError(code, message, statusCode);
    if (details !== undefined) result.details = details;
    return result;
}

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return plainObject(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeRecipeId(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) throw error('recipe_id_invalid', '非法配方ID', 400);
    return recipeId;
}

function getActiveRecipe(db, recipeId) {
    const recipe = db.prepare(`
        SELECT id, template_id, deleted_at
        FROM recipes WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!recipe) throw error('recipe_not_found', '配方不存在', 404);
    return recipe;
}

function resolveStainlessMode(db, recipeId, recipe = null) {
    const currentRecipe = recipe || getActiveRecipe(db, recipeId);
    if (!currentRecipe.template_id) {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'TEMPLATE_MISSING', templateId: null, shellPartId: null };
    }
    const template = db.prepare(`
        SELECT id FROM pump_shell_templates WHERE id = ?
    `).get(currentRecipe.template_id);
    if (!template) {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'TEMPLATE_NOT_FOUND', templateId: Number(currentRecipe.template_id), shellPartId: null };
    }
    const binding = db.prepare(`
        SELECT shell_part_id FROM catalog_template_shell_bindings WHERE template_id = ?
    `).get(template.id);
    if (!binding?.shell_part_id) {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'SHELL_BINDING_MISSING', templateId: Number(template.id), shellPartId: null };
    }
    const part = db.prepare(`
        SELECT id, category, remark, deleted_at FROM parts WHERE id = ?
    `).get(binding.shell_part_id);
    if (!part || part.deleted_at) {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'SHELL_PART_NOT_ACTIVE', templateId: Number(template.id), shellPartId: Number(binding.shell_part_id) };
    }
    if (part.category !== '泵壳') {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'SHELL_PART_CATEGORY_INVALID', templateId: Number(template.id), shellPartId: Number(part.id) };
    }
    let metadata;
    try { metadata = JSON.parse(part.remark || '{}'); } catch { metadata = null; }
    const value = metadata?.isStainless;
    if (typeof value !== 'boolean') {
        return { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, reasonCode: 'PUMP_SHELL_STAINLESS_MISSING', templateId: Number(template.id), shellPartId: Number(part.id) };
    }
    const explicitBoolean = value;
    return {
        stainlessMode: explicitBoolean ? 'STAINLESS' : 'NON_STAINLESS',
        isStainless: explicitBoolean,
        reasonCode: explicitBoolean ? 'FORMAL_SHELL_PART_STAINLESS' : 'FORMAL_SHELL_PART_NON_STAINLESS',
        templateId: Number(template.id), shellPartId: Number(part.id),
    };
}

function normalizeOptionalNumber(field, value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || !NUMERIC_RULES[field](value)) {
        throw error('technical_profile_functional_invalid', `${field} 数值不合法`, 422);
    }
    return value;
}

function normalizePartId(field, value) {
    if (value === null || value === undefined) return null;
    if (!Number.isInteger(value) || value <= 0) {
        throw error('technical_profile_functional_invalid', `${field} 必须是正整数或 null`, 400);
    }
    return value;
}

function normalizeFunctional(value) {
    if (!plainObject(value)) throw error('technical_profile_functional_invalid', 'functional 必须是对象', 400);
    for (const key of Object.keys(value)) {
        if (!FUNCTIONAL_FIELDS.includes(key)) throw error('technical_profile_functional_invalid', `functional 不支持字段 ${key}`, 400);
    }
    const normalized = {};
    for (const field of FUNCTIONAL_FIELDS) {
        normalized[field] = field.endsWith('PartId')
            ? normalizePartId(field, value[field])
            : normalizeOptionalNumber(field, value[field]);
    }
    return normalized;
}

function assertModeInput(functional, policy) {
    if (policy.stainlessMode === 'STAINLESS') {
        if (functional.bearingSpanExplicit !== null) {
            throw error('technical_profile_policy_unresolved_field', '不锈钢模式不允许写入 bearingSpanExplicit', 409);
        }
        if (functional.barrelLength !== null && functional.openOffset !== null
            && functional.barrelLength - functional.openOffset <= 0) {
            throw error('technical_profile_functional_invalid', 'barrelLength - openOffset 必须大于 0', 422);
        }
        return;
    }
    if (policy.stainlessMode === 'NON_STAINLESS') {
        if (functional.barrelLength !== null || functional.openOffset !== null) {
            throw error('technical_profile_policy_unresolved_field', '非不锈钢模式不允许写入 barrelLength 或 openOffset', 409);
        }
        return;
    }
    if ([functional.barrelLength, functional.openOffset, functional.bearingSpanExplicit].some(value => value !== null)) {
        throw error('technical_profile_policy_unresolved_field', '泵壳不锈钢状态未解析，条件字段必须保持 null', 409);
    }
}

function jsonSafe(value, depth = 0) {
    if (depth > 8) return false;
    if (value === null || ['string', 'boolean'].includes(typeof value)) return typeof value !== 'string' || value.length <= 4000;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => jsonSafe(item, depth + 1));
    if (!plainObject(value)) return false;
    const keys = Object.keys(value);
    return keys.length <= 50 && keys.every(key => key.length <= 100 && jsonSafe(value[key], depth + 1));
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function normalizeEvidence(db, recipeId, evidence) {
    if (evidence === undefined) return undefined;
    if (!plainObject(evidence) || Object.keys(evidence).some(key => key !== 'recipeTechnicalFileIds')) {
        throw error('technical_profile_knowledge_invalid', 'evidence 仅支持 recipeTechnicalFileIds', 400);
    }
    if (!Array.isArray(evidence.recipeTechnicalFileIds) || evidence.recipeTechnicalFileIds.length > 100) {
        throw error('technical_profile_knowledge_invalid', 'recipeTechnicalFileIds 必须是有限数组', 400);
    }
    const ids = evidence.recipeTechnicalFileIds.map((value, index) => {
        if (!Number.isInteger(value) || value <= 0) throw error('technical_profile_knowledge_invalid', `recipeTechnicalFileIds[${index}] 非法`, 400);
        return value;
    });
    if (new Set(ids).size !== ids.length) throw error('technical_profile_knowledge_invalid', 'recipeTechnicalFileIds 不可重复', 400);
    for (const id of ids) {
        const file = db.prepare(`SELECT id FROM recipe_technical_files WHERE id = ? AND recipe_id = ? AND deleted_at IS NULL`).get(id, recipeId);
        if (!file) throw error('technical_profile_knowledge_invalid', '技术资料证据文件不存在或不属于该配方', 404);
    }
    return { recipeTechnicalFileIds: ids };
}

function normalizeKnowledge(db, recipeId, value) {
    if (!plainObject(value) || Object.keys(value).some(key => key !== 'items') || !Array.isArray(value.items)) {
        throw error('technical_profile_knowledge_invalid', 'technicalKnowledge 必须仅包含 items 数组', 400);
    }
    if (value.items.length > 200) throw error('technical_profile_knowledge_invalid', 'items 最多 200 项', 400);
    const seen = new Set();
    return value.items.map((item, index) => {
        if (!plainObject(item)) throw error('technical_profile_knowledge_invalid', `items[${index}] 必须是对象`, 400);
        for (const key of Object.keys(item)) {
            if (FORBIDDEN_KNOWLEDGE_FIELDS.has(key)) throw error('technical_profile_knowledge_invalid', `技术资料不得包含功能控制字段 ${key}`, 400);
            if (!KNOWLEDGE_ITEM_FIELDS.has(key)) throw error('technical_profile_knowledge_invalid', `items[${index}] 不支持字段 ${key}`, 400);
        }
        if (typeof item.key !== 'string' || !(item.key = item.key.trim()) || item.key.length > 100 || seen.has(item.key)) {
            throw error('technical_profile_knowledge_invalid', `items[${index}].key 必须唯一且非空`, 400);
        }
        seen.add(item.key);
        if (typeof item.label !== 'string' || !(item.label = item.label.trim()) || item.label.length > 200 || !Object.prototype.hasOwnProperty.call(item, 'value') || !jsonSafe(item.value)) {
            throw error('technical_profile_knowledge_invalid', `items[${index}] 缺少合法 key、label 或 JSON value`, 400);
        }
        const normalized = { key: item.key, label: item.label, value: item.value };
        if (item.unit !== undefined) {
            if (typeof item.unit !== 'string' || !item.unit.trim() || item.unit.length > 64) throw error('technical_profile_knowledge_invalid', `items[${index}].unit 非法`, 400);
            normalized.unit = item.unit.trim();
        }
        if (item.valueType !== undefined) {
            if (typeof item.valueType !== 'string' || !item.valueType.trim() || item.valueType.length > 64) throw error('technical_profile_knowledge_invalid', `items[${index}].valueType 非法`, 400);
            normalized.valueType = item.valueType.trim();
        }
        const evidence = normalizeEvidence(db, recipeId, item.evidence);
        if (evidence) normalized.evidence = evidence;
        return normalized;
    });
}

function functionalFromRow(row) {
    if (!row) return null;
    const result = {};
    for (const field of FUNCTIONAL_FIELDS) result[field] = row[PROFILE_COLUMN_BY_FIELD[field]] ?? null;
    return result;
}

function bearingReference(db, partId) {
    if (!partId) return null;
    const part = db.prepare(`SELECT id, model, supplier, category, deleted_at, naming_json FROM parts WHERE id = ?`).get(partId);
    if (!part) return { partId: Number(partId), model: null, supplier: null, category: null, active: false, engineeringCode: null, geometryAvailable: false };
    const engineeringCode = normalizeBearing(bearingCodeOf(part));
    return {
        partId: Number(part.id), model: part.model, supplier: part.supplier, category: part.category,
        active: !part.deleted_at, engineeringCode: engineeringCode || null,
        geometryAvailable: Boolean(engineeringCode && BEARING_DB[engineeringCode]),
    };
}

function validateBearingPart(db, field, partId) {
    if (partId === null) return null;
    const part = db.prepare(`SELECT id, model, supplier, category, deleted_at, naming_json FROM parts WHERE id = ?`).get(partId);
    if (!part || part.deleted_at || part.category !== '轴承') {
        throw error('technical_profile_bearing_invalid', `${field} 必须引用活动轴承 Part`, !part ? 404 : 422);
    }
    return bearingReference(db, partId);
}

function derivedBearingSpan(functional, policy) {
    if (!functional) return { value: null, source: null, valid: false };
    if (policy.stainlessMode === 'STAINLESS') {
        if (functional.barrelLength === null || functional.openOffset === null) return { value: null, source: 'DERIVED', valid: false };
        const difference = functional.barrelLength - functional.openOffset;
        return difference > 0 ? { value: Number(difference.toFixed(1)), source: 'DERIVED', valid: true } : { value: null, source: 'DERIVED', valid: false };
    }
    if (policy.stainlessMode === 'NON_STAINLESS') return { value: functional.bearingSpanExplicit, source: 'EXPLICIT', valid: functional.bearingSpanExplicit !== null };
    return { value: null, source: 'UNKNOWN_OR_UNRESOLVED', valid: false };
}

function computeCompleteness(db, functional, policy, profileExists) {
    const reasons = [];
    if (!profileExists || !functional) reasons.push('CANONICAL_FUNCTIONAL_PROFILE_ABSENT');
    if (policy.stainlessMode === 'UNKNOWN_OR_UNRESOLVED') reasons.push(policy.reasonCode);
    if (!functional) return { state: 'INCOMPLETE', reasons };
    for (const field of ['rotorDiameter', 'stackOffset', 'oilSealDiameter', 'impellerBoreDiameter', 'impellerSpan', 'impellerThickness', 'threadLength', 'threadDiameter']) {
        if (functional[field] === null) reasons.push(`${field.toUpperCase()}_MISSING`);
    }
    for (const [label, field] of [['UPPER_BEARING', 'upperBearingPartId'], ['LOWER_BEARING', 'lowerBearingPartId']]) {
        if (functional[field] === null) reasons.push(`${label}_MISSING`);
        else {
            const reference = bearingReference(db, functional[field]);
            if (!reference.active || reference.category !== '轴承') reasons.push(`${label}_PART_INVALID`);
            else if (!reference.geometryAvailable) reasons.push(`${label}_GEOMETRY_UNRESOLVED`);
        }
    }
    if (policy.stainlessMode === 'STAINLESS') {
        if (functional.barrelLength === null) reasons.push('BARREL_LENGTH_MISSING');
        if (functional.openOffset === null) reasons.push('OPEN_OFFSET_MISSING');
        if (!derivedBearingSpan(functional, policy).valid) reasons.push('STAINLESS_BEARING_SPAN_INVALID');
    } else if (policy.stainlessMode === 'NON_STAINLESS' && functional.bearingSpanExplicit === null) reasons.push('BEARING_SPAN_EXPLICIT_MISSING');
    return { state: reasons.length === 0 ? 'COMPLETE' : 'INCOMPLETE', reasons: [...new Set(reasons)] };
}

function aggregateUpdatedAt(profile, knowledge) {
    return [profile?.updated_at, knowledge?.updated_at].filter(Boolean).sort().at(-1) || null;
}

function buildDto(db, recipeId, profile, knowledge, policy) {
    const functional = functionalFromRow(profile);
    const span = derivedBearingSpan(functional, policy);
    const completeness = computeCompleteness(db, functional, policy, Boolean(profile));
    if (!knowledge) completeness.reasons = [...new Set([...completeness.reasons, 'CANONICAL_TECHNICAL_KNOWLEDGE_ABSENT'])];
    return {
        recipeId,
        canonicalPresent: Boolean(profile || knowledge),
        schemaVersion: profile?.schema_version ?? knowledge?.schema_version ?? null,
        updatedAt: aggregateUpdatedAt(profile, knowledge),
        policy,
        functional: functional && {
            ...functional,
            bearingSpan: span.value,
            bearingSpanSource: span.source,
        },
        bearingReferences: {
            upper: functional ? bearingReference(db, functional.upperBearingPartId) : null,
            lower: functional ? bearingReference(db, functional.lowerBearingPartId) : null,
        },
        technicalKnowledge: knowledge ? { items: parseJsonArray(knowledge.items_json) } : null,
        completeness,
        migration: {
            state: profile?.migration_state ?? null,
            version: profile?.migration_version ?? null,
            fingerprint: profile?.migration_fingerprint ?? null,
        },
        provenance: profile ? parseJsonObject(profile.provenance_json) : {},
        legacyEvidence: profile ? parseJsonObject(profile.legacy_evidence_json) : {},
    };
}

function validateExpectedUpdatedAt(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim();
    if (!normalized || Number.isNaN(Date.parse(normalized))) throw error('technical_profile_version_invalid', 'expectedUpdatedAt 必须是有效 ISO 时间', 400);
    return normalized;
}

function assertAggregateConcurrency(profile, knowledge, expectedUpdatedAt) {
    const current = aggregateUpdatedAt(profile, knowledge);
    if (!current) {
        if (expectedUpdatedAt !== null) throw error('technical_profile_version_conflict', '尚未创建 canonical 技术档案，expectedUpdatedAt 必须为空', 409);
        return;
    }
    if (!expectedUpdatedAt) throw error('technical_profile_version_required', 'canonical 技术档案更新必须提供 expectedUpdatedAt', 409);
    if (expectedUpdatedAt !== current) throw error('technical_profile_version_conflict', 'canonical 技术档案已被其他操作修改，请刷新后重试', 409);
}

function profileInputFromPayload(profile, functional, now, auditContext, completenessState) {
    const provenance = parseJsonObject(profile?.provenance_json);
    for (const field of FUNCTIONAL_FIELDS) {
        const previous = profile ? profile[PROFILE_COLUMN_BY_FIELD[field]] ?? null : null;
        if (previous !== functional[field]) {
            provenance[field] = {
                sourceKind: 'OWNER_CANONICAL_WRITE', operationId: auditContext.operationId,
                actorKey: auditContext.user, updatedAt: now,
                ...(field.endsWith('PartId') && functional[field] !== null ? { partId: functional[field] } : {}),
            };
        }
    }
    return {
        recipe_id: profile?.recipe_id || null,
        rotor_diameter: functional.rotorDiameter, stack_offset: functional.stackOffset,
        oil_seal_diameter: functional.oilSealDiameter, impeller_bore_diameter: functional.impellerBoreDiameter,
        impeller_span: functional.impellerSpan, impeller_thickness: functional.impellerThickness,
        thread_length: functional.threadLength, thread_diameter: functional.threadDiameter,
        barrel_length: functional.barrelLength, open_offset: functional.openOffset,
        bearing_span_explicit: functional.bearingSpanExplicit,
        upper_bearing_part_id: functional.upperBearingPartId, lower_bearing_part_id: functional.lowerBearingPartId,
        schema_version: profile?.schema_version || 1,
        completeness_state: completenessState,
        migration_state: profile?.migration_state || 'ALREADY_CANONICAL',
        migration_version: profile?.migration_version ?? null,
        migration_fingerprint: profile?.migration_fingerprint ?? null,
        provenance_json: JSON.stringify(provenance),
        legacy_evidence_json: profile?.legacy_evidence_json || '{}',
        created_at: profile?.created_at || now,
        updated_at: now,
    };
}

function knowledgeComparable(item) {
    const rest = { ...(item || {}) };
    delete rest.source;
    return canonicalJson(rest);
}

function knowledgeInputFromPayload(knowledge, items, now, auditContext) {
    const existingByKey = new Map(parseJsonArray(knowledge?.items_json).map(item => [item.key, item]));
    const storedItems = items.map(item => {
        const existing = existingByKey.get(item.key);
        return {
            ...item,
            source: existing && knowledgeComparable(existing) === canonicalJson(item)
                ? existing.source
                : { sourceKind: 'OWNER_CANONICAL_WRITE', operationId: auditContext.operationId, actorKey: auditContext.user, updatedAt: now },
        };
    });
    return {
        recipe_id: knowledge?.recipe_id || null,
        schema_version: knowledge?.schema_version || 1,
        items_json: JSON.stringify(storedItems),
        created_at: knowledge?.created_at || now,
        updated_at: now,
    };
}

function createRecipeTechnicalProfileService(dependencies) {
    const db = dependencies?.db;
    if (!db) throw new Error('Recipe technical profile 缺少 db');
    const auditWriter = dependencies.writeAuditLog || ((action, table, recipeId, before, after, context, now) => writeRecipeTechnicalAudit(db, action, table, recipeId, before, after, context, now));
    const clock = dependencies.now || (() => new Date());

    function get(recipeIdValue) {
        const recipeId = normalizeRecipeId(recipeIdValue);
        const recipe = getActiveRecipe(db, recipeId);
        const profile = getFunctionalProfile(db, recipeId);
        const knowledge = getTechnicalKnowledge(db, recipeId);
        return buildDto(db, recipeId, profile, knowledge, resolveStainlessMode(db, recipeId, recipe));
    }

    function update(recipeIdValue, input = {}, commandContext = {}) {
        const recipeId = normalizeRecipeId(recipeIdValue);
        if (!plainObject(input) || Object.keys(input).some(key => !['functional', 'technicalKnowledge', 'expectedUpdatedAt', 'idempotencyKey'].includes(key))) {
            throw error('technical_profile_functional_invalid', '请求包含不支持的字段', 400);
        }
        const functional = normalizeFunctional(input.functional);
        const expectedUpdatedAt = validateExpectedUpdatedAt(input.expectedUpdatedAt);
        const knowledgeItems = normalizeKnowledge(db, recipeId, input.technicalKnowledge);
        const commandNow = new Date(clock());
        return executePersistentCommand({
            db,
            ...commandContext,
            capabilityId: UPDATE_CAPABILITY_ID,
            input: { recipeId, functional, technicalKnowledge: knowledgeItems, expectedUpdatedAt },
            requestKnowledgeSync: () => {},
            now: commandNow,
            businessChange: standardBusinessChange({
                domain: 'recipe', eventType: 'updated',
                entityRefs: () => [{ entityType: 'recipe', entityId: recipeId, role: 'primary' }],
            }),
            execute: ({ auditContext }) => {
                const recipe = getActiveRecipe(db, recipeId);
                const beforeProfile = getFunctionalProfile(db, recipeId);
                const beforeKnowledge = getTechnicalKnowledge(db, recipeId);
                assertAggregateConcurrency(beforeProfile, beforeKnowledge, expectedUpdatedAt);
                const policy = resolveStainlessMode(db, recipeId, recipe);
                assertModeInput(functional, policy);
                validateBearingPart(db, 'upperBearingPartId', functional.upperBearingPartId);
                validateBearingPart(db, 'lowerBearingPartId', functional.lowerBearingPartId);
                const completenessState = computeCompleteness(db, functional, policy, true).state;
                const currentUpdatedAt = aggregateUpdatedAt(beforeProfile, beforeKnowledge);
                const now = currentUpdatedAt && currentUpdatedAt >= commandNow.toISOString()
                    ? new Date(Date.parse(currentUpdatedAt) + 1).toISOString()
                    : commandNow.toISOString();
                const desiredProfile = profileInputFromPayload(beforeProfile, functional, now, auditContext, completenessState);
                desiredProfile.recipe_id = recipeId;
                const desiredKnowledge = knowledgeInputFromPayload(beforeKnowledge, knowledgeItems, now, auditContext);
                desiredKnowledge.recipe_id = recipeId;
                const profileWrite = persistFunctionalProfile(db, desiredProfile);
                const knowledgeWrite = persistTechnicalKnowledge(db, desiredKnowledge);
                const writes = [
                    [profileWrite, 'recipe_functional_technical_profiles'],
                    [knowledgeWrite, 'recipe_technical_knowledge'],
                ].filter(([write]) => write.changed);
                const auditIds = writes.map(([write, table]) => auditWriter(write.action, table, recipeId, write.before, write.after, auditContext, now));
                const afterProfile = profileWrite.after;
                const afterKnowledge = knowledgeWrite.after;
                const dto = buildDto(db, recipeId, afterProfile, afterKnowledge, policy);
                const changes = writes.map(([, table]) => ({ resourceType: 'recipe', resourceId: recipeId, field: table === 'recipe_functional_technical_profiles' ? 'technicalProfile' : 'technicalKnowledge' }));
                return {
                    data: { technicalProfile: dto },
                    resource: { type: 'recipeTechnicalProfile', ids: [recipeId] },
                    changes,
                    auditIds,
                    requiredAuditCount: writes.length,
                };
            },
        });
    }
    return Object.freeze({ get, update });
}

module.exports = {
    FUNCTIONAL_FIELDS,
    GET_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    bearingReference,
    computeCompleteness,
    createRecipeTechnicalProfileService,
    derivedBearingSpan,
    functionalFromRow,
    resolveStainlessMode,
};
