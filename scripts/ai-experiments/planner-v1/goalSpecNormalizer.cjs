'use strict';

const { dedupeRequirementTargets } = require('./requirementTargetDedupe.cjs');

function normalizeGoalSpec({ goalSpec, context }) {
    const dedupe = dedupeRequirementTargets({ requirement: goalSpec, context });
    return Object.freeze({
        rawTargets: dedupe.rawTargets,
        effectiveTargets: dedupe.targets,
        targetDeduplications: dedupe.targetDeduplications,
        goalSpec: Object.freeze({ ...goalSpec, targets: dedupe.targets, rawTargets: dedupe.rawTargets, targetDeduplications: dedupe.targetDeduplications }),
    });
}

module.exports = { normalizeGoalSpec };
