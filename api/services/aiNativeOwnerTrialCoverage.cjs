'use strict';
/**
 * E1-E — Owner Trial Coverage Manifest（真实老板问法的 Native 覆盖清单）
 *
 * 背景：`ownerTrialReadiness()` 的 `READY_FOR_OWNER_TRIAL` 只表示「结构性质量门槛通过」，
 * 它**不等于**「能承接真实老板问法」。Phase D 实测：10 个真实问法里 Native 只有极少数能
 * 产出正式事实（其余返回 UNSUPPORTED），因此 owner canary 只能进入**已支持**的问法族。
 *
 * 本模块把「支持哪些 question family」变成显式、可执行、可审计的清单：
 *   - 状态枚举：SUPPORTED / PARTIAL / UNSUPPORTED；
 *   - 每条都带证据来源（Phase D parity 语料 / 结构契约测试），不允许凭空声称；
 *   - canary 资格只来自 SUPPORTED 族。
 *
 * 维护规则：Native 新增能力后**必须**更新本清单，否则 canary 范围不会自动扩大。
 */

const COVERAGE_STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED',
    PARTIAL: 'PARTIAL',
    UNSUPPORTED: 'UNSUPPORTED',
    // S1：真实 canary 暴露缺陷时显式停用（绝不静默删除或伪装成从未支持）。
    SUSPENDED: 'SUSPENDED',
});

const OWNER_TRIAL_COVERAGE_VERSION = 1;
const S1_BASELINE_VERSION = 'S1';

/**
 * 真实问法族清单（questionFamily 用业务语言，不用实现细节）。
 * `evidence` 指向产生该结论的真实运行/测试。
 */
const OWNER_TRIAL_COVERAGE = Object.freeze([
    Object.freeze({
        familyId: 'single-recipe-current-cost',
        questionFamily: '当前成本（单个在售配方）',
        example: 'v550-tokoy当前成本是多少',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'CURRENT_COST',
        goalKinds: Object.freeze(['CURRENT_COST']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['preview_recipe_cost', 'get_recipe_detail'],
        requiredFacts: ['recipe.current_cost'],
        ambiguityPolicy: '配方目录多匹配 → RECIPE_AMBIGUOUS 澄清；缺失 → 正式负结果',
        answerContract: 'CURRENT_COST_V1',
        evidence: 'PHASE_D parity: nativeState=SUCCEEDED, verified fact recipe.current_cost',
    }),
    Object.freeze({
        familyId: 'multi-goal-config-profit-readiness',
        questionFamily: '配置变更 + 毛利 + 齐料（多目标）',
        example: 'v550-tokoy现在成本多少？电缆改5米以后呢？卖340毛利多少？如果做300台库存够不够？先不要保存。',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'CURRENT_COST + CONFIGURATION_COMPARE + PROFITABILITY + INVENTORY_QUERY',
        goalKinds: Object.freeze(['CURRENT_COST', 'CONFIGURATION_COMPARE', 'PROFITABILITY', 'INVENTORY_QUERY']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['preview_recipe_cost', 'compare_recipe_scenarios', 'preview_profitability', 'preview_virtual_readiness'],
        requiredFacts: ['recipe.current_cost', 'scenario.cost', 'scenario.cost_comparison', 'profitability.preview', 'inventory.virtual_readiness'],
        ambiguityPolicy: '主体/包装/线圈任一多候选都先澄清；缺单价或数量时只补参数，不默认值',
        answerContract: 'CONFIGURATION_COMPARE_V1 / PROFITABILITY_V1 / VIRTUAL_READINESS_V1',
        evidence: 'PHASE_D parity supplement: nativeState=SUCCEEDED with formal facts',
    }),
    Object.freeze({
        familyId: 'virtual-readiness-preview',
        questionFamily: '虚拟齐料 / 缺料预览',
        example: '如果现在再做300台 v550-tokoy 库存够不够？',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'INVENTORY_QUERY（虚拟齐料）',
        goalKinds: Object.freeze(['INVENTORY_QUERY']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['preview_virtual_readiness'],
        requiredFacts: ['inventory.virtual_readiness'],
        ambiguityPolicy: '缺数量先问数量；配置未验证则不给齐料结论',
        answerContract: 'VIRTUAL_READINESS_V1',
        evidence: 'PHASE_D D05: preview_virtual_readiness returned SHORTAGE with 21 shortages on production-shaped data',
    }),
    Object.freeze({
        familyId: 'recipe-cost-comparison',
        questionFamily: '两个方案的成本差额（比较）',
        example: 'v550-tokoy和v750-tokoy成本差多少？（PHASED-浮球-有和PHASED-浮球-无差多少钱）',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'RECIPE_COST_COMPARISON',
        goalKinds: Object.freeze(['RECIPE_COST_COMPARISON']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['get_all_recipes', 'compare_recipes'],
        requiredFacts: ['recipe.current_cost', 'recipe.cost_difference'],
        ambiguityPolicy: '逐主体解析，按 A→B 有界可恢复澄清；任一主体不唯一即 WAITING_INPUT',
        answerContract: 'RECIPE_COST_COMPARISON_V1（两个主体成本 + 正式差额；方向按 costDiff=配方2−配方1）',
        evidence: 'E2-R1 落地：Task V2 新增 RECIPE_COST_COMPARISON goal kind（aiTaskContractV2）+ 双主体 subjectKeys；'
            + '语义判定复用 E1-B 业务语义层（questionSemantics COST_COMPARISON），模型无权决定比较主体；'
            + '需求 recipe.current_cost×2 + recipe.cost_difference（basis FORMAL_COST_COMPARISON，aiTaskStructuredReadsV2）；'
            + '控制器两个主体**分别** canonical 绑定（get_all_recipes→bindSubject）、按 A→B 可恢复顺序澄清，'
            + '差额只来自 compare_recipes 回执的 costDiff（控制器不相减）；回答模板 RECIPE_COST_COMPARISON_V1；'
            + '测试 tests/nativeCoverageWave1R1.test.cjs；真实 provider 运行记录见 '
            + 'planning/ai-native-v1/release/AiNativeCoverageExpansionWave1R1V1.json。',
    }),
    Object.freeze({
        familyId: 'spec-configuration-difference',
        questionFamily: '规格 / 配置差异（非金额）',
        example: '这两项产品规格有什么不同',
        nativeSupport: COVERAGE_STATUS.UNSUPPORTED,
        expectedGoal: 'CONFIGURATION_COMPARE（差异描述）',
        goalKinds: Object.freeze(['CONFIGURATION_COMPARE', 'OTHER']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['compare_recipes'],
        requiredFacts: [],
        ambiguityPolicy: '不适用（本阶段不进入 Native canary）',
        answerContract: null,
        evidence: 'PHASE_D parity: nativeState=UNSUPPORTED',
    }),
    Object.freeze({
        familyId: 'coil-catalogue-cost',
        questionFamily: '线圈档案成本',
        example: '12-120成本多少？（12-200多少钱 / 帮我查12-140线圈成本 / 12-200现在是什么成本）',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'COIL_COST',
        goalKinds: Object.freeze(['COIL_COST']),
        subjectTypes: Object.freeze(['coil']),
        requiredCapabilities: ['search_coils'],
        requiredFacts: ['coil.current_cost'],
        ambiguityPolicy: '线圈多候选 → COIL_COST_AMBIGUOUS 澄清；不汇总、不默认第一套',
        answerContract: 'CATALOG_V1（单一 canonical 线圈时输出该方案自己的 cost 数值）',
        evidence: 'E2 落地：Task V2 新增 COIL_COST goal kind（aiTaskContractV2）+ 需求 coil.current_cost '
            + '（aiTaskStructuredReadsV2）+ 控制器分支（aiTaskControllerV2，复用 search_coils→canonical 绑定→多候选澄清）'
            + '+ 事实驱动回答（aiTaskAnswerV2）；测试 tests/nativeCoverageWave1.test.cjs；'
            + '真实 provider 运行：唯一候选 → SUCCEEDED/coil.current_cost，多候选 → WAITING_INPUT/COIL_COST_AMBIGUOUS。',
    }),
    Object.freeze({
        familyId: 'coil-inventory',
        questionFamily: '线圈库存',
        example: '12-120还有多少？（12-200有库存吗 / 12-140现在库存多少 / 这个线圈还有货吗）',
        nativeSupport: COVERAGE_STATUS.SUPPORTED,
        expectedGoal: 'INVENTORY_QUERY',
        goalKinds: Object.freeze(['INVENTORY_QUERY']),
        subjectTypes: Object.freeze(['coil']),
        requiredCapabilities: ['search_coils'],
        requiredFacts: ['inventory.coil'],
        ambiguityPolicy: '线圈多候选 → INVENTORY_COIL_AMBIGUOUS 澄清；指代无唯一焦点 → CONTINUATION_FOCUS_AMBIGUOUS',
        answerContract: 'INVENTORY_V1（单一 canonical 线圈时输出该方案自己的库存数值）',
        evidence: 'E2 落地：INVENTORY_INTENT 补齐线圈可用量的口语说法（还有多少/还剩/剩多少/余量/有库存/还有货）'
            + '使其能通过 admission grounding；回答改为事实驱动并输出库存数值；'
            + '真实 provider 运行：唯一候选 → SUCCEEDED/inventory.coil，多候选 → WAITING_INPUT/INVENTORY_COIL_AMBIGUOUS。',
    }),
    Object.freeze({
        familyId: 'management-overview',
        questionFamily: '经营概况 / 看板',
        example: '今天的经营情况是什么',
        nativeSupport: COVERAGE_STATUS.UNSUPPORTED,
        expectedGoal: 'OTHER',
        goalKinds: Object.freeze(['MANAGEMENT_OVERVIEW', 'OTHER']),
        subjectTypes: Object.freeze(['global']),
        requiredCapabilities: ['get_dashboard_summary'],
        requiredFacts: [],
        ambiguityPolicy: '不适用（本阶段不进入 Native canary）',
        answerContract: null,
        evidence: 'PHASE_D parity: nativeState=UNSUPPORTED',
    }),
    Object.freeze({
        familyId: 'negative-object-probe',
        questionFamily: '不存在的对象（负向探测）',
        example: '查不存在的配方',
        nativeSupport: COVERAGE_STATUS.PARTIAL,
        expectedGoal: 'READ_OR_UNSUPPORTED',
        goalKinds: Object.freeze(['OTHER']),
        subjectTypes: Object.freeze(['recipe']),
        requiredCapabilities: ['get_all_recipes'],
        requiredFacts: ['recipe.catalog_absence'],
        ambiguityPolicy: '不适用（部分支持）',
        answerContract: 'RECIPE_CATALOG_NEGATIVE_V1',
        evidence: 'PHASE_D parity: nativeState=UNSUPPORTED，但 Legacy 侧能给出正式「未找到」结论；Native 需要 fail-closed 语义而不是能力缺口',
    }),
]);

/**
 * S1：显式停用登记（SUPPORTED → SUSPENDED）。
 * 真实 canary 暴露缺陷时只允许在这里记录，绝不静默改清单数字。
 */
const FAMILY_SUSPENSIONS = new Map();

function suspendFamily(familyId, reason, at = new Date().toISOString()) {
    const entry = familyById(familyId);
    if (!entry) throw Object.assign(new Error('UNKNOWN_FAMILY'), { code: 'UNKNOWN_FAMILY', familyId });
    if (!reason) throw Object.assign(new Error('SUSPENSION_REASON_REQUIRED'), { code: 'SUSPENSION_REASON_REQUIRED', familyId });
    FAMILY_SUSPENSIONS.set(familyId, Object.freeze({ familyId, questionFamily: entry.questionFamily, reason: String(reason), at }));
    return coverageStatusOf(entry);
}

function reinstateFamily(familyId) {
    FAMILY_SUSPENSIONS.delete(familyId);
    const entry = familyById(familyId);
    return entry ? coverageStatusOf(entry) : null;
}

/** 有效状态：登记的 nativeSupport 被显式 suspension 覆盖为 SUSPENDED。 */
function coverageStatusOf(entry) {
    return FAMILY_SUSPENSIONS.has(entry.familyId) ? COVERAGE_STATUS.SUSPENDED : entry.nativeSupport;
}

function familyById(familyId) { return OWNER_TRIAL_COVERAGE.find(item => item.familyId === familyId) || null; }
function familyByQuestionFamily(questionFamily) { return OWNER_TRIAL_COVERAGE.find(item => item.questionFamily === questionFamily) || null; }

/** goalKind → 覆盖它的族（含未支持族，用于解释不可准入的原因）。 */
function familiesForGoalKind(goalKind) {
    return OWNER_TRIAL_COVERAGE.filter(entry => entry.goalKinds.includes(goalKind));
}

/** 汇总覆盖情况；`canaryEligible` 只包含 SUPPORTED 且未被停用的族。 */
function ownerTrialCoverageSummary() {
    const byStatus = status => OWNER_TRIAL_COVERAGE.filter(entry => coverageStatusOf(entry) === status);
    return Object.freeze({
        version: OWNER_TRIAL_COVERAGE_VERSION,
        total: OWNER_TRIAL_COVERAGE.length,
        supported: byStatus(COVERAGE_STATUS.SUPPORTED),
        partial: byStatus(COVERAGE_STATUS.PARTIAL),
        unsupported: byStatus(COVERAGE_STATUS.UNSUPPORTED),
        suspended: byStatus(COVERAGE_STATUS.SUSPENDED),
        canaryEligible: byStatus(COVERAGE_STATUS.SUPPORTED).map(entry => entry.questionFamily),
    });
}

/** S1 baseline：当前被冻结为可长期 canary 的族（含全部 S1 登记字段）。 */
function ownerTrialCoverageBaseline() {
    const summary = ownerTrialCoverageSummary();
    return Object.freeze({
        version: S1_BASELINE_VERSION,
        families: Object.freeze(summary.supported.map(entry => Object.freeze({
            familyId: entry.familyId,
            questionFamily: entry.questionFamily,
            goalKind: entry.goalKinds.length === 1 ? entry.goalKinds[0] : [...entry.goalKinds],
            goalKinds: entry.goalKinds,
            subjectTypes: entry.subjectTypes,
            requiredCapabilities: entry.requiredCapabilities,
            requiredFacts: entry.requiredFacts,
            ambiguityPolicy: entry.ambiguityPolicy,
            answerContract: entry.answerContract,
            canaryEligible: true,
        }))),
        suspendedFamilies: Object.freeze([...FAMILY_SUSPENSIONS.values()]),
    });
}

/**
 * S1：Owner **只读** canary 的唯一准入闸门。
 *
 * 判据全部来自服务器拥有的信息：已落定的 Task V2 计划目标种类 + 业务写策略 + 结构就绪。
 * 用户请求头、页面参数、prompt 或任何调用方字段都不能参与判定 —— 本函数**不接受**
 * questionFamily / 用户文本之类的输入，只接受计划本身；调用方声称的族名不会改变结果。
 *
 * 允许：全部目标种类都被至少一个 SUPPORTED（未停用）族覆盖 + 只读 + 结构就绪。
 * 拒绝：PARTIAL / UNSUPPORTED / unknown family / 写请求 / 未就绪。
 */
function ownerReadCanaryAdmission({ goalKinds = [], businessWritePolicy = 'FORBIDDEN', structuralReady = true } = {}) {
    const kinds = [...new Set((Array.isArray(goalKinds) ? goalKinds : [goalKinds]).filter(Boolean))];
    const base = { goalKinds: kinds, decision: 'LEGACY_SAFE_PATH' };
    if (structuralReady !== true) return Object.freeze({ ...base, eligible: false, reason: 'STRUCTURAL_NOT_READY', families: [] });
    if (businessWritePolicy !== 'FORBIDDEN') return Object.freeze({ ...base, eligible: false, reason: 'WRITE_BEARING_REQUEST', families: [] });
    if (!kinds.length) return Object.freeze({ ...base, eligible: false, reason: 'EMPTY_PLAN', families: [] });
    const ineligible = [];
    const families = new Set();
    for (const kind of kinds) {
        const covering = familiesForGoalKind(kind).filter(entry => coverageStatusOf(entry) === COVERAGE_STATUS.SUPPORTED);
        if (!covering.length) { ineligible.push(kind); continue; }
        for (const entry of covering) families.add(entry.questionFamily);
    }
    if (ineligible.length) return Object.freeze({ ...base, eligible: false, reason: 'FAMILY_NOT_SUPPORTED', ineligibleGoalKinds: Object.freeze(ineligible), families: Object.freeze([...families]) });
    return Object.freeze({ ...base, eligible: true, decision: 'NATIVE_CANARY', reason: 'SUPPORTED_AND_READ_ONLY', families: Object.freeze([...families]) });
}

/**
 * Owner trial 覆盖就绪度。
 * 结构测试全绿**不**等于 canary 就绪；必须有明确的 SUPPORTED 范围。
 */
function ownerTrialCoverageReadiness({ structuralReady = false } = {}) {
    const summary = ownerTrialCoverageSummary();
    const ready = structuralReady === true && summary.canaryEligible.length > 0;
    return Object.freeze({
        status: ready ? 'READY_WITHIN_SUPPORTED_SCOPE' : 'NOT_READY',
        ready,
        structuralReady: structuralReady === true,
        canaryScope: summary.canaryEligible,
        excludedScope: [...summary.partial, ...summary.unsupported, ...summary.suspended].map(entry => entry.questionFamily),
        counts: summary,
    });
}

/**
 * E2：Owner Canary admission —— 只允许 SUPPORTED 问法族进入 canary。
 * 这是代码层的 admission 判定；本阶段**不**进行生产 canary。
 */
function canaryAdmission({ questionFamily, structuralReady = true } = {}) {
    const entry = familyByQuestionFamily(questionFamily);
    if (!entry) return Object.freeze({ questionFamily: questionFamily ?? null, eligible: false, status: null, reason: 'UNKNOWN_QUESTION_FAMILY' });
    const status = coverageStatusOf(entry);
    if (status === COVERAGE_STATUS.SUSPENDED) {
        return Object.freeze({ questionFamily, eligible: false, status, reason: 'FAMILY_SUSPENDED', suspension: FAMILY_SUSPENSIONS.get(entry.familyId) || null });
    }
    if (status !== COVERAGE_STATUS.SUPPORTED) return Object.freeze({ questionFamily, eligible: false, status, reason: 'FAMILY_NOT_SUPPORTED' });
    if (structuralReady !== true) return Object.freeze({ questionFamily, eligible: false, status, reason: 'STRUCTURAL_NOT_READY' });
    return Object.freeze({ questionFamily, eligible: true, status, reason: 'SUPPORTED_AND_STRUCTURALLY_READY' });
}

/**
 * E2：coverage 与真实 capability support 的一致性。
 * SUPPORTED 族声明的 requiredCapabilities 必须真的登记在能力注册表里，
 * 只改状态字符串会被这里挡下。
 */
function validateCoverageAgainstCapabilities() {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const problems = [];
    for (const entry of OWNER_TRIAL_COVERAGE) {
        const status = coverageStatusOf(entry);
        if (status === COVERAGE_STATUS.SUSPENDED && !FAMILY_SUSPENSIONS.has(entry.familyId)) problems.push({ familyId: entry.familyId, reason: 'SUSPENDED_WITHOUT_RECORD' });
        if (![COVERAGE_STATUS.SUPPORTED, COVERAGE_STATUS.SUSPENDED].includes(status)) continue;
        if (!Array.isArray(entry.requiredCapabilities) || entry.requiredCapabilities.length === 0) {
            problems.push({ questionFamily: entry.questionFamily, reason: 'SUPPORTED_WITHOUT_CAPABILITIES' });
            continue;
        }
        for (const capability of entry.requiredCapabilities) {
            if (!getAiCapability(capability)) problems.push({ questionFamily: entry.questionFamily, reason: `UNREGISTERED_CAPABILITY:${capability}` });
        }
        if (!Array.isArray(entry.requiredFacts) || entry.requiredFacts.length === 0) {
            problems.push({ questionFamily: entry.questionFamily, reason: 'SUPPORTED_WITHOUT_REQUIRED_FACTS' });
        }
        if (!entry.answerContract) problems.push({ questionFamily: entry.questionFamily, reason: 'SUPPORTED_WITHOUT_ANSWER_CONTRACT' });
        if (!Array.isArray(entry.goalKinds) || entry.goalKinds.length === 0) problems.push({ questionFamily: entry.questionFamily, reason: 'SUPPORTED_WITHOUT_GOAL_KINDS' });
    }
    return Object.freeze({ consistent: problems.length === 0, problems });
}

module.exports = {
    canaryAdmission,
    coverageStatusOf,
    familiesForGoalKind,
    familyById,
    familyByQuestionFamily,
    ownerReadCanaryAdmission,
    ownerTrialCoverageBaseline,
    ownerTrialCoverageSummary,
    ownerTrialCoverageReadiness,
    reinstateFamily,
    suspendFamily,
    validateCoverageAgainstCapabilities,
    COVERAGE_STATUS,
    FAMILY_SUSPENSIONS,
    OWNER_TRIAL_COVERAGE,
    OWNER_TRIAL_COVERAGE_VERSION,
    S1_BASELINE_VERSION,
};
