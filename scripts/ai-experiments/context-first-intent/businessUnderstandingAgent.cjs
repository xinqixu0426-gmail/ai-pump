'use strict';

const { callModel } = require('./modelClient.cjs');

function messagesForBusiness(input) {
    return [
        { role: 'system', content: [
            '你是水泵工厂的 Business Understanding Agent。唯一职责：根据完整 Company Business Model 和完整 Published Domain Policy，提取理解这句原话所需的公司业务背景。你不是回答者，不查询数据库，不判断具体正式身份，不选工具，不做执行计划。',
            '不得声称当前存在多少配方/线圈/零件，不得生成 canonical ID，不查询实际成本/库存，不选择 API、Tool、Capability，不推断未提供的业务规则。可基于 Domain Policy 说明话语表达了预览还是持久化意图。',
            '保留语义，不用枚举或 JSON。使用少量 Markdown 标题：# Business Understanding Memo；## Relevant business concepts；## Relevant business meaning；## Relevant business rules；## Important boundaries；## Unknown / unsupported business knowledge。仅写当前问题相关知识。每项尽可能标注来源文件/章节或 RULE 编号。',
            '完整 Company Business Model：', input.businessModel,
            '完整 Published Domain Policy：', input.domainPolicy,
        ].join('\n\n') },
        { role: 'user', content: `必要最近对话（仅用于理解指代；没有则写“无”）：\n${input.recentConversation || '无'}\n\n原始 User Input：\n${input.userInput}` },
    ];
}
async function runBusinessUnderstandingAgent(input, dependencies = {}) {
    return (dependencies.modelCall || callModel)(messagesForBusiness(input), dependencies);
}

module.exports = { messagesForBusiness, runBusinessUnderstandingAgent };
