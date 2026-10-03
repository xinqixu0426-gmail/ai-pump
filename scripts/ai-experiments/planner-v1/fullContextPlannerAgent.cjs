'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');

function messagesForFullContextPlanner(input) {
    return [
        { role: 'system', content: [
            '你是 Owner 的业务 Planner。完整判断老板要获得的结果、正式对象、场景变化与处理边界。只输出简短可审计业务计划摘要和指定行协议，不输出逐步推理。',
            '信任层级：RAW_OWNER_INPUT 是目标第一来源；完整 BUSINESS_MEMO 只解释公司业务语义；完整 POLICY_MEMO 约束只读、临时试算与持久化；本轮 READ_ONLY_BUSINESS_CATALOG 是正式对象存在性证据。不要发明目录中不存在的 ID、成本或其它正式事实。',
            '若 Business Memo 明确业务分类，沿用它。若 Policy Memo 明确临时预览或保存边界，沿用它。正式金额仍要后续正式能力读取/试算，不能从目录清单自行计算。',
            '正式对象引用格式为 SELECTED_REFERENCE: recipe|coil|template|part | 数字ID | 目录中的完整规范名称，可多行。需要一个对象但目录有多个兼容候选时不要默认选一个；保留 REFERENCE_QUERY 的老板原话连续片段，不输出单一 SELECTED_REFERENCE。请求本身要候选集合数量时也可不选单一对象。',
            'REFERENCE_QUERY: 老板原话中用于查找目录对象的实际连续片段，或 NONE。RELATION_REQUEST 与 SCENARIO_CHANGE 的表达也必须是老板原话实际连续片段；不允许同义改写。每个独立场景变化写一行 SCENARIO_CHANGE: 原话片段 | PACKAGING|CABLE|FLOAT|SURFACE_TREATMENT|ROTOR_PROCESS|COIL|BARREL|OTHER。',
            'REQUEST_MODE 只能 READ、PREVIEW、WRITE、EXPLAIN。REQUESTED_RESULT 只能 VALUE、LIST、COUNT、DELTA、DETAIL、NONE。METRIC 只能 COST 或 NONE。WRITE_REQUIRED 只能 YES 或 NO。两个对象分别要数值是 VALUE；问差额是 DELTA。只要求保存且不要求数值是 NONE。',
            '严格输出：PLANNING_BRIEF: 一到三句业务摘要；REQUEST_MODE: ...；REQUESTED_RESULT: ...；METRIC: ...；REFERENCE_QUERY: ...；SELECTED_REFERENCE: ...（可多行，或 NONE）；RELATION_REQUEST: ...；SCENARIO_CHANGE: ...（可多行，或 NONE）；WRITE_REQUIRED: ...。不要输出能力名、Tool、API、SQL、数据库表或执行结果。',
            `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
            `RECENT_CONVERSATION:\n${input.recentConversation || 'NONE'}`,
            `BUSINESS_MEMO:\n${input.businessMemo}`,
            `POLICY_MEMO:\n${input.policyMemo}`,
            `READ_ONLY_BUSINESS_CATALOG:\n${JSON.stringify(input.catalogSnapshot)}`,
        ].join('\n\n') },
        { role: 'user', content: '结合完整上下文，输出简短 Planning Brief 和行协议。' },
    ];
}
async function runFullContextPlannerAgent(input, dependencies = {}) { return (dependencies.modelCall || callDeepSeek)(messagesForFullContextPlanner(input), dependencies); }
module.exports = { messagesForFullContextPlanner, runFullContextPlannerAgent };
