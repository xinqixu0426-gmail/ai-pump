const CORE_AI_RELEASE_CASE_KEYS = Object.freeze([
    'part-current-price',
    'coil-all-official-variants',
    'coil-winding-profile',
    'test-report-file-type',
    'test-report-ignore-template-points',
    'customer-quotation-display-order',
    'complete-cable-semantics',
    'cutting-shell-purpose-evidence',
    'configured-template-cost',
]);

const AI_RELEASE_RUN_OWNER_KEY = 'release:internal';

function releasePolicyError(code, message, statusCode = 409) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function assertCoreAiReleaseCases(cases) {
    const systemCases = (Array.isArray(cases) ? cases : [])
        .filter(item => item?.sourceType === 'system');
    const casesByKey = new Map(systemCases.map(item => [item.caseKey, item]));
    const missingKeys = CORE_AI_RELEASE_CASE_KEYS.filter(
        caseKey => !casesByKey.has(caseKey)
    );
    const inactiveKeys = CORE_AI_RELEASE_CASE_KEYS.filter(caseKey => {
        const item = casesByKey.get(caseKey);
        return item && (
            item.reviewStatus !== 'approved'
            || item.enabled !== true
            || item.releaseGateEnabled !== true
        );
    });
    if (missingKeys.length > 0 || inactiveKeys.length > 0) {
        throw releasePolicyError(
            'ai_evaluation_release_cases_incomplete',
            `核心 AI 发布检查配置不完整：缺少 ${missingKeys.join(', ') || '无'}；`
            + `不可执行 ${inactiveKeys.join(', ') || '无'}`
        );
    }
    return CORE_AI_RELEASE_CASE_KEYS.map(caseKey => casesByKey.get(caseKey));
}

module.exports = {
    AI_RELEASE_RUN_OWNER_KEY,
    CORE_AI_RELEASE_CASE_KEYS,
    assertCoreAiReleaseCases,
};
