'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');
function messagesForMinimalPlanner(input) {
    return [{ role: 'system', content: [
        '你是 Owner 的业务 Planner。读完整原话、完整公司业务理解、完整处理规则和本轮只读正式目录，输出简短业务摘要和最少的请求字段。不要输出逐步推理。',
        '原话是老板目标的第一来源；Business Memo 是业务分类的依据，明确分类时必须沿用；Policy Memo 是临时试算/保存边界的依据。目录只提供正式对象候选，正式身份由后续代码查证。不要自行计算正式成本。',
        '只从老板原话逐字复制 REFERENCE_MENTION、RELATION_REQUEST、SCENARIO_CHANGE 的连续片段，不补词、不改写。REFERENCE_MENTION 只表示需要绑定正式身份的业务对象；配置值和场景变化只填 SCENARIO_CHANGE，不重复填 REFERENCE_MENTION。每个独立正式对象一行 REFERENCE_MENTION；不输出 ID、对象类型、规范名或单一复合查询。多个候选时保留老板提及的原话，不选第一个。',
        '只输出：PLANNING_BRIEF（一到三句）；REQUESTED_RESULT（VALUE|LIST|COUNT|DELTA|DETAIL|NONE）；METRIC（COST|NONE）；REFERENCE_MENTION（可多行或 NONE）；RELATION_REQUEST（原话片段或 NONE）；SCENARIO_CHANGE（可多行，原话片段 | PACKAGING|CABLE|FLOAT|SURFACE_TREATMENT|ROTOR_PROCESS|COIL|BARREL|OTHER，或 NONE）；WRITE_REQUIRED（YES|NO）。',
        'VALUE 表示具体值，DELTA 表示差额，COUNT 表示数量，LIST 表示清单，DETAIL 表示解释，NONE 表示只要求动作而不要求返回数值。若询问当前关联对象或对象包含的关联项清单，填写 RELATION_REQUEST；不要因为关联结果是详情而丢失关系语义。只要求执行写动作而未要求返回金额时，METRIC 为 NONE。',
        '场景变化必须保留全部配置条件。分类遵从 Business Memo。WRITE_REQUIRED 遵从 Policy Memo。不要输出 REQUEST_MODE、GOAL_FACT、SELECTION_REQUIREMENT、PLAN_STATUS、Capability、Tool、API、SQL 或数据库表。',
        `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
        `RECENT_CONVERSATION:\n${input.recentConversation || 'NONE'}`,
        `BUSINESS_MEMO:\n${input.businessMemo}`,
        `POLICY_MEMO:\n${input.policyMemo}`,
        `READ_ONLY_BUSINESS_CATALOG:\n${JSON.stringify(input.catalogSnapshot)}`,
    ].join('\n\n') }, { role: 'user', content: '输出简短 Planning Brief 和最小行协议。' }];
}
async function runMinimalPlannerAgent(input, dependencies = {}) { return (dependencies.modelCall || callDeepSeek)(messagesForMinimalPlanner(input), dependencies); }
module.exports = { messagesForMinimalPlanner, runMinimalPlannerAgent };
