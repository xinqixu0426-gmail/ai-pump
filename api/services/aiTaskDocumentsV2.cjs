'use strict';

// N4.1B document content lives in a separate, server-owned evidence ledger.
// It is deliberately not a FactRecord: documents can support an answer, but
// cannot grant permissions, create a business fact, or control execution.
const crypto = require('node:crypto');
const { stableHash } = require('./stableJson.cjs');

const SOURCE_TYPES = Object.freeze(new Set(['FACTORY_FILE', 'TECHNICAL_FILE', 'KNOWLEDGE_DOCUMENT', 'KNOWLEDGE_ENTRY']));
const CONTENT_AVAILABILITY = Object.freeze(new Set(['FULL', 'PARTIAL', 'METADATA_ONLY', 'UNAVAILABLE']));
const EVIDENCE_KINDS = Object.freeze(new Set(['SOURCE_ASSERTION', 'SOURCE_TABLE', 'SOURCE_METADATA']));
const LOCATION_TYPES = Object.freeze(new Set(['LINE_RANGE', 'PAGE_RANGE', 'CELL_RANGE', 'JSON_POINTER', 'WHOLE_RECORD']));
const EXTRACTED_CONFIGURATION_FIELDS = Object.freeze(new Set([
    'coilSelection', 'hasCable', 'cableLength', 'cableWire', 'hasFloat', 'floatWire',
    'customBarrelLength', 'packingSelection', 'surfaceTreatmentMode', 'unitPrice',
]));
const MAX_EXCERPT_UNICODE = 1200;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function unicodeLength(value) { return [...String(value)].length; }
function truncateUnicode(value, maximum = MAX_EXCERPT_UNICODE) { return [...String(value)].slice(0, maximum).join(''); }
function normalizedExcerpt(value) { return String(value).replace(/\r\n?/g, '\n'); }
function string(value, minimum, maximum, code) { if (typeof value !== 'string' || value.length < minimum || value.length > maximum) fail(code); return value; }
function hash(value, code) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code); return value; }
function iso(value, code) { if (value !== null && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) fail(code); return value; }

function sourceVersionHash(source) {
    // Task IDs, candidate keys, timestamps of this task, and presentation
    // labels are intentionally absent. Only formal source version metadata
    // participates in identity.
    return stableHash({
        sourceType: source.sourceType,
        sourceId: String(source.sourceId),
        sourceTable: source.sourceTable ?? null,
        sourceVersion: source.sourceVersion ?? null,
        updatedAt: source.updatedAt ?? null,
        syncedAt: source.syncedAt ?? null,
        contentHash: source.contentHash ?? null,
        fileSha256: source.fileSha256 ?? null,
    });
}

function candidate(input) {
    const value = {
        version: 1,
        candidateKey: String(input.candidateKey || ''),
        sourceType: input.sourceType,
        sourceId: String(input.sourceId || ''),
        title: String(input.title || ''),
        mimeType: input.mimeType ?? null,
        linkedEntity: input.linkedEntity ?? null,
        lifecycleStatus: input.lifecycleStatus || 'UNKNOWN',
        freshness: input.freshness || 'UNKNOWN',
        updatedAt: input.updatedAt ?? null,
        syncedAt: input.syncedAt ?? null,
        sourceTable: input.sourceTable ?? null,
        entryType: input.entryType ?? null,
        contentAvailability: input.contentAvailability || 'UNAVAILABLE',
        sourceVersionHash: input.sourceVersionHash || sourceVersionHash(input),
    };
    validateDocumentCandidateV1(value);
    return Object.freeze(value);
}

function location(input) {
    if (!input || !LOCATION_TYPES.has(input.type)) fail('SOURCE_LOCATION_INVALID');
    const value = { ...input };
    if (value.type === 'LINE_RANGE' || value.type === 'PAGE_RANGE') {
        if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 1 || value.end < value.start) fail('SOURCE_LOCATION_RANGE_INVALID');
    }
    if (value.type === 'CELL_RANGE' && (typeof value.sheet !== 'string' || !value.sheet || typeof value.range !== 'string' || !value.range)) fail('SOURCE_LOCATION_CELL_RANGE_INVALID');
    if (value.type === 'JSON_POINTER' && (typeof value.pointer !== 'string' || !value.pointer.startsWith('/'))) fail('SOURCE_LOCATION_POINTER_INVALID');
    return Object.freeze(value);
}

function coverage(input = {}) {
    const value = { mode: input.mode || 'METADATA_ONLY', complete: input.complete === true, totalUnits: input.totalUnits ?? null, returnedUnits: input.returnedUnits ?? null, truncated: input.truncated === true };
    if (!['FULL_CONTENT', 'PARTIAL_CONTENT', 'METADATA_ONLY'].includes(value.mode)) fail('SOURCE_COVERAGE_MODE_INVALID');
    if (value.complete && (value.mode !== 'FULL_CONTENT' || value.truncated)) fail('SOURCE_COVERAGE_COMPLETE_INVALID');
    if (value.totalUnits !== null && (!Number.isInteger(value.totalUnits) || value.totalUnits < 0)) fail('SOURCE_COVERAGE_TOTAL_INVALID');
    if (value.returnedUnits !== null && (!Number.isInteger(value.returnedUnits) || value.returnedUnits < 0)) fail('SOURCE_COVERAGE_RETURNED_INVALID');
    return Object.freeze(value);
}

function evidence({ taskId, planRevision, candidate: item, evidenceKind = 'SOURCE_ASSERTION', location: where, excerpt, coverage: readCoverage, observedAt = new Date().toISOString(), evidenceId = crypto.randomUUID() }) {
    const value = {
        version: 1,
        evidenceId,
        taskId,
        planRevision,
        candidateKey: item.candidateKey,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceVersionHash: item.sourceVersionHash,
        candidate: { ...item },
        evidenceKind,
        location: { ...location(where) },
        excerpt: String(excerpt ?? ''),
        excerptHash: sha256(normalizedExcerpt(excerpt ?? '')),
        coverage: { ...coverage(readCoverage) },
        observedAt,
    };
    validateSourceEvidenceRecordV1(value);
    return Object.freeze(value);
}

function validateDocumentCandidateV1(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DOCUMENT_CANDIDATE_OBJECT');
    const keys = ['version', 'candidateKey', 'sourceType', 'sourceId', 'title', 'mimeType', 'linkedEntity', 'lifecycleStatus', 'freshness', 'updatedAt', 'syncedAt', 'sourceTable', 'entryType', 'contentAvailability', 'sourceVersionHash'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('DOCUMENT_CANDIDATE_FIELDS');
    if (value.version !== 1) fail('DOCUMENT_CANDIDATE_VERSION');
    string(value.candidateKey, 1, 160, 'DOCUMENT_CANDIDATE_KEY');
    if (!SOURCE_TYPES.has(value.sourceType)) fail('DOCUMENT_SOURCE_TYPE_INVALID');
    string(value.sourceId, 1, 160, 'DOCUMENT_SOURCE_ID_REQUIRED');
    string(value.title, 1, 500, 'DOCUMENT_TITLE_REQUIRED');
    if (value.mimeType !== null) string(value.mimeType, 1, 160, 'DOCUMENT_MIME_TYPE');
    if (value.linkedEntity !== null && (typeof value.linkedEntity !== 'object' || Array.isArray(value.linkedEntity))) fail('DOCUMENT_LINKED_ENTITY');
    if (!['ACTIVE', 'ARCHIVED', 'DELETED', 'UNKNOWN'].includes(value.lifecycleStatus)) fail('DOCUMENT_LIFECYCLE');
    if (!['CURRENT', 'STALE', 'UNKNOWN', 'NOT_APPLICABLE'].includes(value.freshness)) fail('DOCUMENT_FRESHNESS');
    iso(value.updatedAt, 'DOCUMENT_UPDATED_AT'); iso(value.syncedAt, 'DOCUMENT_SYNCED_AT');
    if (value.sourceTable !== null) string(value.sourceTable, 1,100, 'DOCUMENT_SOURCE_TABLE');
    if (value.entryType !== null) string(value.entryType, 1,100, 'DOCUMENT_ENTRY_TYPE');
    if (!CONTENT_AVAILABILITY.has(value.contentAvailability)) fail('DOCUMENT_CONTENT_AVAILABILITY_INVALID');
    hash(value.sourceVersionHash, 'DOCUMENT_SOURCE_VERSION_HASH');
    return true;
}

function validateSourceEvidenceRecordV1(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOURCE_EVIDENCE_OBJECT');
    const keys = ['version', 'evidenceId', 'taskId', 'planRevision', 'candidateKey', 'sourceType', 'sourceId', 'sourceVersionHash', 'candidate', 'evidenceKind', 'location', 'excerpt', 'excerptHash', 'coverage', 'observedAt'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('SOURCE_EVIDENCE_FIELDS');
    if (value.version !== 1 || typeof value.evidenceId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value.evidenceId) || typeof value.taskId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value.taskId)) fail('SOURCE_EVIDENCE_ID');
    if (!Number.isInteger(value.planRevision) || value.planRevision < 1) fail('SOURCE_EVIDENCE_PLAN_REVISION');
    validateDocumentCandidateV1(value.candidate);
    if (value.candidateKey !== value.candidate.candidateKey || value.sourceType !== value.candidate.sourceType || value.sourceId !== value.candidate.sourceId || value.sourceVersionHash !== value.candidate.sourceVersionHash) fail('SOURCE_EVIDENCE_CANDIDATE_MISMATCH');
    if (!EVIDENCE_KINDS.has(value.evidenceKind)) fail('SOURCE_EVIDENCE_KIND_INVALID');
    location(value.location);
    string(value.excerpt, 0, MAX_EXCERPT_UNICODE, 'SOURCE_EXCERPT_LIMIT');
    hash(value.excerptHash, 'SOURCE_EXCERPT_HASH');
    if (value.excerptHash !== sha256(normalizedExcerpt(value.excerpt))) fail('SOURCE_EXCERPT_HASH_MISMATCH');
    coverage(value.coverage); iso(value.observedAt, 'SOURCE_EVIDENCE_OBSERVED_AT');
    return true;
}

function sourceEvidenceClaim(record, statement) { validateSourceEvidenceRecordV1(record); return Object.freeze({ claimKind: 'SOURCE_EVIDENCE', evidenceIds: [record.evidenceId], statement: String(statement), location: record.location, freshness: record.candidate.freshness, authorityClass: 'DOCUMENT_SOURCE' }); }
function sourceLimitationClaim(record, statement) { validateSourceEvidenceRecordV1(record); return Object.freeze({ claimKind: 'SOURCE_LIMITATION', evidenceIds: [record.evidenceId], statement: String(statement), location: record.location, freshness: record.candidate.freshness, authorityClass: 'DOCUMENT_SOURCE' }); }
function canAssertSourceAbsence(record) { validateSourceEvidenceRecordV1(record); return record.coverage.mode === 'FULL_CONTENT' && record.coverage.complete && !record.coverage.truncated; }
function candidateSetHash(items) { return stableHash([...items].map(item => { validateDocumentCandidateV1(item); return { sourceType: item.sourceType, sourceId: item.sourceId, sourceVersionHash: item.sourceVersionHash }; }).sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`))); }
function classifyContentAvailability({ parserStatus, content }) { if (parserStatus === 'parsed' && typeof content === 'string' && content) return 'FULL'; if (parserStatus === 'metadata_only') return 'METADATA_ONLY'; if (parserStatus === 'failed') return 'UNAVAILABLE'; return 'PARTIAL'; }
function sourceContentBoundary(input) { return Object.freeze({ kind: 'SOURCE_CONTENT', text: String(input ?? '') }); }
function conflict(input) {
    const value = {
        version: 1, conflictId: input.conflictId || crypto.randomUUID(), subjectKey: input.subjectKey ?? null,
        topic: String(input.topic || ''), leftEvidenceId: String(input.leftEvidenceId || ''), rightEvidenceId: String(input.rightEvidenceId || ''),
        conflictType: input.conflictType, resolution: input.resolution || 'UNRESOLVED_SOURCE_CONFLICT',
    };
    validateSourceConflictV1(value);
    return Object.freeze(value);
}
function validateSourceConflictV1(value, evidenceById = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOURCE_CONFLICT_OBJECT');
    const keys = ['version', 'conflictId', 'subjectKey', 'topic', 'leftEvidenceId', 'rightEvidenceId', 'conflictType', 'resolution'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('SOURCE_CONFLICT_FIELDS');
    if (value.version !== 1 || typeof value.conflictId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value.conflictId)) fail('SOURCE_CONFLICT_ID');
    if (value.subjectKey !== null) string(value.subjectKey, 1, 100, 'SOURCE_CONFLICT_SUBJECT');
    string(value.topic, 1, 200, 'SOURCE_CONFLICT_TOPIC');
    if (!/^[0-9a-f-]{36}$/iu.test(value.leftEvidenceId) || !/^[0-9a-f-]{36}$/iu.test(value.rightEvidenceId) || value.leftEvidenceId === value.rightEvidenceId) fail('SOURCE_CONFLICT_EVIDENCE_IDS');
    if (!['VALUE_MISMATCH', 'VERSION_MISMATCH', 'STATUS_MISMATCH'].includes(value.conflictType)) fail('SOURCE_CONFLICT_TYPE');
    if (!['LIVE_BUSINESS_PREVAILS', 'UNRESOLVED_SOURCE_CONFLICT'].includes(value.resolution)) fail('SOURCE_CONFLICT_RESOLUTION');
    if (evidenceById && (!evidenceById.has(value.leftEvidenceId) || !evidenceById.has(value.rightEvidenceId))) fail('SOURCE_CONFLICT_EVIDENCE_REF');
    return true;
}
function detectSourceConflict(left, right, topic = 'source', subjectKey = null) {
    validateSourceEvidenceRecordV1(left); validateSourceEvidenceRecordV1(right);
    if (left.excerpt === right.excerpt) return null;
    return conflict({ subjectKey, topic, leftEvidenceId: left.evidenceId, rightEvidenceId: right.evidenceId, conflictType: left.candidate.sourceVersionHash === right.candidate.sourceVersionHash ? 'VALUE_MISMATCH' : 'VERSION_MISMATCH' });
}
function sourceNumericTokens(statement) { return [...String(statement).matchAll(/-?\d+(?:\.\d+)?/gu)].map(match => match[0]); }
function validateSourceEvidenceClaimV1({ record, sourceLabel, statement, assertsAbsence = false }) {
    validateSourceEvidenceRecordV1(record);
    if (sourceLabel !== record.candidate.title) fail('SOURCE_CLAIM_LABEL_MISMATCH');
    string(statement, 1, 4000, 'SOURCE_CLAIM_STATEMENT');
    if (assertsAbsence && !canAssertSourceAbsence(record)) fail('SOURCE_CLAIM_ABSENCE_INCOMPLETE');
    const excerpt = normalizedExcerpt(record.excerpt);
    if (sourceNumericTokens(statement).some(token => !excerpt.includes(token))) fail('SOURCE_CLAIM_NUMBER_NOT_EVIDENCED');
    return true;
}

function extractedCandidate(input, evidenceById) {
    const record = evidenceById?.get(input.evidenceId);
    if (!record) fail('EXTRACTED_CANDIDATE_EVIDENCE_UNTRUSTED');
    validateSourceEvidenceRecordV1(record);
    const value = {
        version: 1, candidateId: input.candidateId || crypto.randomUUID(), taskId: input.taskId,
        planRevision: input.planRevision, evidenceId: input.evidenceId, field: input.field,
        rawValue: input.rawValue, normalizedValue: input.normalizedValue, unit: input.unit ?? null,
        sourceVersionHash: input.sourceVersionHash, location: input.location, status: 'CANDIDATE',
    };
    validateExtractedCandidateV1(value, evidenceById);
    return Object.freeze(value);
}

function validateExtractedCandidateV1(value, evidenceById) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EXTRACTED_CANDIDATE_OBJECT');
    const keys = ['version', 'candidateId', 'taskId', 'planRevision', 'evidenceId', 'field', 'rawValue', 'normalizedValue', 'unit', 'sourceVersionHash', 'location', 'status'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('EXTRACTED_CANDIDATE_FIELDS');
    if (value.version !== 1 || !/^[0-9a-f-]{36}$/iu.test(String(value.candidateId)) || !/^[0-9a-f-]{36}$/iu.test(String(value.taskId))) fail('EXTRACTED_CANDIDATE_ID');
    if (!Number.isInteger(value.planRevision) || value.planRevision < 1 || !/^[0-9a-f-]{36}$/iu.test(String(value.evidenceId))) fail('EXTRACTED_CANDIDATE_METADATA');
    if (!EXTRACTED_CONFIGURATION_FIELDS.has(value.field) || !['string', 'number', 'boolean'].includes(typeof value.rawValue) || !['string', 'number', 'boolean'].includes(typeof value.normalizedValue) || (value.unit !== null && typeof value.unit !== 'string') || value.status !== 'CANDIDATE') fail('EXTRACTED_CANDIDATE_VALUE');
    hash(value.sourceVersionHash, 'EXTRACTED_CANDIDATE_SOURCE_VERSION'); location(value.location);
    const record = evidenceById?.get(value.evidenceId);
    if (!record) fail('EXTRACTED_CANDIDATE_EVIDENCE_UNTRUSTED');
    validateSourceEvidenceRecordV1(record);
    if (record.taskId !== value.taskId || record.planRevision !== value.planRevision || record.sourceVersionHash !== value.sourceVersionHash) fail('EXTRACTED_CANDIDATE_EVIDENCE_MISMATCH');
    if (JSON.stringify(record.location) !== JSON.stringify(value.location)) fail('EXTRACTED_CANDIDATE_LOCATION_MISMATCH');
    if (!normalizedExcerpt(record.excerpt).includes(String(value.rawValue))) fail('EXTRACTED_CANDIDATE_RAW_VALUE_NOT_EVIDENCED');
    return true;
}

function sourceConfigComparison(input, evidenceById) {
    const trustedEvidence = evidenceById || input.evidenceById;
    const candidateValue = input.candidate || null;
    if (candidateValue) validateExtractedCandidateV1(candidateValue, trustedEvidence);
    const field = candidateValue ? candidateValue.field : input.field;
    const evidenceId = candidateValue ? candidateValue.evidenceId : input.evidenceId;
    const record = trustedEvidence?.get(evidenceId);
    if (!record || !EXTRACTED_CONFIGURATION_FIELDS.has(field)) fail('SOURCE_CONFIG_COMPARISON_EVIDENCE_UNTRUSTED');
    const liveValue = input.liveValue;
    const resolved = Boolean(candidateValue) && input.resolved === true && input.sourceCoverageComplete === true && liveValue !== undefined;
    const status = resolved ? (canonicalJsonValue(candidateValue.normalizedValue) === canonicalJsonValue(liveValue) ? 'MATCH' : 'MISMATCH') : 'UNRESOLVED';
    return Object.freeze({ version: 1, comparisonKey: input.comparisonKey || crypto.randomUUID(), field, evidenceId, sourceAuthority: 'DOCUMENT_SOURCE', liveAuthority: 'LIVE_BUSINESS', sourceValue: candidateValue ? candidateValue.normalizedValue : null, liveValue: liveValue ?? null, status, reasonCode: status === 'UNRESOLVED' ? (input.reasonCode || 'SOURCE_OR_LIVE_VALUE_UNRESOLVED') : null });
}
function canonicalJsonValue(value) { return JSON.stringify(value); }

function validateSourceConfigComparisonV1(value, evidenceById) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOURCE_CONFIG_COMPARISON_OBJECT');
    const keys = ['version', 'comparisonKey', 'field', 'evidenceId', 'sourceAuthority', 'liveAuthority', 'sourceValue', 'liveValue', 'status', 'reasonCode'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('SOURCE_CONFIG_COMPARISON_FIELDS');
    if (value.version !== 1 || !/^[0-9a-f-]{36}$/iu.test(String(value.comparisonKey)) || !EXTRACTED_CONFIGURATION_FIELDS.has(value.field) || !/^[0-9a-f-]{36}$/iu.test(String(value.evidenceId))) fail('SOURCE_CONFIG_COMPARISON_METADATA');
    if (value.sourceAuthority !== 'DOCUMENT_SOURCE' || value.liveAuthority !== 'LIVE_BUSINESS' || !['MATCH', 'MISMATCH', 'UNRESOLVED'].includes(value.status)) fail('SOURCE_CONFIG_COMPARISON_AUTHORITY');
    const record = evidenceById?.get(value.evidenceId);
    if (!record) fail('SOURCE_CONFIG_COMPARISON_EVIDENCE_UNTRUSTED');
    validateSourceEvidenceRecordV1(record);
    if (value.status === 'UNRESOLVED' ? typeof value.reasonCode !== 'string' || !value.reasonCode : value.reasonCode !== null) fail('SOURCE_CONFIG_COMPARISON_RESOLUTION');
    return true;
}

module.exports = { MAX_EXCERPT_UNICODE, EXTRACTED_CONFIGURATION_FIELDS, candidate, candidateSetHash, canAssertSourceAbsence, classifyContentAvailability, conflict, coverage, detectSourceConflict, evidence, extractedCandidate, normalizedExcerpt, sourceConfigComparison, sourceContentBoundary, sourceEvidenceClaim, sourceLimitationClaim, sourceVersionHash, truncateUnicode, unicodeLength, validateDocumentCandidateV1, validateExtractedCandidateV1, validateSourceConflictV1, validateSourceConfigComparisonV1, validateSourceEvidenceClaimV1, validateSourceEvidenceRecordV1 };
