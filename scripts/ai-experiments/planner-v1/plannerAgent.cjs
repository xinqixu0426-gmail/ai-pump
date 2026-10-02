'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');

function renderTargets(targets) {
    return (targets || []).map(target => [
        `owner-mention=${target.mention || 'NONE'}`,
        `formal-status=${target.status}`,
        `canonical-name=${target.canonicalName || 'NONE'}`,
        'resolver-evidence=PROVIDED',
    ].join(' | ')).join('\n') || 'NONE';
}

function renderCatalog(catalog) {
    return catalog.visibleCapabilities.map(capability => `${capability.capabilityId} | ${capability.mode} | ${capability.description}`).join('\n');
}

function messagesForPlanner(input) {
    return [
        { role: 'system', content: [
            '你是 Planner V1。唯一职责：在 frozen upstream 已经完成理解和正式 Grounding 后，规划完成老板目标还需要哪些正式事实，以及它们的依赖顺序。',
            '你不能重新 Grounding、改写正式 target、选择 MULTIPLE 的默认候选、创造 ID、把配置值提升为实体，或用 Business/Policy Memo 当正式事实。',
            '你只生成 Business Capability Plan，绝不执行。不得输出 API、HTTP、SQL、数据库表、工具名、函数名、执行器或调用步骤。只能选择下方 Capability Catalog 的 capabilityId。',
            '只允许 PLAN_STATUS: READY | NO_TOOL_REQUIRED | BLOCKED_GROUNDING | BLOCKED_AMBIGUITY | BLOCKED_CAPABILITY | BLOCKED_POLICY。',
            '步骤 MODE 只能是 READ | ANALYSIS | PREVIEW | COMPUTE。COMPUTE 只可对已获取正式事实做确定性差值/汇总/计数，CAPABILITY 必须写 LOCAL_DETERMINISTIC。禁止 WRITE。',
            '对概念问题且 Grounding NOT_REQUIRED 使用 NO_TOOL_REQUIRED；UNRESOLVED 使用 BLOCKED_GROUNDING；方案专属事实的 MULTIPLE 使用 BLOCKED_AMBIGUITY；显式保存写请求使用 BLOCKED_POLICY，并可写 PREVIEW_PLAN_AVAILABLE: YES 但不能产生 WRITE step。',
            '成本预览先列当前正式配置、权威成本基准、场景预览和差额四类 facts；预览依赖当前配置；差额依赖基准和预览。多个独立对象读取可并行且必须保留全部对象与全部配置变化。',
            '严格只输出下列行协议，不写解释或其它文字：',
            'PLAN_STATUS: ...',
            'OWNER_GOAL: ...',
            'GROUNDED_TARGET: ...',
            'REQUIRED_FACT: F1 | description | target | AUTHORITATIVE_BUSINESS_SOURCE | NONE',
            'STEP: P1 | READ | capability-id | target | F1 | NONE',
            'COMPLETION: ...',
            'WRITE_REQUIRED: YES|NO',
            'PREVIEW_PLAN_AVAILABLE: YES|NO（仅适用时）',
            'MISSING_CAPABILITY: ...（仅 BLOCKED_CAPABILITY）',
            'UPSTREAM_CONTRACT_GAP: ...（仅 frozen upstream 输入确有矛盾时）',
            `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
            `BUSINESS_MEMO:\n${input.businessMemo}`,
            `POLICY_MEMO:\n${input.policyMemo}`,
            `GROUNDING_RESULT:\n${input.groundingResult}`,
            `FINAL_GROUNDED_TARGETS:\n${renderTargets(input.finalGroundedTargets)}`,
            `GROUNDING_AMBIGUITY:\n${input.groundingAmbiguity || 'NONE'}`,
            `READ-ONLY CAPABILITY CATALOG:\n${renderCatalog(input.capabilityCatalog)}`,
        ].join('\n\n') },
        { role: 'user', content: '只按 Planner Memo 行协议输出。' },
    ];
}

async function runPlannerAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForPlanner(input), dependencies);
}

module.exports = { messagesForPlanner, runPlannerAgent };
