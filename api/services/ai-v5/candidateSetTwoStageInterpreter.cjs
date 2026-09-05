'use strict';
const { createV5SourceSpanCatalog, getSourceSpan } = require('./sourceSpanCatalog.cjs');
const { selectSourceSpan } = require('./sourceSpanSelector.cjs');
const { acquireCandidateUnion } = require('./candidateUnion.cjs');
const { buildLocalTaskClassCatalog } = require('./localTaskClassCatalog.cjs');
const { selectLocalIntent } = require('./localIntentSelector.cjs');
const { finalizeEntity } = require('./entityFinalization.cjs');
const { validateV5TaskInterpretation } = require('./taskInterpretationContract.cjs');
const { anchorInterpretationEntities } = require('./sourceAnchoredEntity.cjs');
const { validateV5InterpreterInputEnvelope } = require('./taskInterpreterInput.cjs');
const { withV5InterpreterStage } = require('../observability.cjs');
const V5_INTERPRETER_ARCHITECTURE_VERSION = 3;
const MAX_INTERPRETER_MODEL_CALLS = 2;

async function interpretCandidateSetTask(envelope, options = {}) {
    const started = performance.now();
    const meta = { architectureVersion: 3, stage1Status: 'NOT_RUN', stage2Status: 'NOT_RUN',
        stage1Calls: 0, stage2Calls: 0, businessApiCalls: 0, lookupStatus: 'NOT_RUN',
        complete: false, candidateCount: 0, candidateTypeCount: 0, candidateTypes: [],
        localClassCount: 0, localSelectionMode: 'NOT_RUN', finalEntityStatus: 'NOT_RUN',
        stage1DurationMs: null, lookupDurationMs: null, stage2DurationMs: null };
    const finish = (status, reasonCode, extra = {}) => ({ status, protocolStatus: status, reasonCode,
        sourceSpanRefs: meta.spanRefs || [], taskClassRef: meta.selectedClassRef || null,
        interpretation: null, provider: 'deepseek', model: 'deepseek-v4-flash',
        modelCalls: meta.stage1Calls + meta.stage2Calls, durationMs: performance.now() - started,
        architectureMetadata: Object.freeze({ ...meta }), ...extra });
    if (!validateV5InterpreterInputEnvelope(envelope)) return finish('INVALID', 'INTERPRETER_INPUT_ENVELOPE_INVALID');
    const source = envelope.rawUserRequest;
    const catalog = createV5SourceSpanCatalog(source);
    if (catalog.status !== 'READY') return finish('INVALID', catalog.status);
    meta.stage1Calls = 1;
    const first = await withV5InterpreterStage('span-selection', options, () => selectSourceSpan(source, catalog, options));
    meta.stage1Status = first.status;
    meta.stage1DurationMs = first.durationMs;
    if (first.errorMetadata) meta.stage1Error = first.errorMetadata;
    if (first.status !== 'VALID') return finish(first.status, first.reasonCode || 'SPAN_SELECTION_ERROR');
    if (first.selection.needsClarification) return finish('INVALID', 'MULTI_ENTITY_OR_PRIMARY_ENTITY_CLARIFICATION');
    const spans = first.selection.spanRefs.map(ref=>getSourceSpan(catalog,ref));
    meta.spanRefs = Object.freeze([...first.selection.spanRefs]);
    meta.selectedSpanCount = spans.length;
    const lookupStarted = performance.now();
    const candidateSet = await withV5InterpreterStage('governed-lookup', options, () => acquireCandidateUnion(spans, options));
    meta.lookupDurationMs = performance.now() - lookupStarted;
    Object.assign(meta, { businessApiCalls: candidateSet.businessApiCalls, resolverCalls:candidateSet.resolverCalls,
        lookupStatuses:candidateSet.lookupStatuses, candidateUnionDeduplications:candidateSet.deduplications, lookupStatus: candidateSet.status,
        complete: candidateSet.complete, candidateCount: candidateSet.candidateCount,
        candidateTypeCount: candidateSet.candidateTypeCount,
        candidateTypes: [...new Set(candidateSet.candidates.map(candidate => candidate.entityType))].sort() });
    if (!candidateSet.eligible) return finish('INVALID', candidateSet.reasonCodes[0] || 'CANDIDATE_SET_INELIGIBLE');
    const local = await withV5InterpreterStage('local-task-class-build', options, () => buildLocalTaskClassCatalog(candidateSet.candidates));
    meta.localClassCount = local.length;
    if (!local.length) return finish('INVALID', 'LOCAL_CLASS_EMPTY');
    let selected = local[0];
    meta.localSelectionMode = 'DETERMINISTIC_SELECT';
    if (local.length > 1) {
        meta.localSelectionMode = 'MODEL_SELECT';
        meta.stage2Calls = 1;
        const second = await withV5InterpreterStage('local-intent', options, () => selectLocalIntent(source, meta.spanRefs, meta.candidateTypes, local, options));
        meta.stage2Status = second.status;
        meta.stage2DurationMs = second.durationMs;
        if (second.errorMetadata) meta.stage2Error = second.errorMetadata;
        meta.stage2InputFingerprint = second.inputFingerprint;
        if (second.status !== 'VALID') return finish(second.status, second.reasonCode || 'LOCAL_INTENT_ERROR');
        selected = local.find(item => item.classRef === second.selection.localTaskClassRef);
    }
    meta.selectedClassRef = selected.classRef;
    const final = await withV5InterpreterStage('entity-finalization', options, () => finalizeEntity(candidateSet, selected));
    meta.finalEntityStatus = final.status;
    if (!final.candidate) return finish('INVALID', final.status);
    // Entity was already finalized without rank. Pick a deterministic source witness,
    // independent of model order; preserve the original Top-2 separately for recall.
    const witness = spans.filter(s=>final.candidate.matchedSpanRefs.includes(s.spanRef))
        .sort((a,b)=>a.start-b.start || a.end-b.end)[0];
    const rawMention = source.slice(witness.start,witness.end);
    const interpretation = validateV5TaskInterpretation({ version: 1, domain: selected.domain,
        operation: selected.operation, entityCandidates: [{ entityType: final.candidate.entityType, candidateText: rawMention }],
        needsClarification: false, reasonCodes: ['INTERPRETATION_COMPLETE'] });
    const anchoring = anchorInterpretationEntities(source, interpretation);
    if (!anchoring.valid) return finish('INVALID', anchoring.status);
    return finish('VALID', 'INTERPRETATION_VALID', { interpretation, taskClassRef: selected.classRef,
        sourceSpanRefs: meta.spanRefs,
        // Transient, software-owned identity; never copied into shadow outcomes.
        resolvedIdentity: final.candidate,
    });
}
module.exports = { V5_INTERPRETER_ARCHITECTURE_VERSION, MAX_INTERPRETER_MODEL_CALLS, interpretCandidateSetTask };
