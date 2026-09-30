'use strict';

const { resolutionProjection } = require('../../../api/ontology/agentResolver.cjs');
const { validateGroundingContract } = require('./contracts.cjs');
const { FIXTURE } = require('./fixture.cjs');

function normal(value) { return String(value || '').replace(/正式配方|正式|配方|模板/g, '').trim(); }
function candidates(entityType, mention, fixture) {
    const key = normal(mention);
    if (entityType === 'coil') return fixture.coils.filter(item => item.designation === key).map(item => ({ entityType: 'coil', canonicalId: item.id, canonicalName: item.name, matchKind: 'EXACT' }));
    if (entityType === 'recipe') return fixture.recipes.filter(item => item.name.startsWith(key)).map(item => ({ entityType: 'recipe', canonicalId: item.id, canonicalName: item.name, matchKind: 'EXACT_OR_PREFIX' }));
    if (entityType === 'template') return fixture.templates.filter(item => item.name === key).map(item => ({ entityType: 'template', canonicalId: item.id, canonicalName: item.name, matchKind: 'EXACT' }));
    return [];
}
function binding(entityType, mention, fixture) {
    const list = candidates(entityType, mention, fixture);
    const projected = resolutionProjection(entityType, mention, { complete: true, candidates: list });
    return Object.freeze({ mention, concept: entityType === 'coil' ? 'COIL_COMMON_DESIGNATION' : entityType.toUpperCase(),
        status: projected.status === 'RESOLVED' ? 'UNIQUE' : projected.status, canonicalEntity: projected.verified ? { id: projected.canonicalId, name: projected.canonicalName } : null,
        candidates: projected.candidates.map(candidate => ({ id: candidate.canonicalId, name: candidate.canonicalName })) });
}
function entityTypesFor(semantic, business) {
    const types = new Set(); const concepts = new Set(business.concepts || []); const mentions = semantic.mentions || [];
    if (concepts.has('COIL_COMMON_DESIGNATION') || mentions.some(value => /^\d+-\d+$/.test(value))) types.add('coil');
    if (concepts.has('TEMPLATE') || mentions.some(value => value.includes('模板'))) types.add('template');
    if (concepts.has('RECIPE') || mentions.some(value => /^V\d+/i.test(value))) types.add('recipe');
    return [...types];
}
function runOntologyAgent(input = {}, dependencies = {}) {
    const fixture = dependencies.fixture || FIXTURE;
    const semantic = input.semanticContract; const business = input.businessContract;
    const bindings = [];
    for (const entityType of entityTypesFor(semantic, business)) {
        const mentioned = semantic.mentions.filter(mention => entityType === 'coil' ? /^\d+-\d+$/.test(mention) : entityType === 'template' ? mention.includes('模板') : /^V\d+/i.test(mention));
        for (const mention of mentioned) bindings.push(binding(entityType, mention, fixture));
    }
    return validateGroundingContract({ bindings, unresolvedMentions: [], relationBindings: [] });
}
module.exports = { binding, runOntologyAgent };
