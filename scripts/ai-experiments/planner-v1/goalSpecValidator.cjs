'use strict';

const { GOAL_KINDS, RESULT_SHAPES, METRICS, SCENARIO_CLASSES } = require('./goalSpecMemo.cjs');

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s，。！？、:：;；,.!?（）()\-－–—]/gu, '').toLowerCase(); }
function contains(value, term) { return normalized(value).includes(normalized(term)); }
const SHAPES = Object.freeze({ EXPLAIN: new Set(['DETAIL', 'NONE']), READ_VALUE: new Set(['VALUE']), READ_RELATION: new Set(['VALUE', 'DETAIL']), LIST: new Set(['LIST']), COUNT: new Set(['COUNT']), PREVIEW_SCENARIO: new Set(['VALUE', 'DETAIL']), COMPARE_TARGETS: new Set(['DELTA']), COMPARE_SCENARIO: new Set(['DELTA']) });

function validationResult(violations) { return Object.freeze({ validationStatus: violations.length ? 'INVALID' : 'VALID', violations: Object.freeze(violations) }); }
function groundedTerms(context) { return (context.finalGroundedTargets || []).flatMap(target => [target.mention, target.canonicalName].filter(Boolean)); }

function validateGoalSpec({ goalSpec, context }) {
    const violations = [];
    const add = (code, detail = null) => violations.push(Object.freeze({ code, detail }));
    if (!GOAL_KINDS.has(goalSpec.goalKind)) add('GOAL_SPEC_KIND_INVALID', goalSpec.goalKind);
    if (!RESULT_SHAPES.has(goalSpec.resultShape)) add('GOAL_SPEC_RESULT_SHAPE_INVALID', goalSpec.resultShape);
    if (!METRICS.has(goalSpec.metric)) add('GOAL_SPEC_METRIC_INVALID', goalSpec.metric);
    if (GOAL_KINDS.has(goalSpec.goalKind) && !SHAPES[goalSpec.goalKind].has(goalSpec.resultShape)) add('GOAL_SPEC_KIND_SHAPE_INVALID', `${goalSpec.goalKind}:${goalSpec.resultShape}`);
    if (!['YES', 'NO'].includes(goalSpec.writeRequired)) add('GOAL_SPEC_WRITE_INVALID', goalSpec.writeRequired);
    const terms = groundedTerms(context);
    if (goalSpec.goalKind === 'EXPLAIN') {
        if (goalSpec.targets.length) add('GOAL_SPEC_EXPLAIN_TARGET_FORBIDDEN');
    } else if (context.groundingResult !== 'UNRESOLVED' && !goalSpec.targets.length) add('GOAL_SPEC_TARGET_MISSING');
    for (const target of goalSpec.targets) if (!terms.some(term => contains(target, term) || contains(term, target))) add('GOAL_SPEC_TARGET_NOT_FROM_GROUNDING', target);
    for (const override of goalSpec.scenarioOverrides) {
        if (!SCENARIO_CLASSES.has(override.scenarioClass)) add('GOAL_SPEC_SCENARIO_CLASS_INVALID', override.scenarioClass);
        if (!contains(context.rawOwnerInput, override.expression)) add('GOAL_SPEC_OVERRIDE_NOT_IN_OWNER_WORDING', override.expression);
    }
    if (goalSpec.relationRequest && !contains(context.rawOwnerInput, goalSpec.relationRequest)) add('GOAL_SPEC_RELATION_REQUEST_NOT_IN_OWNER_WORDING', goalSpec.relationRequest);
    if (['READ_RELATION', 'LIST'].includes(goalSpec.goalKind) && !goalSpec.relationRequest) add('GOAL_SPEC_RELATION_REQUEST_MISSING');
    if (['PREVIEW_SCENARIO', 'COMPARE_SCENARIO'].includes(goalSpec.goalKind) && !goalSpec.scenarioOverrides.length) add('GOAL_SPEC_SCENARIO_OVERRIDE_MISSING');
    if (goalSpec.goalKind === 'COUNT' && goalSpec.metric !== 'NONE') add('GOAL_SPEC_COUNT_METRIC_INVALID');
    return validationResult(violations);
}

module.exports = { validateGoalSpec, SHAPES };
