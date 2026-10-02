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
    return catalog.visibleCapabilities.map(capability => `${capability.capabilityId} | ${capability.mode} | ${capability.description} | inputs=${capability.inputSemantics} | outputs=${capability.outputSemantics}`).join('\n');
}

function messagesForPlanner(input) {
    return [
        { role: 'system', content: [
            '你是 Planner V1。唯一职责：在 frozen upstream 已经完成理解和正式 Grounding 后，规划完成老板目标还需要哪些正式事实，以及它们的依赖顺序。',
            '你不能重新 Grounding、改写正式 target、选择 MULTIPLE 的默认候选、创造 ID、把配置值提升为实体，或用 Business/Policy Memo 当正式事实。',
            '你只生成 Business Capability Plan，绝不执行。不得输出 API、HTTP、SQL、数据库表、工具名、函数名、执行器或调用步骤。只能选择下方 Capability Catalog 的 capabilityId。',
            '只允许 PLAN_STATUS: READY | NO_TOOL_REQUIRED | BLOCKED_GROUNDING | BLOCKED_AMBIGUITY | BLOCKED_CAPABILITY | BLOCKED_POLICY。',
            '步骤 MODE 只能是 READ | ANALYSIS | PREVIEW | COMPUTE。COMPUTE 是内置确定性原语，不是 Business Capability：CAPABILITY 必须写 NONE，target 写 inputs=已有FACT_ID逗号列表；它只能做已取得事实的差值/汇总/计数/比较，不能读取外部数据。禁止 WRITE。',
            '对概念问题且 Grounding NOT_REQUIRED 使用 NO_TOOL_REQUIRED；UNRESOLVED 使用 BLOCKED_GROUNDING。MULTIPLE 必须写 AMBIGUITY_USAGE：需要从多个候选中选一个以获得候选专属事实时用 SELECTION_REQUIRED 并 BLOCKED_AMBIGUITY；老板目标就是候选集合、数量或列表时用 SET_CONSUMABLE，不得因多个候选自动阻断。显式限定的多个正式 target 不是 unresolved ambiguity。',
            '选择能直接、权威且最少步骤产出所需事实的 Catalog capability。一个直接 capability 可以替代多个低层读取和本地组合；不要为了固定模板拆分。成本预览 capability 若其输出已包含当前与场景成本，可直接作为比较事实来源。',
            '所有 REQUIRED_FACT 都必须由一个 STEP 产生，或标记 sourceRequirement=FROZEN_UPSTREAM_EVIDENCE。每个 STEP produces 必须是一个 REQUIRED_FACT；depends 只引用存在的前序 STEP。多个独立对象读取可并行且必须保留全部对象与全部配置变化。',
            'BLOCKED_GROUNDING、BLOCKED_AMBIGUITY、BLOCKED_CAPABILITY、NO_TOOL_REQUIRED 必须零 STEP。BLOCKED_CAPABILITY 必须写真实 MISSING_CAPABILITY。显式保存写请求使用 BLOCKED_POLICY；可写 PREVIEW_PLAN_AVAILABLE: YES 并仅规划 READ/PREVIEW/COMPUTE 安全子计划，绝不能产生 WRITE step。本阶段 WRITE_REQUIRED: YES 时不能 READY。',
            '严格只输出下列行协议，不写解释或其它文字：',
            'PLAN_STATUS: ...',
            'OWNER_GOAL: ...',
            'AMBIGUITY_USAGE: NONE|SELECTION_REQUIRED|SET_CONSUMABLE',
            'GROUNDED_TARGET: ...',
            'REQUIRED_FACT: F1 | description | target | AUTHORITATIVE_BUSINESS_SOURCE | NONE',
            'STEP: P1 | READ | capability-id | target | F1 | NONE',
            'STEP: P2 | COMPUTE | NONE | inputs=F1,F2 | F3 | P1',
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
