'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { buildBusinessSemanticFrame } = require('./frameBuilder.cjs');
const { validateBusinessSemanticFrame } = require('./validator.cjs');
const { projectAnswerAgainstFrame } = require('./answerProjection.cjs');
const { deepFreeze } = require('./contract.cjs');

const recent = [];
function safeRequestId(value) {
    if (typeof value !== 'string' || !value) return null;
    return /^[a-zA-Z0-9._-]{8,128}$/.test(value) ? value : crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function observeBusinessSemanticShadow({ userText, toolResults = [], answer = '', requestId, eligibility = null } = {}, dependencies = {}) {
    const started = performance.now();
    let record;
    try {
        const preFrame = buildBusinessSemanticFrame({ userText, stage: 'PRE_EVIDENCE', eligibility });
        const postFrame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE', eligibility });
        validateBusinessSemanticFrame(preFrame);
        validateBusinessSemanticFrame(postFrame);
        record = deepFreeze({ version: 1, requestId: safeRequestId(requestId), preFrame, postFrame,
            answerProjection: projectAnswerAgainstFrame(postFrame, answer), exception: null,
            semanticProviderCalls: 0, businessWrites: 0, durationMs: Math.max(0, performance.now() - started) });
    } catch (error) {
        record = deepFreeze({ version: 1, requestId: safeRequestId(requestId), preFrame: null, postFrame: null,
            answerProjection: { detected: false, violations: [] }, exception: String(error?.reason || error?.code || 'SEMANTIC_FRAME_FAILURE').slice(0, 120),
            semanticProviderCalls: 0, businessWrites: 0, durationMs: Math.max(0, performance.now() - started) });
    }
    recent.push(record);
    if (recent.length > 100) recent.shift();
    try { await dependencies.observe?.(record); } catch { /* Observation is fail-open. */ }
    try { dependencies.record?.(record); } catch { /* Local sink is fail-open. */ }
    return record;
}

function clearRecentBusinessSemanticFrames() { recent.length = 0; }

module.exports = { clearRecentBusinessSemanticFrames, observeBusinessSemanticShadow,
    recentBusinessSemanticFrames: () => recent.slice(), safeRequestId };
