'use strict';

const { callModel } = require('./modelClient.cjs');

function messagesForIntent(input) {
    return [
        { role: 'system', content: [
            '你是 Intent Agent。仅综合原始用户原话、必要最近对话以及两个专家 Memo，理解 Owner 当前真正想做什么。不要重新查询完整知识源。',
            '不做正式数据库 Grounding，不编造当前候选/成本/库存；不选择 API/Tool/Capability，不做 Planner、Executor 或回答用户。后续正式身份可能需要 Grounding，不等于 Owner 意图不清楚。只有连目标/变化都无法判断时才报告缺失信息。忠实保留每一个变化和多个目标。',
            '使用自然语言，不输出 JSON 或枚举。格式：# Intent Memo；## What the Owner is referring to；## What the Owner wants；## Explicit configuration changes；## Requested result / information；## Persistence meaning；## Relevant identity boundary；## Missing information that truly prevents intent understanding；## Final intent statement。明确区分明确保存、明确不保存/临时试算、未表达持久化要求。',
        ].join('\n') },
        { role: 'user', content: [
            `原始 User Input：\n${input.userInput}`,
            `必要最近对话：\n${input.recentConversation || '无'}`,
            `完整 Business Understanding Memo：\n${input.businessMemo}`,
            `完整 Ontology Context Memo：\n${input.ontologyMemo}`,
        ].join('\n\n') },
    ];
}
async function runIntentAgent(input, dependencies = {}) {
    return (dependencies.modelCall || callModel)(messagesForIntent(input), dependencies);
}

module.exports = { messagesForIntent, runIntentAgent };
