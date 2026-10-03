'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');

function renderTargets(targets) {
    return (targets || []).map(target => `owner-mention=${target.mention || 'NONE'} | formal-status=${target.status} | canonical-name=${target.canonicalName || 'NONE'} | resolver-evidence=PROVIDED`).join('\n') || 'NONE';
}

function messagesForRequirementPlanner(input, retryAddendum = null) {
    return [
        { role: 'system', content: [
            '你是 Requirement Planner。你唯一职责是表达：为满足老板当前目标，需要哪些业务事实。Frozen upstream 已经完成理解和正式 Grounding。',
            '你不能重新 Grounding、改变正式 target、选择 MULTIPLE 的默认候选、创造 formal ID、把配置值升级为实体。你不知道系统 capability、API、Tool、数据库、执行步骤和能力是否存在；绝不能猜测或输出这些内容。',
            'REQUIREMENT_STATUS 只作原始观测记录：READY | NO_FORMAL_FACT_REQUIRED | UNRESOLVED_GROUNDING。它会由后续冻结 Grounding 证据确定性归一；不要用它代替 GOAL_FACT、Selection 或场景判断。',
            'GOAL_FACT 只能是 FORMAL_DETAIL | CURRENT_COST | RELATION | CANDIDATE_SET | SCENARIO_COST | SCENARIO_COMPARISON | COST_DIFFERENCE | OTHER。GOAL_FACT 只表示老板明确要求得到的终点业务结果；不要把执行中间事实或 capability 可能顺带返回的事实写入。每个 GOAL_FACT 必须使用格式“GOAL_FACT: FACT_CLASS | OWNER_SPAN=老板原话中的实际连续文字片段”。只有老板明确同时要求多个结果时才输出多个 GOAL_FACT。',
            'SELECTION_REQUIREMENT 只能是 NONE | SINGLE_TARGET_REQUIRED | WHOLE_SET。多个候选中需要某个候选专属事实时 SINGLE_TARGET_REQUIRED；目标本身是候选集合、数量或列表时 WHOLE_SET；显式限定的多个正式 target 用 NONE。',
            '场景变化必须逐行直接复制老板原话中的实际连续文字片段，不要改写、补词或同义转述；每行可选分类 PACKAGING | CABLE | FLOAT | SURFACE_TREATMENT | ROTOR_PROCESS | COIL | BARREL | OTHER。PACKAGING 是包装材料或方式；CABLE 是电缆长度、规格或线缆配置；FLOAT 是浮球相关配置；SURFACE_TREATMENT 是表面处理/表面工艺；ROTOR_PROCESS 是转子制造/加工工艺（如接轴、转轴相关工艺选项）；COIL 是线圈方案/绕组变化；BARREL 是机筒/桶体长度变化。只有 Business Memo 无法归入这些类别才使用 OTHER。不要把它翻译成数据库字段或正式 ID。',
            'WRITE_REQUIRED 只反映老板是否明确要求正式保存/修改；“先算一下、不保存、预览”是 NO。当前阶段写入限制会由后续确定性层处理。',
            '严格只输出下列行，不写解释：',
            'REQUIREMENT_STATUS: ...',
            'OWNER_GOAL: ...',
            'TARGET: Frozen Grounding 中的 owner mention 或 canonical name（可多行）',
            'GOAL_FACT: FACT_CLASS | OWNER_SPAN=...（可多行）',
            'SELECTION_REQUIREMENT: NONE|SINGLE_TARGET_REQUIRED|WHOLE_SET',
            'SCENARIO_OVERRIDE: owner wording | SCENARIO_CLASS（可多行）',
            'WRITE_REQUIRED: YES|NO',
            '不要输出 RAW_OWNER_INPUT、BUSINESS_MEMO、POLICY_MEMO、GROUNDING_RESULT 或任何输入回显。',
            retryAddendum ? `RETRY_ADDENDUM:\n${retryAddendum}` : null,
            `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
            `BUSINESS_MEMO:\n${input.businessMemo}`,
            `POLICY_MEMO:\n${input.policyMemo}`,
            `GROUNDING_RESULT:\n${input.groundingResult}`,
            `FINAL_GROUNDED_TARGETS:\n${renderTargets(input.finalGroundedTargets)}`,
            `GROUNDING_AMBIGUITY:\n${input.groundingAmbiguity || 'NONE'}`,
            `CANDIDATE_SET_COMPLETE:\n${input.candidateSetComplete || 'UNKNOWN'}`,
            'STAGE_CONSTRAINT: READ / ANALYSIS / PREVIEW only; WRITE disabled.',
        ].filter(Boolean).join('\n\n') },
        { role: 'user', content: '只按 Requirement Memo 行协议输出。' },
    ];
}

async function runRequirementPlannerAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForRequirementPlanner(input, dependencies.retryAddendum), dependencies);
}

module.exports = { messagesForRequirementPlanner, runRequirementPlannerAgent };
