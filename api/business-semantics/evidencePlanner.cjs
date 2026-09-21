'use strict';

const { deepFreeze } = require('./contract.cjs');
const { BusinessEvidencePlanVersion, MAX_SEMANTIC_EVIDENCE_CALLS } = require('./evidencePlanContract.cjs');
const { FactCapabilityRegistry } = require('./factCapabilityRegistry.cjs');
const { buildBusinessSemanticFrame } = require('./frameBuilder.cjs');
const { classifyQuestion } = require('./questionSemantics.cjs');
const { validateBusinessEvidencePlan } = require('./evidencePlanValidator.cjs');
const { authoritativeCoilCandidateScope } = require('./authoritativeCandidateScope.cjs');

function verified(item) { return item?.result?.success !== false && item?.result?.executionEvidence?.verified === true; }
function byName(toolResults, name) { return toolResults.filter(item => verified(item) && item.name === name); }
function positiveId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function dataRows(item) { return Array.isArray(item?.result?.data) ? item.result.data : []; }
function call(capability, args, provenance, dependsOnFacts = [], reason = '') {
    return { capability, arguments: args, argumentProvenance: Object.entries(provenance).map(([field, source]) => ({ field, source })),
        dependsOnFacts, reason };
}
function recipeCandidates(toolResults) {
    const rows = byName(toolResults, 'get_all_recipes').flatMap(dataRows);
    return [...new Map(rows.map(row => [positiveId(row.id ?? row.Id), row]).filter(([id]) => id)).values()];
}
function recipeIdentityResolution(toolResults) {
    return byName(toolResults, 'get_all_recipes').map(item => item.result?.identityResolution).find(Boolean) || null;
}
function coilCandidates(toolResults, semantics) {
    return authoritativeCoilCandidateScope(byName(toolResults, 'search_coils').flatMap(dataRows), semantics).rows;
}
function requirementRows(frame, extraFacts = []) {
    const required = [...new Set([...frame.evidence.requiredFacts, ...extraFacts])];
    const states = new Map(frame.evidence.facts.map(fact => [fact.factType, fact.state]));
    return required.map(factType => {
        const registry = FactCapabilityRegistry[factType];
        return {
            factType,
            status: !registry ? 'UNAVAILABLE_CAPABILITY' : states.get(factType) === 'VERIFIED' ? 'SATISFIED'
                : states.get(factType) === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'MISSING',
            sourcePolicy: registry?.sourcePolicy || 'UNAVAILABLE',
            capability: registry?.capability || null,
            argumentPolicy: registry?.argumentPolicy || [],
            required: true,
            reason: `Question kind ${frame.question.kind} requires ${factType}`,
        };
    });
}

function buildBusinessEvidencePlan({ userText, toolResults = [], plannedCallCount = 0, eligibility = null } = {}) {
    const semantics = classifyQuestion(userText, { admittedCatalogLookup: eligibility?.eligible === true && eligibility?.kind === 'CATALOG_LOOKUP' });
    if (semantics.kind === 'OUT_OF_SCOPE') return null;
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE', eligibility });
    const recipes = recipeCandidates(toolResults), coils = coilCandidates(toolResults, semantics);
    const token = semantics.requestedIdentity.token;
    const has = name => byName(toolResults, name).length > 0;
    const calls = [];
    const add = value => {
        if (plannedCallCount + calls.length < MAX_SEMANTIC_EVIDENCE_CALLS
            && !toolResults.some(item => item.name === value.capability && JSON.stringify(item.args || {}) === JSON.stringify(value.arguments))) calls.push(value);
    };
    const recipeLookup = () => add(call('get_all_recipes', { keyword: token }, { keyword: 'USER_EXPLICIT_VALUE' }, [], 'Resolve recipe identity and base configuration'));
    const coilLookup = () => add(call('search_coils', { spec: semantics.requestedIdentity.spec, sheets: semantics.requestedIdentity.sheets },
        { spec: 'USER_EXPLICIT_VALUE', sheets: 'USER_EXPLICIT_VALUE' }, [], 'Resolve the complete official coil variant set'));

    const identityResolution = recipeIdentityResolution(toolResults);
    const aliasResolved = ['CANONICAL_NAME_MATCH', 'FORMAL_ALIAS_MATCH'].includes(identityResolution?.state) && recipes.length === 1;
    const aliasBlocked = semantics.requestedIdentity.aliasConcern && !aliasResolved;
    let extraFacts = [];
    if (aliasBlocked && semantics.requestedType === 'recipe' && token && !identityResolution) {
        recipeLookup();
    } else if (!aliasBlocked && ((['COST_QUERY', 'HYPOTHETICAL_COST_QUERY'].includes(semantics.kind)
        && semantics.requestedType === 'recipe') || (semantics.kind === 'COST_QUERY' && semantics.requestedType === 'unknown'))) {
        if (!has('get_all_recipes')) {
            recipeLookup();
        } else if (recipes.length === 1) {
            if (!has('full_calculate')) add(call('full_calculate', { recipeName: String(recipes[0].name || '') },
                { recipeName: 'VERIFIED_PRIOR_FACT' }, ['RECIPE_CANONICAL_IDENTITY'], 'Read current full machine cost from the canonical recipe'));
            if (semantics.hypotheticalCopperPrice != null && !has('search_coils')) add(call('search_coils', {
                spec: String(recipes[0].coilSpec || ''), sheets: Number(recipes[0].coilSheets),
            }, { spec: 'VERIFIED_PRIOR_FACT', sheets: 'VERIFIED_PRIOR_FACT' }, ['RECIPE_BASE_CONFIGURATION'], 'Read the formal copper basis used by the recipe coil schemes'));
        } else if (recipes.length === 0) {
            if (!has('search_templates')) add(call('search_templates', { shellModel: token }, { shellModel: 'USER_EXPLICIT_VALUE' }, [], 'Verify template catalogue scope after the recipe catalogue returned empty'));
            if (!has('search_parts')) add(call('search_parts', { keyword: token }, { keyword: 'USER_EXPLICIT_VALUE' }, [], 'Verify parts catalogue scope after the recipe catalogue returned empty'));
        }
    } else if (!aliasBlocked && semantics.kind === 'CONFIGURATION_OVERRIDE') {
        extraFacts = ['RECIPE_CURRENT_FULL_COST'];
        if (!has('get_all_recipes')) recipeLookup();
        if (!has('search_coils')) coilLookup();
        if (recipes.length === 1 && coils.length > 0 && has('get_all_recipes') && has('search_coils')) {
            const baseCoilId = positiveId(recipes[0].coilId);
            const selected = coils.length === 1 ? coils[0] : coils.find(row => positiveId(row.id ?? row.Id) === baseCoilId);
            if (selected && !has('preview_recipe_cost')) add(call('preview_recipe_cost', {
                recipeId: positiveId(recipes[0].id ?? recipes[0].Id), useRecipeBaseline: false,
                overrides: { coilId: positiveId(selected.id ?? selected.Id), coilSpec: String(selected.spec || semantics.requestedIdentity.spec),
                    coilSheets: Number(selected.sheets || semantics.requestedIdentity.sheets), coilMaterial: selected.material, coilSlotType: selected.slotType },
            }, { recipeId: 'CANONICAL_SUBJECT_ID', 'overrides.coilId': 'FORMAL_VARIANT_CANDIDATE',
                'overrides.coilSpec': 'FORMAL_VARIANT_CANDIDATE', 'overrides.coilSheets': 'FORMAL_VARIANT_CANDIDATE',
                'overrides.coilMaterial': 'FORMAL_VARIANT_CANDIDATE', 'overrides.coilSlotType': 'FORMAL_VARIANT_CANDIDATE' },
            ['RECIPE_CANONICAL_IDENTITY', 'RECIPE_BASE_CONFIGURATION', 'COIL_CANONICAL_IDENTITY'], 'Preview base recipe with only the verified coil override'));
        }
    } else if (!aliasBlocked && ['COST_QUERY', 'INVENTORY_QUERY', 'HYPOTHETICAL_COST_QUERY'].includes(semantics.kind)
        && semantics.requestedType === 'coil') {
        if (!has('search_coils')) coilLookup();
        if (semantics.wireWeight != null && coils.length === 1 && !has('calculate_coil_cost')) {
            const selected = coils[0];
            add(call('calculate_coil_cost', { spec: String(selected.spec || semantics.requestedIdentity.spec), sheets: Number(selected.sheets || semantics.requestedIdentity.sheets),
                coilId: positiveId(selected.id ?? selected.Id), wireWeight: semantics.wireWeight },
            { spec: 'FORMAL_VARIANT_CANDIDATE', sheets: 'FORMAL_VARIANT_CANDIDATE', coilId: 'CANONICAL_SUBJECT_ID', wireWeight: 'USER_EXPLICIT_VALUE' },
            ['COIL_CANONICAL_IDENTITY'], 'Apply the explicit wire-weight override to the canonical coil'));
        }
    } else if (!aliasBlocked && semantics.kind === 'CATALOG_LOOKUP' && token) {
        if (!has('get_all_recipes')) recipeLookup();
        else if (recipes.length === 0) {
            if (!has('search_templates')) add(call('search_templates', { shellModel: token }, { shellModel: 'USER_EXPLICIT_VALUE' }, [], 'Search template catalogue'));
            if (!has('search_parts')) add(call('search_parts', { keyword: token }, { keyword: 'USER_EXPLICIT_VALUE' }, [], 'Search parts catalogue'));
        }
    }

    const plan = deepFreeze({ version: BusinessEvidencePlanVersion, questionKind: semantics.kind,
        subject: { requestedType: semantics.requestedType, token, resolutionStatus: frame.subject.resolutionStatus },
        requirements: requirementRows(frame, extraFacts),
        execution: { bounded: true, maxCalls: MAX_SEMANTIC_EVIDENCE_CALLS, completedCalls: plannedCallCount, calls },
    });
    validateBusinessEvidencePlan(plan);
    return plan;
}

module.exports = { buildBusinessEvidencePlan, coilCandidates, recipeCandidates, recipeIdentityResolution };
