'use strict';

// The N3 controller owns task lifecycle and evidence admission.  It delegates
// every formal read/preview to the existing capability adapter and executor;
// it intentionally contains no cost, inventory, identity, or write logic.
const crypto = require('node:crypto');
const { extractTaskSemanticsV2, VIRTUAL_READINESS_DESCRIPTION, READINESS_MULTI_SUBJECT_DESCRIPTION } = require('./aiTaskSemanticsV2.cjs');
const { createTaskCapabilityAdapterV2, readJsonPointer } = require('./aiTaskCapabilityAdapterV2.cjs');
const { stableHash } = require('./stableJson.cjs');
const { factSatisfiesRequirement, validateTaskEnvelopeV2, validateTaskProposalV1 } = require('./aiTaskValidationV2.cjs');
const { makeFactKey, makeFactRecordV1, recipeCurrentCostRequirement, scenarioCompareRequirements, profitabilityRequirement, virtualReadinessRequirement, recipeScopeHash } = require('./aiTaskFactsV2.cjs');
const { defaultTaskSessionStoreV2 } = require('./aiTaskSessionV2.cjs');
const { extractQuantitySlot } = require('../business-semantics/readinessSemantics.cjs');
const { ownerReadCanaryAdmission } = require('./aiNativeOwnerTrialCoverage.cjs');
const { composeTaskAnswerV2 } = require('./aiTaskAnswerV2.cjs');
const { collectionCoverageV1, customerHistoryTypes, projectCustomerHistoryFacts, requirementsForStructuredGoal } = require('./aiTaskStructuredReadsV2.cjs');
const { candidate: documentCandidate, evidence: sourceEvidenceRecord, extractedCandidate, sourceConfigComparison, truncateUnicode } = require('./aiTaskDocumentsV2.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');

const UNSUPPORTED_GOALS = new Set([
    'APPLY_CHANGE', 'OTHER',
]);
const LEGACY_READ_GOALS = new Set(['CURRENT_COST', 'CONFIGURATION_COMPARE', 'PROFITABILITY', 'PREPARE_CHANGE']);
const MAX_NATIVE_API_CALLS = 32;
const DEFAULT_ACTIVE_MS = 60_000;
const VIRTUAL_READINESS_INTENT = /(?:再(?:做|生产)|(?:库存|物料).{0,12}够不够|够不够|缺多少料|还差什么|齐料)/u;
const IGNORE_RESERVATION_INTENT = /(?:不管|忽略|不考虑).{0,12}(?:其他订单|活动订单|订单占用|预留)/u;

function iso(clock = Date) { return new clock().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function clone(value) { return structuredClone(value); }
function mapFrom(value) { return value instanceof Map ? new Map(value) : new Map(Object.entries(value || {})); }
function latestUserMessage(messages) { const message = [...(Array.isArray(messages) ? messages : [])].reverse().find(item => item?.role === 'user' && typeof item.content === 'string' && item.content.trim()); if (!message) throw Object.assign(new Error('TASK_V2_USER_MESSAGE_REQUIRED'), { code: 'TASK_V2_USER_MESSAGE_REQUIRED' }); return message; }
function source(messageRef, text, quote, start = text.indexOf(quote)) { if (start < 0) throw new Error('TASK_V2_SOURCE_MISSING'); return { messageRef, start, end: start + quote.length, text: quote }; }
function userSource(fieldPath, span) { return { fieldPath, kind: 'USER_SPAN', sourceRef: span.messageRef, pointer: null, span }; }
function receiptSource(fieldPath, receiptId, pointer) { return { fieldPath, kind: 'FORMAL_RECEIPT', sourceRef: receiptId, pointer, span: null }; }
function policySource(fieldPath, sourceRef = 'NATIVE_BASELINE_INHERITANCE_V1') { return { fieldPath, kind: 'FORMAL_POLICY', sourceRef, pointer: null, span: null }; }
function sourceEvidenceSource(fieldPath, candidateValue) {
    const rawValue = candidateValue.rawValue;
    const normalizedValue = candidateValue.normalizedValue;
    // A conversion is admitted only when the source retained an exact unit token.
    // Do not turn an unqualified document number into centimetres by convention.
    const conversion = candidateValue.field === 'cableLength' && typeof rawValue === 'string' && /^([0-9]+(?:\.[0-9]+)?)cm$/u.test(rawValue) && typeof normalizedValue === 'number' && normalizedValue === Number(rawValue.slice(0, -2)) / 100;
    return { fieldPath, kind: 'SOURCE_EVIDENCE', sourceRef: candidateValue.evidenceId, pointer: null, span: null, sourceVersionHash: candidateValue.sourceVersionHash, rawValue, normalizedValue, transform: conversion ? { type: 'UNIT_CONVERSION', fromUnit: 'cm', toUnit: 'm' } : { type: 'IDENTITY', fromUnit: null, toUnit: null } };
}

function inheritedSource(fieldPath) { return { fieldPath, kind: 'BASELINE_INHERITANCE', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null }; }
function choiceSource(fieldPath, questionId) { return { fieldPath, kind: 'USER_CHOICE', sourceRef: questionId, pointer: null, span: null }; }

function createEnvelope({ taskId = uuid(), ownerKey, conversationId, requestId, userGoal, writePolicy, clock = Date, maxActiveMs = DEFAULT_ACTIVE_MS }) {
    const createdAt = iso(clock);
    return {
        version: 2, taskId, parentTaskId: null, ownerKey, conversationId: conversationId || null, requestId,
        revision: 1, planRevision: 1, state: 'NEW', answerOwner: 'TASK_V2', executionMode: 'FOREGROUND', userGoal,
        // Persistence binds the task to the authoritative raw user message,
        // rather than an assistant-side canonical JSON representation.
        inputHash: crypto.createHash('sha256').update(userGoal).digest('hex'), createdAt, updatedAt: createdAt,
        constraints: { businessWritePolicy: writePolicy, maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: MAX_NATIVE_API_CALLS, maxActiveMs: Math.max(10_000, Math.min(900_000, maxActiveMs)) },
        subjects: [], goals: [], scenarios: [], steps: [], facts: [], sourceEvidence: [], sourceConflicts: [], sourceConfigComparisons: [], questions: [], approvalOperationIds: [], resultSummary: null,
        budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 },
    };
}

function goalFromProposal(goal) {
    return { goalKey: goal.goalKey, kind: goal.kind, description: goal.description, subjectKeys: [...goal.subjectKeys], scenarioKeys: [...goal.scenarioKeys], dependsOn: [...goal.dependsOn], state: 'PENDING', factIds: [], sourceEvidenceIds: [], blockers: [], requirements: [] };
}
function unresolvedSubject(subject) {
    return { subjectKey: subject.subjectKey, mention: subject.mention, resolution: 'UNRESOLVED', selected: null, candidates: [], candidateSetComplete: false, selectionBasis: 'NONE', receiptIds: [] };
}
function blocker(code, message, questionId = null) { return { code, message, questionId }; }
function appendBlocker(goal, code, message, questionId = null) { goal.blockers.push(blocker(code, message, questionId)); }
function terminalTaskState(task) {
    const states = task.goals.map(goal => goal.state);
    if (states.every(state => state === 'UNSUPPORTED')) return 'UNSUPPORTED';
    if (states.every(state => state === 'VERIFIED')) return 'SUCCEEDED';
    if (states.some(state => state === 'NEEDS_INPUT')) return 'WAITING_INPUT';
    if (states.some(state => state === 'VERIFIED') && states.some(state => state !== 'VERIFIED')) return 'PARTIAL';
    if (states.some(state => state === 'UNSUPPORTED')) return 'UNSUPPORTED';
    return 'FAILED';
}
function publicTask(task) {
    return {
        version: task.version, taskId: task.taskId, conversationId: task.conversationId, requestId: task.requestId,
        revision: task.revision, planRevision: task.planRevision, state: task.state, answerOwner: task.answerOwner,
        executionMode: task.executionMode, goals: task.goals.map(goal => ({ goalKey: goal.goalKey, kind: goal.kind, state: goal.state, blockers: goal.blockers, factIds: goal.factIds })),
        facts: task.facts.map(fact => ({ key: fact.key, evidenceState: fact.evidenceState, complete: fact.complete, planRevision: fact.planRevision })),
        sourceConflicts: task.sourceConflicts.map(item => ({ topic: item.topic, conflictType: item.conflictType, resolution: item.resolution })),
        sourceConfigComparisons: task.sourceConfigComparisons.map(item => ({ field: item.field, status: item.status, sourceAuthority: item.sourceAuthority, liveAuthority: item.liveAuthority, reasonCode: item.reasonCode })),
        sourceEvidence: task.sourceEvidence.map(item => ({ sourceType: item.candidate.sourceType, title: item.candidate.title, freshness: item.candidate.freshness, coverage: item.coverage, location: item.location })),
        questions: task.questions.map(question => ({ questionId: question.questionId, planRevision: question.planRevision, prompt: question.prompt, reasonCode: question.reasonCode, choices: question.choices, expiresAt: question.expiresAt, answeredAt: question.answeredAt })),
        budgetUsage: task.budgetUsage,
    };
}
function taskDetail(task) { return { state: task.state, planRevision: task.planRevision, goals: task.goals.map(goal => ({ goalKey: goal.goalKey, state: goal.state, blockerCodes: goal.blockers.map(item => item.code) })) }; }
function taskResult(task, detail, telemetry, trustedReceipts, sourceMessages) {
    const answer = composeTaskAnswerV2(task, { trustedReceiptsById: trustedReceipts, sourceMessages });
    // S1：canary admission 是唯一准入闸门。判据只来自已落定的计划（目标种类 + 写策略），
    // 不接受任何请求方字段；dispatcher 依据该判定决定 Native 是否可以作为权威答案。
    const canaryAdmission = ownerReadCanaryAdmission({
        goalKinds: task.goals.map(goal => goal.kind),
        businessWritePolicy: task.constraints.businessWritePolicy,
    });
    return { task: publicTask(task), detail, answer, canaryAdmission, telemetry: { ...telemetry, answerMode: answer.answerMode, answerModelCalls: answer.answerModelCalls, answerRepairCalls: answer.answerRepairCalls, answerFallbackUsed: answer.fallbackUsed } };
}

function candidateHash(candidates) {
    return stableHash([...candidates].map(item => ({ entityType: item.entityType, entityId: item.entityId, recordHash: item.recordHash, schemeCode: item.schemeCode || null })).sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`)));
}
/**
 * 候选的**可选择身份**（choice identity）。
 *
 * `displayName` 是业务显示名，**不保证唯一**：真实线圈库里大量方案的 scheme_name 都是
 * 「正式方案」，如果直接把它当选项标签，澄清下拉框会出现两行一模一样的选项，用户无法做
 * 业务选择（PHASE D 真实验收：12-220 同时匹配 COIL-0006 / COIL-0010）。
 *
 * 契约（与 A04「ID 隐藏后仍能唯一选择」同源）：内部代号可以被隐藏，但候选选择必须有
 * 唯一、可见的选择身份。显示名不唯一时追加 canonical 身份的稳定业务编码（schemeCode），
 * 仍不可区分时退回 entityId（canonical 主键必然唯一）。
 *
 * 只影响**可见标签**：entity（canonical identity）、candidateSetHash、绑定与校验逻辑都不变。
 */
function candidateChoiceLabel(entity, candidates) {
    const displayName = String(entity?.displayName ?? '').trim();
    if (!displayName) return displayName;
    const siblings = candidates.filter(candidate => String(candidate?.displayName ?? '').trim() === displayName);
    if (siblings.length <= 1) return displayName;
    const discriminator = String(entity?.schemeCode ?? '').trim() || String(entity?.entityId ?? '').trim();
    return discriminator ? `${displayName}（${discriminator}）` : displayName;
}
function questionForCandidates({ goalKeys, candidates, prompt, reasonCode, planRevision, clock = Date, ttlMs = 20 * 60 * 1000 }) {
    const now = new clock();
    return { questionId: uuid(), planRevision, goalKeys, prompt, reasonCode, choices: candidates.map((entity, index) => ({ choiceId: `choice_${index + 1}`, label: candidateChoiceLabel(entity, candidates), entity })), candidateSetHash: candidateHash(candidates), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), answeredAt: null };
}
// ── 澄清回复的动作边界（Root Cause C / A07）──────────────────────────
// 有待澄清问题时，用户的一条消息只可能是下面几种动作之一：
//   SELECT            —— 选择某个正式候选
//   PROVIDE_PARAMETER —— 补一个参数（数量/单价/电缆长度…），由问题自身的 kind 决定
//   NEW_TASK          —— 换了一个新问题
//   NEGATE / CANCEL   —— 否定或撤回这次澄清
//   UNKNOWN           —— 空消息等
//
// 旧实现用 `/(?:第\s*)?(\d+|一|二|三|四|五)(?:个|项|条)?/u` 在**整句里搜第一个数字**，
// 于是「先查2寸泵壳的价格」被解析成 choice_2、「不要第一个」被解析成 choice_1 ——
// 句子里的数字被当成了肯定选择。owner / TTL / candidateSetHash 校验都无法发现这一点，
// 因为它们只证明「选择发生在正确的会话与候选集」，不证明用户真的做出了这个选择。
//
// 现在的选择通道是**闭集整句语法**：只有整句本身就是「序号 / 候选名」时才算选择。
// 正则承担的是词法归一（"第 2 个" / "2" / "第二个"），不承担事实归属判断。
const CLARIFICATION_ACTION = Object.freeze({
    SELECT: 'SELECT',
    PROVIDE_PARAMETER: 'PROVIDE_PARAMETER',
    NEW_TASK: 'NEW_TASK',
    NEGATE: 'NEGATE',
    CANCEL: 'CANCEL',
    UNKNOWN: 'UNKNOWN',
});

// 否定/撤回：出现这些就绝不是一次肯定选择，不允许再从句内抢数字。
const CHOICE_NEGATION_RE = /(?:不(?:要|是|选|用|看|需要)|别(?:选|用|看|要)?|否|取消|算了|都不用|都不要)/u;
const CHOICE_CANCEL_RE = /^(?:取消|算了|不用了|不查了|不看了|结束|退出)[。.!！~～\s]*$/u;
const CHOICE_NUMBER_WORDS = Object.freeze({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 });
// 整句序号：可选祈使前缀 + 可选「第」 + 序号 + 可选量词 + 可选语气词。
// 任何多余内容（"先查2寸泵壳的价格"、"2寸泵壳"、"12-140"、"第2个方案的成本"）都不匹配。
const CHOICE_UTTERANCE_RE = /^(?:请|我)?(?:想|要选|要|选|选择|就|看|用)?\s*(?:第\s*)?(\d+|[一二三四五六七八九十])\s*(?:个|项|条|号|款|种|方案|候选)?\s*(?:吧|呢|的)?$/u;

/**
 * 把一条回复分类为澄清动作。
 * @param {string} text 用户回复原文
 * @param {{choices?: Array<{choiceId:string,label:string,entity?:object}>}} question 待澄清问题
 */
function classifyClarificationReply(text, question) {
    const raw = String(text ?? '').trim();
    if (!raw) return { action: CLARIFICATION_ACTION.UNKNOWN, choice: null };
    const choices = Array.isArray(question?.choices) ? question.choices : [];
    // 无候选的问题（补参数）：回复内容一律交给各参数语法解析，不走选择通道。
    if (choices.length === 0) return { action: CLARIFICATION_ACTION.PROVIDE_PARAMETER, choice: null };
    if (CHOICE_CANCEL_RE.test(raw)) return { action: CLARIFICATION_ACTION.CANCEL, choice: null };
    // 1) 候选名整句精确匹配（正式身份优先，不做模糊猜测）。
    const exact = choices.filter(choice => choice.label === raw || choice.entity?.displayName === raw);
    if (exact.length === 1) return { action: CLARIFICATION_ACTION.SELECT, choice: exact[0] };
    // 2) 否定句：绝不从句内抢数字当选择。
    if (CHOICE_NEGATION_RE.test(raw)) return { action: CLARIFICATION_ACTION.NEGATE, choice: null };
    // 3) 闭集整句序号语法。
    const ordinal = CHOICE_UTTERANCE_RE.exec(raw);
    if (!ordinal) return { action: CLARIFICATION_ACTION.NEW_TASK, choice: null };
    const index = /^\d+$/u.test(ordinal[1]) ? Number(ordinal[1]) : CHOICE_NUMBER_WORDS[ordinal[1]];
    const choice = choices[index - 1] || null;
    // 序号超出候选范围：仍然算「尝试选择」，由调用方按既有的无效选择处理。
    return { action: CLARIFICATION_ACTION.SELECT, choice };
}

/** 仅解析「选择」动作的结果（保留最小语义，供既有调用方使用）。 */
function parseChoice(text, question) {
    return classifyClarificationReply(text, question).choice;
}
function choosePendingSession(session, text, ownerKey, conversationId, clock = Date) {
    const question = session.task.questions.find(item => item.questionId === session.pending?.questionId);
    if (!question || question.answeredAt !== null || question.planRevision !== session.task.planRevision || new Date(question.expiresAt).getTime() <= new clock().getTime()) return { error: 'CLARIFICATION_STALE' };
    if (session.ownerKey !== ownerKey || session.conversationId !== (conversationId || null)) return { error: 'CLARIFICATION_OWNER_MISMATCH' };
    if (candidateHash(question.choices.map(item => item.entity)) !== question.candidateSetHash) return { error: 'CLARIFICATION_CANDIDATE_HASH_MISMATCH' };
    if (question.choices.length === 0) return { question, choice: null, action: CLARIFICATION_ACTION.PROVIDE_PARAMETER };
    const classified = classifyClarificationReply(text, question);
    if (classified.action !== CLARIFICATION_ACTION.SELECT) return { question, choice: null, action: classified.action };
    if (!classified.choice) return { error: 'CLARIFICATION_CHOICE_INVALID' };
    return { question, choice: classified.choice, action: CLARIFICATION_ACTION.SELECT };
}
function markUnsupportedGoals(task) {
    for (const goal of task.goals) if (UNSUPPORTED_GOALS.has(goal.kind)) {
        goal.state = 'UNSUPPORTED';
        appendBlocker(goal, goal.kind === 'APPLY_CHANGE' ? 'WRITE_EXECUTION_NOT_ENABLED' : 'GOAL_NOT_ENABLED_IN_N3_1', goal.kind === 'APPLY_CHANGE' ? 'N3.1 不执行正式业务写入。' : '该目标保留到后续阶段执行。');
    }
}
function markUnsupportedProfitCurrency(task, text) {
    if (!/(?:美元|美金|\bUSD\b)/iu.test(text)) return;
    for (const goal of goalByKind(task, 'PROFITABILITY')) if (goal.state === 'PENDING') {
        goal.state = 'UNSUPPORTED';
        appendBlocker(goal, 'PROFITABILITY_CURRENCY_UNSUPPORTED', '当前正式毛利试算仅支持 CNY，不能把 USD 当作人民币计算。');
    }
}
function updateBudgetFromResult(task, result) {
    task.budgetUsage.toolCalls += 1;
    task.budgetUsage.apiCalls += Array.isArray(result?.executionEvidence?.calls) ? result.executionEvidence.calls.length : 0;
    if (task.budgetUsage.toolCalls > task.constraints.maxToolCalls || task.budgetUsage.apiCalls > task.constraints.maxApiCalls) throw Object.assign(new Error('TASK_V2_BUDGET_EXCEEDED'), { code: 'TASK_V2_BUDGET_EXCEEDED' });
}
function findCandidatePointer(receipt, entity) {
    const rows = readJsonPointer(receipt.result, '/data');
    const index = Array.isArray(rows) ? rows.findIndex(row => String(row.id ?? row.Id) === entity.entityId) : -1;
    if (index < 0) throw new Error('TASK_V2_CANDIDATE_POINTER_MISSING');
    return `/result/data/${index}/id`;
}
function findPartCandidatePointers(receipt, entity) {
    for (const collection of ['/parts', '/data']) {
        try {
            const rows = readJsonPointer(receipt.result, collection);
            const index = Array.isArray(rows) ? rows.findIndex(row => String(row?.id ?? row?.partId) === entity.entityId) : -1;
            if (index >= 0) return {
                partId: `/result${collection}/${index}/${Object.hasOwn(rows[index], 'partId') ? 'partId' : 'id'}`,
                model: `/result${collection}/${index}/model`, supplier: `/result${collection}/${index}/supplier`,
            };
        } catch { /* try the other registered result shape */ }
    }
    throw new Error('TASK_V2_PACKING_PART_POINTER_MISSING');
}
function goalByKind(task, kind) { return task.goals.filter(goal => goal.kind === kind); }

// ── E2-R1 FAMILY-01：正式金额事实（unit=pump / currency=CNY，与当前成本口径一致）──
function moneyFact({ receipt, pointer, entityType, entityId, predicate, basis = 'FORMAL_COST_COMPARISON', complete = true, planRevision, clock }) {
    return makeFactRecordV1({
        receipt, pointer,
        key: makeFactKey({ entityType, entityId, predicate, temporalScope: 'CURRENT', basis, unit: 'pump', currency: 'CNY' }),
        complete, planRevision, clock,
    });
}
/** compare_recipes 回执的两种真实形状：根级 `{recipe1,recipe2,costDiff}` 或 `data` 包裹。 */
function comparisonDataPrefix(receipt) {
    const present = pointer => { try { readJsonPointer(receipt.result, pointer); return true; } catch { return false; } };
    if (present('/costDiff')) return '';
    if (present('/data/costDiff')) return '/data';
    return null;
}

// ── E2-R1 §B：跨轮 canonical 主体继承 ────────────────────────────────
// 契约：只继承**身份**（canonical identity），不继承目标、不继承事实、不继承可变业务数值；
// 本轮必须用正式能力重新读取价格/库存/成本（见各目标分支的 inherited 处理）。
const ANAPHORA_RE = /(?:这个|该|它|此|上述|刚才|那个|这款|那款|这种|那种)/u;
// §G：比较/多主体轮次之后，用户会用序数指代（「第二个现在完整成本呢」「那第一个呢」）。
// 序数按**上一轮 canonical 主体列表的顺序**解释 —— 这是服务器自己的顺序，不是自然语言猜测。
const ORDINAL_REFERENCE_RE = /(?:第\s*)?([一二三四五六七八九十]|\d{1,2})\s*(?:个|项|条|款|种)/u;
function ordinalReferenceIndex(text) {
    const match = ORDINAL_REFERENCE_RE.exec(String(text || ''));
    if (!match) return null;
    const raw = match[1];
    const index = /^\d+$/u.test(raw) ? Number(raw) : CHOICE_NUMBER_WORDS[raw];
    return Number.isSafeInteger(index) && index >= 1 ? index : null;
}
const CONTINUATION_COST_RE = /(?:成本|价格|单价|多少钱|报价)/u;
const CONTINUATION_INVENTORY_RE = /(?:库存|有货|还剩|剩多少|还有多少|有多少|余量|存了|够不够|齐料)/u;
/** 指代句的目标种类由**焦点实体类型 + 业务词**决定（不是关键词意图识别）。 */
function inheritedGoalKind(text, entityType) {
    if (entityType === 'coil') {
        if (CONTINUATION_INVENTORY_RE.test(text)) return 'INVENTORY_QUERY';
        if (CONTINUATION_COST_RE.test(text)) return 'COIL_COST';
        return null;
    }
    if (entityType === 'recipe' && CONTINUATION_COST_RE.test(text)) return 'CURRENT_COST';
    return null;
}
const SUBJECT_ENTITY_TYPE_BY_GOAL = Object.freeze({
    INVENTORY_QUERY: 'coil', COIL_COST: 'coil', COIL_QUERY: 'coil',
    CURRENT_COST: 'recipe', CONFIGURATION_COMPARE: 'recipe', PROFITABILITY: 'recipe',
});
/** 线圈的重新读取选择器：优先用户原来的正式简写（12-200），否则退回 canonical 展示名。 */
function coilReadSelector(subject) {
    const mention = String(subject?.mention || '').trim().replace(/\s+/gu, '');
    if (/^\d{1,3}[-－]\d{2,4}$/u.test(mention)) return mention.replace('－', '-');
    return String(subject?.selected?.displayName || '').trim();
}
function continuationSubjects(task) {
    const used = new Map();
    for (const goal of task.goals) {
        if (!['VERIFIED', 'PARTIAL'].includes(goal.state)) continue;
        for (const key of goal.subjectKeys) {
            const subject = task.subjects.find(item => item.subjectKey === key);
            if (!subject?.selected) continue;
            const identity = `${subject.selected.entityType}:${subject.selected.entityId}`;
            if (used.has(identity)) continue;
            used.set(identity, {
                entityType: subject.selected.entityType, entityId: subject.selected.entityId,
                canonicalIdentity: identity, displayName: subject.selected.displayName,
                entity: subject.selected,
                schemeCode: subject.selected.schemeCode || null,
                readSelector: subject.selected.entityType === 'coil'
                    ? (subject.selected.schemeCode || coilReadSelector(subject))
                    : subject.selected.displayName,
                subjectKey: subject.subjectKey, sourceTaskId: task.taskId,
            });
        }
    }
    return [...used.values()];
}
/** 成功任务后保留的**最小**上下文：只有 canonical 主体身份，没有任务、事实或回执。 */
function continuationFromTask(task, clock, previous = null) {
    const turnSubjects = continuationSubjects(task);
    if (!turnSubjects.length && !previous) return null;
    // 累积有序列表（最近 4 个身份，保持首次出现顺序）用于序数指代（「那第一个呢」）；
    // 上一轮主体列表用于「这个」类指代与歧义判定；两者都不含任何事实或金额。
    const merged = [...(previous?.lastCanonicalSubjects || [])];
    for (const subject of turnSubjects) {
        if (!merged.some(item => item.canonicalIdentity === subject.canonicalIdentity)) merged.push(subject);
    }
    return {
        version: 1, sourceTaskId: task.taskId, observedAt: iso(clock),
        lastCanonicalSubjects: merged.slice(-4),
        turnCanonicalSubjects: turnSubjects,
        lastGoalKinds: [...new Set(task.goals.filter(goal => ['VERIFIED', 'PARTIAL'].includes(goal.state)).map(goal => goal.kind))],
        pendingFocus: turnSubjects.length === 1 ? turnSubjects[0].canonicalIdentity : null,
    };
}
function focusFromEntity(entity, { subjectKey = null } = {}) {
    const entityType = entity.entityType; const entityId = String(entity.entityId);
    return {
        entityType, entityId, canonicalIdentity: `${entityType}:${entityId}`,
        displayName: entity.displayName, entity, subjectKey,
        schemeCode: entity.schemeCode || null,
        // 线圈优先用正式方案编码（search_coils 的正式过滤器），其次用户原来的简写；
        // 配方用 canonical 名称。选择器只用于**重新读取**，身份仍由本轮回执核对。
        readSelector: entityType === 'coil' ? (entity.schemeCode || entity.displayName) : entity.displayName,
    };
}
/**
 * 用**本轮新回执**绑定继承来的身份：
 *   - 单一候选 → 普通 UNIQUE 绑定，并核对 entityId 必须等于继承身份；
 *   - 多候选 → SELECTED + BASELINE_INHERITANCE（身份来自上一轮正式绑定，回执是本轮的），
 *     只有候选集合里存在同一 canonical 主键时才成立；否则返回 null（fail-closed，不猜）。
 */
function bindInheritedSubject({ adapter, subjectKey, mention, toolName, receiptId, focus }) {
    const candidates = adapter.projectCanonicalEntities({ toolName, receiptId });
    const selected = candidates.find(item => item.entityType === focus.entityType && item.entityId === String(focus.entityId));
    if (!selected) return null;
    if (candidates.length === 1) {
        const binding = adapter.bindSubject({ subjectKey, mention, toolName, receiptId, selectionBasis: 'EXACT' });
        return binding.selected?.entityId === selected.entityId ? binding : null;
    }
    return { subjectKey, mention, resolution: 'SELECTED', selected, candidates, candidateSetComplete: true, selectionBasis: 'BASELINE_INHERITANCE', receiptIds: [receiptId] };
}

function requirementsSatisfiedAtPlan(task, goal) {
    const facts = goal.factIds.map(id => task.facts.find(fact => fact.factId === id)).filter(Boolean);
    const factsSatisfied = goal.requirements.every(requirement => facts.some(fact => fact.planRevision === task.planRevision && factSatisfiesRequirement(requirement, fact, task.subjects)));
    const sourceEvidenceIds = Array.isArray(goal.sourceEvidenceIds) ? goal.sourceEvidenceIds : [];
    return factsSatisfied && (goal.requirements.length > 0 || sourceEvidenceIds.length > 0);
}
function nowMessageRef(requestId) { return `msg:user:${requestId}`; }
function replaceTaskGoalsFromProposal(task, proposal) { task.goals = proposal.goals.map(goalFromProposal); }

// This is the detached task's preparation half of the existing controller.
// It performs candidate understanding only; formal capability calls remain the
// worker/controller continuation's responsibility after a lease is acquired.
async function prepareDetachedTaskV2(input = {}, dependencies = {}) {
    const clock = dependencies.clock || Date;
    const ownerKey = dependencies.ownerKey || input.ownerKey;
    if (typeof ownerKey !== 'string' || !ownerKey) throw Object.assign(new Error('TASK_V2_OWNER_REQUIRED'), { code: 'TASK_V2_OWNER_REQUIRED' });
    const message = latestUserMessage(input.messages);
    const requestId = input.requestId || uuid();
    const messageRef = input.messageRef || nowMessageRef(requestId);
    const provider = dependencies.provider || input.provider || null;
    const semantics = await extractTaskSemanticsV2({ messageRef, text: message.content, provider });
    const proposal = clone(semantics.proposal);
    const task = createEnvelope({
        taskId: input.taskId || undefined,
        ownerKey,
        conversationId: input.conversationId || null,
        requestId,
        userGoal: message.content,
        writePolicy: semantics.serverDirectives.businessWritePolicy,
        clock,
        maxActiveMs: Math.min(DEFAULT_ACTIVE_MS, Number(input.timeoutMs) || DEFAULT_ACTIVE_MS),
    });
    task.executionMode = 'DETACHED';
    replaceTaskGoalsFromProposal(task, proposal);
    task.subjects = proposal.subjects.map(unresolvedSubject);
    // Proposal scenarios are natural-language candidate configurations. They
    // become formal V2 scenarios only after the continuation resolves their
    // base subject; retaining an empty formal list prevents false bindings.
    for (const goal of task.goals) goal.scenarioKeys = [];
    task.budgetUsage.modelCalls = semantics.telemetry.modelCalls + semantics.telemetry.formatRepairCalls;
    markUnsupportedGoals(task);
    markUnsupportedProfitCurrency(task, message.content);
    validateTaskEnvelopeV2(task, { trustedReceiptsById: new Map(), sourceMessages: new Map([[messageRef, message.content]]) });
    return {
        task,
        semantics: { status: semantics.status, extractionMode: semantics.extractionMode, blockers: semantics.blockers, telemetry: semantics.telemetry },
        recoveryPlan: {
            version: 1,
            proposal,
            sourceMessageIds: { [messageRef]: Number(input.userMessageId) },
            pending: null,
            activeMsBase: 0,
        },
    };
}
function cableLengthWithUnit(text, messageRef) {
    const match = /(?:电缆|线缆)?[^，。；,;！!？?]{0,12}?(\d+(?:\.\d+)?)\s*(米|m|cm)/iu.exec(text);
    if (!match) return null;
    const value = /cm/iu.test(match[2]) ? Number(match[1]) / 100 : Number(match[1]);
    return { value, source: source(messageRef, text, match[0], match.index) };
}
function quantityFromMessage(text, messageRef) {
    // S2-R3-P1 §A：数量是当前话语的独立结构化槽位，与词序无关，也与意图判定解耦。
    const slot = extractQuantitySlot(text);
    if (!slot) return null;
    return { value: slot.value, source: source(messageRef, text, slot.quote, slot.start) };
}
function missingCableLengthUnit(text) {
    const match = /(?:电缆|线缆)[^，。；,;！!？?]{0,12}?(?:改成|改|换成)\s*(\d+(?:\.\d+)?)(?:\s*(米|cm|m))?/iu.exec(text);
    return Boolean(match && !match[2]);
}
function unitPriceFromMessage(text, messageRef) { const match = /(?:卖|售价|每台|报价|按)\s*(\d+(?:\.\d+)?)(?:\s*元(?:一台|\/台)?)?/iu.exec(text); return match ? { value: Number(match[1]), source: source(messageRef, text, match[0], match.index) } : null; }
function resolvedProfitUnitPrice(proposalValue, sourceValue) {
    if (Number.isFinite(proposalValue?.value) && proposalValue?.sources?.[0]) return { value: proposalValue.value, source: proposalValue.sources[0] };
    if (Number.isFinite(sourceValue?.value) && sourceValue?.source) return { value: sourceValue.value, source: sourceValue.source, historicalPriceFactId: sourceValue.historicalPriceFactId || null };
    if (Number.isFinite(sourceValue?.normalizedValue)) return { value: sourceValue.normalizedValue, source: sourceEvidenceSource('/unitPrice', sourceValue) };
    return null;
}
function surfaceCostFromMessage(text, messageRef) {
    const match = /(\d+(?:\.\d+)?)\s*元/u.exec(text);
    return match ? { value: Number(match[1]), source: source(messageRef, text, match[0], match.index) } : null;
}

function historicalPriceRequested(text) {
    return /(?:按|用)[^，。；,;！!？?]{0,32}(?:上次|以前|历史)[^，。；,;！!？?]{0,32}(?:报价|价格|售价|单价)/u.test(text)
        && /(?:毛利|利润)/u.test(text);
}
function quotationRecipeName(quotation) {
    return String(quotation?.recipeName ?? quotation?.recipe_name ?? quotation?.recipe?.name ?? '').trim();
}
function quotationPriceCandidates(quotation, quotationIndex, recipeMention) {
    const candidates = [];
    const price = (record, pointerBase) => {
        const field = Object.hasOwn(record || {}, 'unitPrice') ? 'unitPrice'
            : Object.hasOwn(record || {}, 'unit_price') ? 'unit_price'
                : Object.hasOwn(record || {}, 'price') ? 'price' : null;
        const value = field ? Number(record[field]) : NaN;
        return Number.isFinite(value) && value >= 0 ? { value, pointer: `${pointerBase}/${field}` } : null;
    };
    // Older projections can contain one recipe directly on the quotation.
    // Current customer-history receipts carry each recipe and its unit price
    // inside items.  Both shapes remain formally bounded by the same receipt.
    if (quotationRecipeName(quotation) === recipeMention) {
        const match = price(quotation, `/data/quotations/${quotationIndex}`);
        if (match) candidates.push(match);
    }
    for (const [itemIndex, item] of (Array.isArray(quotation?.items) ? quotation.items : []).entries()) {
        if (quotationRecipeName(item) !== recipeMention) continue;
        const match = price(item, `/data/quotations/${quotationIndex}/items/${itemIndex}`);
        if (match) candidates.push(match);
    }
    return candidates;
}
function historicalQuotationPrice({ text, proposal, historyReceipt, customer, coverage, planRevision, clock }) {
    if (!historicalPriceRequested(text) || coverage?.complete !== true) return null;
    const recipe = proposal.subjects.find(subject => subject.typeHints.includes('recipe'));
    if (!recipe?.mention) return null;
    const quotations = Array.isArray(historyReceipt?.result?.data?.quotations) ? historyReceipt.result.data.quotations : [];
    const matches = quotations.flatMap((quotation, index) => quotationPriceCandidates(quotation, index, recipe.mention));
    // A historical price is an explicit user hypothesis only after exactly one
    // bounded formal quotation matches the named recipe.  Multiple quotations
    // require a later formal choice; array position is never a selection rule.
    if (matches.length !== 1) return null;
    const { value, pointer } = matches[0];
    const fact = makeFactRecordV1({ receipt: historyReceipt, pointer, key: makeFactKey({
        entityType: 'customer', entityId: customer.entityId, predicate: 'quotation.historical_unit_price', temporalScope: 'HISTORICAL',
        basis: 'CUSTOMER_HISTORY', unit: 'pump', currency: 'CNY', queryScopeHash: coverage.queryScopeHash,
    }), planRevision, clock });
    // Facts point into receipt.result, whereas an ArgumentSource is validated
    // against the trusted receipt envelope.  Keep those two pointer roots
    // explicit so a receipt-backed price cannot be detached from its evidence.
    return { value, source: receiptSource('/unitPrice', historyReceipt.receiptId, `/result${pointer}`), fact };
}

function profitabilityArgs({ recipeId, comparisonInput, scenarioKey, unitPrice, quantity }) {
    return { version: 1, basisRef: { kind: 'SCENARIO_COMPARISON', recipeId, comparisonInput, scenarioKey }, unitPrice, quantity, currency: 'CNY' };
}
function profitabilitySources({ comparisonSources, recipeReceipt, recipe, unitPriceSource, quantity, quantitySource }) {
    const mapped = comparisonSources.filter(item => item.fieldPath !== '/recipeId').map(item => ({ ...item, fieldPath: `/basisRef/comparisonInput${item.fieldPath}` }));
    const unitPriceArgumentSource = unitPriceSource?.kind === 'SOURCE_EVIDENCE' || unitPriceSource?.kind === 'FORMAL_RECEIPT'
        ? { ...unitPriceSource, fieldPath: '/unitPrice' }
        : userSource('/unitPrice', unitPriceSource);
    return [
        receiptSource('/basisRef/recipeId', recipeReceipt.receiptId, findCandidatePointer(recipeReceipt, recipe)),
        policySource('/version'), policySource('/basisRef/kind'), policySource('/basisRef/scenarioKey', 'PROFITABILITY_SCENARIO_KEY_V1'),
        ...mapped, unitPriceArgumentSource,
        quantity === null ? policySource('/quantity', 'PROFITABILITY_QUANTITY_UNSPECIFIED_V1') : userSource('/quantity', quantitySource),
        policySource('/currency', 'PROFITABILITY_CURRENCY_CNY_V1'),
    ];
}
function virtualReadinessArgs({ recipeId, comparisonInput, scenarioKey, quantity }) {
    return { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId, comparisonInput, scenarioKey }, quantity };
}
function virtualReadinessSources({ recipeReceipt, recipe, comparisonSources = [], quantitySource }) {
    const mapped = comparisonSources
        .filter(item => !['/recipeId', '/version', '/baselinePolicy'].includes(item.fieldPath))
        .map(item => ({ ...item, fieldPath: `/basisRef/comparisonInput${item.fieldPath}` }));
    const quantityArgumentSource = quantitySource?.kind === 'SOURCE_EVIDENCE'
        ? { ...quantitySource, fieldPath: '/quantity' }
        : quantitySource?.kind === 'FORMAL_RECEIPT'
            ? { ...quantitySource, fieldPath: '/quantity' }
            : userSource('/quantity', quantitySource);
    return [
        policySource('/version'), policySource('/basisRef/kind'),
        receiptSource('/basisRef/recipeId', recipeReceipt.receiptId, findCandidatePointer(recipeReceipt, recipe)),
        policySource('/basisRef/comparisonInput/version'), policySource('/basisRef/comparisonInput/baselinePolicy'),
        ...(comparisonSources.length === 0 ? [policySource('/basisRef/comparisonInput/scenarios', 'VIRTUAL_READINESS_CURRENT_BASIS_V1')] : []),
        ...mapped,
        policySource('/basisRef/scenarioKey', 'VIRTUAL_READINESS_SCENARIO_KEY_V1'),
        quantityArgumentSource,
    ];
}
function isVirtualReadinessGoal(goal, proposal, text) {
    const semantic = (proposal?.goals || []).find(item => item.goalKey === goal.goalKey);
    return goal.kind === 'INVENTORY_QUERY'
        && (semantic?.description === VIRTUAL_READINESS_DESCRIPTION || VIRTUAL_READINESS_INTENT.test(text));
}
/**
 * E2-R1 §B5/§B6：把上一轮唯一 canonical 主体接进本轮**无标识指代**的问题。
 * 显式新主体优先（本轮已有带标识的主体就完全不继承）；焦点不唯一时只登记候选，
 * 由目标分支要求用户先澄清，绝不自行选择。
 */
function injectInheritedSubjects({ proposal, messageRef, text, continuation, selectedChoice, pendingKind }) {
    const focus = new Map();
    const accumulated = [...(continuation?.lastCanonicalSubjects || [])];
    const turnSubjects = Array.isArray(continuation?.turnCanonicalSubjects) && continuation.turnCanonicalSubjects.length
        ? continuation.turnCanonicalSubjects : accumulated;
    const stored = pendingKind === 'continuationFocus' && selectedChoice?.entity?.entityId
        ? [focusFromEntity(selectedChoice.entity)]
        : [...turnSubjects];
    if (!stored.length && !accumulated.length) return { focus, mutated: false };
    if (proposal.subjects.some(subject => /[A-Za-z0-9]/u.test(String(subject.mention || '')))) return { focus, mutated: false }; // §B6：显式主体优先
    const ordinal = ordinalReferenceIndex(text);
    let focuses = stored;
    let match = ANAPHORA_RE.exec(text);
    if (ordinal !== null) {
        // 序数按**累积有序列表**解释（比较轮之后「第一个」仍指比较里的第一个主体）。
        const ordered = accumulated.length ? accumulated : stored;
        if (ordered.length < ordinal) return { focus, mutated: false };
        focuses = [ordered[ordinal - 1]];
        match = ORDINAL_REFERENCE_RE.exec(text);
    } else if (!match) return { focus, mutated: false };
    if (!match) return { focus, mutated: false };
    const mentionSource = source(messageRef, text, match[0], match.index);
    let goals = proposal.goals.filter(goal => !goal.subjectKeys.length && SUBJECT_ENTITY_TYPE_BY_GOAL[goal.kind]);
    let mutated = false;
    if (!goals.length) {
        // §B3：主体可以继承，目标不可以继承。这里**新建**本轮目标（不是复用上一轮目标），
        // 种类只由焦点实体类型 + 本轮业务词决定；焦点类型不唯一时不猜。
        const types = [...new Set(focuses.map(item => item.entityType))];
        const explicitKind = types.length === 1 ? inheritedGoalKind(text, types[0]) : null;
        // 省略问法（「那第一个呢」）没有业务词：只在**序数指代**且上一轮只有一个目标种类时，
        // 用该种类重新建目标；事实仍然必须在本轮重新正式读取（§B3/B4）。
        const priorKind = ordinal !== null && Array.isArray(continuation?.lastGoalKinds) && continuation.lastGoalKinds.length === 1
            ? continuation.lastGoalKinds[0] : null;
        const priorKindSubjectType = priorKind ? SUBJECT_ENTITY_TYPE_BY_GOAL[priorKind] : null;
        const kind = explicitKind || (priorKindSubjectType && focuses.every(item => item.entityType === priorKindSubjectType) ? priorKind : null);
        if (!kind) return { focus, mutated: false };
        proposal.goals = proposal.goals.filter(goal => !(goal.kind === 'OTHER' && goal.description === '用户请求需要进一步理解'));
        proposal.goals.push({
            goalKey: 'goal_inherited_1', kind, description: kind === 'INVENTORY_QUERY' ? '查询库存' : kind === 'COIL_COST' ? '查询线圈方案当前成本' : '查询当前成本',
            subjectKeys: [], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [mentionSource], quantity: null, unitPrice: null,
        });
        goals = [proposal.goals[proposal.goals.length - 1]];
        mutated = true;
    }
    for (const goal of goals) {
        const compatible = focuses.filter(item => item.entityType === SUBJECT_ENTITY_TYPE_BY_GOAL[goal.kind]);
        if (!compatible.length) continue;
        const subjectKey = `subject_inherited_${focus.size + 1}`;
        proposal.subjects.push({ subjectKey, mention: mentionSource.text, typeHints: [SUBJECT_ENTITY_TYPE_BY_GOAL[goal.kind]], sources: [mentionSource] });
        goal.subjectKeys = [subjectKey];
        focus.set(subjectKey, compatible.length === 1 ? { focus: compatible[0] } : { candidates: compatible });
        mutated = true;
    }
    return { focus, mutated };
}
function replaceSubjectBinding(task, binding) {
    task.subjects = task.subjects.map(subject => subject.subjectKey === binding.subjectKey ? binding : subject);
}
function structuredFact({ receipt, pointer, entityType, entityId, predicate, temporalScope = 'CURRENT', basis, coverage = null, planRevision, clock }) {
    const value = readJsonPointer(receipt.result, pointer);
    const emptyCollection = Array.isArray(value) && value.length === 0;
    const complete = coverage ? coverage.complete : true;
    return makeFactRecordV1({
        receipt, pointer,
        key: makeFactKey({ entityType, entityId, predicate, temporalScope, basis, unit: 'record', currency: null, queryScopeHash: coverage?.queryScopeHash || null }),
        evidenceState: emptyCollection && complete ? 'VERIFIED_NEGATIVE' : 'VERIFIED_POSITIVE',
        complete, planRevision, clock,
    });
}
function sourceFreshness(result) {
    const sources = Array.isArray(result?.receipt?.result?.sources) ? result.receipt.result.sources : [];
    return sources.some(item => item?.freshness && item.freshness !== 'fresh') ? 'STALE' : 'CURRENT';
}
function sourceChoiceEntity(item) {
    return { entityType: item.sourceType === 'KNOWLEDGE_ENTRY' ? 'knowledge' : 'file', entityId: item.sourceId, displayName: item.title, updatedAt: item.updatedAt, recordHash: item.sourceVersionHash, schemeCode: item.sourceType };
}
function selectedDocumentCandidate({ candidates, selectedChoice, pendingKind }) {
    if (candidates.length === 1) return { candidate: candidates[0], stale: false };
    if (pendingKind && selectedChoice) {
        const selected = candidates.find(item => item.sourceId === selectedChoice.entity.entityId && item.sourceVersionHash === selectedChoice.entity.recordHash);
        return selected ? { candidate: selected, stale: false } : { candidate: null, stale: true };
    }
    return { candidate: null, stale: false };
}
function documentQuestion({ goal, candidates, prompt, reasonCode, task, clock, ttlMs }) {
    const entities = candidates.map(sourceChoiceEntity);
    const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: entities, prompt, reasonCode, planRevision: task.planRevision, clock, ttlMs });
    // The canonical question entity is only a UI selection token. Its hash is
    // the formal source-version hash, and the source candidate remains a
    // separate record in the task evidence ledger.
    return question;
}
function sourceExcerpt(value) {
    const full = String(value ?? '');
    if ([...full].length <= 1200) return { excerpt: full, truncated: false };
    const bounded = truncateUnicode(full);
    const boundary = Math.max(...['\n', '。', '！', '？', '.', '!', '?'].map(mark => bounded.lastIndexOf(mark)));
    // Do not present a cut-off clause as a complete statement. A large source
    // remains partial until a later bounded chunk reader is available.
    return { excerpt: boundary >= 0 ? bounded.slice(0, boundary + 1) : '', truncated: true };
}
function addSourceEvidence(task, goal, record, adapter = null) {
    task.sourceEvidence.push(record);
    goal.sourceEvidenceIds.push(record.evidenceId);
    adapter?.registerSourceEvidence?.(record);
}
function finishSourceGoal(task, goal) {
    goal.state = goal.sourceEvidenceIds.length ? 'VERIFIED' : 'PARTIAL';
}
function technicalCandidates(data, binding, freshness) {
    return (Array.isArray(data?.files) ? data.files : []).map(file => documentCandidate({
        candidateKey: `technical:${file.id}`,
        sourceType: 'TECHNICAL_FILE', sourceId: String(file.id), title: file.originalName || `技术档案 ${file.id}`,
        mimeType: file.mimeType || null, linkedEntity: { entityType: 'recipe', entityId: binding.selected.entityId },
        lifecycleStatus: 'ACTIVE', freshness, updatedAt: file.updatedAt || null,
        sourceTable: 'recipe_technical_files', entryType: file.reportType || null,
        contentAvailability: file.testCurve?.testPoints?.length ? 'FULL' : 'METADATA_ONLY',
        fileSha256: file.fileSha256 || null,
    }));
}
function knowledgeCandidates(data, freshness) {
    return (Array.isArray(data) ? data : []).filter(item => Number.isSafeInteger(Number(item?.id))).map(item => documentCandidate({
        candidateKey: `knowledge:${item.id}`,
        sourceType: 'KNOWLEDGE_ENTRY', sourceId: String(item.id), title: item.title || `知识条目 ${item.id}`,
        lifecycleStatus: item.archivedAt ? 'ARCHIVED' : item.deletedAt ? 'DELETED' : 'ACTIVE', freshness, updatedAt: item.updatedAt || item.sourceUpdatedAt || null,
        syncedAt: item.syncedAt || null, sourceTable: item.sourceTable || null, entryType: item.entryType || null,
        contentAvailability: typeof item.content === 'string' && item.content ? 'FULL' : 'METADATA_ONLY',
        // Search and detail responses do not consistently expose contentHash.
        // Their formal update/sync metadata is the common version identity.
        contentHash: null,
    }));
}
function knowledgeSearchQuery(proposal, message, messageRef) {
    const topical = proposal.subjects.find(item => item.mention && item.sources?.[0]);
    if (topical) return { value: topical.mention, source: topical.sources[0] };
    return { value: message.content, source: source(messageRef, message.content, message.content, 0) };
}
function sourceConfigurationCandidates({ task, record, configuration }) {
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return [];
    const allowed = ['coilSelection', 'hasCable', 'cableLength', 'cableWire', 'hasFloat', 'floatWire', 'customBarrelLength', 'packingSelection', 'surfaceTreatmentMode'];
    const evidenceById = new Map([[record.evidenceId, record]]);
    return allowed.filter(field => Object.hasOwn(configuration, field) && ['string', 'number', 'boolean'].includes(typeof configuration[field])).map(field => {
        const rawValue = configuration[field];
        const cmMatch = field === 'cableLength' && typeof rawValue === 'string' && /^([0-9]+(?:\.[0-9]+)?)cm$/u.exec(rawValue);
        return extractedCandidate({
            taskId: task.taskId, planRevision: task.planRevision, evidenceId: record.evidenceId, field,
            rawValue, normalizedValue: cmMatch ? Number(cmMatch[1]) / 100 : rawValue, unit: cmMatch ? 'm' : null,
            sourceVersionHash: record.sourceVersionHash, location: record.location,
        }, evidenceById);
    });
}
function sourceUnitPriceCandidate({ task, record, configuration }) {
    const rawValue = configuration?.unitPrice ?? configuration?.sellingPrice ?? null;
    if (!Number.isFinite(rawValue) || rawValue < 0 || record.coverage.complete !== true) return null;
    const evidenceById = new Map([[record.evidenceId, record]]);
    return extractedCandidate({
        taskId: task.taskId, planRevision: task.planRevision, evidenceId: record.evidenceId,
        field: 'unitPrice', rawValue, normalizedValue: rawValue, unit: 'CNY',
        sourceVersionHash: record.sourceVersionHash, location: record.location,
    }, evidenceById);
}

async function recordSourceConfigurationComparisons({ task, goal, binding, catalogReceipt, execute, candidates, record, includeUnknown = false }) {
    if (!candidates.length && !includeUnknown) return;
    const preview = await execute({ toolName: 'compare_recipe_scenarios', args: { recipeId: Number(binding.selected.entityId), version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'source_live_config', label: '资料与当前正式配置核对', overrides: {} }] }, argumentSources: [
        receiptSource('/recipeId', catalogReceipt.receiptId, findCandidatePointer(catalogReceipt, binding.selected)), policySource('/version'), policySource('/baselinePolicy'), policySource('/scenarios/0/scenarioKey'), policySource('/scenarios/0/label'), inheritedSource('/scenarios/0/overrides'),
    ], goalKeys: [goal.goalKey] });
    const live = preview.receipt?.result?.data?.scenarios?.[0]?.configuration;
    const evidenceById = new Map(task.sourceEvidence.map(item => [item.evidenceId, item]));
    const byField = new Map(candidates.map(item => [item.field, item]));
    const fields = includeUnknown ? [...new Set([...byField.keys(), 'cableLength', 'coilSelection', 'packingSelection', 'surfaceTreatmentMode'])] : [...byField.keys()];
    for (const field of fields) {
        const candidateValue = byField.get(field);
        task.sourceConfigComparisons.push(sourceConfigComparison({ candidate: candidateValue, field, evidenceId: record.evidenceId, evidenceById, liveValue: live?.[field], resolved: Boolean(preview.receipt && live && Object.hasOwn(live, field)), sourceCoverageComplete: record.coverage.complete, reasonCode: candidateValue ? (record.coverage.complete ? (preview.receipt ? 'LIVE_CONFIGURATION_FIELD_UNAVAILABLE' : 'LIVE_CONFIGURATION_UNAVAILABLE') : 'SOURCE_CONTENT_INCOMPLETE') : 'SOURCE_CONFIGURATION_FIELD_UNAVAILABLE' }, evidenceById));
    }
}
// A profitability preview already carries the exact formal current-rebuilt base
// scenario inside its scenarioContext.  That base cost is the same
// `recipe.current_cost` fact the CURRENT_COST goal needs, so the accepted
// receipt is reused instead of asking the formal scenario preview to rebuild
// the identical base scenario a second time in one task.  This mirrors the
// structured-configuration path and never asserts a fact the formal service did
// not return: an incomplete base cost leaves the goal PARTIAL, which the
// standalone rebuild's PENDING guard cannot pick up.
// No extra reuse marker is recorded: the accepted fact plus that guard already
// encode that reuse happened, and the public task projection ignores
// non-contract fields.
function reuseProfitabilityBaseCost({ task, primary, selectedRecipe, receipt, profitability, planRevision, clock }) {
    const base = profitability?.scenarioContext?.scenarios?.[0] ?? null;
    const currentGoal = goalByKind(task, 'CURRENT_COST').find(goal => goal.state === 'PENDING') || null;
    if (!currentGoal || !base) return null;
    const fact = makeFactRecordV1({ receipt, pointer: '/data/scenarioContext/scenarios/0/cost/currentTotalCost', key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'recipe.current_cost', temporalScope: 'CURRENT', basis: 'CURRENT_REBUILT' }), complete: base.cost?.complete === true, planRevision, clock });
    task.facts.push(fact);
    currentGoal.requirements = [recipeCurrentCostRequirement(primary.subjectKey)];
    currentGoal.factIds = [fact.factId];
    currentGoal.state = requirementsSatisfiedAtPlan(task, currentGoal) ? 'VERIFIED' : 'PARTIAL';
    if (currentGoal.state !== 'VERIFIED') appendBlocker(currentGoal, 'COST_PREVIEW_INCOMPLETE', '正式成本预览不完整，不能确认整机成本。');
}

async function runDocumentGoalsV2({ task, proposal, message, messageRef, adapter, execute, clock, sessionStore, selectedChoice, pendingKind }) {
    let pending = null;
    let sourceScenario = null;
    let sourceProfitUnitPrice = null;
    const allowHistoricalSource = /(?:旧版|历史资料|归档)/u.test(message.content);
    const documentGoals = task.goals.filter(goal => ['FILE_INSPECT', 'KNOWLEDGE_QUERY'].includes(goal.kind) && goal.state === 'PENDING');
    for (const goal of documentGoals) {
        if (goal.kind === 'FILE_INSPECT') {
            const subject = proposal.subjects.find(item => item.subjectKey === goal.subjectKeys[0] && item.typeHints.includes('recipe'));
            if (!subject) { markStructuredGap(goal, 'FILE_SUBJECT_UNRESOLVED', '文件读取需要已识别的配方技术档案。'); continue; }
            const mention = subject.sources[0] || source(messageRef, message.content, subject.mention);
            const found = await execute({ toolName: 'get_all_recipes', args: { keyword: subject.mention }, argumentSources: [userSource('/keyword', mention)], goalKeys: [goal.goalKey] });
            if (!found.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'FILE_CATALOG_UNAVAILABLE', '正式技术档案目录读取未获得已验证回执。'); continue; }
            const binding = adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'get_all_recipes', receiptId: found.receipt.receiptId, selectionBasis: 'EXACT' });
            replaceSubjectBinding(task, binding);
            if (binding.resolution === 'MULTIPLE') { const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: binding.candidates, prompt: `“${subject.mention}”匹配多个正式配方，请选择要读取技术档案的对象。`, reasonCode: 'FILE_RECIPE_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs }); task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'FILE_RECIPE_AMBIGUOUS', '多个正式配方匹配，需先选择技术档案归属。', question.questionId); pending = { kind: 'fileRecipe', questionId: question.questionId }; continue; }
            if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { markStructuredGap(goal, binding.resolution === 'NOT_FOUND' ? 'FILE_NOT_FOUND' : 'FILE_RESOLUTION_UNAVAILABLE', '没有可读取的唯一正式技术档案对象。'); continue; }
            const idPointer = findCandidatePointer(found.receipt, binding.selected);
            const read = await execute({ toolName: 'get_recipe_technical_files', args: { recipeId: Number(binding.selected.entityId) }, argumentSources: [receiptSource('/recipeId', found.receipt.receiptId, idPointer)], goalKeys: [goal.goalKey] });
            if (!read.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'CONTENT_EXTRACTION_UNSUPPORTED', '正式技术档案读取未获得已验证回执。'); continue; }
            const technicalData = read.receipt.result.data || read.receipt.result;
            const candidates = technicalCandidates(technicalData, binding, sourceFreshness(read)).filter(item => item.lifecycleStatus === 'ACTIVE' || allowHistoricalSource);
            if (!candidates.length) { markStructuredGap(goal, 'FILE_NOT_FOUND', '该正式配方没有返回可读取的技术档案；该结果不能推广为其他资料不存在。'); continue; }
            const choice = selectedDocumentCandidate({ candidates, selectedChoice, pendingKind: pendingKind === 'file' ? pendingKind : null });
            if (!choice.candidate) {
                const question = documentQuestion({ goal, candidates, prompt: choice.stale ? '所选技术档案已更新或不再可用，请重新选择。' : '该配方有多份技术档案，请选择要查看的一份。', reasonCode: choice.stale ? 'SOURCE_VERSION_CHANGED' : 'FILE_DOCUMENT_AMBIGUOUS', task, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, question.reasonCode, '技术档案需要按当前正式版本重新选择。', question.questionId); pending = { kind: 'file', questionId: question.questionId }; continue;
            }
            const selected = choice.candidate;
            const file = (technicalData.files || []).find(item => String(item.id) === selected.sourceId);
            // The formal technical-file API exposes parsed, structured report
            // metadata under summary.  It remains source evidence; only a separate
            // current formal preview can establish the live configuration.
            const sourceConfiguration = file?.configuration ?? file?.summary?.configuration;
            const structuredConfiguration = sourceConfiguration && typeof sourceConfiguration === 'object' && !Array.isArray(sourceConfiguration) ? sourceConfiguration : null;
            const payload = file?.testCurve || structuredConfiguration ? JSON.stringify({ testCurve: file?.testCurve ?? null, configuration: structuredConfiguration }) : JSON.stringify({ title: selected.title, reportType: selected.entryType, mimeType: selected.mimeType });
            const excerpt = sourceExcerpt(payload);
            const record = sourceEvidenceRecord({ taskId: task.taskId, planRevision: task.planRevision, candidate: selected, evidenceKind: file?.testCurve || structuredConfiguration ? 'SOURCE_TABLE' : 'SOURCE_METADATA', location: file?.testCurve || structuredConfiguration ? { type: 'JSON_POINTER', pointer: '/files/structured-content' } : { type: 'WHOLE_RECORD' }, excerpt: excerpt.excerpt, coverage: (file?.testCurve || structuredConfiguration) && !excerpt.truncated ? { mode: 'FULL_CONTENT', complete: true, truncated: false } : file?.testCurve || structuredConfiguration ? { mode: 'PARTIAL_CONTENT', complete: false, truncated: true } : { mode: 'METADATA_ONLY', complete: false, truncated: false }, observedAt: iso(clock) });
            addSourceEvidence(task, goal, record, adapter);
            const extracted = sourceConfigurationCandidates({ task, record, configuration: structuredConfiguration });
            const sourceCable = extracted.find(item => item.field === 'cableLength');
            if (/按(?:报告|资料|文件)[^，。；,;！!？?]{0,24}(?:电缆长度|电缆)[^，。；,;！!？?]{0,24}试算/u.test(message.content) && sourceCable) sourceScenario = { candidate: sourceCable };
            const sourcePrice = sourceUnitPriceCandidate({ task, record, configuration: structuredConfiguration });
            if (/(?:按(?:报告|资料|文件)[^，。；,;！!？?]{0,24}(?:价格|售价|单价)[^，。；,;！!？?]{0,24}(?:毛利|利润)|(?:报告|资料|文件)里的(?:价格|售价|单价)[^，。；,;！!？?]{0,24}(?:毛利|利润))/u.test(message.content) && sourcePrice) sourceProfitUnitPrice = sourcePrice;
            await recordSourceConfigurationComparisons({ task, goal, binding, catalogReceipt: found.receipt, execute, candidates: extracted, record, includeUnknown: /配置[^，。；,;！!？?]{0,20}(?:当前|一样)|(?:当前|一样)[^，。；,;！!？?]{0,20}配置/u.test(message.content) });
            if (record.coverage.complete) finishSourceGoal(task, goal); else { goal.state = 'PARTIAL'; appendBlocker(goal, 'SOURCE_CONTENT_INCOMPLETE', '正式接口只返回了资料元数据或受限内容，不能把它当作完整资料结论。'); }
        } else {
            const query = knowledgeSearchQuery(proposal, message, messageRef);
            const search = await execute({ toolName: 'search_factory_knowledge', args: { query: query.value, limit: 10 }, argumentSources: [userSource('/query', query.source), policySource('/limit')], goalKeys: [goal.goalKey] });
            if (!search.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'KNOWLEDGE_UNAVAILABLE', '正式知识快照读取未获得已验证回执。'); continue; }
            const candidates = knowledgeCandidates(search.receipt.result.data, sourceFreshness(search)).filter(item => item.lifecycleStatus === 'ACTIVE' || allowHistoricalSource);
            if (!candidates.length) { markStructuredGap(goal, 'KNOWLEDGE_NO_MATCH_IN_BOUNDED_QUERY', '有界知识检索没有返回条目；这不能说明系统范围内不存在该信息。'); continue; }
            const choice = selectedDocumentCandidate({ candidates, selectedChoice, pendingKind: pendingKind === 'knowledge' ? pendingKind : null });
            if (!choice.candidate) {
                const question = documentQuestion({ goal, candidates, prompt: choice.stale ? '所选知识条目已更新或不再可用，请重新选择。' : '知识检索返回多条资料，请选择要查看的一条。', reasonCode: choice.stale ? 'SOURCE_VERSION_CHANGED' : 'KNOWLEDGE_DOCUMENT_AMBIGUOUS', task, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, question.reasonCode, '知识资料需要按当前正式版本选择。', question.questionId); pending = { kind: 'knowledge', questionId: question.questionId }; continue;
            }
            const selected = choice.candidate;
            const index = (search.receipt.result.data || []).findIndex(item => String(item.id) === selected.sourceId);
            const detail = await execute({ toolName: 'get_factory_knowledge_detail', args: { id: Number(selected.sourceId) }, argumentSources: [pendingKind === 'knowledge' ? choiceSource('/id', selectedChoice.questionId || '') : receiptSource('/id', search.receipt.receiptId, `/result/data/${index}/id`)], goalKeys: [goal.goalKey] });
            if (!detail.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'KNOWLEDGE_DETAIL_UNAVAILABLE', '知识详情没有获得已验证回执。'); continue; }
            const entry = detail.receipt.result.data || {};
            const current = knowledgeCandidates([entry], sourceFreshness(detail))[0];
            if (!current || current.sourceVersionHash !== selected.sourceVersionHash) {
                const question = documentQuestion({ goal, candidates: current ? [current] : candidates, prompt: '知识条目版本已变化，请确认当前版本后再继续。', reasonCode: 'SOURCE_VERSION_CHANGED', task, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'SOURCE_VERSION_CHANGED', '资料版本变化，旧选择已失效。', question.questionId); pending = { kind: 'knowledge', questionId: question.questionId }; continue;
            }
            const excerpt = sourceExcerpt(entry.content || entry.summary || entry.title || '');
            const record = sourceEvidenceRecord({ taskId: task.taskId, planRevision: task.planRevision, candidate: current, evidenceKind: typeof entry.content === 'string' && entry.content ? 'SOURCE_ASSERTION' : 'SOURCE_METADATA', location: typeof entry.content === 'string' && entry.content ? { type: 'LINE_RANGE', start: 1, end: Math.max(1, entry.content.split(/\r?\n/u).length) } : { type: 'WHOLE_RECORD' }, excerpt: excerpt.excerpt, coverage: entry.content && !excerpt.truncated ? { mode: 'FULL_CONTENT', complete: true, truncated: false } : entry.content ? { mode: 'PARTIAL_CONTENT', complete: false, truncated: true } : { mode: 'METADATA_ONLY', complete: false, truncated: false }, observedAt: iso(clock) });
            addSourceEvidence(task, goal, record, adapter);
            if (record.coverage.complete) finishSourceGoal(task, goal); else { goal.state = 'PARTIAL'; appendBlocker(goal, 'SOURCE_CONTENT_INCOMPLETE', '知识详情没有提供完整可引用正文，不能据此给出完整性结论。'); }
        }
    }
    return { pending, sourceScenario, sourceProfitUnitPrice };
}

function markStructuredGap(goal, code, message) {
    goal.state = 'UNSUPPORTED';
    appendBlocker(goal, code, message);
}
function finishStructuredGoal(task, goal, facts, requirements) {
    task.facts.push(...facts);
    goal.factIds.push(...facts.map(fact => fact.factId));
    goal.requirements = requirements;
    goal.state = requirementsSatisfiedAtPlan(task, goal) ? 'VERIFIED' : 'PARTIAL';
    if (goal.state !== 'VERIFIED') appendBlocker(goal, 'STRUCTURED_READ_INCOMPLETE', '正式读取没有满足该目标的全部结构化条件。');
}

/** E2-R1 §B5：上一轮焦点不唯一时必须先澄清，绝不自行选择。返回 pending 供会话保存。 */
function continuationFocusQuestion({ task, goal, candidates, clock, sessionStore }) {
    const question = questionForCandidates({
        goalKeys: [goal.goalKey], candidates: candidates.map(item => item.entity),
        prompt: '上一轮涉及多个正式对象，请先确认这次要查询哪一个。',
        reasonCode: 'CONTINUATION_FOCUS_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs,
    });
    task.questions.push(question);
    goal.state = 'NEEDS_INPUT';
    appendBlocker(goal, 'CONTINUATION_FOCUS_AMBIGUOUS', '上一轮焦点不唯一，需要先确认对象，不能自行选择。', question.questionId);
    return { kind: 'continuationFocus', questionId: question.questionId };
}

async function runStructuredReadGoalsV2({ task, proposal, message, messageRef, adapter, execute, clock, sessionStore, pendingKind, existing, inheritedFocus = null }) {
    let pending = null; let historicalProfitUnitPrice = null;
    const goalFor = kind => task.goals.filter(goal => goal.kind === kind && goal.state === 'PENDING');
    const subjectFor = (goal, type) => proposal.subjects.find(subject => subject.subjectKey === goal.subjectKeys[0] && subject.typeHints.includes(type));

    // Customer identity is explicitly resolved with the existing directory before
    // the existing history capability receives the stable customerId.
    for (const goal of goalFor('CUSTOMER_HISTORY')) {
        const subject = subjectFor(goal, 'customer');
        if (!subject) { markStructuredGap(goal, 'N4.1A_CAPABILITY_GAP', '候选理解没有可正式解析的客户对象。'); continue; }
        const mentionSpan = subject.sources[0] || source(messageRef, message.content, subject.mention);
        const choiceId = pendingKind === 'customer' ? existing?.pending?.questionId : null;
        const lookup = await execute({ toolName: 'search_customers', args: { name: subject.mention }, argumentSources: [userSource('/name', mentionSpan)], goalKeys: [goal.goalKey] });
        if (!lookup.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'CUSTOMER_DIRECTORY_UNAVAILABLE', '正式客户目录没有获得已验证回执。'); continue; }
        const binding = adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'search_customers', receiptId: lookup.receipt.receiptId, selectionBasis: 'EXACT', choiceId });
        replaceSubjectBinding(task, binding);
        if (binding.resolution === 'MULTIPLE') {
            const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: binding.candidates, prompt: `“${subject.mention}”匹配多个正式客户，请选择一个。`, reasonCode: 'CUSTOMER_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
            task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'CUSTOMER_AMBIGUOUS', '需要选择正式客户。', question.questionId);
            pending = { kind: 'customer', questionId: question.questionId };
            continue;
        }
        if (binding.resolution === 'NOT_FOUND') { markStructuredGap(goal, 'CUSTOMER_NOT_FOUND', '正式客户目录中没有找到该客户。'); continue; }
        if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { goal.state = 'FAILED'; appendBlocker(goal, 'CUSTOMER_RESOLUTION_UNAVAILABLE', '客户目录结果不完整或不可用。'); continue; }
        const types = customerHistoryTypes(task.userGoal);
        const args = { customerId: Number(binding.selected.entityId), historyType: types.length === 2 ? 'all' : types[0] };
        const idPointer = findCandidatePointer(lookup.receipt, binding.selected);
        const historySources = [
            binding.resolution === 'SELECTED' ? choiceSource('/customerId', choiceId) : receiptSource('/customerId', lookup.receipt.receiptId, idPointer),
            policySource('/historyType'),
        ];
        const history = await execute({ toolName: 'search_customer_history', args, argumentSources: historySources, goalKeys: [goal.goalKey] });
        if (!history.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'CUSTOMER_HISTORY_UNAVAILABLE', '正式客户历史读取没有获得已验证回执。'); continue; }
        const returnedCustomer = readJsonPointer(history.receipt.result, '/data/customer');
        if (String(returnedCustomer?.id ?? returnedCustomer?.Id) !== binding.selected.entityId) { goal.state = 'FAILED'; appendBlocker(goal, 'CUSTOMER_HISTORY_IDENTITY_MISMATCH', '客户历史回执与当前正式客户绑定不一致。'); continue; }
        const coverage = collectionCoverageV1({ result: history.receipt.result, capabilityId: history.receipt.capabilityId, scopeType: 'customer_history' });
        const facts = projectCustomerHistoryFacts({ receipt: history.receipt, customer: binding.selected, historyTypes: types, coverage, planRevision: task.planRevision, clock });
        finishStructuredGoal(task, goal, facts, requirementsForStructuredGoal(goal, { userGoal: task.userGoal, coverage }));
        const historical = historicalQuotationPrice({ text: message.content, proposal, historyReceipt: history.receipt, customer: binding.selected, coverage, planRevision: task.planRevision, clock });
        if (historical) {
            task.facts.push(historical.fact);
            goal.factIds.push(historical.fact.factId);
            historicalProfitUnitPrice = { value: historical.value, source: historical.source, historicalPriceFactId: historical.fact.factId };
        }
    }

    // An explicit order id is an input candidate, then get_order_knowledge_package
    // remains the single authoritative read that supplies identity/readiness/actions.
    for (const goal of goalFor('ORDER_READINESS')) {
        const subject = subjectFor(goal, 'order');
        const numeric = /\d+/u.exec(subject?.mention || '');
        if (!subject || !numeric) { markStructuredGap(goal, 'N4.1A_CAPABILITY_GAP', '当前只读能力需要明确订单ID或已解析订单查询。'); continue; }
        const mentionSpan = subject.sources[0] || source(messageRef, message.content, subject.mention);
        const result = await execute({ toolName: 'get_order_knowledge_package', args: { orderId: Number(numeric[0]) }, argumentSources: [userSource('/orderId', mentionSpan)], goalKeys: [goal.goalKey] });
        if (!result.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'ORDER_KNOWLEDGE_UNAVAILABLE', '正式订单知识包没有获得已验证回执。'); continue; }
        let binding;
        try { binding = adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'get_order_knowledge_package', receiptId: result.receipt.receiptId, selectionBasis: 'EXPLICIT_ID' }); } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'ORDER_RESOLUTION_UNAVAILABLE', error.code || error.message); continue; }
        replaceSubjectBinding(task, binding);
        if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { goal.state = 'FAILED'; appendBlocker(goal, 'ORDER_RESOLUTION_UNAVAILABLE', '订单身份未得到唯一正式绑定。'); continue; }
        try {
            const facts = [
                structuredFact({ receipt: result.receipt, pointer: '/data/order', entityType: 'order', entityId: binding.selected.entityId, predicate: 'order.identity', basis: 'ORDER_KNOWLEDGE_PACKAGE', planRevision: task.planRevision, clock }),
                structuredFact({ receipt: result.receipt, pointer: '/data/readiness', entityType: 'order', entityId: binding.selected.entityId, predicate: 'order.readiness', basis: 'ORDER_KNOWLEDGE_PACKAGE', planRevision: task.planRevision, clock }),
                structuredFact({ receipt: result.receipt, pointer: '/data/actionPlan', entityType: 'order', entityId: binding.selected.entityId, predicate: 'order.readiness_actions', basis: 'ORDER_KNOWLEDGE_PACKAGE', planRevision: task.planRevision, clock }),
            ];
            finishStructuredGoal(task, goal, facts, requirementsForStructuredGoal(goal));
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'ORDER_KNOWLEDGE_SHAPE_INVALID', error.code || error.message); }
    }

    const globalReads = [
        ['QUOTATION_QUERY', 'search_quotations', 'quotation.summary', 'QUOTATION_CURRENT_LIST', 'quotation_current_list', '/data'],
        ['MANAGEMENT_OVERVIEW', 'get_management_action_center', 'management.action_center', 'MANAGEMENT_ACTION_CENTER', 'management_action_center', '/data'],
        ['BUSINESS_CHANGES', 'search_business_changes', 'business.change_set', 'BUSINESS_CHANGE_EVENT_LOG', 'business_change_set', '/data/items'],
        ['COIL_QUERY', 'search_coils', 'coil.variant_set', 'COIL_CATALOGUE_QUERY', 'coil_catalogue', '/data'],
    ];
    for (const [kind, toolName, predicate, basis, scopeType, pointer] of globalReads) for (const goal of goalFor(kind)) {
        const subject = kind === 'COIL_QUERY' ? subjectFor(goal, 'coil') : null;
        const args = kind === 'COIL_QUERY' && subject ? { spec: subject.mention } : {};
        const sources = kind === 'COIL_QUERY' && subject ? [userSource('/spec', subject.sources[0] || source(messageRef, message.content, subject.mention))] : [];
        const result = await execute({ toolName, args, argumentSources: sources, goalKeys: [goal.goalKey] });
        if (!result.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'STRUCTURED_READ_UNAVAILABLE', '正式只读能力没有获得已验证回执。'); continue; }
        const coverage = kind === 'MANAGEMENT_OVERVIEW' ? null : collectionCoverageV1({ result: result.receipt.result, capabilityId: result.receipt.capabilityId, scopeType });
        try {
            const fact = structuredFact({ receipt: result.receipt, pointer, entityType: 'global', entityId: null, predicate, basis, coverage, planRevision: task.planRevision, clock });
            const requirements = requirementsForStructuredGoal({ ...goal, subjectKeys: [] }, { coverage });
            finishStructuredGoal(task, goal, [fact], requirements);
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'STRUCTURED_READ_SHAPE_INVALID', error.code || error.message); }
    }

    for (const goal of goalFor('INVENTORY_QUERY')) {
        if (isVirtualReadinessGoal(goal, proposal, message.content)) continue;
        const subject = subjectFor(goal, 'coil');
        if (!subject) { markStructuredGap(goal, 'N4.1A_CAPABILITY_GAP', '当前候选理解没有绑定到单一正式零件或线圈方案；不能聚合多个方案库存。'); continue; }
        const mentionSpan = subject.sources[0] || source(messageRef, message.content, subject.mention);
        const choiceId = pendingKind === 'inventoryCoil' ? existing?.pending?.questionId : null;
        const inheritedEntry = inheritedFocus?.get(subject.subjectKey) || null;
        if (inheritedEntry?.candidates) { pending = continuationFocusQuestion({ task, goal, candidates: inheritedEntry.candidates, clock, sessionStore }); continue; }
        const inherited = inheritedEntry?.focus || null;
        const inheritedArgs = inherited ? (inherited.schemeCode ? { schemeCode: inherited.schemeCode } : { spec: inherited.readSelector }) : null;
        const result = await execute({ toolName: 'search_coils', args: inheritedArgs || { spec: subject.mention }, argumentSources: [inherited ? inheritedSource(inherited.schemeCode ? '/schemeCode' : '/spec') : userSource('/spec', mentionSpan)], goalKeys: [goal.goalKey] });
        if (!result.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'INVENTORY_READ_UNAVAILABLE', '正式线圈库存读取没有获得已验证回执。'); continue; }
        const binding = inherited
            ? bindInheritedSubject({ adapter, subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'search_coils', receiptId: result.receipt.receiptId, focus: inherited })
            : adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'search_coils', receiptId: result.receipt.receiptId, selectionBasis: 'EXACT', choiceId });
        if (inherited && !binding) { goal.state = 'FAILED'; appendBlocker(goal, 'CONTINUATION_IDENTITY_MISMATCH', '本轮正式读取没有确认上一轮选定对象的身份，不能继续。'); continue; }
        replaceSubjectBinding(task, binding);
        if (binding.resolution === 'MULTIPLE') {
            const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: binding.candidates, prompt: `“${subject.mention}”有多个正式线圈方案，请选择一个后再查询对应库存。`, reasonCode: 'INVENTORY_COIL_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
            task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'INVENTORY_COIL_AMBIGUOUS', '线圈方案存在多个正式候选，不能汇总库存。', question.questionId); pending = { kind: 'inventoryCoil', questionId: question.questionId }; continue;
        }
        if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { goal.state = 'FAILED'; appendBlocker(goal, 'INVENTORY_ENTITY_UNAVAILABLE', '线圈库存对象未得到唯一正式绑定。'); continue; }
        const coverage = collectionCoverageV1({ result: result.receipt.result, capabilityId: result.receipt.capabilityId, scopeType: 'coil_inventory' });
        try {
            const pointer = `/data/${binding.candidates.findIndex(item => item.entityId === binding.selected.entityId)}`;
            const fact = structuredFact({ receipt: result.receipt, pointer, entityType: 'coil', entityId: binding.selected.entityId, predicate: 'inventory.coil', basis: 'FORMAL_INVENTORY_QUERY', coverage, planRevision: task.planRevision, clock });
            finishStructuredGoal(task, goal, [fact], requirementsForStructuredGoal(goal, { coverage }));
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'INVENTORY_RESULT_SHAPE_INVALID', error.code || error.message); }
    }
    // FAMILY-02 线圈成本：与线圈库存共用同一套「正式 search_coils → canonical coil 绑定 →
    // 多候选澄清」机制，只把 predicate / basis / 澄清 reasonCode 换成成本口径。
    // 金额一律从正式回执的 cost 指针读取，不做任何自行计算。
    for (const goal of goalFor('COIL_COST')) {
        const subject = subjectFor(goal, 'coil');
        if (!subject) { markStructuredGap(goal, 'COIL_COST_IDENTITY_REQUIRED', '当前候选理解没有绑定到单一正式线圈方案；不能聚合多个方案成本。'); continue; }
        const mentionSpan = subject.sources[0] || source(messageRef, message.content, subject.mention);
        const choiceId = pendingKind === 'coilCost' ? existing?.pending?.questionId : null;
        const inheritedEntry = inheritedFocus?.get(subject.subjectKey) || null;
        if (inheritedEntry?.candidates) { pending = continuationFocusQuestion({ task, goal, candidates: inheritedEntry.candidates, clock, sessionStore }); continue; }
        const inherited = inheritedEntry?.focus || null;
        const inheritedArgs = inherited ? (inherited.schemeCode ? { schemeCode: inherited.schemeCode } : { spec: inherited.readSelector }) : null;
        const result = await execute({ toolName: 'search_coils', args: inheritedArgs || { spec: subject.mention }, argumentSources: [inherited ? inheritedSource(inherited.schemeCode ? '/schemeCode' : '/spec') : userSource('/spec', mentionSpan)], goalKeys: [goal.goalKey] });
        if (!result.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'COIL_COST_READ_UNAVAILABLE', '正式线圈成本读取没有获得已验证回执。'); continue; }
        const binding = inherited
            ? bindInheritedSubject({ adapter, subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'search_coils', receiptId: result.receipt.receiptId, focus: inherited })
            : adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'search_coils', receiptId: result.receipt.receiptId, selectionBasis: 'EXACT', choiceId });
        if (inherited && !binding) { goal.state = 'FAILED'; appendBlocker(goal, 'CONTINUATION_IDENTITY_MISMATCH', '本轮正式读取没有确认上一轮选定对象的身份，不能继续。'); continue; }
        replaceSubjectBinding(task, binding);
        if (binding.resolution === 'MULTIPLE') {
            const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: binding.candidates, prompt: `“${subject.mention}”有多个正式线圈方案，请选择一个后再查询对应成本。`, reasonCode: 'COIL_COST_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
            task.questions.push(question); goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'COIL_COST_AMBIGUOUS', '线圈方案存在多个正式候选，不能汇总成本。', question.questionId); pending = { kind: 'coilCost', questionId: question.questionId }; continue;
        }
        if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { goal.state = 'FAILED'; appendBlocker(goal, 'COIL_COST_ENTITY_UNAVAILABLE', '线圈成本对象未得到唯一正式绑定。'); continue; }
        const coverage = collectionCoverageV1({ result: result.receipt.result, capabilityId: result.receipt.capabilityId, scopeType: 'coil_cost' });
        try {
            // 金额指针指向正式回执里该候选自己的 cost 字段（不是第一个、不是最小、不是默认）。
            const pointer = `/data/${binding.candidates.findIndex(item => item.entityId === binding.selected.entityId)}/cost`;
            const fact = structuredFact({ receipt: result.receipt, pointer, entityType: 'coil', entityId: binding.selected.entityId, predicate: 'coil.current_cost', basis: 'FORMAL_COIL_COST_QUERY', coverage, planRevision: task.planRevision, clock });
            finishStructuredGoal(task, goal, [fact], requirementsForStructuredGoal(goal, { coverage }));
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'COIL_COST_RESULT_SHAPE_INVALID', error.code || error.message); }
    }
    // E2-R1 FAMILY-01：双主体配方成本比较。两个主体**分别**解析、**分别**绑定 canonical
    // identity；任一主体多候选都按「A 先、B 后」的可恢复顺序澄清（不默认第一项、不只绑一个就执行）。
    for (const goal of goalFor('RECIPE_COST_COMPARISON')) {
        const subjects = goal.subjectKeys.map(key => proposal.subjects.find(subject => subject.subjectKey === key)).filter(Boolean);
        if (subjects.length !== 2) { markStructuredGap(goal, 'RECIPE_COMPARISON_SUBJECTS_REQUIRED', '成本比较需要两个可解析的正式配方主体。'); continue; }
        const bindings = []; const bindingReceipts = new Map(); let stopped = false;
        for (const [index, subject] of subjects.entries()) {
            const kindForRole = index === 0 ? 'recipeComparisonA' : 'recipeComparisonB';
            const prior = task.subjects.find(item => item.subjectKey === subject.subjectKey);
            // 已在上一轮绑定的主体：本轮**重新正式读取**（回执必须是本轮 planRevision，且身份要再次核对），
            // 身份从上一轮的 canonical 绑定继承（BASELINE_INHERITANCE），不重新按名字猜。
            const inherited = prior?.selected && ['UNIQUE', 'SELECTED'].includes(prior.resolution)
                ? { entityType: prior.selected.entityType, entityId: prior.selected.entityId, displayName: prior.selected.displayName, schemeCode: prior.selected.schemeCode || null }
                : null;
            if (inherited) bindings.push(prior);
            const mentionSpan = subject.sources[0] || source(messageRef, message.content, subject.mention);
            const keyword = inherited ? inherited.displayName : subject.mention;
            const lookup = await execute({ toolName: 'get_all_recipes', args: { keyword }, argumentSources: [inherited ? inheritedSource('/keyword') : userSource('/keyword', mentionSpan)], goalKeys: [goal.goalKey] });
            if (!lookup.receipt) { goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_COMPARISON_CATALOGUE_UNAVAILABLE', '正式配方目录读取没有获得已验证回执。'); stopped = true; break; }
            bindingReceipts.set(index, lookup.receipt);
            if (inherited) continue;
            const choiceId = pendingKind === kindForRole ? existing?.pending?.questionId : null;
            const binding = adapter.bindSubject({ subjectKey: subject.subjectKey, mention: subject.mention, toolName: 'get_all_recipes', receiptId: lookup.receipt.receiptId, selectionBasis: 'EXACT', choiceId });
            replaceSubjectBinding(task, binding);
            if (binding.resolution === 'MULTIPLE') {
                const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: binding.candidates, prompt: `“${subject.mention}”有多个正式配方，请选择一个后再进行成本比较。`, reasonCode: 'RECIPE_COMPARISON_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question); goal.state = 'NEEDS_INPUT';
                appendBlocker(goal, 'RECIPE_COMPARISON_AMBIGUOUS', `成本比较的第 ${index + 1} 个主体存在多个正式候选，需要先澄清。`, question.questionId);
                pending = { kind: kindForRole, questionId: question.questionId }; stopped = true; break;
            }
            if (binding.resolution === 'NOT_FOUND') { goal.state = 'UNSUPPORTED'; appendBlocker(goal, 'RECIPE_NOT_FOUND', '正式配方目录中未找到该目标。'); stopped = true; break; }
            if (!['UNIQUE', 'SELECTED'].includes(binding.resolution)) { goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_COMPARISON_RESOLUTION_UNAVAILABLE', '配方目录结果不完整或不可用。'); stopped = true; break; }
            bindings.push(binding);
        }
        if (stopped) continue;
        const [left, right] = bindings;
        if (left.selected.entityId === right.selected.entityId) { markStructuredGap(goal, 'RECIPE_COMPARISON_SAME_SUBJECT', '两个主体解析到同一个正式配方，不能构成成本比较。'); continue; }
        const leftReceipt = bindingReceipts.get(0); const rightReceipt = bindingReceipts.get(1);
        let comparisonSources;
        try {
            comparisonSources = [
                receiptSource('/recipe1', leftReceipt.receiptId, findCandidatePointer(leftReceipt, left.selected)),
                receiptSource('/recipe2', rightReceipt.receiptId, findCandidatePointer(rightReceipt, right.selected)),
            ];
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_COMPARISON_SOURCE_POINTER_MISSING', error.code || error.message); continue; }
        // canonical ID first：两个主体已经 canonical resolved，比较能力必须按主键比较，
        // 不得退回名称再次决定身份（底层 `resolveRecipe` 对全数字选择器走主键匹配）。
        const comparison = await execute({ toolName: 'compare_recipes', args: { recipe1: String(left.selected.entityId), recipe2: String(right.selected.entityId) }, argumentSources: comparisonSources, goalKeys: [goal.goalKey] });
        if (!comparison.receipt) { goal.state = 'PARTIAL'; appendBlocker(goal, 'RECIPE_COMPARISON_UNVERIFIED', '正式成本对比能力没有返回已验证回执。'); continue; }
        const prefix = comparisonDataPrefix(comparison.receipt);
        const leftRow = prefix === null ? null : readJsonPointer(comparison.receipt.result, `${prefix}/recipe1`);
        const rightRow = prefix === null ? null : readJsonPointer(comparison.receipt.result, `${prefix}/recipe2`);
        // 身份核对：正式比较回执必须对应两个已绑定的 canonical 配方（名称不符即 fail-closed）。
        if (!leftRow || !rightRow || String(leftRow.name) !== left.selected.displayName || String(rightRow.name) !== right.selected.displayName) {
            goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_COMPARISON_IDENTITY_MISMATCH', '正式比较回执与已绑定的配方身份不一致，不能给出比较结论。'); continue;
        }
        try {
            const leftCostValue = Number(readJsonPointer(comparison.receipt.result, `${prefix}/recipe1/cost`));
            const rightCostValue = Number(readJsonPointer(comparison.receipt.result, `${prefix}/recipe2/cost`));
            const diffValue = Number(readJsonPointer(comparison.receipt.result, `${prefix}/costDiff`));
            // 正式差额必须与两个正式成本自洽（差额方向按契约 costDiff=配方2−配方1）。
            // 不一致时不产出差额事实、也不给方向结论 —— 既不相减，也不盲信异常回执。
            const consistent = [leftCostValue, rightCostValue, diffValue].every(Number.isFinite)
                && Math.abs((rightCostValue - leftCostValue) - diffValue) < 0.005;
            const facts = [
                moneyFact({ receipt: comparison.receipt, pointer: `${prefix}/recipe1/cost`, entityType: 'recipe', entityId: left.selected.entityId, predicate: 'recipe.current_cost', planRevision: task.planRevision, clock }),
                moneyFact({ receipt: comparison.receipt, pointer: `${prefix}/recipe2/cost`, entityType: 'recipe', entityId: right.selected.entityId, predicate: 'recipe.current_cost', planRevision: task.planRevision, clock }),
            ];
            if (consistent) facts.push(moneyFact({ receipt: comparison.receipt, pointer: `${prefix}/costDiff`, entityType: 'recipe', entityId: left.selected.entityId, predicate: 'recipe.cost_difference', planRevision: task.planRevision, clock }));
            task.facts.push(...facts);
            goal.factIds = facts.map(fact => fact.factId);
            goal.requirements = requirementsForStructuredGoal(goal);
            goal.state = requirementsSatisfiedAtPlan(task, goal) ? 'VERIFIED' : 'PARTIAL';
            if (!consistent) appendBlocker(goal, 'RECIPE_COMPARISON_DIFF_INCONSISTENT', '正式比较回执的差额与两个主体成本不一致，因此不给出差额与方向结论。');
            else if (goal.state !== 'VERIFIED') appendBlocker(goal, 'RECIPE_COMPARISON_FACTS_INCOMPLETE', '正式比较没有同时形成两个主体成本与正式差额三个事实。');
        } catch (error) { goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_COMPARISON_RESULT_SHAPE_INVALID', error.code || error.message); }
    }
    for (const goal of goalFor('IMPACT_INVESTIGATION')) markStructuredGap(goal, 'N4.1A_CAPABILITY_GAP', '现有影响能力只接受已批准规则候选ID，当前语义尚未提供可安全绑定的正式候选。');
    return { pending, historicalProfitUnitPrice };
}

async function runAiTaskControllerV2(input = {}, dependencies = {}) {
    const clock = dependencies.clock || Date;
    const started = Date.now();
    const ownerKey = dependencies.ownerKey || input.ownerKey;
    if (typeof ownerKey !== 'string' || !ownerKey) throw Object.assign(new Error('TASK_V2_OWNER_REQUIRED'), { code: 'TASK_V2_OWNER_REQUIRED' });
    const conversationId = input.conversationId || null;
    const requestId = input.requestId || uuid();
    const recovered = dependencies.recoveredContext || null;
    const message = recovered ? { role: 'user', content: recovered.task.spec.userGoal } : latestUserMessage(input.messages);
    const messageRef = recovered ? recovered.sourceMessages.keys().next().value : nowMessageRef(requestId);
    const sessionStore = dependencies.sessionStore || defaultTaskSessionStoreV2;
    const existing = recovered ? { task: recovered.runtimeTask, proposal: recovered.proposal, sourceMessages: Object.fromEntries(recovered.sourceMessages), trustedReceipts: Object.fromEntries(recovered.trustedReceipts), pending: recovered.pending, recovered: true } : sessionStore.get(ownerKey, conversationId);
    const sourceMessages = existing ? mapFrom(existing.sourceMessages) : new Map();
    if (!recovered) sourceMessages.set(messageRef, message.content);
    let task; let proposal; let semantics; let selectedChoice = null; let pendingKind = null; let inheritedFocus = null;

    // 澄清回复的动作边界（Root Cause C / A07）。
    // 只有「候选澄清 + 明确的肯定选择」才进入上一轮的候选绑定分支：
    //   - 补参数类问题（无候选）保持既有行为，由各参数语法解析；
    //   - 出现否定/撤回时既不能绑定候选、也不能把它当新问题，返回待输入并保留原问题；
    //   - 换了一个新问题时放弃该待澄清问题，按新问题重新解析（不得从句内抢数字当选择）。
    const pendingReply = existing?.pending && !existing.recovered
        ? choosePendingSession(existing, message.content, ownerKey, conversationId, clock) : null;
    const pendingHasChoices = Array.isArray(pendingReply?.question?.choices) && pendingReply.question.choices.length > 0;
    if (pendingReply && !pendingReply.error && pendingHasChoices) {
        if (pendingReply.action === CLARIFICATION_ACTION.NEGATE || pendingReply.action === CLARIFICATION_ACTION.CANCEL) {
            return taskResult(existing.task, { state: 'WAITING_INPUT', errorCode: 'CLARIFICATION_NOT_SELECTED', clarificationAction: pendingReply.action }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
        }
        if (pendingReply.action === CLARIFICATION_ACTION.NEW_TASK || pendingReply.action === CLARIFICATION_ACTION.UNKNOWN) {
            // 用户换了话题：旧澄清作废，按新问题走完整的语义解析。
            sessionStore.remove(ownerKey, conversationId);
            existing.pending = null;
        }
    }

    if (existing?.pending && !existing.recovered) {
        const selected = pendingReply;
        if (selected.error) {
            return taskResult(existing.task, { state: 'WAITING_INPUT', errorCode: selected.error }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
        }
        task = clone(existing.task); proposal = clone(existing.proposal); task.planRevision += 1; task.revision += 1;
        // A single textual follow-up can safely answer more than one pending
        // free-form question.  Bind only values with their explicit syntax to
        // the matching question kind; never infer one parameter from another.
        const continuationPrice = unitPriceFromMessage(message.content, messageRef);
        const continuationQuantity = quantityFromMessage(message.content, messageRef);
        const answeredQuestionIds = new Set([selected.question.questionId]);
        if (continuationPrice) for (const question of task.questions) {
            if (question.answeredAt === null && question.reasonCode === 'PROFITABILITY_UNIT_PRICE_REQUIRED') answeredQuestionIds.add(question.questionId);
        }
        if (continuationQuantity) for (const question of task.questions) {
            if (question.answeredAt === null && question.reasonCode === 'VIRTUAL_READINESS_QUANTITY_REQUIRED') answeredQuestionIds.add(question.questionId);
        }
        const answeredAt = iso(clock);
        task.questions = task.questions.map(question => answeredQuestionIds.has(question.questionId) ? { ...question, answeredAt } : question);
        for (const goal of task.goals) if (goal.blockers.some(item => answeredQuestionIds.has(item.questionId))) {
            goal.blockers = goal.blockers.filter(item => !answeredQuestionIds.has(item.questionId));
            if (goal.state === 'NEEDS_INPUT') goal.state = 'PENDING';
        }
        selectedChoice = selected.choice ? { ...selected.choice, questionId: selected.question.questionId } : null; pendingKind = existing.pending.kind;
        // E2-R1 §B5：上一轮焦点不唯一的澄清被选中后，本轮才允许把它当作继承身份（仍然只接身份）。
        if (pendingKind === 'continuationFocus' && selectedChoice?.entity?.entityId) {
            const focus = focusFromEntity(selectedChoice.entity);
            inheritedFocus = new Map();
            for (const subject of proposal.subjects) {
                if (ANAPHORA_RE.test(String(subject.mention || '')) && subject.typeHints.includes(focus.entityType)) inheritedFocus.set(subject.subjectKey, { focus });
            }
        }
        if (pendingKind === 'cableUnit') {
            const cable = cableLengthWithUnit(message.content, messageRef);
            if (!cable) return taskResult(task, { state: 'WAITING_INPUT', errorCode: 'CABLE_LENGTH_UNIT_REQUIRED' }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
            const primarySubject = proposal.subjects.find(subject => subject.typeHints.includes('recipe')) || proposal.subjects[0];
            if (!proposal.scenarios.length) proposal.scenarios.push({ scenarioKey: 'candidate_1', label: '用户候选配置', baseSubjectKey: primarySubject.subjectKey, overrides: [], sources: [] });
            const scenario = proposal.scenarios[0];
            scenario.overrides = scenario.overrides.filter(item => item.field !== 'cableLength');
            scenario.overrides.push({ field: 'cableLength', value: cable.value, unit: 'm', sources: [cable.source] });
            scenario.sources = [...scenario.sources, cable.source];
        }
        if (pendingKind === 'profitPrice' || answeredQuestionIds.size > 1 && continuationPrice) {
            const price = continuationPrice;
            if (!price) return taskResult(task, { state: 'WAITING_INPUT', errorCode: 'PROFITABILITY_UNIT_PRICE_REQUIRED' }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
            const profitProposal = proposal.goals.find(goal => goal.kind === 'PROFITABILITY');
            if (profitProposal) profitProposal.unitPrice = { value: price.value, unit: 'CNY', sources: [price.source] };
            // A new user price advances planRevision. Re-read the independent
            // current-cost requirement at that revision so the final answer
            // never combines an old-plan cost fact with a new-plan profit fact.
            for (const goal of goalByKind(task, 'CURRENT_COST')) if (goal.state === 'VERIFIED') {
                goal.state = 'PENDING'; goal.factIds = []; goal.requirements = [];
            }
        }
        if (pendingKind === 'virtualReadinessQuantity' || answeredQuestionIds.size > 1 && continuationQuantity) {
            const quantity = continuationQuantity;
            if (!quantity) return taskResult(task, { state: 'WAITING_INPUT', errorCode: 'VIRTUAL_READINESS_QUANTITY_REQUIRED' }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
            const readinessProposal = proposal.goals.find(goal => goal.kind === 'INVENTORY_QUERY' && goal.description === VIRTUAL_READINESS_DESCRIPTION);
            if (readinessProposal) readinessProposal.quantity = { value: quantity.value, unit: 'pump', sources: [quantity.source] };
            for (const goal of task.goals) if (isVirtualReadinessGoal(goal, proposal, task.userGoal)) {
                goal.state = 'PENDING'; goal.factIds = []; goal.requirements = [];
            }
        }
        if (pendingKind === 'surfaceCost') {
            const surface = surfaceCostFromMessage(message.content, messageRef);
            if (!surface) return taskResult(task, { state: 'WAITING_INPUT', errorCode: 'SURFACE_TREATMENT_COST_REQUIRED' }, { outcome: 'waiting_input', modelRequestCount: 0, executedTools: 0 }, mapFrom(existing.trustedReceipts), sourceMessages);
            const scenario = proposal.scenarios[0];
            scenario.overrides = scenario.overrides.filter(item => item.field !== 'surfaceTreatmentCost');
            scenario.overrides.push({ field: 'surfaceTreatmentCost', value: surface.value, unit: 'CNY', sources: [surface.source] });
            scenario.sources = [...scenario.sources, surface.source];
        }
        semantics = { telemetry: { modelCalls: 0, formatRepairCalls: 0, provider: null, model: null }, extractionMode: 'DETERMINISTIC' };
    } else if (existing?.recovered) {
        task = clone(existing.task); proposal = clone(existing.proposal);
        // N5.2 resumes only use answers that the route has rebound to durable
        // user messages.  The persisted task plan remains the sole semantic
        // source: no model call or reinterpretation occurs after a restart.
        const resumed = existing.pending?.resume?.answers || [];
        if (resumed.length) {
            const answered = resumed[0];
            const answerText = sourceMessages.get(answered.messageRef);
            if (typeof answerText !== 'string') throw Object.assign(new Error('TASK_SOURCE_MESSAGE_UNAVAILABLE'), { code: 'TASK_SOURCE_MESSAGE_UNAVAILABLE' });
            const question = task.questions.find(item => item.questionId === answered.questionId);
            if (!question) throw Object.assign(new Error('TASK_CLARIFICATION_STALE'), { code: 'TASK_CLARIFICATION_STALE' });
            pendingKind = existing.pending?.kind || null;
            if (answered.choiceId) {
                const choice = question.choices.find(item => item.choiceId === answered.choiceId);
                if (!choice) throw Object.assign(new Error('TASK_CLARIFICATION_CHOICE_INVALID'), { code: 'TASK_CLARIFICATION_CHOICE_INVALID' });
                selectedChoice = { ...choice, questionId: question.questionId };
            }
            const price = unitPriceFromMessage(answerText, answered.messageRef);
            const quantity = quantityFromMessage(answerText, answered.messageRef);
            if (price) {
                const profit = proposal.goals.find(goal => goal.kind === 'PROFITABILITY');
                if (profit) profit.unitPrice = { value: price.value, unit: 'CNY', sources: [price.source] };
            }
            if (quantity) {
                for (const goal of proposal.goals.filter(goal => goal.kind === 'INVENTORY_QUERY' || goal.kind === 'PROFITABILITY')) goal.quantity = { value: quantity.value, unit: 'pump', sources: [quantity.source] };
            }
        }
        semantics = { telemetry: { modelCalls: 0, formatRepairCalls: 0, provider: null, model: null }, extractionMode: 'RECOVERED' };
    } else {
        const configuredProvider = dependencies.provider || (input.fetchAiProvider ? async request => input.fetchAiProvider(request.messages, { tools: request.tools, toolChoice: request.toolChoice, signal: input.signal, onProvider: input.onProvider }) : null);
        const provider = configuredProvider ? async request => {
            if (typeof dependencies.beforeModelCall === 'function') await dependencies.beforeModelCall();
            return configuredProvider(request);
        } : null;
        semantics = await extractTaskSemanticsV2({ messageRef, text: message.content, provider });
        proposal = clone(semantics.proposal);
        // Exact user prices and quantities are server-rebound numeric inputs.
        // They may fill an already admitted goal, but never create a new goal.
        const messagePrice = unitPriceFromMessage(message.content, messageRef);
        const messageQuantity = quantityFromMessage(message.content, messageRef);
        for (const goal of proposal.goals) {
            if (goal.kind === 'PROFITABILITY' && !goal.unitPrice && messagePrice) goal.unitPrice = { value: messagePrice.value, unit: 'CNY', sources: [messagePrice.source] };
            if (['INVENTORY_QUERY', 'PROFITABILITY'].includes(goal.kind) && !goal.quantity && messageQuantity) goal.quantity = { value: messageQuantity.value, unit: 'pump', sources: [messageQuantity.source] };
        }
        // E2-R1 §B：跨轮 canonical 主体继承。只把**身份**接进本轮无标识指代的问题；
        // 目标/事实/可变业务数值都不继承，必须在本轮重新正式读取。
        const injection = injectInheritedSubjects({ proposal, messageRef, text: message.content, continuation: existing?.continuation || null, selectedChoice, pendingKind });
        inheritedFocus = injection.focus;
        if (injection.mutated) validateTaskProposalV1(proposal, { sourceMessages: new Map([[messageRef, message.content]]) });
        task = createEnvelope({ taskId: input.taskId || undefined, ownerKey, conversationId, requestId, userGoal: message.content, writePolicy: semantics.serverDirectives.businessWritePolicy, clock, maxActiveMs: Math.min(DEFAULT_ACTIVE_MS, Number(input.timeoutMs) || DEFAULT_ACTIVE_MS) });
        if (input.executionMode === 'DETACHED') task.executionMode = 'DETACHED';
        replaceTaskGoalsFromProposal(task, proposal);
        task.subjects = proposal.subjects.map(unresolvedSubject);
        // A proposal scenario may still contain natural-language choices (for
        // example coilSelection).  It becomes a V2 formal scenario only after
        // resolution; until then retain the proposal in the server session and
        // do not pretend it is an executable scenario binding.
        for (const goal of task.goals) goal.scenarioKeys = [];
        task.budgetUsage.modelCalls = semantics.telemetry.modelCalls + semantics.telemetry.formatRepairCalls;
        markUnsupportedGoals(task);
        markUnsupportedProfitCurrency(task, message.content);
        if (missingCableLengthUnit(message.content)) {
            let configGoal = task.goals.find(goal => goal.kind === 'CONFIGURATION_COMPARE' || goal.kind === 'PREPARE_CHANGE');
            if (!configGoal) {
                configGoal = task.goals.find(goal => goal.kind === 'OTHER');
                if (configGoal) { configGoal.kind = 'CONFIGURATION_COMPARE'; configGoal.description = '比较电缆配置与当前成本'; configGoal.state = 'PENDING'; configGoal.blockers = []; }
            }
            if (configGoal) {
                const question = questionForCandidates({ goalKeys: [configGoal.goalKey], candidates: [], prompt: '电缆长度缺少单位，请确认例如“5米”。', reasonCode: 'CABLE_LENGTH_UNIT_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question); configGoal.state = 'NEEDS_INPUT'; appendBlocker(configGoal, 'CABLE_LENGTH_UNIT_REQUIRED', '电缆长度没有单位。', question.questionId);
                task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
                sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: {}, pending: { kind: 'cableUnit', questionId: question.questionId } });
                validateTaskEnvelopeV2(task, { trustedReceiptsById: new Map(), sourceMessages });
                return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: 0 }, new Map(), sourceMessages);
            }
        }
    }
    task.state = 'UNDERSTANDING'; task.revision += 1;
    if (task.budgetUsage.modelCalls > task.constraints.maxModelCalls) throw Object.assign(new Error('TASK_V2_BUDGET_EXCEEDED'), { code: 'TASK_V2_BUDGET_EXCEEDED' });

    for (const goal of task.goals.filter(item => item.state === 'PENDING' && isVirtualReadinessGoal(item, proposal, task.userGoal))) {
        if (IGNORE_RESERVATION_INTENT.test(task.userGoal)) {
            goal.state = 'UNSUPPORTED';
            appendBlocker(goal, 'UNSUPPORTED_RESERVATION_POLICY', '当前虚拟齐料预览固定扣除活动订单占用，不能忽略其他订单。');
            continue;
        }
        const semanticGoal = proposal.goals.find(item => item.goalKey === goal.goalKey);
        if (!Number.isSafeInteger(semanticGoal?.quantity?.value) || semanticGoal.quantity.value < 1) {
            const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: [], prompt: '请确认本次要按多少台进行虚拟齐料预览，例如“300台”。', reasonCode: 'VIRTUAL_READINESS_QUANTITY_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
            task.questions.push(question); goal.state = 'NEEDS_INPUT';
            appendBlocker(goal, 'VIRTUAL_READINESS_QUANTITY_REQUIRED', '需要明确虚拟需求数量，不能默认数量。', question.questionId);
        }
    }

    // S2-R3-P1 §D：齐料预览正式契约是**一次一个配方**。
    // 句子里出现多个配方主体时不新增多配方能力，也不自行挑选，给出有界澄清。
    for (const goal of task.goals.filter(item => item.state === 'PENDING' && item.kind === 'INVENTORY_QUERY'
        && item.description === READINESS_MULTI_SUBJECT_DESCRIPTION)) {
        const candidateNames = [...new Set((proposal.subjects || [])
            .filter(subject => (subject.typeHints || []).includes('recipe'))
            .map(subject => String(subject.mention || '').trim()).filter(Boolean))];
        const prompt = `当前一次按一个配方做齐料预览。请先选择 ${candidateNames.join(' 或 ') || '一个配方'}，并说明按多少台计算。`;
        const question = questionForCandidates({ goalKeys: [goal.goalKey], candidates: [], prompt, reasonCode: 'READINESS_SINGLE_RECIPE_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
        task.questions.push(question);
        goal.state = 'NEEDS_INPUT';
        appendBlocker(goal, 'READINESS_SINGLE_RECIPE_REQUIRED', '齐料预览一次只按一个配方，需要先确认目标配方。', question.questionId);
        task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
        sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(mapFrom(existing?.trustedReceipts)), pending: { kind: 'readinessRecipe', questionId: question.questionId } });
        validateTaskEnvelopeV2(task, { trustedReceiptsById: mapFrom(existing?.trustedReceipts), sourceMessages });
        return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: 0 }, mapFrom(existing?.trustedReceipts), sourceMessages);
    }

    const trustedChoices = selectedChoice ? { [selectedChoice.questionId || existing?.pending?.questionId]: { value: Number(selectedChoice.entity.entityId) } } : {};
    const adapter = createTaskCapabilityAdapterV2({
        taskId: task.taskId, planRevision: task.planRevision, sourceMessages, trustedChoices,
        executeToolCall: dependencies.executeToolCall, executionOptions: { signal: input.signal },
        beforeExecute: request => dependencies.beforeToolCall?.(request),
        afterExecute: dependencies.afterToolCall,
        trustedReceipts: mapFrom(existing?.trustedReceipts),
        findRecoveredReceipt: dependencies.findRecoveredReceipt,
    });
    const allReceipts = mapFrom(existing?.trustedReceipts);
    const execute = async ({ toolName, args, argumentSources, goalKeys }) => {
        if (input.signal?.aborted) throw input.signal.reason || Object.assign(new Error('TASK_V2_ABORTED'), { code: 'TASK_V2_ABORTED' });
        const descriptor = adapter.describeCapability(toolName);
        if (descriptor.access === 'COMMAND') throw Object.assign(new Error('TASK_V2_COMMAND_NOT_ENABLED'), { code: 'TASK_V2_COMMAND_NOT_ENABLED' });
        const retryStep = typeof dependencies.findInterruptedRetry === 'function'
            ? dependencies.findInterruptedRetry({ toolName, capabilityId: descriptor.capabilityId, args, argsHash: require('./aiTaskContractV2.cjs').stableHash(args) }) : null;
        const recoveredReceipt = !retryStep && typeof dependencies.findRecoveredReceipt === 'function'
            ? dependencies.findRecoveredReceipt({ toolName, capabilityId: descriptor.capabilityId, args }) : null;
        const stepId = retryStep?.stepKey || uuid();
        // A detached Worker must make the dispatch boundary durable before the
        // external read.  The lifecycle persists this PLANNED entry as RUNNING;
        // an interrupted process can therefore make one bounded recovery retry.
        if (!retryStep && !recoveredReceipt) {
            task.steps.push({ stepId, goalKeys, toolName: descriptor.toolName, capabilityId: descriptor.capabilityId, access: descriptor.access, arguments: args, argumentSources, argsHash: require('./aiTaskContractV2.cjs').stableHash(args), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, receiptId: null, operationId: null, errorCode: null });
            if (typeof dependencies.onProgress === 'function') await dependencies.onProgress({ task: clone(task), proposal: clone(proposal), trustedReceipts: new Map(allReceipts), sourceMessages: new Map(sourceMessages), pending: existing?.pending || null, iterationActiveMs: Date.now() - started });
        }
        let result = await adapter.executeCapability({ toolName, args, argumentSources, stepId });
        if (result.status !== 'VERIFIED_REUSED') updateBudgetFromResult(task, result.result);
        // One retry is reserved for technical non-receipt outcomes.  Formal
        // ambiguity, absence, and business errors never take this path.
        if (result.status !== 'VERIFIED' && result?.result?.technicalFailure === true) {
            result = await adapter.executeCapability({ toolName, args, argumentSources, stepId });
            updateBudgetFromResult(task, result.result);
        }
        if (retryStep || result.status !== 'VERIFIED_REUSED') {
            task.steps = task.steps.map(step => step.stepId === stepId ? { ...step, state: result.receipt ? 'SUCCEEDED' : 'FAILED', attempt: retryStep ? 2 : step.attempt, receiptId: result.receipt?.receiptId || null, errorCode: result.receipt ? null : 'UNVERIFIED_EXECUTOR_RESULT', finishedAt: iso(clock) } : step);
        }
        if (result.receipt) allReceipts.set(result.receipt.receiptId, result.receipt);
        if (typeof dependencies.onProgress === 'function') await dependencies.onProgress({ task: clone(task), proposal: clone(proposal), trustedReceipts: new Map(allReceipts), sourceMessages: new Map(sourceMessages), pending: existing?.pending || null, iterationActiveMs: Date.now() - started });
        return result;
    };

    if (typeof dependencies.onProgress === 'function') await dependencies.onProgress({ task: clone(task), proposal: clone(proposal), trustedReceipts: new Map(existing?.trustedReceipts ? Object.entries(existing.trustedReceipts) : []), sourceMessages: new Map(sourceMessages), pending: existing?.pending || null, iterationActiveMs: Date.now() - started });
    task.state = 'RESOLVING'; task.revision += 1;
    const structuredRun = await runStructuredReadGoalsV2({
        task, proposal, message, messageRef, adapter, execute, clock, sessionStore,
        ownerKey, conversationId, selectedChoice, pendingKind, existing, inheritedFocus,
    });
    const documentRun = await runDocumentGoalsV2({ task, proposal, message, messageRef, adapter, execute, clock, sessionStore, selectedChoice, pendingKind });
    const activeGoals = task.goals.filter(goal => (LEGACY_READ_GOALS.has(goal.kind) || isVirtualReadinessGoal(goal, proposal, message.content)) && goal.state === 'PENDING');
    const inheritedRecipeSubject = proposal.subjects.find(subject => subject.typeHints.includes('recipe')) || null;
    const inheritedRecipeEntry = inheritedRecipeSubject ? inheritedFocus?.get(inheritedRecipeSubject.subjectKey) : null;
    // §B5：上一轮焦点不唯一时先澄清，绝不自行选择哪个主体。
    if (activeGoals.length && inheritedRecipeEntry?.candidates) {
        const question = questionForCandidates({
            goalKeys: activeGoals.map(goal => goal.goalKey), candidates: inheritedRecipeEntry.candidates.map(item => item.entity),
            prompt: '上一轮涉及多个正式配方，请先确认这次要查询哪一个。',
            reasonCode: 'CONTINUATION_FOCUS_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs,
        });
        task.questions.push(question);
        for (const goal of activeGoals) { goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'CONTINUATION_FOCUS_AMBIGUOUS', '上一轮焦点不唯一，需要先确认对象，不能自行选择。', question.questionId); }
    }
    if (activeGoals.length && !inheritedRecipeEntry?.candidates) {
    const primary = proposal.subjects.find(subject => subject.typeHints.includes('recipe')) || proposal.subjects[0];
    if (!primary) {
        for (const goal of activeGoals) { goal.state = 'UNSUPPORTED'; appendBlocker(goal, 'SUBJECT_NOT_PROPOSED', '候选理解没有可解析的正式对象。'); }
    } else {
        const mentionSpan = primary.sources[0] || source(messageRef, message.content, primary.mention);
        let recipeChoiceId = pendingKind === 'recipe' ? existing.pending.questionId : null;
        const inheritedRecipe = inheritedRecipeEntry?.focus || null;
        const recipeSearch = await execute({ toolName: 'get_all_recipes', args: { keyword: inheritedRecipe ? inheritedRecipe.readSelector : primary.mention }, argumentSources: [inheritedRecipe ? inheritedSource('/keyword') : userSource('/keyword', mentionSpan)], goalKeys: activeGoals.map(goal => goal.goalKey) });
        if (!recipeSearch.receipt) {
            for (const goal of activeGoals) { goal.state = 'FAILED'; appendBlocker(goal, 'FORMAL_RECIPE_READ_FAILED', '正式配方目录读取未获得已验证回执。'); }
        } else {
            const binding = inheritedRecipe
                ? bindInheritedSubject({ adapter, subjectKey: primary.subjectKey, mention: primary.mention, toolName: 'get_all_recipes', receiptId: recipeSearch.receipt.receiptId, focus: inheritedRecipe })
                : adapter.bindSubject({ subjectKey: primary.subjectKey, mention: primary.mention, toolName: 'get_all_recipes', receiptId: recipeSearch.receipt.receiptId, selectionBasis: 'EXACT', choiceId: recipeChoiceId });
            if (binding) task.subjects = task.subjects.map(subject => subject.subjectKey === primary.subjectKey ? binding : subject);
            if (!binding) {
                for (const goal of activeGoals) { goal.state = 'FAILED'; appendBlocker(goal, 'CONTINUATION_IDENTITY_MISMATCH', '本轮正式读取没有确认上一轮选定配方的身份，不能继续。'); }
            } else if (binding.resolution === 'NOT_FOUND') {
                const negative = makeFactRecordV1({ receipt: recipeSearch.receipt, pointer: '/data', key: makeFactKey({ entityType: 'recipe', entityId: null, predicate: 'recipe.catalog_match', temporalScope: 'CURRENT', basis: 'RECIPE_CATALOGUE_QUERY', queryScopeHash: recipeScopeHash(primary.mention) }), evidenceState: 'VERIFIED_NEGATIVE', complete: true, planRevision: task.planRevision, clock });
                task.facts.push(negative);
                for (const goal of activeGoals) { goal.state = 'UNSUPPORTED'; goal.factIds.push(negative.factId); appendBlocker(goal, 'RECIPE_NOT_FOUND', '正式配方目录中未找到该目标。'); }
            } else if (binding.resolution === 'MULTIPLE') {
                const question = questionForCandidates({ goalKeys: activeGoals.map(goal => goal.goalKey), candidates: binding.candidates, prompt: `“${primary.mention}”有多个正式配方，请选择一个。`, reasonCode: 'RECIPE_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                task.questions.push(question);
                for (const goal of activeGoals) { goal.state = 'NEEDS_INPUT'; appendBlocker(goal, 'RECIPE_AMBIGUOUS', '需要选择正式配方。', question.questionId); }
                task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
                sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(allReceipts), pending: { kind: 'recipe', questionId: question.questionId } });
                validateTaskEnvelopeV2(task, { trustedReceiptsById: allReceipts, sourceMessages });
                return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: task.budgetUsage.toolCalls }, allReceipts, sourceMessages);
            } else if (binding.resolution !== 'UNIQUE' && binding.resolution !== 'SELECTED') {
                for (const goal of activeGoals) { goal.state = 'FAILED'; appendBlocker(goal, 'RECIPE_RESOLUTION_UNAVAILABLE', '配方目录结果不完整或不可用。'); }
            } else {
                const selectedRecipe = binding.selected;
                const configGoal = task.goals.find(goal => goal.kind === 'CONFIGURATION_COMPARE' || goal.kind === 'PREPARE_CHANGE');
                const semanticScenario = proposal.scenarios[0] || null;
                let readinessScenarioContext = null;
                let resolvedOverrides = {};
                const sourceScenarioCandidate = documentRun.sourceScenario?.candidate || null;
                if (configGoal && sourceScenarioCandidate && semanticScenario?.scenarioKey === 'candidate_1' && !semanticScenario.overrides.length) {
                    resolvedOverrides.cableLength = sourceScenarioCandidate.normalizedValue;
                    resolvedOverrides.__sourceEvidence = { cableLength: sourceScenarioCandidate };
                }
                let coilChoiceQuestion = null;
                let packingChoiceQuestion = null;
                const coilOverride = semanticScenario?.overrides.find(item => item.field === 'coilSelection') || null;
                if (coilOverride) {
                    const coilSpan = coilOverride.sources[0];
                    const coilChoiceId = pendingKind === 'coil' ? existing.pending.questionId : null;
                    const coils = await execute({ toolName: 'search_coils', args: { spec: coilOverride.value, schemeStatus: 'official' }, argumentSources: [userSource('/spec', coilSpan), policySource('/schemeStatus')], goalKeys: configGoal ? [configGoal.goalKey] : activeGoals.map(goal => goal.goalKey) });
                    if (!coils.receipt) {
                        configGoal.state = 'FAILED'; appendBlocker(configGoal, 'FORMAL_COIL_READ_FAILED', '正式线圈目录读取未获得已验证回执。');
                    } else {
                        const coilBinding = adapter.bindSubject({ subjectKey: `coil_for_${semanticScenario.scenarioKey}`, mention: coilOverride.value, toolName: 'search_coils', receiptId: coils.receipt.receiptId, selectionBasis: 'EXACT', choiceId: coilChoiceId });
                        if (coilBinding.resolution === 'MULTIPLE') {
                            coilChoiceQuestion = questionForCandidates({ goalKeys: [configGoal.goalKey], candidates: coilBinding.candidates, prompt: `“${coilOverride.value}”有多个正式线圈方案，请选择一个。`, reasonCode: 'COIL_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                        } else if (coilBinding.resolution === 'UNIQUE' || coilBinding.resolution === 'SELECTED') {
                            resolvedOverrides.coilId = Number(coilBinding.selected.entityId);
                            resolvedOverrides.__coilSource = coilBinding.resolution === 'SELECTED' ? choiceSource : receiptSource;
                            resolvedOverrides.__coilReceipt = coils.receipt;
                            resolvedOverrides.__coilQuestionId = coilChoiceId;
                        } else {
                            configGoal.state = 'FAILED'; appendBlocker(configGoal, 'COIL_RESOLUTION_UNAVAILABLE', '正式线圈目录没有可用的唯一方案。');
                        }
                    }
                }
                const packingSelection = semanticScenario?.overrides.find(item => item.field === 'packingSelection') || null;
                const packingRemoval = semanticScenario?.overrides.find(item => item.field === 'packingRemoval') || null;
                const packingClearAll = semanticScenario?.overrides.find(item => item.field === 'packingClearAll') || null;
                const packingOverride = packingSelection || packingRemoval;
                if (packingClearAll && configGoal?.state !== 'FAILED') {
                    resolvedOverrides.packingParts = [];
                    resolvedOverrides.__packingClearAllSource = packingClearAll.sources[0];
                }
                if (packingOverride && configGoal?.state !== 'FAILED') {
                    const packingChoiceId = pendingKind === 'packing' ? existing.pending.questionId : null;
                    const parts = await execute({ toolName: 'search_parts', args: { keyword: packingOverride.value, category: '包装' }, argumentSources: [
                        userSource('/keyword', packingOverride.sources[0]), policySource('/category', 'PACKING_CATEGORY_FORMAL_FILTER_V1'),
                    ], goalKeys: [configGoal.goalKey] });
                    if (!parts.receipt) {
                        configGoal.state = 'FAILED'; appendBlocker(configGoal, 'PACKING_RESOLUTION_UNAVAILABLE', '正式包装目录读取未获得已验证回执。');
                    } else {
                        const packingBinding = adapter.bindSubject({ subjectKey: `packing_for_${semanticScenario.scenarioKey}`, mention: packingOverride.value, toolName: 'search_parts', receiptId: parts.receipt.receiptId, selectionBasis: 'EXACT', choiceId: packingChoiceId });
                        if (packingBinding.resolution === 'MULTIPLE') {
                            packingChoiceQuestion = questionForCandidates({ goalKeys: [configGoal.goalKey], candidates: packingBinding.candidates, prompt: `“${packingOverride.value}”匹配多个正式包装零件，请选择一个。`, reasonCode: 'PACKING_AMBIGUOUS', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                        } else if (packingBinding.resolution === 'UNIQUE' || packingBinding.resolution === 'SELECTED') {
                            const pointers = findPartCandidatePointers(parts.receipt, packingBinding.selected);
                            const formalPart = {
                                model: readJsonPointer(parts.receipt.result, pointers.model.replace('/result', '')),
                                supplier: readJsonPointer(parts.receipt.result, pointers.supplier.replace('/result', '')),
                            };
                            resolvedOverrides.packingParts = [{
                                partId: Number(packingBinding.selected.entityId), model: formalPart.model,
                                supplier: formalPart.supplier, qty: packingRemoval ? 0 : 1,
                                packingRole: inferPackagingSemantics(formalPart).packingRole,
                            }];
                            resolvedOverrides.__packingReceipt = parts.receipt;
                            resolvedOverrides.__packingPointers = pointers;
                            resolvedOverrides.__packingQuestionId = packingChoiceId;
                        } else {
                            configGoal.state = 'FAILED'; appendBlocker(configGoal, 'PACKING_RESOLUTION_UNAVAILABLE', '包装目录没有可用的唯一正式候选。');
                        }
                    }
                }
                if (coilChoiceQuestion || packingChoiceQuestion) {
                    const question = coilChoiceQuestion || packingChoiceQuestion;
                    configGoal.scenarioKeys = [];
                    task.questions.push(question);
                    const isCoil = Boolean(coilChoiceQuestion);
                    configGoal.state = 'NEEDS_INPUT'; appendBlocker(configGoal, isCoil ? 'COIL_AMBIGUOUS' : 'PACKING_AMBIGUOUS', isCoil ? '需要选择正式线圈方案。' : '需要选择正式包装零件。', question.questionId);
                    task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
                    sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(allReceipts), pending: { kind: isCoil ? 'coil' : 'packing', questionId: question.questionId } });
                    validateTaskEnvelopeV2(task, { trustedReceiptsById: allReceipts, sourceMessages });
                    return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: task.budgetUsage.toolCalls }, allReceipts, sourceMessages);
                }
                if (configGoal && configGoal.state !== 'FAILED') {
                    for (const override of semanticScenario?.overrides || []) if (!['coilSelection', 'packingSelection', 'packingRemoval', 'packingClearAll'].includes(override.field)) resolvedOverrides[override.field] = override.value;
                    const scenarioKey = pendingKind === 'coil' ? `${semanticScenario.scenarioKey}_selected` : semanticScenario.scenarioKey;
                    configGoal.scenarioKeys = [scenarioKey];
                    const args = { recipeId: Number(selectedRecipe.entityId), version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey, label: semanticScenario.label, overrides: Object.fromEntries(Object.entries(resolvedOverrides).filter(([key]) => !key.startsWith('__'))) }] };
                    const argumentSources = [receiptSource('/recipeId', recipeSearch.receipt.receiptId, findCandidatePointer(recipeSearch.receipt, selectedRecipe)), policySource('/version'), policySource('/baselinePolicy'), policySource('/scenarios/0/scenarioKey'), policySource('/scenarios/0/label')];
                    for (const [field, value] of Object.entries(args.scenarios[0].overrides)) {
                        if (field === 'coilId') argumentSources.push(resolvedOverrides.__coilSource === choiceSource ? choiceSource(`/scenarios/0/overrides/${field}`, resolvedOverrides.__coilQuestionId) : receiptSource(`/scenarios/0/overrides/${field}`, resolvedOverrides.__coilReceipt.receiptId, findCandidatePointer(resolvedOverrides.__coilReceipt, { entityId: String(value) })));
                        else if (field === 'packingParts') {
                            const base = '/scenarios/0/overrides/packingParts';
                            if (value.length === 0) {
                                argumentSources.push(userSource(base, resolvedOverrides.__packingClearAllSource));
                            } else {
                                const pointers = resolvedOverrides.__packingPointers;
                                const receipt = resolvedOverrides.__packingReceipt;
                                const removal = Boolean(packingRemoval);
                                argumentSources.push(
                                    receiptSource(`${base}/0/partId`, receipt.receiptId, pointers.partId),
                                    receiptSource(`${base}/0/model`, receipt.receiptId, pointers.model),
                                    receiptSource(`${base}/0/supplier`, receipt.receiptId, pointers.supplier),
                                    removal ? userSource(`${base}/0/qty`, packingRemoval.sources[0]) : policySource(`${base}/0/qty`, 'PACKING_DEFAULT_QTY_ONE_V1'),
                                    policySource(`${base}/0/packingRole`, 'PACKING_ROLE_FORMAL_SEMANTICS_V1'),
                                );
                            }
                        } else if (field === 'surfaceTreatmentCost' && !semanticScenario.overrides.some(item => item.field === field)) {
                            argumentSources.push(policySource(`/scenarios/0/overrides/${field}`, value === 0 ? 'SURFACE_NONE_ZERO_COST_V1' : 'SURFACE_TREATMENT_OPTION_V1'));
                        }
                        else if (resolvedOverrides.__sourceEvidence?.[field]) {
                            argumentSources.push(sourceEvidenceSource(`/scenarios/0/overrides/${field}`, resolvedOverrides.__sourceEvidence[field]));
                        } else {
                            const original = semanticScenario.overrides.find(item => item.field === field);
                            argumentSources.push(userSource(`/scenarios/0/overrides/${field}`, original.sources[0]));
                        }
                    }
                    if (!Object.keys(args.scenarios[0].overrides).length) argumentSources.push(inheritedSource('/scenarios/0/overrides'));
                    const profitGoal = goalByKind(task, 'PROFITABILITY').find(goal => goal.state === 'PENDING') || null;
                    const profitProposal = profitGoal ? proposal.goals.find(goal => goal.goalKey === profitGoal.goalKey) : null;
                    const effectiveProfitPrice = resolvedProfitUnitPrice(profitProposal?.unitPrice, documentRun.sourceProfitUnitPrice || structuredRun.historicalProfitUnitPrice);
                    let compared;
                    try {
                        if (profitGoal && !effectiveProfitPrice) {
                            const question = questionForCandidates({ goalKeys: [profitGoal.goalKey], candidates: [], prompt: '请提供销售单价，例如“每台 340 元”。', reasonCode: 'PROFITABILITY_UNIT_PRICE_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                            task.questions.push(question); profitGoal.state = 'NEEDS_INPUT'; appendBlocker(profitGoal, 'PROFITABILITY_UNIT_PRICE_REQUIRED', '需要明确销售单价，才能进行正式毛利试算。', question.questionId);
                            compared = await execute({ toolName: 'compare_recipe_scenarios', args, argumentSources, goalKeys: [configGoal.goalKey] });
                        } else if (profitGoal) {
                            const comparisonInput = { version: args.version, baselinePolicy: args.baselinePolicy, scenarios: args.scenarios };
                            const profitArgs = profitabilityArgs({ recipeId: args.recipeId, comparisonInput, scenarioKey, unitPrice: effectiveProfitPrice.value, quantity: profitProposal.quantity?.value ?? null });
                            compared = await execute({ toolName: 'preview_profitability', args: profitArgs, argumentSources: profitabilitySources({ comparisonSources: argumentSources, recipeReceipt: recipeSearch.receipt, recipe: selectedRecipe, unitPriceSource: effectiveProfitPrice.source, quantity: profitArgs.quantity, quantitySource: profitProposal.quantity?.sources?.[0] }), goalKeys: [configGoal.goalKey, profitGoal.goalKey] });
                        } else {
                            compared = await execute({ toolName: 'compare_recipe_scenarios', args, argumentSources, goalKeys: [configGoal.goalKey] });
                        }
                    } catch (error) {
                        if (error?.code === 'SURFACE_TREATMENT_COST_REQUIRED') {
                            const question = questionForCandidates({ goalKeys: [configGoal.goalKey], candidates: [], prompt: '该表面处理方式缺少正式费用，请确认例如“5元”。', reasonCode: 'SURFACE_TREATMENT_COST_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                            task.questions.push(question); configGoal.scenarioKeys = []; configGoal.state = 'NEEDS_INPUT'; appendBlocker(configGoal, 'SURFACE_TREATMENT_COST_REQUIRED', '新表面处理方式需要明确费用。', question.questionId);
                            task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
                            sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(allReceipts), pending: { kind: 'surfaceCost', questionId: question.questionId } });
                            validateTaskEnvelopeV2(task, { trustedReceiptsById: allReceipts, sourceMessages });
                            return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: task.budgetUsage.toolCalls }, allReceipts, sourceMessages);
                        }
                        throw error;
                    }
                    if (!compared.receipt && compared.result?.code === 'SURFACE_TREATMENT_COST_REQUIRED') {
                        const question = questionForCandidates({ goalKeys: [configGoal.goalKey], candidates: [], prompt: '该表面处理方式缺少正式费用，请确认例如“5元”。', reasonCode: 'SURFACE_TREATMENT_COST_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                        task.questions.push(question); configGoal.scenarioKeys = []; configGoal.state = 'NEEDS_INPUT'; appendBlocker(configGoal, 'SURFACE_TREATMENT_COST_REQUIRED', '新表面处理方式需要明确费用。', question.questionId);
                        task.state = 'WAITING_INPUT'; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
                        sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(allReceipts), pending: { kind: 'surfaceCost', questionId: question.questionId } });
                        validateTaskEnvelopeV2(task, { trustedReceiptsById: allReceipts, sourceMessages });
                        return taskResult(task, taskDetail(task), { outcome: 'waiting_input', modelRequestCount: task.budgetUsage.modelCalls, executedTools: task.budgetUsage.toolCalls }, allReceipts, sourceMessages);
                    }
                    if (!compared.receipt) {
                        configGoal.scenarioKeys = [];
                        configGoal.state = 'FAILED';
                        appendBlocker(configGoal, 'SCENARIO_PREVIEW_UNVERIFIED', '情景预览没有已验证执行回执。');
                        // A profitability preview submitted for this candidate
                        // has the exact same formal scenario as its basis. If
                        // that scenario was rejected or could not be verified,
                        // it must not fall through to an unrelated base-cost
                        // profitability calculation later in this task.
                        if (profitGoal?.state === 'PENDING') {
                            profitGoal.state = 'PARTIAL';
                            appendBlocker(profitGoal, 'SCENARIO_CONFIGURATION_UNVERIFIED', '候选配置没有形成已验证正式情景，不能改用当前基础配置计算毛利。');
                        }
                    }
                    else {
                        // Both scenario comparison and profitability endpoints are previews.
                        // The capability identity, not a shared `preview` response flag,
                        // determines the result schema and fact projection.
                        const isProfitabilityReceipt = compared.receipt.toolName === 'preview_profitability';
                        const dataPrefix = isProfitabilityReceipt ? '/data/scenarioContext' : '/data';
                        const data = isProfitabilityReceipt ? compared.receipt.result.data.scenarioContext : compared.receipt.result.data;
                        const profitability = isProfitabilityReceipt ? compared.receipt.result.data : null;
                        const base = data?.scenarios?.[0]; const candidate = data?.scenarios?.find(item => item.scenarioKey === scenarioKey); const comparison = data?.comparisons?.find(item => item.candidateScenarioKey === scenarioKey);
                        const integratedProfitMismatch = isProfitabilityReceipt && (!profitability?.configurationHash || profitability.configurationHash !== candidate?.configurationHash);
                        if (integratedProfitMismatch) {
                            configGoal.state = 'FAILED';
                            appendBlocker(configGoal, 'INTEGRATED_SCENARIO_MISMATCH', '盈利预览与其正式情景比较没有返回相同配置标识，不能合并结论。');
                            if (profitGoal) { profitGoal.state = 'FAILED'; appendBlocker(profitGoal, 'INTEGRATED_SCENARIO_MISMATCH', '盈利预览配置标识与正式情景不一致。'); }
                        }
                        task.scenarios = [{ scenarioKey, label: semanticScenario.label, baseSubjectKey: primary.subjectKey, basis: 'CURRENT_REBUILT', priceContext: 'FORMAL_READ_SET', overrides: args.scenarios[0].overrides, readSetId: compared.receipt.readSetId }];
                        const complete = Boolean(base?.cost?.complete && candidate?.cost?.complete && Number.isFinite(base?.cost?.currentTotalCost) && Number.isFinite(candidate?.cost?.currentTotalCost));
                        if (!integratedProfitMismatch && complete && candidate.notApplied?.length === 0 && comparison?.status === 'COMPARABLE') {
                            const facts = [
                                makeFactRecordV1({ receipt: compared.receipt, pointer: `${dataPrefix}/scenarios/0/cost/currentTotalCost`, key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'recipe.current_cost', temporalScope: 'CURRENT', basis: 'CURRENT_REBUILT' }), planRevision: task.planRevision, clock }),
                                makeFactRecordV1({ receipt: compared.receipt, pointer: `${dataPrefix}/scenarios/${data.scenarios.indexOf(candidate)}/cost/currentTotalCost`, key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'scenario.cost', temporalScope: 'SCENARIO', scenarioKey, basis: 'CURRENT_REBUILT' }), planRevision: task.planRevision, clock }),
                                makeFactRecordV1({ receipt: compared.receipt, pointer: `${dataPrefix}/scenarios/${data.scenarios.indexOf(candidate)}/appliedOverrides`, key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'scenario.override_application', temporalScope: 'SCENARIO', scenarioKey, basis: 'CURRENT_REBUILT' }), planRevision: task.planRevision, clock }),
                                makeFactRecordV1({ receipt: compared.receipt, pointer: `${dataPrefix}/comparisons/${data.comparisons.indexOf(comparison)}`, key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'scenario.cost_comparison', temporalScope: 'SCENARIO', scenarioKey, basis: 'CURRENT_REBUILT' }), planRevision: task.planRevision, clock }),
                            ];
                            task.facts.push(...facts); configGoal.requirements = scenarioCompareRequirements(primary.subjectKey, scenarioKey); configGoal.factIds = facts.map(fact => fact.factId); configGoal.state = requirementsSatisfiedAtPlan(task, configGoal) ? 'VERIFIED' : 'PARTIAL';
                            // A profitability receipt contains the same formal base
                            // scenario comparison.  Reuse that exact current-cost
                            // fact instead of issuing a third scenario preview.
                            const currentGoal = goalByKind(task, 'CURRENT_COST').find(goal => goal.state === 'PENDING');
                            if (currentGoal) {
                                const currentFact = facts[0];
                                currentGoal.requirements = [recipeCurrentCostRequirement(primary.subjectKey)];
                                currentGoal.factIds = [currentFact.factId];
                                currentGoal.state = requirementsSatisfiedAtPlan(task, currentGoal) ? 'VERIFIED' : 'PARTIAL';
                                if (currentGoal.state !== 'VERIFIED') appendBlocker(currentGoal, 'COST_PREVIEW_INCOMPLETE', '正式成本预览不完整，不能确认整机成本。');
                            }
                            // Readiness depends on the formal scenario identity and
                            // applied configuration, not on every cost component
                            // having a price.  Preserve the same candidate context
                            // for an independent inventory preview when cost is
                            // incomplete, while leaving the cost/profit goals
                            // partial.
                            if (candidate?.configurationHash && candidate.notApplied?.length === 0 && !integratedProfitMismatch) readinessScenarioContext = {
                                comparisonInput: { version: args.version, baselinePolicy: args.baselinePolicy, scenarios: args.scenarios },
                                comparisonSources: argumentSources, scenarioKey, configurationHash: candidate.configurationHash,
                            };
                            if (isProfitabilityReceipt && profitGoal) {
                                const profitFact = makeFactRecordV1({ receipt: compared.receipt, pointer: '/data', key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'profitability.preview', temporalScope: 'SCENARIO', scenarioKey, basis: 'CURRENT_REBUILT', unit: 'pump', currency: 'CNY' }), complete: profitability.costComplete === true, planRevision: task.planRevision, clock });
                                task.facts.push(profitFact); profitGoal.requirements = [profitabilityRequirement(primary.subjectKey, scenarioKey)]; profitGoal.factIds = [profitFact.factId, ...(effectiveProfitPrice.historicalPriceFactId ? [effectiveProfitPrice.historicalPriceFactId] : [])]; profitGoal.state = requirementsSatisfiedAtPlan(task, profitGoal) ? 'VERIFIED' : 'PARTIAL';
                                if (profitGoal.state !== 'VERIFIED') appendBlocker(profitGoal, 'COST_PREVIEW_INCOMPLETE', '正式成本不完整，不能确认毛利。');
                            }
                        } else if (!integratedProfitMismatch) {
                            if (candidate?.configurationHash && candidate.notApplied?.length === 0) readinessScenarioContext = {
                                comparisonInput: { version: args.version, baselinePolicy: args.baselinePolicy, scenarios: args.scenarios },
                                comparisonSources: argumentSources, scenarioKey, configurationHash: candidate.configurationHash,
                            };
                            configGoal.state = 'PARTIAL'; appendBlocker(configGoal, comparison?.status === 'OVERRIDE_NOT_APPLIED' ? 'OVERRIDE_NOT_APPLIED' : 'COST_PREVIEW_INCOMPLETE', '情景成本未形成可比较的完整正式事实。');
                        }
                    }
                }
                for (const readinessGoal of goalByKind(task, 'INVENTORY_QUERY').filter(goal => goal.state === 'PENDING' && isVirtualReadinessGoal(goal, proposal, task.userGoal))) {
                    const readinessProposal = proposal.goals.find(goal => goal.goalKey === readinessGoal.goalKey);
                    const quantity = readinessProposal?.quantity;
                    if (!Number.isSafeInteger(quantity?.value) || quantity.value < 1) {
                        readinessGoal.state = 'NEEDS_INPUT';
                        appendBlocker(readinessGoal, 'VIRTUAL_READINESS_QUANTITY_REQUIRED', '需要明确虚拟需求数量，不能默认数量。');
                        continue;
                    }
                    if (semanticScenario && !readinessScenarioContext) {
                        readinessGoal.state = 'PARTIAL';
                        appendBlocker(readinessGoal, 'SCENARIO_CONFIGURATION_UNVERIFIED', '候选配置没有形成完整正式情景，不能用于虚拟齐料预览。');
                        continue;
                    }
                    const context = readinessScenarioContext || {
                        comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] },
                        comparisonSources: [], scenarioKey: 'base', configurationHash: null,
                    };
                    const readinessArgs = virtualReadinessArgs({ recipeId: Number(selectedRecipe.entityId), comparisonInput: context.comparisonInput, scenarioKey: context.scenarioKey, quantity: quantity.value });
                    const preview = await execute({ toolName: 'preview_virtual_readiness', args: readinessArgs, argumentSources: virtualReadinessSources({ recipeReceipt: recipeSearch.receipt, recipe: selectedRecipe, comparisonSources: context.comparisonSources, quantitySource: quantity.sources?.[0] }), goalKeys: [readinessGoal.goalKey] });
                    const result = preview.receipt?.result?.data;
                    if (!preview.receipt || result?.preview !== true) {
                        readinessGoal.state = 'PARTIAL';
                        appendBlocker(readinessGoal, 'VIRTUAL_READINESS_PREVIEW_UNVERIFIED', '正式虚拟齐料预览没有获得已验证执行回执。');
                        continue;
                    }
                    if (context.configurationHash !== null && result.configurationHash !== context.configurationHash) {
                        readinessGoal.state = 'FAILED';
                        appendBlocker(readinessGoal, 'INTEGRATED_SCENARIO_MISMATCH', '成本情景与库存齐料预览使用了不同配置，不能合并结论。');
                        continue;
                    }
                    const complete = result.coverage?.complete === true && ['READY', 'SHORTAGE'].includes(result.status);
                    const fact = makeFactRecordV1({ receipt: preview.receipt, pointer: '/data', key: makeFactKey({
                        entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'inventory.virtual_readiness',
                        temporalScope: context.scenarioKey === 'base' ? 'CURRENT' : 'SCENARIO', scenarioKey: context.scenarioKey === 'base' ? null : context.scenarioKey,
                        basis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', unit: 'pump', currency: null,
                    }), complete, planRevision: task.planRevision, clock });
                    task.facts.push(fact);
                    readinessGoal.requirements = [virtualReadinessRequirement(primary.subjectKey, context.scenarioKey === 'base' ? null : context.scenarioKey)];
                    readinessGoal.factIds = [fact.factId];
                    readinessGoal.state = requirementsSatisfiedAtPlan(task, readinessGoal) ? 'VERIFIED' : 'PARTIAL';
                    if (readinessGoal.state !== 'VERIFIED') appendBlocker(readinessGoal, result.status === 'INCOMPLETE' ? 'VIRTUAL_READINESS_INCOMPLETE' : 'VIRTUAL_READINESS_FACTS_INCOMPLETE', '正式库存齐料预览未形成完整结论。');
                }
                const completedCompare = configGoal?.state === 'VERIFIED' ? configGoal : null;
                for (const prepareGoal of goalByKind(task, 'PREPARE_CHANGE')) if (prepareGoal.state === 'PENDING' && completedCompare) {
                    // PREPARE_CHANGE is a read-only preview in N3.1.  It can
                    // reuse the just-verified comparison facts, but never
                    // creates an operation, approval, or persisted change.
                    prepareGoal.scenarioKeys = [...completedCompare.scenarioKeys];
                    prepareGoal.requirements = clone(completedCompare.requirements);
                    prepareGoal.factIds = [...completedCompare.factIds];
                    prepareGoal.state = requirementsSatisfiedAtPlan(task, prepareGoal) ? 'VERIFIED' : 'PARTIAL';
                }
                for (const profitGoal of goalByKind(task, 'PROFITABILITY')) if (profitGoal.state === 'PENDING') {
                    const proposalProfit = proposal.goals.find(goal => goal.goalKey === profitGoal.goalKey);
                    const effectiveProfitPrice = resolvedProfitUnitPrice(proposalProfit?.unitPrice, documentRun.sourceProfitUnitPrice || structuredRun.historicalProfitUnitPrice);
                    if (!effectiveProfitPrice) {
                        const question = questionForCandidates({ goalKeys: [profitGoal.goalKey], candidates: [], prompt: '请提供销售单价，例如“每台 340 元”。', reasonCode: 'PROFITABILITY_UNIT_PRICE_REQUIRED', planRevision: task.planRevision, clock, ttlMs: sessionStore.ttlMs });
                        task.questions.push(question); profitGoal.state = 'NEEDS_INPUT'; appendBlocker(profitGoal, 'PROFITABILITY_UNIT_PRICE_REQUIRED', '需要明确销售单价，才能进行正式毛利试算。', question.questionId); continue;
                    }
                    const scenarioKey = 'base';
                    const comparisonInput = { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'profitability_check', label: '当前正式配置盈利复核', overrides: {} }] };
                    const comparisonSources = [
                        receiptSource('/recipeId', recipeSearch.receipt.receiptId, findCandidatePointer(recipeSearch.receipt, selectedRecipe)), policySource('/version'), policySource('/baselinePolicy'), policySource('/scenarios/0/scenarioKey'), policySource('/scenarios/0/label'), inheritedSource('/scenarios/0/overrides'),
                    ];
                    const profitArgs = profitabilityArgs({ recipeId: Number(selectedRecipe.entityId), comparisonInput, scenarioKey, unitPrice: effectiveProfitPrice.value, quantity: proposalProfit.quantity?.value ?? null });
                    const preview = await execute({ toolName: 'preview_profitability', args: profitArgs, argumentSources: profitabilitySources({ comparisonSources, recipeReceipt: recipeSearch.receipt, recipe: selectedRecipe, unitPriceSource: effectiveProfitPrice.source, quantity: profitArgs.quantity, quantitySource: proposalProfit.quantity?.sources?.[0] }), goalKeys: [profitGoal.goalKey] });
                    const result = preview.receipt?.result?.data;
                    if (preview.receipt && result?.preview === true) {
                        const profitFact = makeFactRecordV1({ receipt: preview.receipt, pointer: '/data', key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'profitability.preview', temporalScope: 'CURRENT', basis: 'CURRENT_REBUILT', unit: 'pump', currency: 'CNY' }), complete: result.costComplete === true, planRevision: task.planRevision, clock });
                        task.facts.push(profitFact); profitGoal.requirements = [profitabilityRequirement(primary.subjectKey)]; profitGoal.factIds = [profitFact.factId, ...(effectiveProfitPrice.historicalPriceFactId ? [effectiveProfitPrice.historicalPriceFactId] : [])]; profitGoal.state = requirementsSatisfiedAtPlan(task, profitGoal) ? 'VERIFIED' : 'PARTIAL';
                        if (profitGoal.state !== 'VERIFIED') appendBlocker(profitGoal, 'COST_PREVIEW_INCOMPLETE', '正式成本不完整，不能确认毛利。');
                        reuseProfitabilityBaseCost({ task, primary, selectedRecipe, receipt: preview.receipt, profitability: result, planRevision: task.planRevision, clock });
                    } else { profitGoal.state = 'PARTIAL'; appendBlocker(profitGoal, 'PROFITABILITY_PREVIEW_UNVERIFIED', '正式盈利试算没有已验证执行回执。'); }
                }
                for (const currentGoal of goalByKind(task, 'CURRENT_COST')) if (currentGoal.state === 'PENDING') {
                    // Use the N2.2 same-read-set preview for current cost as
                    // well.  The legacy current-cost list endpoint is not a
                    // receipt-grade task primitive and cannot prove a full
                    // cost result with the V2 comparison contract.
                    const currentScenarioKey = 'current_check';
                    const args = { recipeId: Number(selectedRecipe.entityId), version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: currentScenarioKey, label: '当前正式配置复核', overrides: {} }] };
                    const preview = await execute({ toolName: 'compare_recipe_scenarios', args, argumentSources: [
                        receiptSource('/recipeId', recipeSearch.receipt.receiptId, findCandidatePointer(recipeSearch.receipt, selectedRecipe)), policySource('/version'), policySource('/baselinePolicy'), policySource('/scenarios/0/scenarioKey'), policySource('/scenarios/0/label'), inheritedSource('/scenarios/0/overrides'),
                    ], goalKeys: [currentGoal.goalKey] });
                    const value = preview.receipt ? preview.receipt.result?.data?.scenarios?.[0]?.cost?.currentTotalCost : null;
                    if (preview.receipt && Number.isFinite(value) && preview.receipt.result?.data?.scenarios?.[0]?.cost?.complete === true) {
                        const fact = makeFactRecordV1({ receipt: preview.receipt, pointer: '/data/scenarios/0/cost/currentTotalCost', key: makeFactKey({ entityType: 'recipe', entityId: selectedRecipe.entityId, predicate: 'recipe.current_cost', temporalScope: 'CURRENT', basis: 'CURRENT_REBUILT' }), planRevision: task.planRevision, clock });
                        task.facts.push(fact); currentGoal.requirements = [recipeCurrentCostRequirement(primary.subjectKey)]; currentGoal.factIds = [fact.factId]; currentGoal.state = requirementsSatisfiedAtPlan(task, currentGoal) ? 'VERIFIED' : 'PARTIAL';
                    } else { currentGoal.state = 'PARTIAL'; appendBlocker(currentGoal, 'COST_PREVIEW_INCOMPLETE', '正式成本预览不完整，不能确认整机成本。'); }
                }
            }
        }
    }
    }
    task.state = 'VERIFYING'; task.revision += 1;
    task.state = terminalTaskState(task); task.revision += 1; task.updatedAt = iso(clock); task.budgetUsage.activeMs = Date.now() - started;
    if (task.budgetUsage.activeMs > task.constraints.maxActiveMs) throw Object.assign(new Error('TASK_V2_ACTIVE_BUDGET_EXCEEDED'), { code: 'TASK_V2_ACTIVE_BUDGET_EXCEEDED' });
    // recoveryPlan is a storage-only projection; it is deliberately not part
    // of the public TaskEnvelopeV2 contract.
    delete task.recoveryPlan;
    validateTaskEnvelopeV2(task, { trustedReceiptsById: allReceipts, sourceMessages });
    if (task.state === 'WAITING_INPUT') sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, task, proposal, sourceMessages: Object.fromEntries(sourceMessages), trustedReceipts: Object.fromEntries(allReceipts), pending: documentRun.pending || structuredRun.pending || (task.questions.find(item => item.reasonCode === 'VIRTUAL_READINESS_QUANTITY_REQUIRED' && item.answeredAt === null) ? { kind: 'virtualReadinessQuantity', questionId: task.questions.find(item => item.reasonCode === 'VIRTUAL_READINESS_QUANTITY_REQUIRED' && item.answeredAt === null).questionId } : null) || (task.questions.find(item => item.reasonCode === 'PROFITABILITY_UNIT_PRICE_REQUIRED' && item.answeredAt === null) ? { kind: 'profitPrice', questionId: task.questions.find(item => item.reasonCode === 'PROFITABILITY_UNIT_PRICE_REQUIRED' && item.answeredAt === null).questionId } : null) || (task.questions.find(item => item.reasonCode === 'CONTINUATION_FOCUS_AMBIGUOUS' && item.answeredAt === null) ? { kind: 'continuationFocus', questionId: task.questions.find(item => item.reasonCode === 'CONTINUATION_FOCUS_AMBIGUOUS' && item.answeredAt === null).questionId } : null) || existing?.pending || null });
    // E2-R1 §B2：成功任务只保留**最小**续接上下文（canonical 主体身份），绝不保存旧事实。
    else {
        // §B2：成功任务刷新最小续接上下文；**未成功**的一轮不得抹掉上一轮已建立的焦点
        // （否则一次「先查12-140」失败就会让「这个」失去唯一身份）。上下文永远只有身份，没有事实。
        const continuation = continuationFromTask(task, clock, existing?.continuation || null) || existing?.continuation || null;
        if (continuation) sessionStore.set(ownerKey, conversationId, { ownerKey, conversationId, continuation }); else sessionStore.remove(ownerKey, conversationId);
    }
    // This optional server-side observer is an adapter seam for persistence
    // tests and later N5 wiring. It is not a model tool and leaves the
    // foreground controller's default in-memory behavior unchanged.
    if (typeof dependencies.onValidatedTask === 'function') {
        await dependencies.onValidatedTask({
            task: clone(task),
            trustedReceipts: new Map(allReceipts),
            sourceMessages: new Map(sourceMessages),
            iterationActiveMs: Date.now() - started,
        });
    }
    return taskResult(task, taskDetail(task), { outcome: task.state.toLowerCase(), modelRequestCount: task.budgetUsage.modelCalls, executedTools: task.budgetUsage.toolCalls, provider: semantics.telemetry.provider, model: semantics.telemetry.model }, allReceipts, sourceMessages);
}

module.exports = { createEnvelope, prepareDetachedTaskV2, publicTask, requirementsSatisfiedAtPlan, runAiTaskControllerV2, runDocumentGoalsV2, CLARIFICATION_ACTION, classifyClarificationReply, parseChoice, choosePendingSession };
