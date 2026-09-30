'use strict';

const { callDeepSeek } = require('./modelClient.cjs');
const { parseJson, validateIntentResult } = require('./contracts.cjs');

function messagesForIntent(input) {
    return [
        { role: 'system', content: [
            '你是 Intent Agent。唯一职责：综合原话、Business Memo 和 Policy Memo，忠实描述 Owner 想做什么。',
            '只输出 JSON，且必须且只能有 objectMentions、requestedChanges、requestedInformation、persistence、needsClarification、clarificationReason。',
            'requestedChanges 每项只能有 subject、from、to、delta、evidence；requestedInformation 每项只能有 value、evidence。evidence 必须是当前原话或明确给出的最近用户原话中的连续文字，不得来自 memo。',
            'persistence 仅可 SAVE、DO_NOT_SAVE、UNSPECIFIED、NOT_APPLICABLE：只依据 Owner 的明确表达，不可把“差多少钱”擅自变成 DO_NOT_SAVE。',
            '不得输出数据库 ID、工具/API、正式事实、实体唯一性、成本计算或下一步计划。缺少理解目标的必要语言信息才 needsClarification=true。',
            `Business Memo：\n${input.businessMemo}`,
            `Policy Memo：\n${input.policyMemo}`,
            input.recentConversation ? `最近用户原话：${input.recentConversation}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runIntentAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    const content = await modelCall(messagesForIntent(input), dependencies);
    return validateIntentResult(parseJson(content, 'INTENT_RESULT_INVALID'));
}

module.exports = { messagesForIntent, runIntentAgent };
