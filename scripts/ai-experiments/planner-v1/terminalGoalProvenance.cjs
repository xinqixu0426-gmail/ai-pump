'use strict';

function normalized(value) { return String(value || '').normalize('NFKC').replace(/\s/gu, '').toLowerCase(); }
function matches(span, pattern) { return pattern.test(normalized(span)); }

function validateTerminalGoalProvenance({ rawOwnerInput, factClass, ownerSpan }) {
    const raw = String(rawOwnerInput || '');
    const span = String(ownerSpan || '');
    if (!span || !normalized(raw).includes(normalized(span))) return Object.freeze({ status: 'UNSUPPORTED', reason: 'OWNER_SPAN_NOT_PRESENT' });
    const supported = {
        COST_DIFFERENCE: /差多少|增加多少|减少多少|差异|相差|高多少|低多少/u,
        SCENARIO_COMPARISON: /差多少|增加多少|减少多少|差异|相差|高多少|低多少/u,
        SCENARIO_COST: /以后多少钱|后多少钱|场景成本|改后成本|换后成本|做后成本|先算一下|试算|算一下/u,
        RELATION: /哪个线圈|用哪个|有哪些|固定件|关系/u,
        CANDIDATE_SET: /几个方案|多少方案|有哪些方案|方案数量/u,
        FORMAL_DETAIL: /详情|明细|哪些固定件|固定件/u,
    };
    if (factClass === 'CURRENT_COST') {
        if (matches(span, /增加|减少|差异|相差|高多少|低多少/u)) return Object.freeze({ status: 'UNSUPPORTED', reason: 'COMPARISON_SPAN_IS_NOT_CURRENT_COST' });
        return matches(span, /当前成本|现在成本|成本|多少钱|价格/u)
            ? Object.freeze({ status: 'SUPPORTED', reason: 'OWNER_SPAN_SUPPORTS_TERMINAL_FACT' })
            : Object.freeze({ status: 'UNSUPPORTED', reason: 'OWNER_SPAN_DOES_NOT_SUPPORT_TERMINAL_FACT' });
    }
    if (!supported[factClass]) return Object.freeze({ status: 'AMBIGUOUS', reason: 'FACT_CLASS_NOT_HIGH_CONFIDENCE' });
    return matches(span, supported[factClass])
        ? Object.freeze({ status: 'SUPPORTED', reason: 'OWNER_SPAN_SUPPORTS_TERMINAL_FACT' })
        : Object.freeze({ status: 'UNSUPPORTED', reason: 'OWNER_SPAN_DOES_NOT_SUPPORT_TERMINAL_FACT' });
}

module.exports = { validateTerminalGoalProvenance };
