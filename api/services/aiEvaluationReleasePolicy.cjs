// 2026-09-19 负责人决定：以下九条核心 AI 发布用例引用的实体在生产数据库清理后已不存在
// （模板与包材改名、配方删除），负责人明确不再需要这些旧用例并授权退役。
// 保留为历史清单，只用于审计引用与门禁机制的回归测试；数据行由迁移 86 删除。
// 它不再是发布门禁的要求清单。
const RETIRED_AI_RELEASE_CASE_KEYS = Object.freeze([
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

// 当前要求清单是显式空集：发布门禁不再要求任何固定用例存在。
// 后果必须一起读：`verify:ai-release` 现在不再产出 AI 质量证据（报告会明确标记
// coreCasesRetired），真实 AI 回归的自动拦截能力为 0。要恢复这个信号，必须重新按当前
// 数据库中的真实实体编写用例，并通过一次显式的清单变更把它写回这里。
const CORE_AI_RELEASE_CASE_KEYS = Object.freeze([]);

const AI_RELEASE_CORE_CASES_RETIRED_AT = '2026-09-19';

const AI_RELEASE_RUN_OWNER_KEY = 'release:internal';

function releasePolicyError(code, message, statusCode = 409) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function coreReleaseCasesRetired() {
    return CORE_AI_RELEASE_CASE_KEYS.length === 0;
}

/**
 * 校验"被要求的核心用例都存在且可执行"。清单为空时不要求任何用例（退役状态），
 * 但仍可用 `keys` 传入显式清单来复核机制本身。
 */
function assertCoreAiReleaseCases(cases, keys = CORE_AI_RELEASE_CASE_KEYS) {
    const requiredKeys = Array.isArray(keys) ? keys : CORE_AI_RELEASE_CASE_KEYS;
    const systemCases = (Array.isArray(cases) ? cases : [])
        .filter(item => item?.sourceType === 'system');
    const casesByKey = new Map(systemCases.map(item => [item.caseKey, item]));
    const missingKeys = requiredKeys.filter(caseKey => !casesByKey.has(caseKey));
    const inactiveKeys = requiredKeys.filter(caseKey => {
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
    return requiredKeys.map(caseKey => casesByKey.get(caseKey));
}

module.exports = {
    AI_RELEASE_CORE_CASES_RETIRED_AT,
    AI_RELEASE_RUN_OWNER_KEY,
    CORE_AI_RELEASE_CASE_KEYS,
    RETIRED_AI_RELEASE_CASE_KEYS,
    assertCoreAiReleaseCases,
    coreReleaseCasesRetired,
};
