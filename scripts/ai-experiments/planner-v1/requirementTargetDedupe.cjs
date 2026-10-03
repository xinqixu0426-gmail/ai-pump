'use strict';

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s\-－–—]/gu, '').toLowerCase(); }
function matches(proposed, target) {
    const expression = normalized(proposed);
    return [target.mention, target.canonicalName].filter(Boolean).some(value => normalized(value) === expression);
}
function targetKey(target, fallback) { return target.canonicalId !== undefined && target.canonicalId !== null ? `${target.entityType || 'formal'}:${target.canonicalId}` : `expression:${normalized(fallback)}`; }

function dedupeRequirementTargets({ requirement, context }) {
    const rawTargets = Object.freeze([...(requirement.targets || [])]);
    const seen = new Set();
    const targets = [];
    let deduplications = 0;
    for (const proposed of rawTargets) {
        const resolved = (context.finalGroundedTargets || []).find(target => matches(proposed, target));
        const key = targetKey(resolved || {}, proposed);
        if (seen.has(key)) { deduplications += 1; continue; }
        seen.add(key);
        targets.push(resolved?.mention || proposed);
    }
    return Object.freeze({ rawTargets, targets: Object.freeze(targets), targetDeduplications: deduplications });
}

module.exports = { dedupeRequirementTargets };
