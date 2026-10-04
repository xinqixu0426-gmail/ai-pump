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
const MAX_COMPLETION_REVIEWS_PER_REQUEST = 1;
const MAX_TERMINAL_OUTCOME_REVIEWS = 1;

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
        'Before ending investigation, compare the owner request with the formal evidence already obtained. Resolving an identity is not by itself a cost, inventory, or relationship answer. If a requested fact is already present, use it without repeating a query. If a requested fact is still missing and a loaded read/preview tool can investigate it, continue safely. If a necessary input is genuinely missing, a target remains ambiguous, or the capability is unavailable, say that specific reason. Do not guess data, silently select candidates, or write data.',
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
    if (status === 'UNAVAILABLE') return JSON.stringify({
        answer: '当前正式业务能力无法可靠完成该请求；不会把未应用的配置、零差额或未核验数据当作结果。',
        claims: [], goals: [{ questionIndex: 0, status, factIds: [] }],
    });
    if (status === 'CLARIFICATION') return JSON.stringify({
        answer: '当前缺少能够唯一确定对象或范围的必要信息；请补充具体对象或范围。',
        claims: [], goals: [{ questionIndex: 0, status, factIds: [] }],
    });
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
function modelSafeQualifiers(value) {
    if (Array.isArray(value)) return value.map(modelSafeQualifiers);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/(?:^|_)(?:id|canonicalid)$/i.test(key) && !/Id$/i.test(key))
        .map(([key, child]) => [key, modelSafeQualifiers(child)]));
}
function renderClaimableFactsForModel(ledgerOrSnapshot) {
    const facts = Array.isArray(ledgerOrSnapshot?.facts) ? ledgerOrSnapshot.facts : [];
    const seen = new Set();
    const entries = [];
    const structuredMoney = new Set(facts.filter(fact => fact?.verified && fact?.qualifiers?.moneyRole)
        .map(fact => stableJson([fact.entity?.type || null, fact.entity?.canonicalName || null, fact.value, fact.unit])));
    for (const fact of facts) {
        if (!fact?.verified) continue;
        // Generic deep field observations stay in the ledger for audit.  Only
        // identity, relation and scalar-bearing paths are claimable; exposing
        // every nested display field turns one detailed object into hundreds
        // of finalization choices without adding evidence.
        const fieldPath = String(fact.predicate || '').replace(/^formal_field:/, '').split('.').at(-1).replace(/\[\d+\]/g, '');
        if (String(fact.predicate || '').startsWith('formal_field:')
            && !/^(?:name|recipeName|schemeCode|schemeName|spec|sheets|currentTotalCost|totalCost|costDifference|costDiff|costBasis|complete|totalCount|count)$/i.test(fieldPath)) continue;
        // A structured current/scenario/difference fact is the authoritative
        // finalization choice. Suppress its generic deep-field duplicate so a
        // model cannot accidentally cite the less-specific observation.
        if (String(fact.predicate || '').startsWith('formal_field:')
            && /^(?:currentTotalCost|totalCost|costDifference|costDiff)$/i.test(fieldPath)
            && structuredMoney.has(stableJson([fact.entity?.type || null, fact.entity?.canonicalName || null, fact.value, fact.unit]))) continue;
        const entity = fact.entity ? `${fact.entity.type}/${fact.entity.canonicalName || fact.entity.id}` : 'none';
        const moneyRole = fact.qualifiers?.moneyRole || null;
        const scenario = fact.qualifiers?.scenario || fact.qualifiers?.scenarioKey || null;
        const participants = fact.qualifiers?.participants || null;
        const key = stableJson([entity, fact.predicate, fact.value, fact.unit, fact.basis, moneyRole, scenario, participants, fact.source?.tool]);
        if (seen.has(key)) continue;
        seen.add(key);
        const qualifiers = fact.qualifiers || {};
        const claimType = moneyRole === 'CURRENT_FORMAL' || moneyRole === 'CURRENT_BASE' ? 'CURRENT_COST'
            : moneyRole === 'SCENARIO_CANDIDATE' ? 'SCENARIO_COST'
                : moneyRole === 'SCENARIO_DIFFERENCE' ? 'SCENARIO_DELTA'
                    : moneyRole === 'RECIPE_DIFFERENCE' ? 'RECIPE_COST_DIFFERENCE'
                        : qualifiers.quantityRole ? 'OPERATIONAL_QUANTITY'
                            : fact.predicate === 'collection_completeness' ? 'COLLECTION_COMPLETENESS' : null;
        // Existing D1 catalog entries have dedicated scenario/participant
        // fields. Operational evidence is the only new class whose role,
        // unit/basis context and result-scoped collection reference need to
        // be visible to the finalizer as generic qualifiers.
        const modelQualifiers = ['OPERATIONAL_QUANTITY', 'COLLECTION_COMPLETENESS'].includes(claimType)
            || fact.predicate === 'unresolved_requirement'
            ? modelSafeQualifiers(qualifiers) : {};
        entries.push({ factId: fact.factId, ...(claimType ? { claimType } : {}),
            entity: fact.entity ? { type: fact.entity.type, canonicalName: fact.entity.canonicalName } : null,
            ...(participants ? { participants } : {}), predicate: fact.predicate, value: fact.value, unit: fact.unit, basis: fact.basis,
            ...(qualifiers.scenarioKey || qualifiers.label || qualifiers.role ? { scenario: { scenarioKey: qualifiers.scenarioKey || null, label: qualifiers.label || null, role: qualifiers.role || null } } : {}),
            ...(qualifiers.direction ? { direction: qualifiers.direction } : {}),
            ...(Object.keys(modelQualifiers).length ? { qualifiers: modelQualifiers } : {}),
            sourceTool: fact.source?.tool || null });
    }
    return Object.freeze(entries);
}
function formalScenarioOutcomeReceipts(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.scenarios)) return [];
    const comparisons = Array.isArray(data.comparisons) ? data.comparisons : [];
    return data.scenarios.filter(item => item?.role && item.role !== 'BASE').map(scenario => {
        const comparison = comparisons.find(item => item?.candidateScenarioKey === scenario.scenarioKey) || null;
        const notApplied = Array.isArray(scenario.notApplied) ? scenario.notApplied : [];
        const applicationStatus = notApplied.length ? 'NOT_APPLIED' : 'APPLIED';
        const comparisonStatus = comparison?.status || null;
        return Object.freeze({ scenarioKey: scenario.scenarioKey || null, label: scenario.label || null, role: scenario.role,
            applicationStatus, appliedOverrideKeys: Object.keys(scenario.appliedOverrides || scenario.overrides || {}),
            notAppliedOverrideKeys: notApplied.map(item => item?.key || item?.field || item?.code).filter(Boolean), comparisonStatus,
            capabilityOutcome: applicationStatus === 'NOT_APPLIED' ? 'REQUESTED_CHANGE_NOT_APPLIED'
                : comparisonStatus && comparisonStatus !== 'COMPARABLE' ? 'NON_COMPARABLE' : 'EXECUTABLE_RESULT' });
    });
}
function finalizationEvidenceSummary(catalog, receipts) {
    return Object.freeze({ availableClaimTypes: [...new Set(catalog.map(item => item.claimType).filter(Boolean))].sort(),
        scenarioOutcomes: receipts.map(item => ({ applicationStatus: item.applicationStatus, comparisonStatus: item.comparisonStatus, capabilityOutcome: item.capabilityOutcome })),
        capabilityGap: receipts.some(item => ['REQUESTED_CHANGE_NOT_APPLIED', 'NON_COMPARABLE'].includes(item.capabilityOutcome)) });
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
    const ledger = dependencies.factLedger || createFactLedger({ includeRecipeComparisonFacts: true, includeScenarioComparisonFacts: true, includeCoilDirectoryCostFacts: true, includeRecipeDetailCurrentCostFacts: true, includeOperationalEvidenceFacts: true });
    const validator = dependencies.validateAnswer || validateAnswer;
    const maxMainModelCalls = Number.isSafeInteger(input.maxMainModelCalls)
        ? Math.max(1, Math.min(input.maxMainModelCalls, MAX_MAIN_MODEL_CALLS))
        : MAX_MAIN_MODEL_CALLS;
    const finalizationEnabled = input.finalizationEnabled !== false;
    const completionReviewEnabled = input.completionReviewEnabled !== false;
    const startedAt = Date.now();
    const messages = [
        { role: 'system', content: candidateSystemPrompt({ businessMemo: input.businessMemo, policyMemo: input.policyMemo, ontologyContext, apiIndex: apiIndexText }) },
        ...boundedRecentConversation(input.recentConversation),
        { role: 'user', content: rawOwnerInput },
    ];
    const toolResults = []; const traces = []; const finalizationAttempts = []; const formalOutcomeReceipts = []; const successfulCalls = new Set(); const formalEvidence = new Set();
    const context = { selectedToolNames: new Set(), entityBindings: new Map(), resolvedRecipeIds: new Set(), resolvedRecipeBindings: new Map(), resolvedCoilBindings: new Map(), resolvedPartBindings: new Map(), ambiguousCoilKeys: new Set(), signal: input.signal };
    let mainModelCalls = 0; let loadToolsCalls = 0; let resolveCalls = 0; let businessToolCalls = 0;
    let secondDecisionAfterResult = false; let resultReturnedToAgent = false; let noNewEvidenceEvents = 0; let duplicateFactsAvoided = 0; let consecutiveNoNewEvidence = 0; let noProgressEvents = 0;
    let completionReviewCalls = 0; let completionReviewResumed = 0; let terminalOutcomeReviewCalls = 0; const stoppingReasons = [];

    function metrics() {
        return Object.freeze({ mainModelCalls, loadToolsCalls, resolveCalls, businessToolCalls, noNewEvidenceEvents, duplicateFactsAvoided, noProgressEvents, completionReviewCalls, completionReviewResumed, terminalOutcomeReviewCalls, stoppingReasons: [...stoppingReasons], loadedToolNames: session.loadedToolNames(), apiIndexFingerprint: apiIndex.fingerprint, loadedSchemaFingerprint: session.snapshot().schemaFingerprint });
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
        toolResults.push(result); traces.push({ name: call.name, argKeys: Object.keys(call.args || {}).sort(), success: result.success === true, verified: result.verified === true,
            code: result.code || null, factIds, noNewEvidence, controlPlane: appendFacts === false,
            ...(appendFacts ? { businessExecution: result.success === true && result.verified === true } : {}) });
        resultReturnedToAgent = true;
    }
    function complete(content, fallbackStatus) {
        const raw = String(content || '').trim() || finalFallback(ledger, fallbackStatus);
        const validation = validator(raw, { ledger: ledger.snapshot(), judge: { questions: [rawOwnerInput] }, mode: 'READ' });
        const snapshot = ledger.snapshot(); const claimableFacts = renderClaimableFactsForModel(snapshot);
        return Object.freeze({ rawOwnerInput, rawFinalEnvelope: raw, answer: validation.answer, answerValidation: validation, toolResults: Object.freeze(toolResults), factLedger: snapshot, claimableFacts, formalOutcomeReceipts: Object.freeze([...formalOutcomeReceipts]), traces: Object.freeze(traces), finalizationAttempts: Object.freeze([...finalizationAttempts]), metrics: metrics(), durationMs: Date.now() - startedAt, context: Object.freeze({ rawOwnerInputTokensEst: estimateTokens(rawOwnerInput), businessMemoTokensEst: estimateTokens(input.businessMemo), policyMemoTokensEst: estimateTokens(input.policyMemo), ontologyContextTokensEst: estimateTokens(ontologyContext), apiIndexTokensEst: estimateTokens(apiIndexText), loadedSchemaTokensEst: estimateTokens(JSON.stringify(session.loadedDefinitions())), factCatalogChars: JSON.stringify(claimableFacts).length, factCatalogFactCount: claimableFacts.length, totalApproxContextTokens: estimateTokens(messages.map(item => item.content || JSON.stringify(item.tool_calls || '')).join('\n')) }), flags: Object.freeze({ apiIndexUsed: true, loadToolsUsed: loadToolsCalls > 0, onDemandSchemaUsed: session.loadedToolNames().length > 0, toolResultsReturnToSameAgent: resultReturnedToAgent, secondToolDecisionAfterResult: secondDecisionAfterResult, judgeRouterUsed: false, domainToolNamesSelectionUsed: false, mandatoryGroundingLayerUsed: false }) });
    }

    async function finalize(draft, fallbackStatus = 'PARTIAL') {
        if (!finalizationEnabled) return complete(draft, fallbackStatus);
        let prior = String(draft || '');
        for (let attempt = 0; attempt < MAX_FINALIZATION_MODEL_CALLS; attempt += 1) {
            const catalog = renderClaimableFactsForModel(ledger.snapshot());
            const outcomeSummary = finalizationEvidenceSummary(catalog, formalOutcomeReceipts);
            messages.push({ role: 'system', content: [
                'FINALIZE phase: business tools are no longer available. Do not add facts, infer amounts, or call tools.',
                'Return only the required answer JSON envelope. Cover every owner-requested outcome that has supporting Claimable Fact Catalog evidence. If the owner asks for a difference, directly state the formal difference using RECIPE_COST_DIFFERENCE or SCENARIO_DELTA; do not replace it with only two absolute costs. For a scenario request, use SCENARIO_COST for the candidate amount and SCENARIO_DELTA when the owner asks how much it changes. Claims may cite only this deterministic Claimable Fact Catalog. Every money sentence must include its exact canonical entity name from the cited Fact Catalog; never use a pronoun as the money subject. Each monetary factual sentence/claim may assert only one money role: current/base, scenario candidate, or difference. If you mention more than one, split them into separate sentences and give each sentence only its matching Fact IDs. Operational quantity claims must cite the exact quantityRole and unit (required, available, shortage, or purchase progress); never substitute one role or unit for another. Do not call a partial collection complete, and do not infer that purchase covers a shortage unless a formal fact says so. Do not repeat a money amount in an uncited disclaimer: either keep it in the same cited sentence or make that disclaimer its own cited claim. For a CLARIFICATION or UNAVAILABLE response that states no verified business fact, use claims: [] and empty goal factIds; never create an uncited explanatory claim. Do not include internal IDs, suppliers, or unrelated metadata. Write one to four short factual sentences only: every claims[].text must be a byte-for-byte contiguous sentence copied from answer (including punctuation), and answer must contain no additional factual sentence without a claim.',
                `CLAIMABLE FACT CATALOG:\n${JSON.stringify(catalog)}`,
                `FINALIZATION EVIDENCE SUMMARY (control evidence only; no amounts):\n${JSON.stringify(outcomeSummary)}`,
                'Every claim must have one or more verified Fact IDs. Omit a narrative sentence instead of emitting a claim with empty factIds. Prior drafts are non-authoritative. A prior UNAVAILABLE/PARTIAL statement cannot override APPLIED, COMPARABLE formal outcome evidence or the Claimable Fact Catalog.',
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
            finalizationAttempts.push(Object.freeze({ attempt: attempt + 1, code: finalized.answerValidation.code || null, detail: finalized.answerValidation.detail || null, valid: finalized.answerValidation.valid === true, raw: String(message.content || '').slice(0, 6000) }));
            if (finalized.answerValidation.valid === true) {
                return Object.freeze({ ...finalized, finalizationAttempts: Object.freeze([...finalizationAttempts]) });
            }
            prior = String(message.content || prior);
            messages.push({ role: 'assistant', content: prior });
            messages.push({ role: 'system', content: `The envelope was rejected with ${finalized.answerValidation.code}. Safe validation detail: ${JSON.stringify(finalized.answerValidation.detail || null)}. Use only matching Claimable Fact Catalog entries and return corrected JSON only. Every claim must cite one or more verified Fact IDs; delete unsupported narrative sentences instead of keeping them with empty factIds. If the error is WRONG_MONEY_ROLE, MISSING_DIFFERENCE_FACT, or MONEY_CLAIM_BINDING_MISMATCH, split current/base, scenario candidate, and difference amounts into separate factual sentences and claims; each claim may cite only facts for that exact money role. If the detail says a difference fact is missing, do not cite two absolute costs as a difference; select a compatible formal difference entry instead.` });
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
            // A no-tool response is a candidate answer, not proof that every
            // requested business outcome is complete.  The same conversation
            // gets one bounded, tool-capable review; it is deliberately not a
            // router and carries no case/tool-specific instruction.
            if (completionReviewEnabled && finalizationEnabled && completionReviewCalls < MAX_COMPLETION_REVIEWS_PER_REQUEST && turn + 1 < maxMainModelCalls) {
                completionReviewCalls += 1;
                stoppingReasons.push('MODEL_READY_TO_ANSWER');
                messages.push({ role: 'assistant', content: String(message.content || '') });
                messages.push({ role: 'system', content: 'COMPLETION REVIEW: Recheck the owner\'s original request against the formal evidence already obtained. Identity alone is not a requested cost, inventory, or relationship result. If all requested facts are already supported, return the final JSON answer now without extra calls. If a requested fact is missing and an available read/preview capability can investigate it, continue with tools. If necessary input is missing, a target is ambiguous, or capability is unavailable, state that exact reason. Do not guess, silently choose, or write.' });
                continue;
            }
            stoppingReasons.push(completionReviewCalls ? 'COMPLETION_REVIEW_CONFIRMED' : 'MODEL_READY_TO_ANSWER');
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
        if (completionReviewCalls > 0) {
            completionReviewResumed += 1;
            stoppingReasons.push('COMPLETION_REVIEW_RESUMED');
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
            if (call.name === 'compare_recipe_scenarios' && result?.success === true) {
                const receipts = formalScenarioOutcomeReceipts(result.data);
                formalOutcomeReceipts.push(...receipts);
                if (receipts.some(item => ['REQUESTED_CHANGE_NOT_APPLIED', 'NON_COMPARABLE'].includes(item.capabilityOutcome)) && terminalOutcomeReviewCalls < MAX_TERMINAL_OUTCOME_REVIEWS) {
                    terminalOutcomeReviewCalls += 1;
                    stoppingReasons.push('TERMINAL_OUTCOME_REVIEW');
                    messages.push({ role: 'system', content: 'TERMINAL OUTCOME REVIEW: Formal outcome evidence says this scenario path did not apply the requested change or is non-comparable. Do not treat base/no-op values as the requested result. Check only for another clearly applicable loaded/indexed read or preview capability; otherwise stop and state the formal capability gap. Do not substitute an unrelated entity or configuration.' });
                }
            }
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
    finalizationEvidenceSummary,
    formalScenarioOutcomeReceipts,
    renderClaimableFactsForModel,
    runApiNativeAgentCandidate,
    runtimeToolDefinitions,
};
