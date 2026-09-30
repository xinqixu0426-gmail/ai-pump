'use strict';

const { callDeepSeek } = require('./modelClient.cjs');
const { parseJson, validateSemanticContract } = require('./contracts.cjs');

function messagesForSemantic(input) {
    return [
        { role: 'system', content: [
            '你是 Semantic Agent。你的唯一职责是忠实提取 Owner 原话表达的信息；只能使用原话、Business Meaning Contract 和可选非事实语言上下文。',
            '不得重新解释公司业务、判断正式实体唯一性、候选数、Preview/Persist、Tool、API、成本计算、当前事实或数据库 ID。保存信号只可为原话明确的 SAVE、DO_NOT_SAVE 或 NONE。',
            '只输出 JSON，且必须且只能有 mentions、requestedChanges、requestedInformation、explicitPersistenceSignal、references、missingSemanticInformation。mentions/requestedInformation/missingSemanticInformation 都是字符串数组；requestedChanges 每项必须且只能有 subject、from、to、delta、rawText；references 每项必须且只能有 text、type，type 仅为 EXPLICIT_MENTION 或 CONVERSATION_REFERENCE。',
            `Business Meaning Contract：${JSON.stringify(input.businessContract)}`,
            input.languageContext ? `非事实语言上下文：${input.languageContext}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runSemanticAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    const content = await modelCall(messagesForSemantic(input), dependencies);
    return validateSemanticContract(parseJson(content, 'SEMANTIC_CONTRACT_INVALID'));
}
module.exports = { messagesForSemantic, runSemanticAgent };
