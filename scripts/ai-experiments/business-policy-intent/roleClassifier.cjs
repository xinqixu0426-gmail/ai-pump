'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

const ROLE_NAMES = new Set(['FORMAL_ENTITY_CANDIDATE', 'CONFIG_VALUE', 'CONCEPT_ONLY']);

function messagesForRoleClassifier(input) {
    const reference = input.reference || { status: 'NONE', surface: null, resolvedLanguageReference: null };
    return [
        { role: 'system', content: [
            '你是 Minimal Grounding Role Classifier。唯一职责：标注哪些老板语言表达值得进入正式 identity resolver。',
            '严格只输出以下行，不要任何标题、解释或其它字段：',
            'ROLE: 原始语言表达 | FORMAL_ENTITY_CANDIDATE',
            'ROLE: 原始语言表达 | CONFIG_VALUE',
            'ROLE: 原始语言表达 | CONCEPT_ONLY',
            '不要输出实体类型、请求类别、Grounding Need、查询词、Reference、ID、候选、数据库、resolver、工具、API、计划、保存、写入、成本或最终事实。',
            'FORMAL_ENTITY_CANDIDATE 是需要在正式系统中找“是哪一条记录”的型号、方案、模板或零件表达。CONFIG_VALUE 是依附于正式对象的配置、参数、工艺或选项；例如木箱、纸箱、浮球、电泳、不锈钢接轴、长度。即使配置与 Recipe 有关，也不是 Recipe target。CONCEPT_ONLY 是当前只讨论业务定义、含义或区别而不要求绑定记录的表达。',
            '若存在已解析的语言指代，必须把该已解析语言表达作为候选或概念输出；它仍不是正式 ID。',
            `老板原话：${input.userInput}`,
            'Business Memo（帮助理解业务词，不是正式身份来源）：', input.businessMemo,
            'Policy Memo（帮助保留安全边界，不是正式身份来源）：', input.policyMemo,
            `Reference Status: ${reference.status}`,
            `Resolved Language Reference: ${reference.resolvedLanguageReference || 'NONE'}`,
        ].join('\n') },
        { role: 'user', content: '请只按 ROLE 行协议输出。' },
    ];
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
