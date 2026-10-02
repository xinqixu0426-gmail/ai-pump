'use strict';

const ROLE_RETRY_ADDENDUM = '上一轮输出与当前请求存在结构矛盾：当前请求包含正式事实查询信号，但你没有提出任何 FORMAL_ENTITY_CANDIDATE 或 CONFIG_VALUE。请重新检查老板原话中的业务主体。仍只按原 ROLE 协议输出，不得为了消除矛盾强行制造实体；如果确实没有 formal candidate，应保持原判断。';

function detectRoleContradiction({ conceptFastPath, roles = [] }) {
    const formalFactSignals = conceptFastPath?.status === 'NOT_MATCHED'
        ? conceptFastPath.detectedFormalFactSignals || []
        : [];
    const formalCandidateCount = roles.filter(item => item.role === 'FORMAL_ENTITY_CANDIDATE').length;
    const configValueCount = roles.filter(item => item.role === 'CONFIG_VALUE').length;
    const allConceptOnly = roles.length === 0 || roles.every(item => item.role === 'CONCEPT_ONLY');
    const triggered = formalFactSignals.length > 0 && formalCandidateCount === 0 && configValueCount === 0 && allConceptOnly;
    return Object.freeze({
        triggered,
        reason: triggered ? 'FORMAL_FACT_SIGNAL_WITH_ONLY_CONCEPT_OR_EMPTY_ROLE_OUTPUT' : null,
        formalFactSignals: Object.freeze([...formalFactSignals]),
        formalCandidateCount,
        configValueCount,
        allConceptOnly,
    });
}

module.exports = { ROLE_RETRY_ADDENDUM, detectRoleContradiction };
