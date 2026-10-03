'use strict';

// Isolated Phase D1 candidate. It deliberately has no production route or
// runtime import: tool discovery comes from the Phase B index, schemas from
// the Phase C request-scoped loader, and execution remains the existing
// read/preview Agent Tool + Executor path.
const crypto = require('node:crypto');
const { fetchAiProvider, decodeAiProviderResponse } = require('../../../api/services/aiProvider.cjs');
const { resolveProviderConfig } = require('../../../api/services/aiProviderRegistry.cjs');
const { validateAiToolArgs } = require('../../../api/services/aiToolInputValidator.cjs');
const { executeAgentTool } = require('../../../api/services/ai-assistant/agentTools.cjs');
const { RESOLVE_ENTITY_TOOL, boundToolDefinition } = require('../../../api/services/ai-assistant/capabilityBroker.cjs');
const { createFactLedger, modelProjection } = require('../../../api/services/ai-assistant/factLedger.cjs');
const { validateAnswer } = require('../../../api/services/ai-assistant/answerValidator.cjs');
const { formalToolFailure } = require('../../../api/services/aiFormalToolError.cjs');
const { buildApiIndex, renderApiIndexForModel } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const { LOAD_TOOLS_TOOL, createToolSchemaSession } = require('../../../api/services/ai-assistant/toolSchemaLoader.cjs');
const { ontology } = require('../../../api/ontology/contract.cjs');

const MAX_MAIN_MODEL_CALLS = 10;
const MAX_BUSINESS_TOOL_CALLS = 8;
const MAX_LOAD_TOOLS_CALLS = 4;
const MAX_RESOLVE_CALLS = 6;
const MAX_RUNTIME_MS = 120_000;
const MAX_CURRENT_TOOL_RESULT_CHARS = 16 * 1024;
const MAX_HISTORICAL_TOOL_RESULT_CHARS = 900;
const MAX_FINALIZATION_MODEL_CALLS = 2;

class CandidateAgentError extends Error {
    constructor(code, message) { super(message); this.name = 'CandidateAgentError'; this.code = code; }
}

function estimateTokens(value) { return Math.ceil(Buffer.byteLength(String(value || ''), 'utf8') / 4); }
function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function businessEvidenceFingerprint(result) {
    const omit = new Set(['fetchedAt', 'executionEvidence', 'apiTrace', 'operationId', 'requestId', 'traceId']);
    const normalize = value => {
        if (Array.isArray(value)) return value.map(normalize);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !omit.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
    };
    return crypto.createHash('sha256').update(stableJson(normalize(result?.data ?? result))).digest('hex');
}
function callKey(name, args) { return `${name}:${stableJson(args)}`; }
function boundedRecentConversation(recentConversation) {
    return (Array.isArray(recentConversation) ? recentConversation : []).filter(item => item && ['user', 'assistant'].includes(item.role))
        .slice(-4).map(item => ({ role: item.role, content: String(item.content || '').slice(0, 2_000) }));
}

function buildOntologyContext(contract = ontology) {
    const entityTypes = (contract.entities || []).map(item => item.type).sort();
    const relations = (contract.relations || []).filter(item => item.authority === 'FORMAL').map(item => item.relationId).sort();
    return [
        'Formal ontology context (structure only, not live facts):',
        `- Entity types: ${entityTypes.join(', ') || 'none'}.`,
        '- Canonical identity is a positive formal DB identifier returned by a formal resource receipt; names alone are not identity and fuzzy identity is not allowed.',
        '- Multiple candidates must not be silently selected. Resolve a formal identity before using identity-protected tool arguments.',
        `- Important formal relationships: ${relations.join(', ') || 'none'}.`,
        '- Ontology is not a source for current cost, inventory, price, order status, or any other live business value.',
    ].join('\n');
}

function candidateSystemPrompt({ businessMemo, policyMemo, ontologyContext, apiIndex }) {
    return [
        'You are an autonomous business investigation agent for a pump factory. Answer the owner in Chinese using formal tool evidence only.',
        'The raw owner input is the primary task source. Business Memo explains business terminology. Policy Memo explains handling, preview, and persistence boundaries. Ontology explains identity and relationships. The API Index is discovery only, not a router.',
        'Initially you only have load_tools and resolve_entity. Before calling an indexed business tool, load its schema with load_tools. Choose tools and order yourself; do not assume an ID, money amount, inventory, relationship, or current configuration.',
        'If a formal result is ambiguous, not found, unsupported, or incomplete, investigate safely when useful or ask for clarification. Never silently choose a candidate. Never call a write tool or claim a write happened.',
        'After every formal result, decide yourself whether more investigation is needed. A formal count can answer a count question even if item detail projection is truncated. Projection truncation is not the same as an incomplete formal business query. If a result says NO_NEW_EVIDENCE or INVESTIGATION_NO_PROGRESS, use existing evidence, choose another capability, or clarify; do not repeatedly vary arbitrary filters. Stop once formal evidence is sufficient.',
        'When ready, return JSON only: {"answer":"Chinese answer","claims":[{"text":"exact assertion in answer","factIds":["F-001"]}],"goals":[{"questionIndex":0,"status":"COMPLETED|PARTIAL|UNAVAILABLE|CLARIFICATION","factIds":["F-001"]}]}. Every factual assertion needs cited fact IDs. A clarification/unavailable answer may use an empty factIds array. Never show IDs, tool names, API paths, tokens, or internal JSON to the owner.',
        '', 'FULL BUSINESS MEMO:', businessMemo || 'No business memo was supplied.',
        '', 'FULL POLICY MEMO:', policyMemo || 'No policy memo was supplied.',
        '', ontologyContext,
        '', 'LIGHTWEIGHT API INDEX:', apiIndex,
    ].join('\n');
}

async function defaultModelCall(messages, options = {}) {
    const config = resolveProviderConfig('deepseek', options.env || process.env);
    if (!config.apiKey) throw new CandidateAgentError('DEEPSEEK_NOT_CONFIGURED', 'DeepSeek is not configured for the candidate.');
    const response = await fetchAiProvider(messages, { config, env: options.env, tools: options.tools || [], stream: false, signal: options.signal, timeoutMs: options.timeoutMs || MAX_RUNTIME_MS });
    const payload = await decodeAiProviderResponse(response);
    const message = payload?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') throw new CandidateAgentError('MODEL_RESPONSE_INVALID', 'Candidate model response has no message.');
    return message;
}

function toolCallsFrom(message) {
    if (!Array.isArray(message?.tool_calls)) return [];
    return message.tool_calls.map(call => {
        const name = String(call?.function?.name || '').trim();
        if (!name || typeof call?.function?.arguments !== 'string') throw new CandidateAgentError('MODEL_TOOL_CALL_INVALID', 'Tool call format is invalid.');
        let args;
        try { args = JSON.parse(call.function.arguments); } catch { throw new CandidateAgentError('MODEL_TOOL_CALL_INVALID', 'Tool arguments are not JSON.'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new CandidateAgentError('MODEL_TOOL_CALL_INVALID', 'Tool arguments must be an object.');
        return Object.freeze({ id: String(call.id || `call-${name}`), name, args });
    });
}
function assistantToolMessage(message, calls) {
    return { role: 'assistant', content: typeof message.content === 'string' ? message.content : '', tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) };
}
function failure(name, code, details) {
    return Object.freeze({ success: false, agentToolName: name, code, category: 'SAFETY_OR_VALIDATION', recoverable: true, ...(details ? { details } : {}) });
}
function runtimeToolDefinitions(session) {
    return Object.freeze([
        LOAD_TOOLS_TOOL,
        RESOLVE_ENTITY_TOOL,
        ...session.loadedToolNames().map(name => boundToolDefinition(name) || session.loadedDefinitions().find(item => item.function.name === name)).filter(Boolean),
    ]);
}
function finalFallback(ledger, status = 'UNAVAILABLE') {
    const snapshot = ledger.snapshot(); const facts = snapshot.facts.filter(item => item.verified);
    const factIds = facts.filter(item => item.predicate !== 'identity_resolved').slice(0, 2).map(item => item.factId);
    const answer = factIds.length ? '已取得部分正式结果，但不足以可靠完成全部请求；请补充对象或范围。' : '当前没有足够的正式业务事实完成该请求；请补充对象或范围。';
    return JSON.stringify({ answer, claims: factIds.length ? [{ text: answer, factIds }] : [], goals: [{ questionIndex: 0, status, factIds }] });
}
function compactValue(value, depth = 0) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.length <= 800 ? value : `${value.slice(0, 800)}…`;
    if (depth >= 3) return '[candidate context detail truncated]';
    if (Array.isArray(value)) {
        const returned = value.slice(0, 8).map(item => compactValue(item, depth + 1));
        return value.length <= returned.length ? returned : { items: returned, totalCount: value.length, returnedCount: returned.length, hasMore: true, complete: false };
    }
    if (typeof value !== 'object') return String(value);
    const entries = Object.entries(value).slice(0, 18).map(([key, item]) => [key, compactValue(item, depth + 1)]);
    const output = Object.fromEntries(entries);
    if (Object.keys(value).length > entries.length) output._candidateContextTruncated = true;
    return output;
}
function candidateToolProjection(result, factIds) {
    const projected = modelProjection(result, factIds);
    const serialized = JSON.stringify(projected);
    if (serialized.length <= MAX_CURRENT_TOOL_RESULT_CHARS) return projected;
    return {
        success: projected.success, agentToolName: projected.agentToolName, verified: projected.verified,
        code: projected.code || null, category: projected.category || null, recoverable: projected.recoverable === true,
        data: compactValue(projected.data), factRefs: projected.factRefs,
        projection: { ...(projected.projection || {}), truncated: true, candidateContextTruncated: true,
            reason: 'CANDIDATE_TOOL_RESULT_CONTEXT_LIMIT', maxChars: MAX_CURRENT_TOOL_RESULT_CHARS },
    };
}
function renderClaimableFactsForModel(ledgerOrSnapshot) {
    const facts = Array.isArray(ledgerOrSnapshot?.facts) ? ledgerOrSnapshot.facts : [];
    const seen = new Set();
    const entries = [];
    for (const fact of facts) {
        if (!fact?.verified) continue;
        // Generic deep field observations stay in the ledger for audit.  Only
        // identity, relation and scalar-bearing paths are claimable; exposing
        // every nested display field turns one detailed object into hundreds
        // of finalization choices without adding evidence.
        const fieldPath = String(fact.predicate || '').replace(/^formal_field:/, '').split('.').at(-1).replace(/\[\d+\]/g, '');
        if (String(fact.predicate || '').startsWith('formal_field:')
            && !/^(?:id|name|recipeName|coilId|schemeCode|schemeName|spec|sheets|currentTotalCost|totalCost|costDifference|costBasis|complete|totalCount|count)$/i.test(fieldPath)) continue;
        const entity = fact.entity ? `${fact.entity.type}/${fact.entity.canonicalName || fact.entity.id}` : 'none';
        const scenario = fact.qualifiers?.scenario || fact.qualifiers?.scenarioKey || null;
        const key = stableJson([entity, fact.predicate, fact.value, fact.unit, fact.basis, scenario, fact.source?.tool]);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ factId: fact.factId, entity: fact.entity ? { type: fact.entity.type, canonicalName: fact.entity.canonicalName, id: fact.entity.id } : null,
            predicate: fact.predicate, value: fact.value, unit: fact.unit, basis: fact.basis,
            qualifiers: fact.qualifiers || null, sourceTool: fact.source?.tool || null });
    }
    return Object.freeze(entries);
}
function compactHistoricalToolMessages(messages) {
    const toolIndexes = messages.map((message, index) => message.role === 'tool' ? index : -1).filter(index => index >= 0);
    // Keep the newest formal result at the Phase-A projection budget.  Older
    // results retain their semantic receipts and fact references but are
    // compacted before another model call, otherwise several individually
    // safe 16KB projections can exceed the provider context together.
    for (const index of toolIndexes.slice(0, -1)) {
        const message = messages[index];
        if (String(message.content || '').length <= MAX_HISTORICAL_TOOL_RESULT_CHARS) continue;
        let prior = {}; try { prior = JSON.parse(message.content); } catch { /* safe replacement below */ }
        messages[index] = { ...message, content: JSON.stringify({
            controlPlane: prior.controlPlane === true,
            historyCompacted: true,
            success: prior.success === true,
            toolName: message.name || prior.agentToolName || null,
            code: prior.code || null,
            data: compactValue(prior.data),
            factRefs: Array.isArray(prior.factRefs) ? prior.factRefs : [],
            formalBusinessCompleteness: prior.data?.complete === true || prior.data?.queryReceipt?.truncated === false
                ? true : prior.data?.complete === false ? false : null,
            projection: { ...(prior.projection || {}), truncated: true, reason: 'CANDIDATE_HISTORICAL_TOOL_CONTEXT_COMPACTION', complete: false },
        }) };
    }
}

async function runApiNativeAgentCandidate(input = {}, dependencies = {}) {
    const rawOwnerInput = String(input.rawOwnerInput || '').trim();
    if (!rawOwnerInput) throw new CandidateAgentError('CANDIDATE_INPUT_INVALID', 'rawOwnerInput is required.');
    const apiIndex = dependencies.apiIndex || buildApiIndex();
    const apiIndexText = dependencies.apiIndexText || renderApiIndexForModel(apiIndex);
    const ontologyContext = dependencies.ontologyContext || buildOntologyContext();
    const session = dependencies.session || createToolSchemaSession({ index: apiIndex, indexFactory: dependencies.indexFactory || buildApiIndex });
    const runModel = dependencies.modelCall || defaultModelCall;
    const runTool = dependencies.executeAgentTool || executeAgentTool;
    // Candidate-only projection asks the shared ledger to retain formal
    // scenario basis/delta facts. Default production callers retain their
    // existing ledger behavior unchanged.
    const ledger = dependencies.factLedger || createFactLedger({ includeScenarioComparisonFacts: true });
    const validator = dependencies.validateAnswer || validateAnswer;
    const maxMainModelCalls = Number.isSafeInteger(input.maxMainModelCalls)
        ? Math.max(1, Math.min(input.maxMainModelCalls, MAX_MAIN_MODEL_CALLS))
        : MAX_MAIN_MODEL_CALLS;
    const finalizationEnabled = input.finalizationEnabled !== false;
    const startedAt = Date.now();
    const messages = [
        { role: 'system', content: candidateSystemPrompt({ businessMemo: input.businessMemo, policyMemo: input.policyMemo, ontologyContext, apiIndex: apiIndexText }) },
        ...boundedRecentConversation(input.recentConversation),
        { role: 'user', content: rawOwnerInput },
    ];
    const toolResults = []; const traces = []; const finalizationAttempts = []; const successfulCalls = new Set(); const formalEvidence = new Set();
    const context = { selectedToolNames: new Set(), entityBindings: new Map(), resolvedRecipeIds: new Set(), resolvedRecipeBindings: new Map(), resolvedCoilBindings: new Map(), resolvedPartBindings: new Map(), ambiguousCoilKeys: new Set(), signal: input.signal };
    let mainModelCalls = 0; let loadToolsCalls = 0; let resolveCalls = 0; let businessToolCalls = 0;
    let secondDecisionAfterResult = false; let resultReturnedToAgent = false; let noNewEvidenceEvents = 0; let duplicateFactsAvoided = 0; let consecutiveNoNewEvidence = 0; let noProgressEvents = 0;

    function metrics() {
        return Object.freeze({ mainModelCalls, loadToolsCalls, resolveCalls, businessToolCalls, noNewEvidenceEvents, duplicateFactsAvoided, noProgressEvents, loadedToolNames: session.loadedToolNames(), apiIndexFingerprint: apiIndex.fingerprint, loadedSchemaFingerprint: session.snapshot().schemaFingerprint });
    }
    function appendToolMessage(call, result, appendFacts = true) {
        let factIds = [];
        let noNewEvidence = false;
        if (appendFacts && result?.success === true && result?.verified === true) {
            const fingerprint = businessEvidenceFingerprint(result);
            noNewEvidence = formalEvidence.has(fingerprint);
            formalEvidence.add(fingerprint);
            if (noNewEvidence) { noNewEvidenceEvents += 1; duplicateFactsAvoided += 1; consecutiveNoNewEvidence += 1; }
            else consecutiveNoNewEvidence = 0;
        }
        if (appendFacts && !noNewEvidence) factIds = ledger.appendToolResult({ toolName: call.name, args: call.args, result, entityBindings: context.entityBindings }).factIds;
        const noProgress = noNewEvidence && consecutiveNoNewEvidence >= 2;
        if (noProgress) noProgressEvents += 1;
        const projection = appendFacts ? { ...candidateToolProjection(result, factIds), ...(noNewEvidence ? { control: { code: noProgress ? 'INVESTIGATION_NO_PROGRESS' : 'NO_NEW_EVIDENCE', message: noProgress ? '连续正式查询未增加业务证据；请使用已有证据、换能力或澄清，不要继续重复同一路径。' : '本次正式结果没有增加新的业务证据；请使用已有证据、换能力或澄清。' } } : {}) } : { controlPlane: true, success: result.success, code: result.code || null, loadedToolNames: result.loadedToolNames || [], newlyLoadedToolNames: result.newlyLoadedToolNames || [] };
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(projection) });
        toolResults.push(result); traces.push({ name: call.name, success: result.success === true, code: result.code || null, factIds, noNewEvidence, controlPlane: appendFacts === false });
        resultReturnedToAgent = true;
    }
    function complete(content, fallbackStatus) {
        const raw = String(content || '').trim() || finalFallback(ledger, fallbackStatus);
        const validation = validator(raw, { ledger: ledger.snapshot(), judge: { questions: [rawOwnerInput] }, mode: 'READ' });
        const snapshot = ledger.snapshot(); const claimableFacts = renderClaimableFactsForModel(snapshot);
        return Object.freeze({ rawOwnerInput, rawFinalEnvelope: raw, answer: validation.answer, answerValidation: validation, toolResults: Object.freeze(toolResults), factLedger: snapshot, claimableFacts, traces: Object.freeze(traces), finalizationAttempts: Object.freeze([...finalizationAttempts]), metrics: metrics(), durationMs: Date.now() - startedAt, context: Object.freeze({ rawOwnerInputTokensEst: estimateTokens(rawOwnerInput), businessMemoTokensEst: estimateTokens(input.businessMemo), policyMemoTokensEst: estimateTokens(input.policyMemo), ontologyContextTokensEst: estimateTokens(ontologyContext), apiIndexTokensEst: estimateTokens(apiIndexText), loadedSchemaTokensEst: estimateTokens(JSON.stringify(session.loadedDefinitions())), factCatalogChars: JSON.stringify(claimableFacts).length, factCatalogFactCount: claimableFacts.length, totalApproxContextTokens: estimateTokens(messages.map(item => item.content || JSON.stringify(item.tool_calls || '')).join('\n')) }), flags: Object.freeze({ apiIndexUsed: true, loadToolsUsed: loadToolsCalls > 0, onDemandSchemaUsed: session.loadedToolNames().length > 0, toolResultsReturnToSameAgent: resultReturnedToAgent, secondToolDecisionAfterResult: secondDecisionAfterResult, judgeRouterUsed: false, domainToolNamesSelectionUsed: false, mandatoryGroundingLayerUsed: false }) });
    }

    async function finalize(draft, fallbackStatus = 'PARTIAL') {
        if (!finalizationEnabled) return complete(draft, fallbackStatus);
        let prior = String(draft || '');
        for (let attempt = 0; attempt < MAX_FINALIZATION_MODEL_CALLS; attempt += 1) {
            const catalog = renderClaimableFactsForModel(ledger.snapshot());
            messages.push({ role: 'system', content: [
                'FINALIZE phase: business tools are no longer available. Do not add facts, infer amounts, or call tools.',
                'Return only the required answer JSON envelope. Cover every owner-requested outcome that has supporting Claimable Fact Catalog evidence; do not omit a distinct formal scalar merely because related component facts are present. Claims may cite only this deterministic Claimable Fact Catalog. Every money sentence must include its exact canonical entity name from the cited Fact Catalog; never use a pronoun as the money subject. Write the answer as short factual sentences only: every claims[].text must be a byte-for-byte contiguous sentence copied from answer (including punctuation), and answer must contain no additional factual sentence without a claim.',
                `CLAIMABLE FACT CATALOG:\n${JSON.stringify(catalog)}`,
                prior ? `Prior draft to correct:\n${prior}` : '',
            ].filter(Boolean).join('\n\n') });
            compactHistoricalToolMessages(messages);
            const message = await runModel(messages, { tools: [], env: input.env, signal: input.signal, timeoutMs: Math.max(1, MAX_RUNTIME_MS - (Date.now() - startedAt)) });
            mainModelCalls += 1;
            if (toolCallsFrom(message).length > 0) {
                prior = finalFallback(ledger, fallbackStatus);
                messages.push({ role: 'assistant', content: String(message.content || '') });
                continue;
            }
            const finalized = complete(message.content || prior, fallbackStatus);
            finalizationAttempts.push(Object.freeze({ attempt: attempt + 1, code: finalized.answerValidation.code || null, valid: finalized.answerValidation.valid === true, raw: String(message.content || '').slice(0, 6000) }));
            if (finalized.answerValidation.valid === true) {
                return Object.freeze({ ...finalized, finalizationAttempts: Object.freeze([...finalizationAttempts]) });
            }
            prior = String(message.content || prior);
            messages.push({ role: 'assistant', content: prior });
            messages.push({ role: 'system', content: `The envelope was rejected with ${finalized.answerValidation.code}. Use only matching Claimable Fact Catalog entries and return corrected JSON only.` });
        }
        return complete(finalFallback(ledger, fallbackStatus), fallbackStatus);
    }

    for (let turn = 0; turn < maxMainModelCalls; turn += 1) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) return complete(finalFallback(ledger, 'UNAVAILABLE'), 'UNAVAILABLE');
        if (turn > 0 && toolResults.length > 0) secondDecisionAfterResult = true;
        compactHistoricalToolMessages(messages);
        const message = await runModel(messages, { tools: runtimeToolDefinitions(session), env: input.env, signal: input.signal, timeoutMs: Math.max(1, MAX_RUNTIME_MS - (Date.now() - startedAt)) });
        mainModelCalls += 1;
        const calls = toolCallsFrom(message);
        if (calls.length === 0) {
            if (finalizationEnabled) return finalize(message.content, 'UNAVAILABLE');
            const completed = complete(message.content, 'UNAVAILABLE');
            // This is a generic answer-envelope repair, not task routing: the
            // same Agent receives the validator's stable failure code and the
            // existing formal facts, then can correct its own citations.
            if (completed.answerValidation.valid !== true && turn + 1 < maxMainModelCalls) {
                messages.push({ role: 'assistant', content: String(message.content || '') });
                messages.push({ role: 'system', content: `The final answer envelope was rejected with ${completed.answerValidation.code}. Return a corrected JSON envelope only. Each claim.text must be an exact contiguous assertion from answer, cite only the matching formal fact IDs, and omit assertions that cannot be cited.` });
                continue;
            }
            return completed;
        }
        messages.push(assistantToolMessage(message, calls));
        for (const rawCall of calls) {
            let call = rawCall;
            const currentTools = new Set(runtimeToolDefinitions(session).map(item => item.function.name));
            if (call.name === 'load_tools') {
                loadToolsCalls += 1;
                const result = loadToolsCalls > MAX_LOAD_TOOLS_CALLS ? failure(call.name, 'LOAD_TOOLS_CALL_LIMIT_EXCEEDED') : session.load(call.args.toolNames);
                if (result.success) for (const name of result.newlyLoadedToolNames) context.selectedToolNames.add(name);
                appendToolMessage(call, result, false);
                continue;
            }
            if (!currentTools.has(call.name)) { appendToolMessage(call, failure(call.name, 'TOOL_NOT_LOADED'), false); continue; }
            if (call.name === 'resolve_entity' || call.name === 'resolve_page_context_entity') {
                if (resolveCalls >= MAX_RESOLVE_CALLS) { appendToolMessage(call, failure(call.name, 'RESOLVE_CALL_LIMIT_EXCEEDED'), false); continue; }
                resolveCalls += 1;
            } else {
                if (!context.selectedToolNames.has(call.name)) { appendToolMessage(call, failure(call.name, 'TOOL_NOT_LOADED'), false); continue; }
                if (businessToolCalls >= MAX_BUSINESS_TOOL_CALLS) { appendToolMessage(call, failure(call.name, 'BUSINESS_TOOL_CALL_LIMIT_EXCEEDED'), false); continue; }
                try { call = { ...call, args: validateAiToolArgs(call.name, call.args) }; } catch (error) { appendToolMessage(call, failure(call.name, error.code || 'INVALID_AI_TOOL_INPUT', error.details), false); continue; }
                const key = callKey(call.name, call.args);
                if (successfulCalls.has(key)) { appendToolMessage(call, failure(call.name, 'DUPLICATE_TOOL_CALL'), false); continue; }
                businessToolCalls += 1;
            }
            let result;
            try {
                result = await runTool(call.name, call.args, context, { executeToolCall: dependencies.executeToolCall, resolveAgentEntity: dependencies.resolveAgentEntity, lookupEntities: dependencies.lookupEntities, internalFetch: dependencies.internalFetch });
            } catch (error) { result = formalToolFailure({ code: error?.code || 'FORMAL_TOOL_FAILED', details: error?.details }, call.name); }
            if (result.success === true && call.name !== 'resolve_entity' && call.name !== 'resolve_page_context_entity') successfulCalls.add(callKey(call.name, call.args));
            appendToolMessage(call, result, true);
        }
    }
    return finalize(finalFallback(ledger, 'PARTIAL'), 'PARTIAL');
}

module.exports = {
    CandidateAgentError,
    MAX_BUSINESS_TOOL_CALLS,
    MAX_CURRENT_TOOL_RESULT_CHARS,
    MAX_FINALIZATION_MODEL_CALLS,
    MAX_LOAD_TOOLS_CALLS,
    MAX_MAIN_MODEL_CALLS,
    MAX_RESOLVE_CALLS,
    MAX_RUNTIME_MS,
    buildOntologyContext,
    candidateToolProjection,
    candidateSystemPrompt,
    businessEvidenceFingerprint,
    callKey,
    renderClaimableFactsForModel,
    runApiNativeAgentCandidate,
    runtimeToolDefinitions,
};
