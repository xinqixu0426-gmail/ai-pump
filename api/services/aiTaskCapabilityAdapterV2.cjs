'use strict';

// N2.1 is deliberately a thin, server-owned adapter over the existing AI
// capability registry and executor.  It is not another tool registry or an
// alternate business-data access path.
const crypto = require('node:crypto');

const { AI_TOOLS } = require('../routes/ai/tools.cjs');
const { AI_NATIVE_TOOLS_V2 } = require('./aiNativeToolDefinitionsV2.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { validateAiToolArgs } = require('./aiToolInputValidatorV2.cjs');
const { validateArgumentSource, validateSourceSpan, validateCanonicalEntity, validateSubjectBinding } = require('./aiTaskValidationV2.cjs');
const { canonicalJson, stableHash } = require('./stableJson.cjs');

const MAX_RECEIPT_RESULT_BYTES = 98_304;
const NATIVE_OVERRIDE_FIELDS = Object.freeze([
    'hasFloat', 'floatWire', 'floatAccessoryType',
    'hasCable', 'cableLength', 'cableWire', 'cableAccessoryType',
    'coilId', 'customBarrelLength', 'coilSheets', 'packingParts', 'surfaceTreatmentMode', 'surfaceTreatmentCost',
]);
const FORMAL_POLICIES = Object.freeze(new Set([
    'NATIVE_BASELINE_INHERITANCE_V1', 'PACKING_DEFAULT_QTY_ONE_V1',
    'PACKING_ROLE_FORMAL_SEMANTICS_V1', 'PACKING_CATEGORY_FORMAL_FILTER_V1',
    'SURFACE_NONE_ZERO_COST_V1', 'SURFACE_TREATMENT_OPTION_V1',
    'PROFITABILITY_SCENARIO_KEY_V1', 'PROFITABILITY_CURRENCY_CNY_V1', 'PROFITABILITY_QUANTITY_UNSPECIFIED_V1',
    'VIRTUAL_READINESS_SCENARIO_KEY_V1', 'VIRTUAL_READINESS_CURRENT_BASIS_V1',
]));
const FORBIDDEN_POINTER_TOKENS = Object.freeze(new Set(['__proto__', 'prototype', 'constructor']));

class AiTaskCapabilityAdapterError extends Error {
    constructor(code, message = code, details = null) {
        super(message);
        this.name = 'AiTaskCapabilityAdapterError';
        this.code = code;
        this.details = details;
    }
}

function fail(code, message, details) {
    throw new AiTaskCapabilityAdapterError(code, `${code}: ${message || code}`, details);
}

function toolDefinition(toolName, tools = [...AI_TOOLS, ...AI_NATIVE_TOOLS_V2]) {
    const tool = (Array.isArray(tools) ? tools : []).find(item => item?.function?.name === toolName);
    if (!tool) fail('CAPABILITY_NOT_REGISTERED', `AI_TOOLS 中不存在工具：${toolName}`);
    return tool;
}

function capabilityAccess(capability) {
    const pair = `${capability?.access}/${capability?.operation}`;
    if (pair === 'read/query') return 'QUERY';
    if (pair === 'read/preview') return 'PREVIEW';
    if (pair === 'write/command') return 'COMMAND';
    fail('CAPABILITY_CLASSIFICATION_INVALID', `未声明的能力分类：${pair}`);
}

function overrideProperties(schema) {
    const direct = schema?.properties || {};
    return {
        ...direct,
        ...(direct.overrides?.properties || {}),
    };
}

function buildCapabilityDescriptorV2(toolName, options = {}) {
    const tool = toolDefinition(toolName, options.tools || [...AI_TOOLS, ...AI_NATIVE_TOOLS_V2]);
    const lookup = options.getAiCapability || getAiCapability;
    const capability = lookup(toolName);
    if (!capability || capability.toolName !== toolName) {
        fail('CAPABILITY_NOT_REGISTERED', `能力注册表中不存在工具：${toolName}`);
    }
    const supported = Object.keys(overrideProperties(tool.function.parameters))
        .filter(field => NATIVE_OVERRIDE_FIELDS.includes(field));
    return Object.freeze({
        version: 1,
        toolName,
        capabilityId: capability.capabilityId,
        access: capabilityAccess(capability),
        sourceOfTruth: capability.sourceOfTruth,
        formalCapabilityIds: Object.freeze([...(capability.formalCapabilityIds || [])]),
        supportedOverrideFields: Object.freeze(supported),
    });
}

function decodePointer(pointer) {
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
        fail('JSON_POINTER_INVALID', 'JSON Pointer 必须以 / 开头');
    }
    return pointer.slice(1).split('/').map(token => {
        const decoded = token.replace(/~1/g, '/').replace(/~0/g, '~');
        if (FORBIDDEN_POINTER_TOKENS.has(decoded)) {
            fail('JSON_POINTER_FORBIDDEN_TOKEN', `JSON Pointer 含禁止路径：${decoded}`);
        }
        return decoded;
    });
}

function readJsonPointer(value, pointer) {
    const tokens = decodePointer(pointer);
    let current = value;
    for (const token of tokens) {
        if (current === null || typeof current !== 'object') {
            fail('JSON_POINTER_MISSING', `JSON Pointer 不存在：${pointer}`);
        }
        if (Array.isArray(current) && (!/^(?:0|[1-9][0-9]*)$/u.test(token) || Number(token) >= current.length)) {
            fail('JSON_POINTER_OUT_OF_RANGE', `JSON Pointer 数组下标无效：${pointer}`);
        }
        if (!Object.hasOwn(current, token)) fail('JSON_POINTER_MISSING', `JSON Pointer 不存在：${pointer}`);
        current = current[token];
    }
    return current;
}

function leafPaths(value, path = '') {
    if (value === null || typeof value !== 'object') return [path];
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return path ? [path] : [];
    return entries.flatMap(([key, child]) => leafPaths(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
}

function deepEqual(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

function cloneFormalResult(result) {
    const copy = structuredClone(result);
    // Evidence transport metadata establishes execution but is not a business
    // source version.  Excluding it keeps sourceHash stable across retries.
    delete copy.executionEvidence;
    delete copy.provenance;
    return copy;
}

function isVerifiedExecutorResult(result) {
    return Boolean(result && result.success !== false && !result.requiresConfirmation
        && result.executionEvidence?.verified === true);
}

function projectCanonicalRecord(entityType, record) {
    const id = record?.id ?? record?.Id ?? record?.recipeId ?? record?.coilId ?? record?.partId ?? record?.templateId ?? record?.entityId;
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || String(Math.trunc(Number(id))) !== String(id)) {
        fail('CANONICAL_PROJECTION_INVALID_ID', `正式 ${entityType} 结果缺少正整数 ID`);
    }
    const names = {
        recipe: ['displayName', 'name', 'recipeName'],
        coil: ['schemeName', 'name', 'model', 'spec'],
        part: ['model', 'name'],
        template: ['shellModel', 'name', 'description'],
        customer: ['name', 'customerName', 'displayName'],
        order: ['contractNo', 'orderNo', 'customerName', 'name'],
        quotation: ['quotationNo', 'customerName', 'displayName'],
    };
    const displayName = (names[entityType] || []).map(key => record?.[key])
        .find(value => typeof value === 'string' && value.trim());
    if (!displayName) fail('CANONICAL_PROJECTION_INVALID_SHAPE', `正式 ${entityType} 结果缺少显示名称`);
    const entity = {
        entityType,
        entityId: String(Math.trunc(Number(id))),
        displayName: displayName.trim(),
        updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : null,
        recordHash: stableHash(record),
        schemeCode: entityType === 'coil' && typeof record?.schemeCode === 'string' && record.schemeCode
            ? record.schemeCode
            : null,
    };
    validateCanonicalEntity(entity);
    return entity;
}

const CANONICAL_PROJECTORS = Object.freeze({
    get_all_recipes: Object.freeze({ entityType: 'recipe', pointer: '/data' }),
    compare_recipe_scenarios: Object.freeze({ entityType: 'recipe', pointer: '/data/recipe', single: true }),
    preview_profitability: Object.freeze({ entityType: 'recipe', pointer: '/data/recipe', single: true }),
    preview_virtual_readiness: Object.freeze({ entityType: 'recipe', pointer: '/data/recipe', single: true }),
    search_coils: Object.freeze({ entityType: 'coil', pointer: '/data' }),
    search_parts: Object.freeze({ entityType: 'part', pointer: '/parts' }),
    search_templates: Object.freeze({ entityType: 'template', pointer: '/data' }),
    search_customers: Object.freeze({ entityType: 'customer', pointer: '/data' }),
    get_order_knowledge_package: Object.freeze({ entityType: 'order', pointer: '/data/order', single: true }),
    check_order_readiness: Object.freeze({ entityType: 'order', pointer: '/data/order', single: true }),
    get_order_detail: Object.freeze({ entityType: 'order', pointer: '/data', single: true }),
    get_quotation_detail: Object.freeze({ entityType: 'quotation', pointer: '/data', single: true }),
});

function collectionComplete(result) {
    const receipt = result?.queryReceipt;
    if (result?.complete === true || result?.collectionComplete === true) return true;
    return receipt?.authoritative === true && receipt?.truncated === false && receipt?.possiblyTruncated !== true;
}

function resultForReceipt(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        fail('RECEIPT_RESULT_INVALID', 'executor 未返回对象结果');
    }
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    if (bytes > MAX_RECEIPT_RESULT_BYTES) {
        fail('RECEIPT_RESULT_LIMIT', `executor 结果超过 ${MAX_RECEIPT_RESULT_BYTES} 字节`, { bytes });
    }
    return result;
}

function sourceValueMatches(value, source, context) {
    switch (source.kind) {
        case 'USER_SPAN':
            try {
                validateSourceSpan(source.span, { sourceMessages: context.sourceMessages });
            } catch (error) {
                fail('USER_SPAN_UNVERIFIED', error.code || error.message);
            }
            return true;
        case 'FORMAL_RECEIPT': {
            const receipt = context.trustedReceipts.get(source.sourceRef);
            if (!receipt || receipt.taskId !== context.taskId || receipt.planRevision !== context.planRevision
                || receipt.origin !== 'SERVER_EXECUTOR') {
                fail('FORMAL_RECEIPT_UNTRUSTED');
            }
            const pointed = readJsonPointer(receipt, source.pointer);
            // 正式主键在回执里是数字（`id: 13`），而 capability schema 的选择器是字符串（`"13"`）。
            // 这不是两个不同的值：同一数值的 number/string 表示视为同一证据，其它任何差异仍然拒绝。
            const numericallyEqual = (left, right) => {
                const shape = item => (typeof item === 'number' ? 'number' : typeof item === 'string' && /^-?\d+(?:\.\d+)?$/u.test(item.trim()) ? 'numeric-string' : null);
                return Boolean(shape(left) && shape(right) && Number(left) === Number(right));
            };
            if (!deepEqual(pointed, value) && !numericallyEqual(pointed, value)) fail('FORMAL_RECEIPT_VALUE_MISMATCH');
            return true;
        }
        case 'USER_CHOICE': {
            const choice = context.trustedChoices.get(source.sourceRef);
            if (!choice || !deepEqual(choice.value, value)) fail('USER_CHOICE_UNTRUSTED');
            return true;
        }
        case 'SOURCE_EVIDENCE': {
            const record = context.trustedSourceEvidence.get(source.sourceRef);
            if (!record || record.taskId !== context.taskId || record.planRevision !== context.planRevision || record.sourceVersionHash !== source.sourceVersionHash || !String(record.excerpt).includes(String(source.rawValue))) fail('SOURCE_EVIDENCE_UNTRUSTED');
            const transform = source.transform;
            const cmMatch = typeof source.rawValue === 'string' && /^([0-9]+(?:\.[0-9]+)?)cm$/u.exec(source.rawValue);
            const normalized = transform.type === 'IDENTITY' ? source.rawValue : (cmMatch ? Number(cmMatch[1]) / 100 : NaN);
            if (!deepEqual(normalized, source.normalizedValue) || !deepEqual(value, source.normalizedValue)) fail('SOURCE_EVIDENCE_VALUE_MISMATCH');
            return true;
        }
        case 'FORMAL_POLICY':
            if (!FORMAL_POLICIES.has(source.sourceRef)) fail('FORMAL_POLICY_UNSUPPORTED');
            return true;
        case 'BASELINE_INHERITANCE':
            if (source.sourceRef !== 'NATIVE_BASELINE_INHERITANCE_V1') fail('BASELINE_INHERITANCE_UNSUPPORTED');
            return true;
        default:
            fail('ARGUMENT_SOURCE_KIND_INVALID');
    }
}

function validateArgumentSources(args, argumentSources, context) {
    const expected = new Set(leafPaths(args));
    const sources = Array.isArray(argumentSources) ? argumentSources : [];
    const byPath = new Map();
    for (const source of sources) {
        if (!source || typeof source !== 'object') fail('ARGUMENT_SOURCE_INVALID');
        try {
            validateArgumentSource(source, {
                sourceMessages: context.sourceMessages,
                trustedSourceEvidenceById: context.trustedSourceEvidence,
                taskId: context.taskId,
                planRevision: context.planRevision,
            });
        } catch (error) {
            fail(error.code || 'ARGUMENT_SOURCE_INVALID', error.message);
        }
        const path = source.fieldPath;
        if (!expected.has(path)) fail('ARGUMENT_SOURCE_EXTRA', `参数来源没有对应叶字段：${path}`);
        if (byPath.has(path)) fail('ARGUMENT_SOURCE_DUPLICATE', `参数叶字段重复来源：${path}`);
        byPath.set(path, source);
        const value = readJsonPointer(args, path);
        sourceValueMatches(value, source, context);
    }
    for (const path of expected) if (!byPath.has(path)) fail('ARGUMENT_SOURCE_MISSING', `参数叶字段缺少来源：${path}`);
    return true;
}

function assertSupportedOverrides(descriptor, args) {
    if (descriptor.toolName === 'compare_recipe_scenarios') {
        for (const scenario of args?.scenarios || []) {
            for (const field of Object.keys(scenario?.overrides || {})) {
                if (!NATIVE_OVERRIDE_FIELDS.includes(field)) fail('UNSUPPORTED_OVERRIDE_FIELD');
            }
            if (Object.hasOwn(scenario?.overrides || {}, 'coilSheets')
                && !Object.hasOwn(scenario?.overrides || {}, 'coilId')) {
                fail('COIL_SHEETS_REQUIRES_COIL_ID');
            }
        }
        return;
    }
    const overrides = args?.overrides;
    if (overrides !== undefined) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('UNSUPPORTED_OVERRIDE_FIELD');
        for (const field of Object.keys(overrides)) {
            if (!descriptor.supportedOverrideFields.includes(field)) {
                fail('UNSUPPORTED_OVERRIDE_FIELD', `当前能力不支持覆盖字段：${field}`);
            }
        }
    }
    for (const field of NATIVE_OVERRIDE_FIELDS) {
        if (Object.hasOwn(args || {}, field) && !descriptor.supportedOverrideFields.includes(field)) {
            fail('UNSUPPORTED_OVERRIDE_FIELD', `当前能力不支持覆盖字段：${field}`);
        }
    }
    if (Object.hasOwn(overrides || {}, 'coilSheets') && !Object.hasOwn(overrides || {}, 'coilId')) {
        fail('COIL_SHEETS_REQUIRES_COIL_ID');
    }
}

function createTaskCapabilityAdapterV2(options = {}) {
    const taskId = options.taskId;
    const planRevision = options.planRevision;
    if (!crypto.randomUUID || typeof taskId !== 'string' || !taskId || !Number.isInteger(planRevision) || planRevision < 1) {
        fail('TASK_ADAPTER_CONTEXT_INVALID');
    }
    const sourceMessages = options.sourceMessages instanceof Map
        ? options.sourceMessages
        : new Map(Object.entries(options.sourceMessages || {}));
    const trustedReceipts = options.trustedReceipts instanceof Map ? new Map(options.trustedReceipts) : new Map(Object.entries(options.trustedReceipts || {}));
    const trustedChoices = new Map(Object.entries(options.trustedChoices || {}));
    const trustedSourceEvidence = options.trustedSourceEvidence instanceof Map ? options.trustedSourceEvidence : new Map(Object.entries(options.trustedSourceEvidence || {}));
    const execute = options.executeToolCall || executeToolCall;
    const validator = options.validateAiToolArgs || validateAiToolArgs;

    function describeCapability(toolName) {
        return buildCapabilityDescriptorV2(toolName, options);
    }

    function validateRequest({ toolName, args, argumentSources }) {
        const descriptor = describeCapability(toolName);
        if (descriptor.access === 'COMMAND') fail('TASK_V2_COMMAND_NOT_ENABLED');
        let normalized;
        try { normalized = validator(toolName, args); } catch (error) {
            fail(error.code || 'INVALID_AI_TOOL_INPUT', error.message);
        }
        assertSupportedOverrides(descriptor, normalized);
        validateArgumentSources(normalized, argumentSources, {
            sourceMessages, trustedReceipts, trustedChoices, trustedSourceEvidence, trustedSourceEvidenceById: trustedSourceEvidence, taskId, planRevision,
        });
        return { descriptor, args: normalized, argsHash: stableHash(normalized) };
    }

    async function executeCapability({ toolName, args, argumentSources, stepId = null }) {
        const request = validateRequest({ toolName, args, argumentSources });
        const recovered = typeof options.findRecoveredReceipt === 'function'
            ? options.findRecoveredReceipt({ toolName, capabilityId: request.descriptor.capabilityId, args: request.args, argsHash: request.argsHash })
            : null;
        if (recovered && recovered.origin === 'SERVER_EXECUTOR' && recovered.toolName === toolName && recovered.capabilityId === request.descriptor.capabilityId && recovered.argsHash === request.argsHash) {
            trustedReceipts.set(recovered.receiptId, recovered);
            return Object.freeze({ receipt: recovered, result: recovered.result, status: 'VERIFIED_REUSED' });
        }
        // Optional worker hooks run only after strict request validation and
        // immediately around the formal executor call.  They keep the
        // foreground adapter behavior unchanged while allowing a leased
        // worker to reserve budget and fence a detached execution.
        if (typeof options.beforeExecute === 'function') await options.beforeExecute({ toolName, request });
        const result = await execute(toolName, request.args, { allowWrite: false, ...(options.executionOptions || {}) });
        if (typeof options.afterExecute === 'function') await options.afterExecute({ toolName, request, result });
        if (!isVerifiedExecutorResult(result)) {
            return Object.freeze({ receipt: null, result, status: 'UNVERIFIED_EXECUTOR_RESULT' });
        }
        const formalResult = resultForReceipt(result);
        const receipt = Object.freeze({
            version: 1,
            receiptId: crypto.randomUUID(),
            taskId,
            stepId,
            planRevision,
            toolName,
            capabilityId: request.descriptor.capabilityId,
            access: request.descriptor.access,
            argsHash: request.argsHash,
            origin: 'SERVER_EXECUTOR',
            observedAt: new Date().toISOString(),
            readSetId: typeof (formalResult?.readSetId ?? formalResult?.data?.readSetId) === 'string'
                ? (formalResult.readSetId ?? formalResult.data.readSetId)
                : null,
            sourceHash: stableHash(cloneFormalResult(formalResult)),
            projectionVersion: 1,
            result: formalResult,
        });
        trustedReceipts.set(receipt.receiptId, receipt);
        return Object.freeze({ receipt, result: formalResult, status: 'VERIFIED' });
    }

    function getTrustedReceipt(receiptId) {
        const receipt = trustedReceipts.get(receiptId);
        if (!receipt) fail('FORMAL_RECEIPT_UNTRUSTED');
        return receipt;
    }

    function projectCanonicalEntities({ toolName, receiptId }) {
        const projector = CANONICAL_PROJECTORS[toolName];
        if (!projector) fail('CANONICAL_PROJECTION_UNSUPPORTED', `工具没有服务端实体投影：${toolName}`);
        const receipt = getTrustedReceipt(receiptId);
        if (receipt.toolName !== toolName) fail('CANONICAL_PROJECTION_RECEIPT_TOOL_MISMATCH');
        const projected = readJsonPointer(receipt.result, projector.pointer);
        const records = projector.single ? [projected] : projected;
        if (!Array.isArray(records)) fail('CANONICAL_PROJECTION_INVALID_SHAPE');
        return records.map(record => projectCanonicalRecord(projector.entityType, record));
    }

    function bindSubject({ subjectKey, mention, toolName, receiptId, selectionBasis = 'EXACT', choiceId = null }) {
        const receipt = getTrustedReceipt(receiptId);
        const candidates = projectCanonicalEntities({ toolName, receiptId });
        // Exact resource reads have one authoritative record by contract.  They
        // are distinct from a potentially truncated list result.
        const complete = Boolean(CANONICAL_PROJECTORS[toolName]?.single) || collectionComplete(receipt.result);
        let resolution = 'UNRESOLVED';
        let selected = null;
        let basis = 'NONE';
        if (!complete) {
            resolution = 'UNRESOLVED';
        } else if (candidates.length === 0) {
            resolution = 'NOT_FOUND';
        } else if (candidates.length === 1) {
            resolution = 'UNIQUE';
            selected = candidates[0];
            basis = selectionBasis;
        } else if (choiceId) {
            const choice = trustedChoices.get(choiceId);
            const candidate = candidates.find(item => item.entityId === String(choice?.value));
            if (!candidate) fail('USER_CHOICE_UNTRUSTED');
            resolution = 'SELECTED';
            selected = candidate;
            basis = 'USER_CHOICE';
        } else {
            resolution = 'MULTIPLE';
        }
        const binding = {
            subjectKey, mention, resolution, selected, candidates,
            candidateSetComplete: complete,
            selectionBasis: basis,
            receiptIds: [receiptId],
        };
        validateSubjectBinding(binding, trustedReceipts);
        return binding;
    }

    return Object.freeze({
        describeCapability,
        validateRequest,
        executeCapability,
        getTrustedReceipt,
        projectCanonicalEntities,
        bindSubject,
        getTrustedReceipts: () => new Map(trustedReceipts),
        registerSourceEvidence: record => { trustedSourceEvidence.set(record.evidenceId, record); },
    });
}

module.exports = {
    AiTaskCapabilityAdapterError,
    CANONICAL_PROJECTORS,
    FORMAL_POLICIES,
    MAX_RECEIPT_RESULT_BYTES,
    NATIVE_OVERRIDE_FIELDS,
    buildCapabilityDescriptorV2,
    createTaskCapabilityAdapterV2,
    readJsonPointer,
};
