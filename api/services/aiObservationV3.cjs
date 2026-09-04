const { getAiCapability } = require('../capabilities/registry.cjs');
const { hasVerifiedExecution, hasVerifiedWriteExecution } = require('./aiExecutionEvidence.cjs');
const { normalizeStableEntityIdentity } = require('./aiStableEntityIdentityV4.cjs');

const BEHAVIOR_EVENT_TYPES = new Set([
    'tool_proposed',
    'tool_rejected_not_allowed',
    'tool_schema_rejected',
    'duplicate_call_suppressed',
    'plan_drift',
    'retry_requested',
    'budget_exceeded',
]);
const OBSERVATION_OUTCOMES = new Set([
    'success_non_empty',
    'success_empty',
    'resource_not_found',
    'ambiguous',
    'business_rule_rejected',
    'timeout',
    'transport_failure',
    'protocol_failure',
    'cancelled',
]);
const EVIDENCE_KINDS = new Set([
    'live_business',
    'verified_negative',
    'historical_snapshot',
    'human_confirmed',
    'document',
    'operation',
]);
const VALID_OBSERVATIONS = new WeakSet();
const VALID_EVIDENCE_RECORDS = new WeakSet();

function immutableCopy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutableCopy(nested)])
    ));
}

function freezeRecord(value) {
    return immutableCopy({ ...value });
}

function createBehaviorEvent(type, details = {}) {
    if (!BEHAVIOR_EVENT_TYPES.has(type)) {
        throw new TypeError(`未知 BehaviorEvent 类型: ${type}`);
    }
    return freezeRecord({
        recordType: 'behavior_event',
        type,
        occurredAt: details.occurredAt || new Date().toISOString(),
        toolName: details.toolName || null,
        code: details.code || null,
        details: details.details || null,
    });
}

function resultCount(result = {}) {
    if (Number.isFinite(Number(result.count))) return Number(result.count);
    if (Number.isFinite(Number(result.returnedCount))) return Number(result.returnedCount);
    if (Number.isFinite(Number(result.queryReceipt?.returnedCount))) {
        return Number(result.queryReceipt.returnedCount);
    }
    if (Array.isArray(result.data)) return result.data.length;
    if (Array.isArray(result.items)) return result.items.length;
    if (Array.isArray(result.parts)) return result.parts.length;
    if (Array.isArray(result.templates)) return result.templates.length;
    if (Array.isArray(result.recipes)) return result.recipes.length;
    if (Array.isArray(result.coils)) return result.coils.length;
    return null;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function factKeyForTool(toolName, args = {}) {
    return `${String(toolName || '')}:${JSON.stringify(stableValue(args || {}))}`;
}

function normalizedError(input = {}) {
    const trace = Array.isArray(input.trace) ? input.trace : [];
    const failedCall = [...trace].reverse().find(item => item?.ok === false) || null;
    const error = input.error || failedCall?.error || {};
    return {
        code: String(error.code || input.result?.code || '').toUpperCase(),
        statusCode: Number(error.statusCode || input.result?.statusCode) || null,
        outcome: failedCall?.outcome
            || error.formalApiOutcome
            || input.result?.formalApiOutcome
            || null,
    };
}

function classifyObservationOutcome(input = {}) {
    const result = input.result || {};
    const error = normalizedError(input);
    if (input.cancelled || /CANCELLED|ABORT/.test(error.code)) return 'cancelled';
    if (error.outcome === 'not_found' || error.code === 'AI_RESOURCE_NOT_FOUND') {
        return 'resource_not_found';
    }
    if (/AMBIGU|MULTIPLE_MATCH|NEEDS_CLARIFICATION/.test(error.code)
        || result?.clarification?.status === 'ambiguous') return 'ambiguous';
    if (/TIMEOUT|TIMED_OUT/.test(error.code) || error.statusCode === 504) return 'timeout';
    if (/PROTOCOL|NON_JSON|INVALID_JSON/.test(error.code)) return 'protocol_failure';
    if (/NETWORK|SOCKET|ECONN|ENOTFOUND|FETCH_FAILED|TRANSPORT/.test(error.code)
        || [502, 503].includes(error.statusCode)) return 'transport_failure';
    if (result.success === false) {
        if ([400, 409, 422].includes(error.statusCode)
            || /BUSINESS|VALIDATION|CONFLICT|REJECTED/.test(error.code)) {
            return 'business_rule_rejected';
        }
        return 'protocol_failure';
    }
    return resultCount(result) === 0 ? 'success_empty' : 'success_non_empty';
}

function createObservation(input = {}) {
    if (input.attempted !== true) {
        throw new TypeError('Observation 只能由实际尝试的正式 capability/API 调用产生');
    }
    const outcome = input.outcome || classifyObservationOutcome(input);
    if (!OBSERVATION_OUTCOMES.has(outcome)) {
        throw new TypeError(`未知 Observation outcome: ${outcome}`);
    }
    const observation = freezeRecord({
        recordType: 'observation',
        observationId: input.observationId || null,
        outcome,
        capabilityName: input.capabilityName || null,
        factKey: input.factKey || factKeyForTool(input.capabilityName, input.args),
        attemptedAt: input.attemptedAt || new Date().toISOString(),
        verified: Boolean(input.verified),
        sourceOfTruth: input.sourceOfTruth || null,
        dataMode: input.dataMode || null,
        authorityVersion: input.authorityVersion ?? null,
        authorityTime: input.authorityTime || null,
        subjectIdentity: input.subjectIdentity
            ? normalizeStableEntityIdentity(input.subjectIdentity)
            : null,
        result: input.result || null,
    });
    VALID_OBSERVATIONS.add(observation);
    return observation;
}

function authorityVersionFromResult(result = {}) {
    const candidates = [result.version, result.data?.version, result.provenance?.version];
    return candidates.find(value => Number.isFinite(Number(value))) ?? null;
}

function authorityTimeFromResult(result = {}) {
    return result.provenance?.asOf
        || result.asOf
        || result.data?.asOf
        || result.updatedAt
        || result.data?.updatedAt
        || null;
}

function observationFromToolResult(toolName, args, result, options = {}) {
    const capability = options.capability || getAiCapability(toolName);
    return createObservation({
        attempted: true,
        capabilityName: toolName,
        factKey: options.factKey,
        observationId: options.observationId,
        args,
        result,
        trace: options.trace,
        error: options.error,
        cancelled: options.cancelled,
        verified: hasVerifiedExecution(result) || hasVerifiedWriteExecution(result),
        sourceOfTruth: capability?.sourceOfTruth || null,
        dataMode: capability?.dataMode || null,
        authorityVersion: authorityVersionFromResult(result),
        authorityTime: authorityTimeFromResult(result),
    });
}

function evidenceKindForObservation(observation, capability) {
    if (!observation?.verified) return null;
    if (['success_empty', 'resource_not_found'].includes(observation.outcome)) {
        return 'verified_negative';
    }
    if (observation.outcome !== 'success_non_empty') return null;
    if (hasVerifiedWriteExecution(observation.result)) return 'operation';
    if (capability?.resultProvenance?.kind === 'live_business') return 'live_business';
    if (capability?.dataMode === 'derived') return 'document';
    return 'historical_snapshot';
}

function createEvidenceRecord(input = {}) {
    if (!EVIDENCE_KINDS.has(input.kind)) {
        throw new TypeError(`未知 Evidence kind: ${input.kind}`);
    }
    if (!VALID_OBSERVATIONS.has(input.observation)) {
        throw new TypeError('EvidenceRecord 必须来自 Observation');
    }
    if (!input.observation.verified) {
        throw new TypeError('EvidenceRecord 只能来自已验证 Observation');
    }
    const expectedKind = evidenceKindForObservation(
        input.observation,
        getAiCapability(input.observation.capabilityName)
    );
    if (!expectedKind || input.kind !== expectedKind) {
        throw new TypeError('EvidenceRecord kind 必须与 Observation 的正式证据语义一致');
    }
    const evidence = freezeRecord({
        recordType: 'evidence',
        evidenceId: input.evidenceId || null,
        kind: input.kind,
        factKey: input.observation.factKey,
        observationId: input.observation.observationId || null,
        capabilityName: input.observation.capabilityName,
        sourceOfTruth: input.observation.sourceOfTruth,
        authorityVersion: input.observation.authorityVersion,
        authorityTime: input.observation.authorityTime,
        subjectIdentity: input.observation.subjectIdentity || null,
        recordedAt: input.recordedAt || new Date().toISOString(),
        supersedesEvidenceId: input.supersedesEvidenceId || null,
        toolResult: input.toolResult || null,
    });
    VALID_EVIDENCE_RECORDS.add(evidence);
    return evidence;
}

function isNewerAuthority(incoming, current) {
    if (!incoming || !current || incoming.factKey !== current.factKey) return false;
    if (!incoming.sourceOfTruth || incoming.sourceOfTruth !== current.sourceOfTruth) return false;
    const hasVersions = incoming.authorityVersion !== null
        && incoming.authorityVersion !== undefined
        && current.authorityVersion !== null
        && current.authorityVersion !== undefined;
    const incomingVersion = Number(incoming.authorityVersion);
    const currentVersion = Number(current.authorityVersion);
    if (hasVersions && Number.isFinite(incomingVersion) && Number.isFinite(currentVersion)) {
        return incomingVersion > currentVersion;
    }
    const incomingTime = Date.parse(incoming.authorityTime || '');
    const currentTime = Date.parse(current.authorityTime || '');
    return Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime > currentTime;
}

function createEvidenceLedger() {
    const entries = [];
    let sequence = 0;
    const snapshot = () => Object.freeze(entries.slice());
    const activeRecords = () => {
        const superseded = new Set(entries.map(item => item.supersedesEvidenceId).filter(Boolean));
        return Object.freeze(entries.filter(item => !superseded.has(item.evidenceId)));
    };
    const append = record => {
        if (!VALID_EVIDENCE_RECORDS.has(record)) {
            throw new TypeError('Evidence Ledger 只接受 EvidenceRecord；BehaviorEvent/Observation 禁止进入');
        }
        if (!EVIDENCE_KINDS.has(record.kind) || !record.factKey || !record.capabilityName) {
            throw new TypeError('Evidence Ledger 只接受完整 EvidenceRecord');
        }
        const current = [...activeRecords()].reverse().find(item => item.factKey === record.factKey);
        sequence += 1;
        const appended = freezeRecord({
            ...record,
            evidenceId: `evidence-${sequence}`,
            supersedesEvidenceId: isNewerAuthority(record, current) ? current.evidenceId : null,
        });
        entries.push(appended);
        return appended;
    };
    const appendObservation = (observation, context = {}) => {
        const capability = context.capability || getAiCapability(observation?.capabilityName);
        const kind = evidenceKindForObservation(observation, capability);
        if (!kind) return null;
        const candidate = createEvidenceRecord({ kind, observation, toolResult: context.toolResult || null });
        return append(candidate);
    };
    const toolResults = () => activeRecords().map(item => item.toolResult).filter(Boolean);
    return Object.freeze({ append, appendObservation, snapshot, activeRecords, toolResults });
}

function isVerifiedEmptyObservation(result = {}) {
    return Boolean(result && result.success !== false && hasVerifiedExecution(result) && resultCount(result) === 0);
}

function isVerifiedPositiveObservation(result = {}) {
    if (!result || result.success === false || !hasVerifiedExecution(result)) return false;
    const count = resultCount(result);
    return count === null || count > 0;
}

function completedCapabilityNames(toolResults = [], options = {}) {
    const names = new Set();
    for (const item of toolResults || []) {
        if (isVerifiedPositiveObservation(item?.result)) names.add(item.name);
        if (options.acceptVerifiedEmpty && isVerifiedEmptyObservation(item?.result)) names.add(item.name);
    }
    return names;
}

module.exports = {
    BEHAVIOR_EVENT_TYPES,
    EVIDENCE_KINDS,
    OBSERVATION_OUTCOMES,
    classifyObservationOutcome,
    completedCapabilityNames,
    createBehaviorEvent,
    createEvidenceLedger,
    createEvidenceRecord,
    createObservation,
    evidenceKindForObservation,
    factKeyForTool,
    isNewerAuthority,
    isVerifiedEmptyObservation,
    isVerifiedPositiveObservation,
    observationFromToolResult,
    resultCount,
};
