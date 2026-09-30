'use strict';

const { callDeepSeek } = require('./modelClient.cjs');
const { parseJson, validateBusinessContract } = require('./contracts.cjs');

function messagesForBusiness(input) {
    return [
        { role: 'system', content: [
            '你是 Business Understanding Agent。你的唯一职责是根据提供的 Company Business Model，解释用户原话涉及的公司业务概念。',
            '不得判断保存/不保存、Preview/Persist、用户动作、数据库身份、正式候选数、当前事实、Tool、API、成本、库存或下一步。',
            '只输出 JSON，且必须且只能有 concepts、businessMeanings、businessRelations、unknownBusinessTerms 四个字段；每个字段都是字符串数组。concepts 只能使用 COIL_COMMON_DESIGNATION、COIL_SCHEME、STATOR、TEMPLATE、RECIPE、BOM、PART、PACKING_CONFIGURATION、ROTOR_PROCESS_CONFIGURATION、OEM_CONFIGURATION。',
            'Company Business Model：', input.businessModel,
        ].join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runBusinessAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    const content = await modelCall(messagesForBusiness(input), dependencies);
    return validateBusinessContract(parseJson(content, 'BUSINESS_CONTRACT_INVALID'));
}
module.exports = { messagesForBusiness, runBusinessAgent };
