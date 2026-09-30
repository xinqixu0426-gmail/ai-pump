'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForPolicy(input) {
    return [
        { role: 'system', content: [
            '你是 Domain Policy Agent。唯一职责：依据提供的 Domain Policy，说明用户这句话应如何处理。',
            '只输出中文 Markdown Memo，使用四个简短章节：Applicable policy、Interpretation、Persistence meaning、Required caution。',
            '可以说明临时试算、明确保存、未表达保存意图、歧义不得默认选择及写入需确认。禁止解释公司业务概念、数据库身份、候选数量、工具/API、当前成本/库存或正式金额。',
            'Domain Policy（这是你唯一规则源）：', input.domainPolicy,
            input.recentConversation ? `仅语言上下文：${input.recentConversation}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runPolicyAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForPolicy(input), dependencies);
}

module.exports = { messagesForPolicy, runPolicyAgent };
