const { prioritizeCurrentEvidence } = require('./aiContext.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { TOOL_TARGETS } = require('./aiCapabilityGraphV3.cjs');
const {
    validateAiToolArgs,
} = require('./aiToolInputValidatorV2.cjs');

const VIEW_TYPE_MAP = {
    search_business_changes: 'business_change_history',
    get_order_detail: 'order_detail',
    get_order_knowledge_package: 'order_knowledge_package',
    generate_purchase_list: 'purchase_list',
    get_management_action_center: 'management_action_center',
    get_order_readiness_overview: 'order_readiness_overview',
    check_order_readiness: 'order_readiness',
    plan_order_readiness_actions: 'order_readiness_plan',
    execute_order_readiness_action: 'order_readiness_action',
};

const MAX_AI_READ_TOOL_RESULT_BYTES = 256 * 1024;

// S2-R2P1：预算语义分层，两个上限管的是两件不同的事。
//
// RAW_RECEIPT_SAFETY_LIMIT 只防工程事故：正式 API 异常返回数十 MB 时才拦截，
// 它**不是** LLM 上下文预算。依据：生产形状库上最大的真实正式响应是 121,341 字节
// （get_all_recipes 全量配方列表），1 MiB 约为其 8.6 倍，不误伤任何已知正常业务结果。
//
// MODEL_VIEW_RESULT_LIMIT 的语义是「单次送到模型的视图预算」。它只能作用在
// modelResultView 产出的投影上，绝不能用来判断正式 API 回执是否有效 ——
// 否则一个有投影的大列表会因为原始回执超限而被整轮改写成失败。
const RAW_RECEIPT_SAFETY_LIMIT = 1024 * 1024;
const MODEL_VIEW_RESULT_LIMIT = 96 * 1024;

function buildAiSynthesisEvidence(toolResults = []) {
    return toolResults.map(item => ({
        capabilityName: item.name,
        ...(item.name === 'get_order_knowledge_package' ? {
            evidencePriority: 'human_confirmed_order_knowledge',
            confirmedKnowledge: item.result?.data?.confirmedKnowledge
                || item.result?.confirmedKnowledge
                || null,
            knowledgeCoverage: item.result?.data?.coverage
                || item.result?.coverage
                || null,
        } : {}),
        result: item.result,
    }));
}

// 拒绝结果保持既有 code（向后兼容既有断言），用 reason 区分三种不同语义，
// error 文案按 reason 给出可执行的下一步。
function queryResultTooLarge(result, reason = null, error = null) {
    return {
        success: false,
        code: 'AI_QUERY_RESULT_TOO_LARGE',
        ...(reason ? { reason } : {}),
        error: error || '查询结果过大，未删除任何业务字段。请增加正式筛选条件、明确 limit，或改用单条详情查询。',
        executionEvidence: result?.executionEvidence,
    };
}

function parseAiToolArguments(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(typeof value === 'string' && value.trim() ? value : '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function compactValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) return `共 ${value.length} 项`;
    if (typeof value === 'object') return '已提供';
    return String(value);
}

function summarizeArgs(args = {}) {
    return Object.entries(args || {})
        .map(([key, value]) => ({ key, value: compactValue(value) }))
        .filter(item => item.value)
        .slice(0, 6);
}

function validationErrorForModel(error) {
    const failures = Array.isArray(error?.details?.failures)
        ? [...new Set(error.details.failures.map(item => String(item || '').trim()).filter(Boolean))]
        : [];
    return failures.length > 0
        ? `${error.message}：${failures.join('；')}`
        : error.message;
}

function explicitIdentifierFromUserText(userText) {
    const source = String(userText || '').normalize('NFKC');
    const matches = (source.match(
        /(?=[A-Za-z0-9._”"寸-]*\d)[A-Za-z0-9][A-Za-z0-9._”"寸\p{Script=Han}-]{1,79}/gu
    ) || []).map(value => value
        .replace(/(?:的)?(?:测试报告|技术档案|测试曲线|当前成本|成本|价格|单价|详情|有没有|是多少|是什么|怎么样).*$/u, '')
        .replace(/[-._]+$/u, '')
        .trim()
    ).filter(Boolean);
    const unique = [...new Map(matches.map(value => [value.toLowerCase(), value])).values()];
    return unique.length === 1 ? unique[0] : '';
}

function normalizeTargetForGrounding(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s._+#/()（）\-－]/gu, '');
}

function isLossyTargetArgument(proposed, explicitTarget) {
    const proposedKey = normalizeTargetForGrounding(proposed);
    const explicitKey = normalizeTargetForGrounding(explicitTarget);
    return proposedKey.length >= 2
        && explicitKey.length > proposedKey.length
        && explicitKey.startsWith(proposedKey);
}

function selectedCandidateIndex(reply) {
    const normalized = String(reply || '').normalize('NFKC').trim();
    const digit = normalized.match(/^(?:选|选择|看|查)?\s*(?:第\s*)?(\d+)\s*(?:个|项|条|号)?$/u);
    if (digit) return Number(digit[1]) - 1;
    const chineseNumbers = new Map([
        ['一', 0], ['二', 1], ['三', 2], ['四', 3], ['五', 4],
        ['六', 5], ['七', 6], ['八', 7], ['九', 8], ['十', 9],
    ]);
    const chinese = normalized.match(/^(?:选|选择|看|查)?\s*(?:第\s*)?([一二三四五六七八九十])\s*(?:个|项|条|号)?$/u);
    return chinese ? chineseNumbers.get(chinese[1]) : -1;
}

function normalizedCandidateSelectionText(value, options = {}) {
    let normalized = String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s“”"'`_.,，。:：;；()（）\[\]【】/-]+/g, '');
    if (options.reply) {
        normalized = normalized
            .replace(/^(?:选|选择|看|查|要|就是|我选|我要)+/u, '')
            .replace(/(?:那个|这个|一个|这款|那款|型号|配方|的)+$/u, '');
    }
    return normalized;
}

function selectedCandidateFromReply(reply, candidates = []) {
    const index = selectedCandidateIndex(reply);
    if (Number.isInteger(index) && index >= 0) return candidates[index] || null;
    const replyKey = normalizedCandidateSelectionText(reply, { reply: true });
    if (replyKey.length < 2) return null;
    const matches = candidates.filter(candidate => [
        candidate?.name,
        candidate?.spec,
        candidate?.label,
        candidate?.model,
        candidate?.schemeName,
        candidate?.customerName,
        candidate?.contractNo,
    ].some(value => {
        const candidateKey = normalizedCandidateSelectionText(value);
        return candidateKey && (
            candidateKey.includes(replyKey)
            || replyKey.includes(candidateKey)
        );
    }));
    return matches.length === 1 ? matches[0] : null;
}

function groundCandidateSelectionArgument(toolCall, capabilityName, reply, previousToolResults = []) {
    const capability = getAiCapability(capabilityName);
    const target = TOOL_TARGETS[capabilityName];
    const outputIdField = target?.outputIdField;
    if (capability?.access !== 'read' || !outputIdField) return toolCall;
    const args = parseAiToolArguments(toolCall?.function?.arguments);
    const targetFields = [target.inputField, outputIdField, target.outputField].filter(Boolean);
    if (targetFields.some(field => args[field] !== undefined && args[field] !== null)) {
        return toolCall;
    }
    const eligible = (previousToolResults || []).filter(item => (
        item?.name === capabilityName
        && item?.result?.executionEvidence?.verified === true
        && item?.result?.requiresClarification === true
        && Array.isArray(item.result.candidates)
    ));
    if (eligible.length !== 1) return toolCall;
    const selectedId = Number(selectedCandidateFromReply(
        reply,
        eligible[0].result.candidates
    )?.id);
    if (!Number.isSafeInteger(selectedId) || selectedId <= 0) return toolCall;
    return {
        ...toolCall,
        function: {
            ...toolCall.function,
            arguments: JSON.stringify({ ...args, [outputIdField]: selectedId }),
        },
    };
}

function explicitTargetForCapability(capabilityName, userText, fallback = '') {
    const text = String(userText || '').normalize('NFKC').trim();
    if (capabilityName === 'build_recipe_bom_draft') {
        const shell = text.match(/(?:^|[，,。；;：:\s])([^，,。；;：:]{2,80}?)\s*(?:的壳|泵壳)(?=$|[，,。；;：:\s])/u)?.[1]
            || text.match(/^(.{2,80}?)\s*(?:的壳|泵壳)/u)?.[1];
        if (shell) return shell.trim();
    }
    if (capabilityName === 'search_customer_history') {
        const customer = text.match(/客户\s*([^，,。；;：:]{2,40}?)(?=\s*(?:现有|全部|历史|最近).{0,8}报价)/u)?.[1];
        if (customer) return customer.trim();
    }
    return String(fallback || '').trim();
}

function sanitizeModelInferredFilters(toolCall, capabilityName, userText) {
    if (capabilityName !== 'search_parts') return toolCall;
    const args = parseAiToolArguments(toolCall?.function?.arguments);
    if (args.category !== undefined && !/(?:分类|类别)/u.test(String(userText || ''))) {
        delete args.category;
        return {
            ...toolCall,
            function: { ...toolCall.function, arguments: JSON.stringify(args) },
        };
    }
    return toolCall;
}

function groundMissingTargetArgument(toolCall, capabilityName, originalTarget, userText) {
    const capability = getAiCapability(capabilityName);
    const target = TOOL_TARGETS[capabilityName];
    const inputField = target?.inputField;
    if (capability?.access !== 'read' || !inputField) return toolCall;
    const args = parseAiToolArguments(toolCall?.function?.arguments);
    const mention = explicitTargetForCapability(capabilityName, userText, originalTarget);
    const explicitId = /(?:\bID\b|编号)\s*[:：#]?\s*\d+/iu.test(String(userText || ''));
    if (
        target.outputIdField
        && args[target.outputIdField] != null
        && mention
        && !explicitId
    ) {
        delete args[target.outputIdField];
        toolCall = {
            ...toolCall,
            function: { ...toolCall.function, arguments: JSON.stringify(args) },
        };
    }
    const targetFields = [
        inputField,
        target.outputIdField,
        target.outputField,
        ...Object.keys(target.outputFields || {}),
    ].filter(Boolean);
    const currentUserText = String(userText || '').trim();
    const proposedTarget = args[inputField];
    if (
        target.outputIdField
        && proposedTarget !== undefined
        && proposedTarget !== null
        && mention
        && mention !== currentUserText
        && currentUserText.includes(mention)
        && isLossyTargetArgument(proposedTarget, mention)
    ) {
        return {
            ...toolCall,
            function: {
                ...toolCall.function,
                arguments: JSON.stringify({ ...args, [inputField]: mention }),
            },
        };
    }
    if (targetFields.some(field => args[field] !== undefined && args[field] !== null)) {
        return toolCall;
    }
    if (!mention || mention === currentUserText || !currentUserText.includes(mention)) {
        return toolCall;
    }
    return {
        ...toolCall,
        function: {
            ...toolCall.function,
            arguments: JSON.stringify({ ...args, [inputField]: mention }),
        },
    };
}

function prepareAiToolCalls(toolCalls = [], source = 'model', options = {}) {
    const allowedToolNames = options.allowedToolNames
        ? new Set(options.allowedToolNames)
        : null;
    const writeTools = options.writeTools || new Set();
    const prepared = toolCalls.map(toolCall => {
        const name = toolCall.function?.name || '';
        if (allowedToolNames && !allowedToolNames.has(name)) {
            return {
                toolCall,
                source,
                validationStatus: 'rejected',
                validationCode: 'AI_TOOL_NOT_ALLOWED_FOR_CURRENT_TURN',
                validationError: `当前问题未授权调用工具 ${name}`,
            };
        }
        if (writeTools.has(name) && options.writeIntent !== true) {
            return {
                toolCall,
                source,
                validationStatus: 'rejected',
                validationCode: 'AI_WRITE_TOOL_NOT_ALLOWED_FOR_READ_TURN',
                validationError: `当前问题是查询意图，已阻止写工具 ${name}`,
            };
        }
        try {
            const args = validateAiToolArgs(
                name,
                parseAiToolArguments(toolCall.function?.arguments)
            );
            return {
                toolCall: {
                    ...toolCall,
                    function: {
                        ...toolCall.function,
                        arguments: JSON.stringify(args),
                    },
                },
                source,
                validationStatus: 'validated',
            };
        } catch (error) {
            return {
                toolCall: {
                    ...toolCall,
                    function: {
                        ...toolCall.function,
                        arguments: '{}',
                    },
                },
                source,
                validationStatus: 'rejected',
                validationCode: error.code || 'INVALID_AI_TOOL_INPUT',
                validationError: validationErrorForModel(error),
            };
        }
    });
    return prepared;
}

function buildAiToolPlan(toolCalls = [], writeTools = new Set(), options = {}) {
    const prepared = toolCalls.map(item => (
        item?.toolCall
            ? item
            : {
                toolCall: item,
                source: options.source || 'unknown',
                validationStatus: 'validated',
            }
    ));
    const steps = prepared.map((preparedCall, index) => {
        const toolCall = preparedCall.toolCall;
        const name = toolCall.function?.name || '';
        const write = writeTools.has(name);
        return {
            index: index + 1,
            name,
            label: getAiCapability(name)?.displayName || name,
            mode: write ? 'write' : 'read',
            requiresConfirmation: write,
            source: preparedCall.source,
            validationStatus: preparedCall.validationStatus,
            validationError: preparedCall.validationError,
            argsSummary: preparedCall.validationStatus === 'rejected'
                ? []
                : summarizeArgs(parseAiToolArguments(toolCall.function?.arguments)),
        };
    });
    const writeCount = steps.filter(step => step.mode === 'write').length;
    const rejectedCount = steps.filter(step => step.validationStatus === 'rejected').length;
    return {
        steps,
        summary: rejectedCount > 0
            ? `${rejectedCount} 个候选步骤参数未通过校验，不会执行。`
            : writeCount > 0
            ? `准备执行 ${steps.length} 个步骤，其中 ${writeCount} 个写操作需要确认。`
            : `准备执行 ${steps.length} 个只读/试算步骤。`,
    };
}

function buildAiToolResultMessage(toolCall, result) {
    return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name || '',
        content: `${JSON.stringify(result)}\n\n${FINAL_REPLY_PRESENTATION_RULE}`,
    };
}

function enforceAiToolResultSize(toolName, result, maxBytes = MAX_AI_READ_TOOL_RESULT_BYTES) {
    const capability = getAiCapability(toolName);
    if (capability?.access !== 'read' || !result || typeof result !== 'object') return result;
    const serialized = JSON.stringify(result);
    if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return result;
    return queryResultTooLarge(result);
}

function enforceAiToolResultBudget(
    toolName,
    result,
    existingToolResults = [],
    maxBytes = MAX_AI_READ_TOOL_RESULT_BYTES
) {
    const checked = enforceAiToolResultSize(toolName, result, maxBytes);
    if (checked !== result) return checked;
    const capability = getAiCapability(toolName);
    if (capability?.access !== 'read' || !checked || typeof checked !== 'object') return checked;
    const evidence = buildAiSynthesisEvidence([
        ...existingToolResults,
        { name: toolName, result: checked },
    ]);
    if (Buffer.byteLength(JSON.stringify(evidence), 'utf8') <= maxBytes) return checked;
    return queryResultTooLarge(checked);
}

// S2-R2P1 第一道门：正式 API 回执安全上限。
// 只判断「这个回执是不是异常到不该进入本轮工程流程」，不判断模型上下文是否放得下。
// 通过的回执原样返回（完整业务字段、evidence 全部保留），失败才返回有界拒绝。
function enforceAiRawReceiptSafety(toolName, result, maxBytes = RAW_RECEIPT_SAFETY_LIMIT) {
    const capability = getAiCapability(toolName);
    if (capability?.access !== 'read' || !result || typeof result !== 'object') return result;
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= maxBytes) return result;
    return queryResultTooLarge(
        result,
        'RAW_RECEIPT_SAFETY_LIMIT_EXCEEDED',
        '正式 API 回执异常过大，未删除任何业务字段。请增加正式筛选条件、明确 limit，或改用单条详情查询。'
    );
}

// S2-R2P1 第二道门：模型视图预算。判定对象是 modelResultView 的产出，不是原始回执。
// 单条与累计都按投影字节计算，调用方必须把「判定用的同一个投影对象」交给 buildAiToolResultMessage，
// 不允许为了预算检查再投影一次（modelResultView 不是纯函数：知识检索路径会分配 documentRef）。
function enforceAiModelViewBudget(
    toolName,
    modelView,
    existingModelViews = [],
    maxBytes = MODEL_VIEW_RESULT_LIMIT
) {
    const capability = getAiCapability(toolName);
    if (capability?.access !== 'read' || !modelView || typeof modelView !== 'object') {
        return { allowed: true, bytes: 0, cumulativeBytes: 0 };
    }
    const bytes = Buffer.byteLength(JSON.stringify(modelView), 'utf8');
    if (bytes > maxBytes) {
        return {
            allowed: false,
            reason: 'MODEL_VIEW_RESULT_TOO_LARGE',
            bytes,
            cumulativeBytes: bytes,
            maxBytes,
            result: queryResultTooLarge(
                modelView,
                'MODEL_VIEW_RESULT_TOO_LARGE',
                '这条结果的模型视图超过单次上下文预算，未删除任何业务字段。请增加正式筛选条件、明确 limit，或改用单条详情查询。'
            ),
        };
    }
    const cumulativeBytes = Buffer.byteLength(JSON.stringify(buildAiSynthesisEvidence([
        ...existingModelViews,
        { name: toolName, result: modelView },
    ])), 'utf8');
    if (cumulativeBytes > maxBytes) {
        return {
            allowed: false,
            reason: 'CUMULATIVE_MODEL_VIEW_BUDGET_EXCEEDED',
            bytes,
            cumulativeBytes,
            maxBytes,
            result: queryResultTooLarge(
                modelView,
                'CUMULATIVE_MODEL_VIEW_BUDGET_EXCEEDED',
                '本轮送给模型的上下文预算已用完，未删除任何业务字段。请用已经取得的正式结果回答原问题，需要更多明细时改用带筛选条件的单条查询。'
            ),
        };
    }
    return { allowed: true, bytes, cumulativeBytes };
}

function viewTypeForAiTool(name) {
    return VIEW_TYPE_MAP[name] || 'action_result';
}

const FINAL_REPLY_PRESENTATION_RULE = '【最终回复格式】只输出面向用户的结果，不展示内部思考、逐步推理、工具选择或处理过程。使用适量 Markdown：简单问题用短段落，一般问题可用一个简短标题和 2-5 个短要点；保留结论、关键数字/异常、必要下一步和风险，不复述折叠处理区中的工具明细。用户要求原因时给出可核验的关键依据，不展示内部推理链；确认、失败和关键风险不得省略。';

function prioritizeBusinessEvidence(messages, historyMessageCount) {
    const next = prioritizeCurrentEvidence(messages, historyMessageCount);
    if (!next[0]) return next;
    next[0] = {
        ...next[0],
        content: `${next[0].content}\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。\n${FINAL_REPLY_PRESENTATION_RULE}`,
    };
    return next;
}

function containsEmbeddedToolProtocol(content) {
    return /DSML[\s\S]{0,40}tool_calls|<\/?(?:tool_calls?|function_calls?|invoke)(?:\s|>)/i.test(String(content || ''));
}

module.exports = {
    containsEmbeddedToolProtocol,
    MAX_AI_READ_TOOL_RESULT_BYTES,
    MODEL_VIEW_RESULT_LIMIT,
    RAW_RECEIPT_SAFETY_LIMIT,
    buildAiSynthesisEvidence,
    buildAiToolPlan,
    buildAiToolResultMessage,
    enforceAiModelViewBudget,
    enforceAiRawReceiptSafety,
    enforceAiToolResultBudget,
    enforceAiToolResultSize,
    explicitIdentifierFromUserText,
    groundCandidateSelectionArgument,
    groundMissingTargetArgument,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    selectedCandidateFromReply,
    sanitizeModelInferredFilters,
    validationErrorForModel,
    viewTypeForAiTool,
};
