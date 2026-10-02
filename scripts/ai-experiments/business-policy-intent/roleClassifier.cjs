'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

const ROLE_NAMES = new Set(['FORMAL_ENTITY_CANDIDATE', 'CONFIG_VALUE', 'CONCEPT_ONLY']);

function messagesForRoleClassifier(input) {
    const messages = [
        { role: 'system', content: [
            '你是 Minimal Grounding Role Classifier。唯一职责：标注哪些老板语言表达值得进入正式 identity resolver。',
            '严格只输出以下行，不要任何标题、解释或其它字段：',
            'ROLE: 原始语言表达 | FORMAL_ENTITY_CANDIDATE',
            'ROLE: 原始语言表达 | CONFIG_VALUE',
            'ROLE: 原始语言表达 | CONCEPT_ONLY',
            '不要输出实体类型、请求类别、Grounding Need、查询词、Reference、ID、候选、数据库、resolver、工具、API、计划、保存、写入、成本或最终事实。',
            'FORMAL_ENTITY_CANDIDATE 的含义是：为了完成老板当前请求，这个语言表达需要进入正式 identity resolver，由正式系统决定 EXACT、MULTIPLE 或 UNRESOLVED。它不要求已经唯一、canonical 或已绑定正式实体。',
            '同一表达的角色取决于当前请求用途：问“12-120是什么意思”时 12-120 是 CONCEPT_ONLY；问“12-120多少钱”或“12-120有几个方案”时 12-120 是 FORMAL_ENTITY_CANDIDATE。不要把“不唯一正式 identity”误判为 CONCEPT_ONLY。',
            'CONFIG_VALUE 是依附于正式对象的配置、参数、工艺或选项；例如木箱、纸箱、浮球、电泳、不锈钢接轴、长度。即使配置与 Recipe 有关，也不是 Recipe target。CONCEPT_ONLY 是当前只讨论业务定义、含义或区别而不要求绑定记录的表达。',
            '若存在已解析的语言指代，必须把该已解析语言表达作为候选或概念输出；它仍不是正式 ID。',
            `Grounding Working Utterance：${input.workingUtterance}`,
            'Business Memo（帮助理解业务词，不是正式身份来源）：', input.businessMemo,
            'Policy Memo（帮助保留安全边界，不是正式身份来源）：', input.policyMemo,
        ].join('\n') },
        { role: 'user', content: '请只按 ROLE 行协议输出。' },
    ];
    if (input.retryAddendum) messages.push({ role: 'user', content: input.retryAddendum });
    return messages;
}

function parseRoleMemo(memo) {
    const roles = [];
    for (const line of String(memo || '').split(/\r?\n/u)) {
        const match = line.match(/^ROLE:\s*(.+?)\s*\|\s*(FORMAL_ENTITY_CANDIDATE|CONFIG_VALUE|CONCEPT_ONLY)\s*$/u);
        if (!match) continue;
        const expression = match[1].trim();
        const role = match[2];
        if (expression && ROLE_NAMES.has(role)) roles.push(Object.freeze({ expression, role }));
    }
    return Object.freeze({ roles: Object.freeze(roles) });
}

async function runRoleClassifier(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForRoleClassifier(input), dependencies);
}

module.exports = { messagesForRoleClassifier, parseRoleMemo, runRoleClassifier };
