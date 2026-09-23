'use strict';

const crypto = require('node:crypto');
const { getAiCapability } = require('../capabilities/registry.cjs');

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHAT_ID_RE = /^chat-([1-9][0-9]*)$/u;
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._:/-]{8,200}$/u;
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);
class AiTaskPublicError extends Error { constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; } }
const fail = (code, status = 400, message) => { throw new AiTaskPublicError(code, status, message); };
function exact(value, keys, code = 'TASK_REQUEST_INVALID') { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail(code); return value; }
function positive(value, code = 'TASK_REQUEST_INVALID') { if (!Number.isInteger(value) || value < 1) fail(code); return value; }
function requiredIdempotency(value) { const key = String(value || '').trim(); if (!IDEMPOTENCY_KEY_RE.test(key)) fail('IDEMPOTENCY_KEY_REQUIRED'); return key; }
function parseTaskStart(value) { exact(value, ['version', 'conversationId', 'userMessageId', 'executionMode']); if (value.version !== 1 || !CHAT_ID_RE.test(value.conversationId) || !positive(value.userMessageId) || value.executionMode !== 'DETACHED') fail('TASK_START_INVALID'); return value; }
function parseTaskResume(value) {
    exact(value, ['version', 'expectedRevision', 'answers', 'executionMode']);
    if (value.version !== 1 || !positive(value.expectedRevision) || value.executionMode !== 'DETACHED' || !Array.isArray(value.answers) || value.answers.length > 12) fail('TASK_RESUME_INVALID');
    const seen = new Set();
    for (const answer of value.answers) {
        exact(answer, ['questionId', 'choiceId', 'answerText'], 'TASK_RESUME_INVALID');
        if (!TASK_ID_RE.test(String(answer.questionId || '')) || seen.has(answer.questionId)) fail('TASK_RESUME_INVALID');
        seen.add(answer.questionId);
        const choice = answer.choiceId; const text = answer.answerText;
        if (!((typeof choice === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(choice) && text === null) || (choice === null && typeof text === 'string' && text.length >= 1 && text.length <= 2000))) fail('TASK_RESUME_INVALID');
    }
    return value;
}
function parseTaskCancel(value) { exact(value, ['version', 'expectedRevision', 'reason']); if (value.version !== 1 || !positive(value.expectedRevision) || typeof value.reason !== 'string' || value.reason.length > 500) fail('TASK_CANCEL_INVALID'); return value; }
function acknowledgement(task) { return { version: 1, taskId: task.taskKey, revision: task.revision, state: task.state, executionMode: task.executionMode, statusPath: `/api/ai/tasks/${task.taskKey}` }; }
function publicStep(step) { return { stepId: step.stepKey, displayName: getAiCapability(step.toolName)?.displayName || '正式查询步骤', state: step.state, errorCode: step.errorCode || null }; }
function publicView(task, steps = []) {
    return {
        version: 1, taskId: task.taskKey, parentTaskId: task.parentTaskId ? String(task.parentTaskId) : null,
        conversationId: task.conversationId ? `chat-${task.conversationId}` : null,
        revision: task.revision, planRevision: task.planRevision, state: task.state, executionMode: task.executionMode,
        userGoal: task.spec.userGoal,
        goals: task.spec.goals.map(goal => ({ goalKey: goal.goalKey, description: goal.description, state: goal.state, blockers: goal.blockers.map(item => ({ code: item.code, message: item.message, questionId: item.questionId || null })) })),
        steps: steps.map(publicStep),
        questions: task.spec.questions.map(question => ({ questionId: question.questionId, planRevision: question.planRevision, goalKeys: question.goalKeys, prompt: question.prompt, reasonCode: question.reasonCode, choices: question.choices.map(choice => ({ choiceId: choice.choiceId, label: choice.label, entity: choice.entity })), candidateSetHash: question.candidateSetHash, expiresAt: question.expiresAt, answeredAt: question.answeredAt })),
        resultSummary: typeof task.result?.answer === 'string' ? task.result.answer.slice(0, 4000) : null,
        createdAt: task.createdAt, updatedAt: task.updatedAt,
    };
}
function eventType(event) {
    if (/QUESTION|WAITING_INPUT|PLAN_REVISED/u.test(event.eventType)) return 'CLARIFICATION';
    if (/STEP/u.test(event.eventType)) return 'STEP_STATE';
    if (/RESULT/u.test(event.eventType)) return 'RESULT';
    if (/FACT|LIMIT|SUSPENDED|EXPIRED/u.test(event.eventType)) return 'LIMITATION';
    return 'TASK_STATE';
}
function publicEvent(event) { const payload = event.payload || {}; return { seq: event.seq, type: eventType(event), occurredAt: event.createdAt, state: typeof payload.to === 'string' ? payload.to : typeof payload.recoveredState === 'string' ? payload.recoveredState : null, goalKey: typeof payload.goalKey === 'string' ? payload.goalKey : null, stepId: typeof payload.stepKey === 'string' && TASK_ID_RE.test(payload.stepKey) ? payload.stepKey : null, message: eventType(event) === 'LIMITATION' ? '任务状态需要核对。' : eventType(event) === 'CLARIFICATION' ? '任务需要补充信息。' : '任务状态已更新。' }; }
function publicEvents(taskKey, events, { afterSeq = 0, limit = 50 } = {}) { if (!Number.isInteger(afterSeq) || afterSeq < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('TASK_EVENTS_QUERY_INVALID'); const items = events.filter(event => event.seq > afterSeq).slice(0, limit); const totalAfter = events.filter(event => event.seq > afterSeq).length; return { version: 1, taskId: taskKey, events: items.map(publicEvent), nextSeq: items.length ? items.at(-1).seq : afterSeq, hasMore: totalAfter > items.length }; }
function assertTaskId(taskId) { if (!TASK_ID_RE.test(String(taskId || ''))) fail('TASK_NOT_FOUND', 404); return taskId; }
function resumeSpec(task, request, now = new Date().toISOString()) {
    if (TERMINAL.has(task.state) || !['WAITING_INPUT', 'SUSPENDED'].includes(task.state)) fail('TASK_RESUME_STATE_INVALID', 409);
    const spec = structuredClone(task.spec);
    const questionById = new Map(spec.questions.map(question => [question.questionId, question]));
    for (const answer of request.answers) {
        const question = questionById.get(answer.questionId);
        if (!question || question.answeredAt !== null || question.planRevision !== task.planRevision || new Date(question.expiresAt).getTime() <= Date.now()) fail('TASK_CLARIFICATION_STALE', 409);
        if (question.choices.length) {
            const choice = question.choices.find(item => item.choiceId === answer.choiceId);
            if (!choice || answer.answerText !== null) fail('TASK_CLARIFICATION_CHOICE_INVALID', 409);
        } else if (answer.choiceId !== null || !answer.answerText) fail('TASK_CLARIFICATION_ANSWER_INVALID', 409);
        question.answeredAt = now;
        for (const goal of spec.goals.filter(goal => goal.blockers.some(blocker => blocker.questionId === question.questionId))) {
            goal.blockers = goal.blockers.filter(blocker => blocker.questionId !== question.questionId);
            if (goal.state === 'NEEDS_INPUT') goal.state = 'PENDING';
        }
    }
    return spec;
}

function bindResumeSources(task, spec, request, db, ownerKey) {
    const questions = new Map(task.spec.questions.map(question => [question.questionId, question]));
    const rows = db.prepare(`SELECT m.id, m.content FROM ai_conversation_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=? AND c.owner_key=? AND c.deleted_at IS NULL AND m.role='user' AND m.id>? ORDER BY m.id DESC`).all(task.conversationId, ownerKey, task.userMessageId);
    const used = new Set();
    const answers = request.answers.map(answer => {
        const question = questions.get(answer.questionId);
        const text = answer.answerText === null ? question?.choices.find(choice => choice.choiceId === answer.choiceId)?.label : answer.answerText;
        const matches = rows.filter(row => row.content === text && !used.has(row.id));
        if (matches.length !== 1) fail('TASK_RESUME_SOURCE_MESSAGE_REQUIRED', 409, '请先在当前会话中发送该补充信息，再继续后台任务');
        const row = matches[0]; used.add(row.id);
        return { questionId: answer.questionId, choiceId: answer.choiceId, answerText: answer.answerText, messageRef: `msg:durable:${row.id}` };
    });
    const recovery = spec.recovery;
    recovery.sourceMessageIds = { ...recovery.sourceMessageIds, ...Object.fromEntries(answers.map(answer => [answer.messageRef, Number(answer.messageRef.slice('msg:durable:'.length))])) };
    recovery.pending = { ...(recovery.pending || {}), resume: { answers } };
    return spec;
}
function sourceMessageRef(task) { const refs = Object.keys(task.spec.recovery?.sourceMessageIds || {}); return refs[0] || `msg:durable:${task.userMessageId}`; }
function taskRequestId() { return crypto.randomUUID(); }
module.exports = { AiTaskPublicError, CHAT_ID_RE, IDEMPOTENCY_KEY_RE, bindResumeSources, acknowledgement, assertTaskId, parseTaskCancel, parseTaskResume, parseTaskStart, publicEvents, publicView, requiredIdempotency, resumeSpec, sourceMessageRef, taskRequestId };
