'use strict';

const { callModel } = require('./modelClient.cjs');

function messagesForOntology(input) {
    return [
        { role: 'system', content: [
            '你是 Ontology Context Agent。唯一职责：从提供的完整 active Ontology 定义中，提取理解原话涉及的实体类型、属性、designation、关系和身份边界所需的信息。你不是 Entity Resolver。',
            '不得访问或声称数据库事实、候选数量、具体 canonical ID、成本或库存。不得判断预览/保存，不接触 Domain Policy，不选择 Tool/API/Capability，不做计划。普通配置值可以说明不是需要身份 Grounding 的实体。',
            '保留语义，不用枚举或 JSON。使用少量 Markdown 标题：# Ontology Context Memo；## Relevant entity types；## Relevant attributes / designations；## Relevant relations；## Identity boundaries；## Relevant ontology limitations；## Not relevant。仅提取相关信息，并注明 Ontology concept/relation id 或源路径。',
            '完整 active Ontology 定义：', input.ontologyText,
        ].join('\n\n') },
        { role: 'user', content: `必要最近对话（仅用于理解指代；没有则写“无”）：\n${input.recentConversation || '无'}\n\n原始 User Input：\n${input.userInput}` },
    ];
}
async function runOntologyContextAgent(input, dependencies = {}) {
    return (dependencies.modelCall || callModel)(messagesForOntology(input), dependencies);
}

module.exports = { messagesForOntology, runOntologyContextAgent };
