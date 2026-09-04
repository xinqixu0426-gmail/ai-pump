'use strict';

const V5_CONTRACT_VERSION = 1;

const V5_TASK_STATES = Object.freeze([
    'RECEIVED',
    'UNDERSTANDING',
    'RESOLVING_ENTITY',
    'ROUTING',
    'EXECUTING',
    'COLLECTING_EVIDENCE',
    'VERIFYING',
    'COMPOSING',
    'COMPLETED',
    'NEEDS_CLARIFICATION',
    'BLOCKED_POLICY',
    'FAILED_TOOL',
    'FAILED_EVIDENCE',
    'FAILED_INTERNAL',
]);

const V5_TOOL_ERROR_CLASSES = Object.freeze([
    'VALIDATION_ERROR',
    'POLICY_BLOCKED',
    'EXECUTION_ERROR',
    'TIMEOUT',
    'NOT_FOUND',
    'AMBIGUOUS_ENTITY',
    'INTERNAL_ERROR',
]);

const V5_RISK_CLASSES = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
const V5_TOOL_RESULT_STATUSES = Object.freeze(['success', 'failure']);

class V5ContractValidationError extends TypeError {
    constructor(message, details = {}) {
        super(message);
        this.name = 'V5ContractValidationError';
        this.code = 'V5_CONTRACT_VALIDATION_FAILED';
        this.details = Object.freeze({ ...details });
    }
}

function fail(message, path, value) {
    throw new V5ContractValidationError(message, {
        path,
        actualType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    });
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneSerializable(value, path = 'value', seen = new WeakSet()) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(`${path} 必须是有限数字`, path, value);
        return value;
    }
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        fail(`${path} 必须可序列化`, path, value);
    }
    if (seen.has(value)) fail(`${path} 不允许循环引用`, path, value);
    seen.add(value);
    let output;
    if (Array.isArray(value)) {
        output = value.map((item, index) => cloneSerializable(item, `${path}[${index}]`, seen));
    } else if (isPlainObject(value)) {
        output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = cloneSerializable(item, `${path}.${key}`, seen);
        }
    } else {
        fail(`${path} 只允许普通对象、数组和 JSON 标量`, path, value);
    }
    seen.delete(value);
    return output;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}

function immutableSerializable(value, path) {
    return deepFreeze(cloneSerializable(value, path));
}

function serializableArray(value, path) {
    if (!Array.isArray(value)) fail(`${path} 必须是数组`, path, value);
    return immutableSerializable(value, path);
}

function requiredString(value, path) {
    if (typeof value !== 'string' || value.length === 0) fail(`${path} 必须是非空字符串`, path, value);
    return value;
}

function optionalNonEmptyString(value, path) {
    if (value === null || value === undefined) return null;
    return requiredString(value, path);
}

function exactVersion(value, path = 'version') {
    if (value !== V5_CONTRACT_VERSION) {
        fail(`${path} 必须严格等于 ${V5_CONTRACT_VERSION}`, path, value);
    }
    return value;
}

function isoTimestamp(value, path) {
    requiredString(value, path);
    if (Number.isNaN(Date.parse(value))) fail(`${path} 必须是有效时间戳`, path, value);
    return value;
}

function canonicalEntityId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return fail(
        'entityReference.canonicalEntityId 必须是非空字符串、有限数字或 null',
        'entityReference.canonicalEntityId',
        value
    );
}

function createV5EntityReference(input = {}) {
    const entityType = requiredString(input.entityType, 'entityReference.entityType');
    const rawMention = requiredString(input.rawMention, 'entityReference.rawMention');
    const normalizedMention = optionalNonEmptyString(
        input.normalizedMention,
        'entityReference.normalizedMention'
    );
    const stableCanonicalEntityId = canonicalEntityId(input.canonicalEntityId);

    return immutableSerializable({
        version: exactVersion(input.version ?? V5_CONTRACT_VERSION, 'entityReference.version'),
        entityType,
        rawMention,
        normalizedMention,
        canonicalEntityId: stableCanonicalEntityId,
        resolutionReceiptRef: optionalNonEmptyString(
            input.resolutionReceiptRef,
            'entityReference.resolutionReceiptRef'
        ),
        aliasSource: optionalNonEmptyString(input.aliasSource, 'entityReference.aliasSource'),
    }, 'entityReference');
}

function validateEntityReference(value, path = 'entityReference') {
    if (!isPlainObject(value)) fail(`${path} 必须是对象`, path, value);
    return createV5EntityReference({ ...value, version: exactVersion(value.version, `${path}.version`) });
}

function createV5ToolRequest(input = {}) {
    const rawArguments = input.rawArguments === undefined
        ? fail('toolRequest.rawArguments 必须显式提供', 'toolRequest.rawArguments', input.rawArguments)
        : immutableSerializable(input.rawArguments, 'toolRequest.rawArguments');
    if (!isPlainObject(rawArguments)) fail('toolRequest.rawArguments 必须是普通对象', 'toolRequest.rawArguments', rawArguments);

    const hasValidatedArguments = input.validatedArguments !== null && input.validatedArguments !== undefined;
    const validatedArguments = hasValidatedArguments
        ? immutableSerializable(input.validatedArguments, 'toolRequest.validatedArguments')
        : null;
    if (validatedArguments !== null && !isPlainObject(validatedArguments)) {
        fail('toolRequest.validatedArguments 必须是普通对象或 null', 'toolRequest.validatedArguments', validatedArguments);
    }

    if (!Array.isArray(input.entityRefs || [])) {
        fail('toolRequest.entityRefs 必须是数组', 'toolRequest.entityRefs', input.entityRefs);
    }
    const entityRefs = (input.entityRefs || []).map((item, index) => (
        validateEntityReference(item, `toolRequest.entityRefs[${index}]`)
    ));
    const capability = optionalNonEmptyString(input.capability, 'toolRequest.capability');
    const validationStatus = input.validationStatus || (hasValidatedArguments ? 'validated' : 'raw');
    if (!['raw', 'validated'].includes(validationStatus)) {
        fail('toolRequest.validationStatus 必须是 raw 或 validated', 'toolRequest.validationStatus', validationStatus);
    }
    if (validationStatus === 'validated' && validatedArguments === null) {
        fail('validated ToolRequest 必须包含 validatedArguments', 'toolRequest.validatedArguments', validatedArguments);
    }
    if (validationStatus === 'raw' && validatedArguments !== null) {
        fail('raw ToolRequest 不得提前包含 validatedArguments', 'toolRequest.validationStatus', validationStatus);
    }

    const executionReady = validationStatus === 'validated'
        && validatedArguments !== null
        && capability !== null;

    return immutableSerializable({
        version: exactVersion(input.version ?? V5_CONTRACT_VERSION, 'toolRequest.version'),
        taskId: requiredString(input.taskId, 'toolRequest.taskId'),
        toolName: requiredString(input.toolName, 'toolRequest.toolName'),
        capability,
        rawArguments,
        validatedArguments,
        entityRefs,
        riskClass: V5_RISK_CLASSES.includes(input.riskClass) ? input.riskClass : fail(
            'toolRequest.riskClass 非法',
            'toolRequest.riskClass',
            input.riskClass
        ),
        validationStatus,
        executionReady,
    }, 'toolRequest');
}

function validateV5ToolRequest(value, path = 'toolRequest') {
    if (!isPlainObject(value)) fail(`${path} 必须是对象`, path, value);
    const validated = createV5ToolRequest({ ...value, version: exactVersion(value.version, `${path}.version`) });
    if (value.executionReady !== undefined && value.executionReady !== validated.executionReady) {
        fail(`${path}.executionReady 与验证阶段不一致`, `${path}.executionReady`, value.executionReady);
    }
    return validated;
}

function validateToolRequestForExecution(value) {
    try {
        const request = validateV5ToolRequest(value);
        if (!request.executionReady) {
            return Object.freeze({ valid: false, code: 'V5_TOOL_REQUEST_NOT_VALIDATED', request: null });
        }
        return Object.freeze({ valid: true, code: null, request });
    } catch (error) {
        return Object.freeze({
            valid: false,
            code: error.code || 'V5_CONTRACT_VALIDATION_FAILED',
            request: null,
        });
    }
}

function createV5ToolError(input = {}) {
    const classification = V5_TOOL_ERROR_CLASSES.includes(input.classification)
        ? input.classification
        : fail('toolError.classification 非法', 'toolError.classification', input.classification);
    return immutableSerializable({
        version: exactVersion(input.version ?? V5_CONTRACT_VERSION, 'toolError.version'),
        classification,
        code: requiredString(input.code, 'toolError.code'),
        retryable: input.retryable === true,
        safeMessage: optionalNonEmptyString(input.safeMessage, 'toolError.safeMessage'),
        operationRefs: serializableArray(input.operationRefs || [], 'toolError.operationRefs'),
    }, 'toolError');
}

function validateV5ToolError(value, path = 'toolError') {
    if (!isPlainObject(value)) fail(`${path} 必须是对象`, path, value);
    return createV5ToolError({ ...value, version: exactVersion(value.version, `${path}.version`) });
}

function createV5ToolResult(input = {}) {
    const status = V5_TOOL_RESULT_STATUSES.includes(input.status)
        ? input.status
        : fail('toolResult.status 必须明确为 success 或 failure', 'toolResult.status', input.status);
    const error = input.error === null || input.error === undefined ? null : validateV5ToolError(input.error);
    if (status === 'success' && error !== null) {
        fail('成功 ToolResult 不得包含 error', 'toolResult.error', error);
    }
    if (status === 'failure' && error === null) {
        fail('失败 ToolResult 必须包含结构化 error', 'toolResult.error', error);
    }
    return immutableSerializable({
        version: exactVersion(input.version ?? V5_CONTRACT_VERSION, 'toolResult.version'),
        taskId: requiredString(input.taskId, 'toolResult.taskId'),
        toolName: requiredString(input.toolName, 'toolResult.toolName'),
        status,
        data: status === 'success'
            ? immutableSerializable(input.data ?? null, 'toolResult.data')
            : null,
        error,
        operationRefs: serializableArray(input.operationRefs || [], 'toolResult.operationRefs'),
    }, 'toolResult');
}

function validateV5ToolResult(value, path = 'toolResult') {
    if (!isPlainObject(value)) fail(`${path} 必须是对象`, path, value);
    return createV5ToolResult({ ...value, version: exactVersion(value.version, `${path}.version`) });
}

function normalizeExecution(input = {}) {
    if (!isPlainObject(input)) fail('task.execution 必须是对象', 'task.execution', input);
    return {
        toolRequest: input.toolRequest === null || input.toolRequest === undefined
            ? null
            : validateV5ToolRequest(input.toolRequest, 'task.execution.toolRequest'),
        toolResult: input.toolResult === null || input.toolResult === undefined
            ? null
            : validateV5ToolResult(input.toolResult, 'task.execution.toolResult'),
    };
}

function normalizeHistory(input = []) {
    if (!Array.isArray(input)) fail('task.stateHistory 必须是数组', 'task.stateHistory', input);
    return input.map((item, index) => {
        const path = `task.stateHistory[${index}]`;
        if (!isPlainObject(item)) fail(`${path} 必须是对象`, path, item);
        if (!V5_TASK_STATES.includes(item.from) || !V5_TASK_STATES.includes(item.to)) {
            fail(`${path} 包含非法状态`, path, item);
        }
        return {
            from: item.from,
            to: item.to,
            timestamp: isoTimestamp(item.timestamp, `${path}.timestamp`),
            reasonCode: requiredString(item.reasonCode, `${path}.reasonCode`),
        };
    });
}

function createV5Task(input = {}) {
    const version = exactVersion(input.version ?? V5_CONTRACT_VERSION, 'task.version');
    const state = input.state || 'RECEIVED';
    if (!V5_TASK_STATES.includes(state)) fail('task.state 非法', 'task.state', state);
    const createdAt = isoTimestamp(input.createdAt, 'task.createdAt');
    const updatedAt = isoTimestamp(input.updatedAt ?? createdAt, 'task.updatedAt');
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
        fail('task.updatedAt 不得早于 createdAt', 'task.updatedAt', updatedAt);
    }

    if (!Array.isArray(input.entityContext || [])) {
        fail('task.entityContext 必须是数组', 'task.entityContext', input.entityContext);
    }

    return immutableSerializable({
        version,
        taskId: requiredString(input.taskId, 'task.taskId'),
        state,
        createdAt,
        updatedAt,
        intent: input.intent === null || input.intent === undefined
            ? null
            : immutableSerializable(input.intent, 'task.intent'),
        entityContext: (input.entityContext || []).map((item, index) => (
            validateEntityReference(item, `task.entityContext[${index}]`)
        )),
        requestedCapability: optionalNonEmptyString(
            input.requestedCapability,
            'task.requestedCapability'
        ),
        execution: normalizeExecution(input.execution || {}),
        verification: input.verification === null || input.verification === undefined
            ? null
            : immutableSerializable(input.verification, 'task.verification'),
        failure: input.failure === null || input.failure === undefined
            ? null
            : immutableSerializable(input.failure, 'task.failure'),
        metadata: immutableSerializable(input.metadata || {}, 'task.metadata'),
        stateHistory: normalizeHistory(input.stateHistory || []),
    }, 'task');
}

function validateV5Task(value) {
    if (!isPlainObject(value)) fail('task 必须是对象', 'task', value);
    return createV5Task({ ...value, version: exactVersion(value.version, 'task.version') });
}

module.exports = {
    V5_CONTRACT_VERSION,
    V5ContractValidationError,
    V5_RISK_CLASSES,
    V5_TASK_STATES,
    V5_TOOL_ERROR_CLASSES,
    V5_TOOL_RESULT_STATUSES,
    createV5EntityReference,
    createV5Task,
    createV5ToolError,
    createV5ToolRequest,
    createV5ToolResult,
    validateEntityReference,
    validateToolRequestForExecution,
    validateV5Task,
    validateV5ToolError,
    validateV5ToolRequest,
    validateV5ToolResult,
};
