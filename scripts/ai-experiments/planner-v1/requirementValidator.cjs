'use strict';

const { GOAL_FACT_CLASSES, SELECTION_REQUIREMENTS, SCENARIO_CLASSES } = require('./requirementMemo.cjs');

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s，。！？、:：;；,.!?（）()\-－–—]/gu, '').toLowerCase(); }
function contains(value, term) { return normalized(value).includes(normalized(term)); }
function add(violations, code, detail = null) { violations.push(Object.freeze(detail ? { code, detail } : { code })); }
function explicitWriteIntent(rawOwnerInput) {
    if (/不保存|先算一下|仅预览|临时试算/u.test(String(rawOwnerInput || ''))) return 'NO';
    if (/保存|正式修改|改成.*并保存/u.test(String(rawOwnerInput || ''))) return 'YES';
    return null;
}

function validateRequirementMemo({ requirement, context }) {
    const violations = [];
    const targets = context.finalGroundedTargets || [];
    if (!requirement.ownerGoal) add(violations, 'REQUIREMENT_OWNER_GOAL_MISSING');
    if (!SELECTION_REQUIREMENTS.has(requirement.selectionRequirement)) add(violations, 'REQUIREMENT_SELECTION_INVALID');
    for (const fact of requirement.goalFacts) if (!GOAL_FACT_CLASSES.has(fact)) add(violations, 'REQUIREMENT_GOAL_FACT_INVALID', fact);
    for (const override of requirement.scenarioOverrides) {
        if (!SCENARIO_CLASSES.has(override.scenarioClass)) add(violations, 'REQUIREMENT_SCENARIO_CLASS_INVALID', override.scenarioClass);
        if (!contains(context.rawOwnerInput, override.expression)) add(violations, 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING', override.expression);
    }
    for (const proposed of requirement.targets) {
        const supplied = targets.some(target => [target.mention, target.canonicalName].some(value => value && contains(proposed, value)));
        if (!supplied) add(violations, 'REQUIREMENT_TARGET_NOT_FROM_GROUNDING', proposed);
    }
    if (requirement.status === 'NO_FORMAL_FACT_REQUIRED' && (requirement.goalFacts.length || requirement.targets.length || requirement.scenarioOverrides.length)) add(violations, 'REQUIREMENT_NO_FACT_CONTRADICTION');
    if (!['YES', 'NO'].includes(requirement.writeRequired)) add(violations, 'REQUIREMENT_WRITE_INVALID');
    const explicitIntent = explicitWriteIntent(context.rawOwnerInput);
    if (explicitIntent && requirement.writeRequired && requirement.writeRequired !== explicitIntent) add(violations, 'REQUIREMENT_WRITE_INTENT_CONTRADICTION');
    const unique = Object.freeze(violations.filter((value, index, values) => values.findIndex(other => other.code === value.code && other.detail === value.detail) === index));
    return Object.freeze({ validationStatus: unique.length ? 'INVALID' : 'VALID', violations: unique });
}

module.exports = { validateRequirementMemo, explicitWriteIntent };
