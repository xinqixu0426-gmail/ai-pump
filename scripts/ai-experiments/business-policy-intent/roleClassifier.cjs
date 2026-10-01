'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

const ROLE_NAMES = new Set(['FORMAL_ENTITY_CANDIDATE', 'CONFIG_VALUE', 'REFERENCE', 'CONCEPT_ONLY', 'QUERY_ONLY']);
const ENTITY_TYPES = new Set(['recipe', 'coil', 'template', 'part']);

function messagesForRoleClassifier(input) {
    const reference = input.reference || { status: 'NONE', surface: null, resolvedLanguageReference: null };
    return [
        { role: 'system', content: [
            '你是 Grounding Role Classifier。唯一职责：给老板原话中的语言表达标注业务角色；不要找正式 ID，不要决定是否调用 resolver，也不要回答成本、库存、BOM 或最终事实。',
            '严格使用以下两种行：',
            'REQUEST_CLASS: CONCEPT_ONLY 或 FORMAL_FACT_OR_ACTION',
            'ROLE: 原始语言表达 | FORMAL_ENTITY_CANDIDATE | RECIPE/COIL/TEMPLATE/PART',
            'ROLE: 原始语言表达 | CONFIG_VALUE | NONE',
            'ROLE: 原始语言表达 | REFERENCE | NONE',
            'ROLE: 原始语言表达 | CONCEPT_ONLY | NONE',
            'ROLE: 原始语言表达 | QUERY_ONLY | NONE',
            'FORMAL_ENTITY_CANDIDATE 仅用于需要绑定正式业务记录的型号、方案、模板或零件表达。配置条件（包装、木箱、浮球、电泳、不锈钢接轴、长度）必须是 CONFIG_VALUE；成本、多少钱、固定件、线圈（作为被查询属性）、几个方案是 QUERY_ONLY；语言指代是 REFERENCE。概念解释中的模板、配方等是 CONCEPT_ONLY。',
            '不要输出 Grounding Need、resolver、候选、ID、数据库、工具、API、计划、保存、写入或追问。不要依据用户句中的数字声称正式事实。',
            `老板原话：${input.userInput}`,
            'Business Memo（只帮助理解业务词，不是正式身份来源）：', input.businessMemo,
            'Policy Memo（只帮助保留安全边界，不是正式身份来源）：', input.policyMemo,
            `Reference Status: ${reference.status}`,
            `Reference Surface: ${reference.surface || 'NONE'}`,
            `Resolved Language Reference: ${reference.resolvedLanguageReference || 'NONE'}`,
        ].join('\n') },
        { role: 'user', content: '请只按行协议输出。' },
    ];
}

function normalizeEntityType(value) {
    const type = String(value || '').trim().toLowerCase();
    return ENTITY_TYPES.has(type) ? type : null;
}

function parseRoleMemo(memo) {
    const text = String(memo || '');
    const requestClass = text.match(/^REQUEST_CLASS:\s*(CONCEPT_ONLY|FORMAL_FACT_OR_ACTION)\s*$/mi)?.[1] || null;
    const roles = [];
    for (const line of text.split(/\r?\n/u)) {
        const match = line.match(/^ROLE:\s*(.+?)\s*\|\s*([A-Z_]+)\s*\|\s*(.+?)\s*$/u);
        if (!match) continue;
        const expression = match[1].trim();
        const role = match[2].trim();
        if (!expression || !ROLE_NAMES.has(role)) continue;
        const entityType = role === 'FORMAL_ENTITY_CANDIDATE' ? normalizeEntityType(match[3]) : null;
        if (role === 'FORMAL_ENTITY_CANDIDATE' && !entityType) continue;
        roles.push(Object.freeze({ expression, role, entityType }));
    }
    return Object.freeze({ requestClass, roles: Object.freeze(roles) });
}

async function runRoleClassifier(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForRoleClassifier(input), dependencies);
}

module.exports = { messagesForRoleClassifier, parseRoleMemo, runRoleClassifier };
