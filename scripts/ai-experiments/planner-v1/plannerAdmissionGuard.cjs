'use strict';

function hasMultiple(targets) { return (targets || []).some(target => target.status === 'MULTIPLE' || target.status === 'MULTIPLE_TYPE'); }
function hasExactOrQualified(targets) { return (targets || []).some(target => ['EXACT', 'QUALIFIED_EXACT', 'QUALIFIED_SET'].includes(target.status)); }
function explicitNoSave(rawOwnerInput, policyMemo) { return /不保存|先算一下|仅预览|临时试算/u.test(`${rawOwnerInput || ''}\n${policyMemo || ''}`); }

function buildPlannerAdmission({ rawOwnerInput, upstream }) {
    const targets = upstream.finalGroundedTargets || [];
    const unresolved = upstream.groundingResult === 'UNRESOLVED' || !targets.length && upstream.groundingResult !== 'NOT_REQUIRED';
    const exactOrQualified = hasExactOrQualified(targets);
    const multiple = hasMultiple(targets) || upstream.groundingResult === 'MULTIPLE';
    return Object.freeze({
        unresolved,
        exactOrQualified,
        multiple,
        candidateSetComplete: multiple ? (upstream.candidateSetComplete || 'UNKNOWN') : 'NO',
        explicitNoSave: explicitNoSave(rawOwnerInput, upstream.policyMemo),
        allowedStatuses: Object.freeze(unresolved ? ['BLOCKED_GROUNDING'] : multiple ? ['READY', 'NO_TOOL_REQUIRED', 'BLOCKED_AMBIGUITY', 'BLOCKED_CAPABILITY', 'BLOCKED_POLICY'] : ['READY', 'NO_TOOL_REQUIRED', 'BLOCKED_CAPABILITY', 'BLOCKED_POLICY']),
    });
}

function validatePlannerAdmission({ plan, admission }) {
    const violations = [];
    if (admission.unresolved && plan.status !== 'BLOCKED_GROUNDING') violations.push('STATUS_GROUNDING_CONTRADICTION');
    if (admission.exactOrQualified && plan.status === 'BLOCKED_GROUNDING') violations.push('STATUS_GROUNDING_CONTRADICTION');
    if (admission.exactOrQualified && !admission.multiple && plan.status === 'BLOCKED_AMBIGUITY') violations.push('STATUS_GROUNDING_CONTRADICTION');
    if (admission.explicitNoSave && plan.status === 'BLOCKED_POLICY') violations.push('STATUS_POLICY_CONTRADICTION');
    return Object.freeze([...new Set(violations)]);
}

module.exports = { buildPlannerAdmission, validatePlannerAdmission };
