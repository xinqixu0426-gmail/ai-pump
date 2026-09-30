'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForBusiness(input) {
    return [
        { role: 'system', content: [
            '你是 Business Model Agent。唯一职责：根据 Company Business Model 解释用户原话里业务对象在本公司的含义。',
            '只输出中文 Markdown Memo，使用四个简短章节：Relevant business concepts、Business meaning、Relevant relationships、Unknown business terms。',
            '禁止判断预览/保存/持久化意图、下一步、工具/API、数据库身份、候选数量、当前成本/库存或任何正式事实。未知时说明业务模型未定义，不猜测。',
            'Company Business Model（这是你唯一知识源）：', input.businessModel,
            input.recentConversation ? `仅语言上下文：${input.recentConversation}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runBusinessAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForBusiness(input), dependencies);
}

module.exports = { messagesForBusiness, runBusinessAgent };
