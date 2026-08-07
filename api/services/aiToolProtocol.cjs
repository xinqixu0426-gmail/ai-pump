const { prioritizeCurrentEvidence } = require('./aiContext.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const {
    QUERY_TOOL_NAMES,
    normalizeBusinessQueryArgs,
} = require('./aiBusinessQueryCompiler.cjs');

const VIEW_TYPE_MAP = {
    get_order_detail: 'order_detail',
    get_order_knowledge_package: 'order_knowledge_package',
    generate_purchase_list: 'purchase_list',
    get_management_action_center: 'management_action_center',
    get_order_readiness_overview: 'order_readiness_overview',
    check_order_readiness: 'order_readiness',
    plan_order_readiness_actions: 'order_readiness_plan',
    execute_order_readiness_action: 'order_readiness_action',
};

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

function prepareAiToolCalls(toolCalls = [], source = 'model', options = {}) {
    const allowedToolNames = options.allowedToolNames
        ? new Set(options.allowedToolNames)
        : null;
    const writeTools = options.writeTools || new Set();
    return toolCalls.map(toolCall => {
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
        if (!QUERY_TOOL_NAMES.has(name)) {
            return {
                toolCall,
                source,
            };
        }
        try {
            const args = normalizeBusinessQueryArgs(
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
                validationCode: 'INVALID_AI_BUSINESS_QUERY',
                validationError: error.message,
            };
        }
    });
}

function buildAiToolPlan(toolCalls = [], writeTools = new Set(), options = {}) {
    const prepared = toolCalls.map(item => (
        item?.toolCall
            ? item
            : {
                toolCall: item,
                source: options.source || 'unknown',
                validationStatus: QUERY_TOOL_NAMES.has(item?.function?.name)
                    ? 'validated'
                    : undefined,
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

function buildAiToolCall(name, args, id) {
    return {
        id,
        type: 'function',
        function: {
            name,
            arguments: JSON.stringify(args || {}),
        },
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

function viewTypeForAiTool(name) {
    return VIEW_TYPE_MAP[name] || 'action_result';
}

const FINAL_REPLY_PRESENTATION_RULE = '【最终回复格式】只输出面向用户的结果，不展示内部思考、逐步推理、工具选择或处理过程。使用适量 Markdown：简单问题用短段落，一般问题可用一个简短标题和 2-5 个短要点；保留结论、关键数字/异常、必要下一步和风险，不复述折叠处理区中的工具明细。用户要求原因时给出可核验的关键依据，不展示内部推理链；确认、失败和关键风险不得省略。';

function appendRefreshedBusinessEvidence(messages, toolResults) {
    if (!Array.isArray(messages) || !messages[0]) return messages;
    const next = [...messages];
    next[0] = {
        ...messages[0],
        content: `${messages[0].content}\n\n【本轮服务端已刷新数据】\n${JSON.stringify(toolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。\n${FINAL_REPLY_PRESENTATION_RULE}`,
    };
    return next;
}

function prioritizeBusinessEvidence(messages, historyMessageCount) {
    const next = prioritizeCurrentEvidence(messages, historyMessageCount);
    if (!next[0]) return next;
    next[0] = {
        ...next[0],
        content: `${next[0].content}\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。\n${FINAL_REPLY_PRESENTATION_RULE}`,
    };
    return next;
}

module.exports = {
    appendRefreshedBusinessEvidence,
    buildAiToolCall,
    buildAiToolPlan,
    buildAiToolResultMessage,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    viewTypeForAiTool,
};
