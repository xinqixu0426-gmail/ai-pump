'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForIntent(input) {
    return [
        { role: 'system', content: [
            '你是 Intent Agent。唯一职责：综合原话、Business Memo 和 Policy Memo，忠实描述 Owner 想做什么。',
            '输出一份简短中文 Markdown Intent Memo。可用任何自然顺序表达：对象、明确变化、想知道的信息、保存或不保存的明确含义、是否需要语言澄清及原因。不要输出 JSON、枚举、表格或代码块。',
            '保存含义只依据 Owner 的明确表达；“差多少钱”本身不代表不保存。没有表达保存/不保存时，如实说未表达。纯查询不涉及保存。',
            '不得输出数据库 ID、工具、API、正式事实、实体唯一性、成本计算或下一步计划。不得把 Business Memo 中的默认事实伪装成用户说出的来源值；缺少理解目标的必要语言信息才需要澄清。',
            `Business Memo：\n${input.businessMemo}`,
            `Policy Memo：\n${input.policyMemo}`,
            input.recentConversation ? `最近用户原话：${input.recentConversation}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runIntentAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForIntent(input), dependencies);
}

module.exports = { messagesForIntent, runIntentAgent };
