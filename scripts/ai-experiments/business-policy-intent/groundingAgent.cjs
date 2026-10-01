'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForGrounding(input) {
    return [
        { role: 'system', content: [
            '你是 Grounding Layer。唯一职责：将老板原话中需要正式业务身份的表达，交给现有正式 identity resolver 进行绑定。',
            '你可以判断是否需要 grounding，保留语言指代并只用给定的近期老板原话恢复明显的语言指代；不得把语言指代直接当正式身份。',
            '只输出简短中文 Markdown Memo，使用 Grounding Need（REQUIRED 或 NOT_REQUIRED）、Reference、Language Target、Expected Business Type 四类信息。每一个可解析 target 必须单独一行，严格写成 `Language Target: 原始语言表达 | recipe`、`Language Target: 原始语言表达 | coil` 或 `Language Target: 原始语言表达 | template`。可列多个 target。',
            '语言指代无法恢复时写 `Reference: UNRESOLVED`；能从近期老板原话恢复时另写 `Resolved Language Reference: 原始表达`。没有指代时写 `Reference: NONE`。',
            '概念解释不需要 formal grounding；查询当前正式资料、成本、库存、方案数量或正式修改表达通常需要。配置值如木箱、浮球、不锈钢接轴、电缆长度或电泳不是必然独立实体。',
            '禁止输出正式 ID、候选数量、正式成本/库存/BOM 事实、工具/API、计划、预览/保存/写入决定或追问话术。不得自行创造正式候选。',
            'Raw Owner Input：', input.userInput,
            input.recentOwnerWording ? `Bounded recent raw Owner wording：${input.recentOwnerWording}` : '',
            'Business Memo（只帮助理解业务概念，不是正式身份来源）：', input.businessMemo,
            'Policy Memo（只帮助保持安全边界，不是正式身份来源）：', input.policyMemo,
        ].filter(Boolean).join('\n') },
        { role: 'user', content: '请只做 Grounding admission 和语言 target 提取。' },
    ];
}

async function runGroundingAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForGrounding(input), dependencies);
}

module.exports = { messagesForGrounding, runGroundingAgent };
