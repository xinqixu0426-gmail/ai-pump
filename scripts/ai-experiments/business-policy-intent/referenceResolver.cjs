'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForReferenceResolver(input) {
    return [
        { role: 'system', content: [
            '你是语言指代解析器。唯一任务：判断当前老板原话中的指定指代，能否仅根据近期老板原话唯一恢复为一段语言表达。',
            '你只能看到当前原话和近期老板原话。禁止推断业务类型、正式实体、数据库身份、候选、工具、API、下一步或追问。',
            '严格只输出三行：',
            'REFERENCE_STATUS: RESOLVED 或 UNRESOLVED',
            `REFERENCE_SURFACE: ${input.referenceSurface}`,
            'RESOLVED_LANGUAGE_REFERENCE: 近期老板原话中的原始表达，或 NONE',
            '若没有唯一可恢复的近期老板表达，必须输出 UNRESOLVED 和 NONE。不要猜测。',
            `当前老板原话：${input.userInput}`,
            `近期老板原话：${input.recentOwnerWording || 'NONE'}`,
        ].join('\n') },
        { role: 'user', content: '请按三行协议输出。' },
    ];
}

function parseReferenceMemo(memo, detected) {
    if (!detected || detected.status === 'NONE') return Object.freeze({ status: 'NONE', surface: null, resolvedLanguageReference: null });
    const text = String(memo || '');
    const status = text.match(/^REFERENCE_STATUS:\s*(RESOLVED|UNRESOLVED)\s*$/mi)?.[1] || 'UNRESOLVED';
    const surface = text.match(/^REFERENCE_SURFACE:\s*(.+?)\s*$/mi)?.[1]?.trim() || detected.surface;
    const resolved = text.match(/^RESOLVED_LANGUAGE_REFERENCE:\s*(.+?)\s*$/mi)?.[1]?.trim() || 'NONE';
    if (status !== 'RESOLVED' || !resolved || /^NONE$/iu.test(resolved)) {
        return Object.freeze({ status: 'UNRESOLVED', surface: detected.surface, resolvedLanguageReference: null });
    }
    return Object.freeze({ status: 'RESOLVED', surface, resolvedLanguageReference: resolved });
}

async function runReferenceResolver(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForReferenceResolver(input), dependencies);
}

module.exports = { messagesForReferenceResolver, parseReferenceMemo, runReferenceResolver };
