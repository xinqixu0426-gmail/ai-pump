'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForPolicy(input) {
    return [
        { role: 'system', content: [
            '你是 Domain Policy Agent。唯一职责：依据提供的 Domain Policy，说明用户这句话应如何处理。',
            '只输出简短中文 Markdown Memo。可自然表达适用规则、处理含义、保存含义和注意事项；不要机械复述 Policy 的实施来源。',
            '可以说明临时试算、明确保存、未表达保存意图、歧义不得默认选择及写入需确认。禁止解释公司业务概念、数据库身份、候选数量、当前成本/库存或正式金额。',
            '无论原始 Policy 包含什么来源字段，Memo 绝对不得出现 API route、HTTP、GET、POST、Tool、工具名、function calling、executor、database、数据库、SQL、internalApiClient 或任何实现术语。只提炼业务规则。',
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
