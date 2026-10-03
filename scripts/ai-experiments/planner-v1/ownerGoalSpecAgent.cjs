'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');

function renderTargets(targets) { return (targets || []).map(target => `owner-mention=${target.mention || 'NONE'} | formal-status=${target.status} | canonical-name=${target.canonicalName || 'NONE'} | resolver-evidence=PROVIDED`).join('\n') || 'NONE'; }

function messagesForOwnerGoalSpec(input) {
    return [
        { role: 'system', content: [
            '你是 Owner Goal Spec Planner。你只描述老板最终希望得到的业务结果；Frozen upstream 已完成业务理解和正式 Grounding。',
            '你不能重新 Grounding、改变正式 target、创造 formal ID、选择多个候选的默认项，也不知道 capability、API、Tool、数据库、计划步骤或能力是否存在。绝不能输出这些内容。',
            'GOAL_KIND 只能是 EXPLAIN | READ_VALUE | READ_RELATION | LIST | COUNT | PREVIEW_SCENARIO | COMPARE_TARGETS | COMPARE_SCENARIO。RESULT_SHAPE 只能是 VALUE | DETAIL | LIST | COUNT | DELTA | NONE。METRIC 只能是 COST | NONE。',
            'EXPLAIN 用于概念解释；READ_VALUE 用于读取一个数值；READ_RELATION 用于当前关系；LIST 用于关系列表；COUNT 用于候选集合数量；PREVIEW_SCENARIO 用于变化后的结果；COMPARE_TARGETS 用于两个明确对象的差异；COMPARE_SCENARIO 用于当前对象与老板明确变化场景的差异。',
            'TARGET 只能复制 Frozen Grounding 已给出的 owner mention 或 canonical name。RELATION_REQUEST 仅用于关系/列表需求，且必须是老板原话中的实际连续文字片段。SCENARIO_OVERRIDE 每行必须直接复制老板原话中的实际连续文字片段，格式“SCENARIO_OVERRIDE: owner wording | PACKAGING|CABLE|FLOAT|SURFACE_TREATMENT|ROTOR_PROCESS|COIL|BARREL|OTHER”；不得改写、补词或同义转述。',
            'WRITE_REQUIRED 只反映老板是否明确要求正式保存/修改；读取、预览、“先算一下”或“不保存”是 NO。每个请求只输出一个 primary GOAL_KIND；如果老板明确含多个独立目标，仍选最主要的一个 Goal Kind。',
            '严格只输出下列行，不写解释：',
            'GOAL_KIND: ...', 'RESULT_SHAPE: ...', 'METRIC: COST|NONE', 'TARGET: Frozen Grounding 中的 owner mention 或 canonical name（可多行）', 'RELATION_REQUEST: owner wording 或 NONE', 'SCENARIO_OVERRIDE: owner wording | SCENARIO_CLASS（可多行）', 'WRITE_REQUIRED: YES|NO',
            '禁止输出 GOAL_FACT、REQUIREMENT_STATUS、SELECTION_REQUIREMENT、Capability、Tool、API、DB、步骤或输入回显。',
            `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
            `BUSINESS_MEMO:\n${input.businessMemo}`,
            `POLICY_MEMO:\n${input.policyMemo}`,
            `GROUNDING_RESULT:\n${input.groundingResult}`,
            `FINAL_GROUNDED_TARGETS:\n${renderTargets(input.finalGroundedTargets)}`,
            `GROUNDING_AMBIGUITY:\n${input.groundingAmbiguity || 'NONE'}`,
            `CANDIDATE_SET_COMPLETE:\n${input.candidateSetComplete || 'UNKNOWN'}`,
        ].join('\n\n') },
        { role: 'user', content: '只按 Owner Goal Spec 行协议输出。' },
    ];
}

async function runOwnerGoalSpecAgent(input, dependencies = {}) { return (dependencies.modelCall || callDeepSeek)(messagesForOwnerGoalSpec(input), dependencies); }

module.exports = { messagesForOwnerGoalSpec, runOwnerGoalSpecAgent };
