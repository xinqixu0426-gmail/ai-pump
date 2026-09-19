'use strict';

const { deepFreeze } = require('./contract.cjs');
const { classifyQuestion } = require('./questionSemantics.cjs');
const { officialCoilRows, sameSpecSheetsRows } = require('../services/coilVariantAmbiguity.cjs');

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function verified(item) { return item?.result?.executionEvidence?.verified === true; }
function dataRows(item) { return Array.isArray(item?.result?.data) ? item.result.data : []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function addFact(map, factType, state, details = {}) {
    const rank = { VERIFIED: 5, AMBIGUOUS: 4, UNSUPPORTED: 3, MISSING: 2, NOT_APPLICABLE: 1 };
    const current = map.get(factType);
    if (!current || rank[state] > rank[current.state]) map.set(factType, { factType, state, ...details });
}
function officialCoilEvidence(toolResults, semantics) {
    const items = toolResults.filter(item => verified(item) && item.name === 'search_coils');
    const rows = officialCoilRows(items.flatMap(dataRows));
    const matching = semantics.requestedIdentity.spec && semantics.requestedIdentity.sheets
        ? sameSpecSheetsRows(rows, semantics.requestedIdentity.spec, semantics.requestedIdentity.sheets)
        : rows;
    const receipts = items.map(item => item.result?.queryReceipt).filter(Boolean);
    const expectedCount = receipts.length ? Math.max(...receipts.map(receipt => Number(receipt.totalCount) || 0)) : matching.length;
    const complete = items.length > 0 && receipts.length === items.length && receipts.every(receipt => receipt.authoritative === true
        && receipt.truncated !== true && receipt.possiblyTruncated !== true
        && Number(receipt.returnedCount) === Number(receipt.totalCount)) && matching.length === expectedCount;
    return { rows: matching, expectedCount, complete };
}
function recipeRows(toolResults) {
    const rows = [];
    for (const item of toolResults.filter(verified)) {
        if (item.name === 'get_all_recipes') rows.push(...dataRows(item));
        if (item.name === 'get_recipe_detail' && item.result?.recipe) rows.push(item.result.recipe);
        if (item.name === 'full_calculate' && positiveId(item.result?.data?.recipeCost?.recipeId)) rows.push({
            id: item.result.data.recipeCost.recipeId,
            name: item.result.data.recipeCost.recipeName,
            spec: item.result.data.recipeCost.recipeSpec,
            currentTotalCost: item.result.data.totalCost,
        });
    }
    const byId = new Map();
    for (const row of rows) {
        const id = positiveId(row?.id ?? row?.Id);
        if (!id) continue;
        byId.set(id, { ...(byId.get(id) || {}), ...row });
    }
    return [...byId.values()];
}
function recipeIdentityResolution(toolResults) {
    return toolResults.filter(verified).filter(item => item.name === 'get_all_recipes')
        .map(item => item.result?.identityResolution).find(Boolean) || null;
}
function crossCatalogCandidates(toolResults) {
    const candidates = toolResults.filter(verified).flatMap(item => Array.isArray(item.result?.crossCatalogCandidates) ? item.result.crossCatalogCandidates : []);
    for (const item of toolResults.filter(verified)) {
        if (item.name === 'search_parts') for (const row of [...dataRows(item), ...(Array.isArray(item.result?.parts) ? item.result.parts : [])]) candidates.push({
            entityType: 'part', canonicalId: positiveId(row.id ?? row.Id), name: row.model || row.name || '',
        });
        if (item.name === 'search_templates') for (const row of dataRows(item)) candidates.push({
            entityType: 'template', canonicalId: positiveId(row.id ?? row.Id), name: row.shellModel || row.name || '',
        });
    }
    return [...new Map(candidates.filter(item => positiveId(item.canonicalId)).map(item => [`${item.entityType}:${item.canonicalId}`, item])).values()];
}
function catalogScopeVerified(toolResults) {
    const authoritative = name => toolResults.some(item => verified(item) && item.name === name
        && item.result?.queryReceipt?.authoritative === true && item.result.queryReceipt.truncated !== true
        && item.result.queryReceipt.possiblyTruncated !== true
        && Number(item.result.queryReceipt.returnedCount) === Number(item.result.queryReceipt.totalCount));
    return authoritative('get_all_recipes') && authoritative('search_templates') && authoritative('search_parts');
}
function requiredFactsFor(semantics) {
    if (semantics.kind === 'INVENTORY_QUERY') return ['COIL_OFFICIAL_VARIANT_SET', 'COIL_VARIANT_INVENTORY'];
    if (semantics.kind === 'CONFIGURATION_OVERRIDE') return ['RECIPE_CANONICAL_IDENTITY', 'RECIPE_BASE_CONFIGURATION', 'COIL_CANONICAL_IDENTITY'];
    if (semantics.kind === 'HYPOTHETICAL_COST_QUERY' && semantics.wireWeight != null) return ['COIL_CANONICAL_IDENTITY', 'COIL_SCHEME_COST', 'COIL_OVERRIDE_APPLIED'];
    if (semantics.kind === 'HYPOTHETICAL_COST_QUERY') return ['RECIPE_CANONICAL_IDENTITY', 'RECIPE_CURRENT_FULL_COST', 'CURRENT_COPPER_PRICE_BASIS'];
    if (semantics.kind === 'COST_QUERY' && semantics.requestedType === 'coil') return ['COIL_OFFICIAL_VARIANT_SET', 'COIL_SCHEME_COST'];
    if (semantics.kind === 'COST_QUERY') return ['RECIPE_CANONICAL_IDENTITY', 'RECIPE_CURRENT_FULL_COST'];
    return ['CROSS_CATALOG_CANDIDATES'];
}
function sourceProjection(toolResults) {
    return toolResults.filter(verified).flatMap(item => (item.result.executionEvidence.calls || []).map(call => ({
        capability: String(item.name || ''), method: String(call.method || ''), path: String(call.path || '').slice(0, 240),
    }))).sort((a, b) => `${a.capability}\0${a.method}\0${a.path}`.localeCompare(`${b.capability}\0${b.method}\0${b.path}`)).slice(0, 24);
}

function buildBusinessSemanticFrame({ userText, toolResults = [], stage = 'POST_EVIDENCE' } = {}) {
    const semantics = classifyQuestion(userText);
    let requiredFacts = requiredFactsFor(semantics);
    const recipes = recipeRows(toolResults), coilEvidence = officialCoilEvidence(toolResults, semantics), coils = coilEvidence.rows;
    const candidates = crossCatalogCandidates(toolResults);
    const calculatedCoils = toolResults.filter(item => verified(item) && item.name === 'calculate_coil_cost' && item.result?.data)
        .map(item => item.result.data).filter(row => positiveId(row.coilId));
    const identityResolution = recipeIdentityResolution(toolResults);
    const aliasResolved = ['CANONICAL_NAME_MATCH', 'FORMAL_ALIAS_MATCH'].includes(identityResolution?.state);
    const aliasAmbiguous = identityResolution?.state === 'ALIAS_AMBIGUOUS';
    const aliasUnresolved = semantics.requestedIdentity.aliasConcern && !aliasResolved && !aliasAmbiguous;
    const uniqueRecipe = recipes.length === 1 ? recipes[0] : null;
    const partCandidate = candidates.length === 1 && candidates[0].entityType === 'part' ? candidates[0] : null;
    const fullCatalogNegative = catalogScopeVerified(toolResults) && recipes.length === 0 && candidates.length === 0;
    if (stage !== 'PRE_EVIDENCE' && semantics.kind === 'COST_QUERY' && semantics.requestedType === 'recipe' && !uniqueRecipe) {
        if (partCandidate) requiredFacts = ['CROSS_CATALOG_CANDIDATES', 'PART_CATALOG_IDENTITY'];
        else if (fullCatalogNegative) requiredFacts = ['CROSS_CATALOG_CANDIDATES'];
    }
    const facts = new Map(requiredFacts.map(factType => [factType, { factType, state: 'MISSING' }]));
    let canonicalType = null, canonicalId = null, resolutionStatus = 'UNRESOLVED';
    if (stage !== 'PRE_EVIDENCE') {
        if (aliasAmbiguous) { canonicalType = 'recipe'; resolutionStatus = 'AMBIGUOUS'; }
        else if (aliasUnresolved) resolutionStatus = 'ALIAS_UNRESOLVED';
        else if (semantics.requestedType === 'coil' && coilEvidence.expectedCount > 1) { canonicalType = 'coil'; resolutionStatus = 'AMBIGUOUS'; }
        else if (semantics.requestedType === 'coil' && coils.length === 1) { canonicalType = 'coil'; canonicalId = positiveId(coils[0].id ?? coils[0].Id); resolutionStatus = 'UNIQUE'; }
        else if (semantics.requestedType === 'coil' && calculatedCoils.length === 1) { canonicalType = 'coil'; canonicalId = positiveId(calculatedCoils[0].coilId); resolutionStatus = 'UNIQUE'; }
        else if (uniqueRecipe) { canonicalType = 'recipe'; canonicalId = positiveId(uniqueRecipe.id ?? uniqueRecipe.Id); resolutionStatus = 'UNIQUE'; }
        else if (partCandidate) { canonicalType = 'part'; canonicalId = positiveId(partCandidate.canonicalId); resolutionStatus = 'CROSS_CATALOG_CANDIDATE'; }
        else if (fullCatalogNegative) resolutionStatus = 'NOT_FOUND';
    }
    if (uniqueRecipe && !aliasUnresolved) {
        addFact(facts, 'RECIPE_CANONICAL_IDENTITY', 'VERIFIED', { canonicalIds: [positiveId(uniqueRecipe.id ?? uniqueRecipe.Id)] });
        if (uniqueRecipe.coilId || uniqueRecipe.partsJson || uniqueRecipe.parts_json) addFact(facts, 'RECIPE_BASE_CONFIGURATION', 'VERIFIED', { canonicalIds: [positiveId(uniqueRecipe.id ?? uniqueRecipe.Id)] });
        if (uniqueRecipe.currentCost?.currentTotalCost != null || uniqueRecipe.currentTotalCost != null) addFact(facts, 'RECIPE_CURRENT_FULL_COST', 'VERIFIED', { canonicalIds: [positiveId(uniqueRecipe.id ?? uniqueRecipe.Id)] });
    }
    for (const item of toolResults.filter(verified)) {
        const data = item.result?.data;
        if (['preview_recipe_cost', 'full_calculate'].includes(item.name) && data && (data.currentTotalCost != null || data.costPreview?.currentTotalCost != null || data.totalCost != null)) {
            addFact(facts, 'RECIPE_CURRENT_FULL_COST', 'VERIFIED', { canonicalIds: unique([positiveId(data.recipeId), canonicalId]) });
        }
        if (item.name === 'get_recipe_detail' && (item.result?.currentCost?.currentTotalCost != null || item.result?.recipe?.currentCost?.currentTotalCost != null)) {
            addFact(facts, 'RECIPE_CURRENT_FULL_COST', 'VERIFIED', { canonicalIds: [positiveId(item.result.recipe.id)] });
        }
        if (item.name === 'get_copper_price' && data && (data.pricePerKg != null || data.copperPrice != null || data.price != null)) addFact(facts, 'CURRENT_COPPER_PRICE_BASIS', 'VERIFIED');
    }
    if (coils.length) {
        const ids = unique(coils.map(row => positiveId(row.id ?? row.Id)));
        addFact(facts, 'COIL_CANONICAL_IDENTITY', coilEvidence.expectedCount === 1 && coilEvidence.complete ? 'VERIFIED' : 'AMBIGUOUS', { canonicalIds: ids });
        addFact(facts, 'COIL_OFFICIAL_VARIANT_SET', coilEvidence.complete ? 'VERIFIED' : 'AMBIGUOUS', { canonicalIds: ids, candidateCount: coilEvidence.expectedCount });
        if (coilEvidence.complete && coils.every(row => row.cost != null || row.kitPrice != null)) addFact(facts, 'COIL_SCHEME_COST', 'VERIFIED', { canonicalIds: ids });
        if (coilEvidence.complete && coils.every(row => row.stock != null)) addFact(facts, 'COIL_VARIANT_INVENTORY', 'VERIFIED', { canonicalIds: ids });
        const copperBases = unique(coils.map(row => row.copperBase).filter(value => value != null && Number.isFinite(Number(value))).map(String));
        if (semantics.hypotheticalCopperPrice != null && coilEvidence.complete && copperBases.length === 1) {
            addFact(facts, 'CURRENT_COPPER_PRICE_BASIS', 'VERIFIED', { canonicalIds: ids });
        }
    }
    for (const item of toolResults.filter(item => verified(item) && item.name === 'calculate_coil_cost' && item.result?.data)) {
        addFact(facts, 'COIL_CANONICAL_IDENTITY', 'VERIFIED', { canonicalIds: unique([positiveId(item.result.data.coilId)]) });
        if (item.result.data.totalCost != null) addFact(facts, 'COIL_SCHEME_COST', 'VERIFIED', { canonicalIds: unique([positiveId(item.result.data.coilId)]) });
        if (semantics.wireWeight != null && item.result.data.isCustomWireWeight === true
            && item.result.data.overrideStatus === 'APPLIED'
            && Number(item.result.data.requestedWireWeight) === Number(semantics.wireWeight)
            && Number(item.result.data.appliedWireWeight) === Number(semantics.wireWeight)) {
            addFact(facts, 'COIL_OVERRIDE_APPLIED', 'VERIFIED', { canonicalIds: unique([positiveId(item.result.data.coilId)]) });
        } else if (semantics.wireWeight != null && (item.result.data.isCustomWireWeight === false
            || item.result.data.overrideStatus === 'UNSUPPORTED_FOR_PRICING_MODE')) {
            addFact(facts, 'COIL_OVERRIDE_APPLIED', 'UNSUPPORTED', { canonicalIds: unique([positiveId(item.result.data.coilId)]) });
        }
    }
    if (candidates.length || catalogScopeVerified(toolResults)) addFact(facts, 'CROSS_CATALOG_CANDIDATES', 'VERIFIED', {
        canonicalIds: unique(candidates.map(item => positiveId(item.canonicalId))), candidateCount: candidates.length,
    });
    if (partCandidate) addFact(facts, 'PART_CATALOG_IDENTITY', 'VERIFIED', { canonicalIds: [positiveId(partCandidate.canonicalId)] });

    let ambiguityStatus = coilEvidence.expectedCount > 1 ? 'MULTIPLE_OFFICIAL_VARIANTS'
        : aliasAmbiguous || resolutionStatus === 'UNRESOLVED' ? 'UNRESOLVED_IDENTITY' : 'NONE';
    const overrideFields = [];
    if (semantics.configurationOverride && semantics.requestedIdentity.spec) overrideFields.push({ field: 'coil', requested: `${semantics.requestedIdentity.spec}-${semantics.requestedIdentity.sheets}`, source: 'USER' });
    if (semantics.wireWeight != null) overrideFields.push({ field: 'wireWeight', requested: semantics.wireWeight, source: 'USER' });
    if (semantics.hypotheticalCopperPrice != null) overrideFields.push({ field: 'copperPrice', requested: semantics.hypotheticalCopperPrice, source: 'USER' });
    const machineHypothetical = semantics.hypotheticalCopperPrice != null && semantics.requestedType === 'recipe';
    let overrideStatus = overrideFields.length ? 'SUPPORTED_OVERRIDE' : 'NO_OVERRIDE';
    if (machineHypothetical) overrideStatus = 'UNSUPPORTED_OVERRIDE';
    const baseCoilMatches = uniqueRecipe && coils.length > 1 && coils.some(row => positiveId(row.id ?? row.Id) === positiveId(uniqueRecipe.coilId));
    if (semantics.configurationOverride && coils.length > 1 && !baseCoilMatches) overrideStatus = 'AMBIGUOUS_OVERRIDE';
    if (semantics.configurationOverride && !uniqueRecipe) overrideStatus = 'MISSING_BASE';
    if (semantics.configurationOverride && baseCoilMatches) {
        addFact(facts, 'COIL_CANONICAL_IDENTITY', 'VERIFIED', { canonicalIds: [positiveId(uniqueRecipe.coilId)] });
        ambiguityStatus = 'NONE';
    }

    const factList = [...facts.values()].map(item => ({ ...item, canonicalIds: unique(item.canonicalIds || []).sort((a, b) => Number(a) - Number(b)) }));
    const verifiedFacts = factList.filter(item => item.state === 'VERIFIED').map(item => item.factType);
    const missingFacts = factList.filter(item => item.state === 'MISSING').map(item => item.factType);
    const unsupportedFacts = factList.filter(item => item.state === 'UNSUPPORTED').map(item => item.factType);
    let completenessStatus = 'NEEDS_EVIDENCE', blockers = missingFacts.slice();
    if (machineHypothetical) { completenessStatus = 'UNSUPPORTED_REQUEST'; blockers = ['UNSUPPORTED_MACHINE_HYPOTHETICAL_PRICE']; }
    else if (overrideStatus === 'AMBIGUOUS_OVERRIDE' || resolutionStatus === 'ALIAS_UNRESOLVED' || aliasAmbiguous) { completenessStatus = 'NEEDS_CLARIFICATION'; blockers = [overrideStatus === 'AMBIGUOUS_OVERRIDE' ? 'AMBIGUOUS_OVERRIDE' : aliasAmbiguous ? 'ALIAS_AMBIGUOUS' : 'ALIAS_UNRESOLVED']; }
    else if (resolutionStatus === 'NOT_FOUND' && verifiedFacts.includes('CROSS_CATALOG_CANDIDATES')) { completenessStatus = 'NOT_FOUND_VERIFIED'; blockers = []; }
    else if (requiredFacts.every(factType => facts.get(factType)?.state === 'VERIFIED')) { completenessStatus = 'COMPLETE'; blockers = []; }
    else if (verifiedFacts.length) completenessStatus = 'PARTIAL_VERIFIED';

    const disclosures = [], clarifications = [], forbiddenClaims = [];
    if (ambiguityStatus === 'MULTIPLE_OFFICIAL_VARIANTS') disclosures.push('DISCLOSE_MULTIPLE_VARIANTS');
    if (semantics.kind.includes('COST') || semantics.kind === 'CONFIGURATION_OVERRIDE') disclosures.push('DISCLOSE_COST_BASIS');
    if (machineHypothetical) disclosures.push('DISCLOSE_UNSUPPORTED_HYPOTHETICAL', 'DISCLOSE_CURRENT_PRICE_BASIS');
    if (resolutionStatus === 'CROSS_CATALOG_CANDIDATE') disclosures.push('DISCLOSE_CROSS_CATALOG_CANDIDATE');
    if (['NEEDS_EVIDENCE', 'PARTIAL_VERIFIED'].includes(completenessStatus)) disclosures.push('DISCLOSE_INCOMPLETE_CONFIGURATION');
    if (overrideStatus === 'AMBIGUOUS_OVERRIDE') clarifications.push('CLARIFY_VARIANT_SELECTION');
    if (resolutionStatus === 'ALIAS_UNRESOLVED' || aliasAmbiguous) clarifications.push('CLARIFY_IDENTITY');
    if (completenessStatus !== 'COMPLETE' && completenessStatus !== 'NOT_FOUND_VERIFIED') forbiddenClaims.push('MUST_NOT_CLAIM_COMPLETE');
    if (overrideStatus === 'AMBIGUOUS_OVERRIDE') forbiddenClaims.push('MUST_NOT_SELECT_VARIANT', 'MUST_NOT_GUESS_PARAMETER');
    if (machineHypothetical) forbiddenClaims.push('MUST_NOT_PRESENT_HYPOTHETICAL_AS_FORMAL');
    if (resolutionStatus === 'CROSS_CATALOG_CANDIDATE') forbiddenClaims.push('MUST_NOT_PRESENT_PART_PRICE_AS_MACHINE_COST');

    const actualBasis = semantics.kind === 'INVENTORY_QUERY' ? 'UNKNOWN_COST_BASIS'
        : verifiedFacts.includes('RECIPE_CURRENT_FULL_COST') ? 'MACHINE_CURRENT_FULL_COST'
        : verifiedFacts.includes('COIL_SCHEME_COST') ? 'COIL_SCHEME_COST'
            : verifiedFacts.includes('PART_CATALOG_UNIT_COST') ? 'PART_CATALOG_UNIT_COST' : 'UNKNOWN_COST_BASIS';
    const requestedBasis = semantics.requestedType === 'coil' ? 'COIL_SCHEME_COST'
        : semantics.kind.includes('COST') || semantics.kind === 'CONFIGURATION_OVERRIDE' ? 'MACHINE_CURRENT_FULL_COST' : 'UNKNOWN_COST_BASIS';
    return deepFreeze({
        version: 1, stage,
        question: { kind: semantics.kind, operation: semantics.operation },
        subject: { requestedType: semantics.requestedType, canonicalType, canonicalId, resolutionStatus },
        ambiguity: { status: ambiguityStatus, dimensions: coilEvidence.expectedCount > 1 ? ['spec', 'sheets', 'material', 'slotType', 'canonicalCoilId'] : [], candidateCount: coilEvidence.expectedCount },
        cost: { requestedBasis, actualBasis, requestedPriceContext: semantics.requestedPriceContext,
            actualPriceContext: actualBasis === 'UNKNOWN_COST_BASIS' ? 'UNKNOWN' : 'CURRENT_FORMAL_PRICE',
            calculationSupport: machineHypothetical ? 'UNSUPPORTED' : requestedBasis === 'UNKNOWN_COST_BASIS' ? 'NOT_APPLICABLE' : 'SUPPORTED' },
        override: { requested: overrideFields.length > 0, fields: overrideFields, supportStatus: overrideStatus,
            baseEntity: uniqueRecipe ? { entityType: 'recipe', canonicalId: positiveId(uniqueRecipe.id ?? uniqueRecipe.Id) } : null,
            inheritancePolicy: semantics.configurationOverride ? 'PRESERVE_UNMENTIONED_BASE_CONFIGURATION' : 'NOT_APPLICABLE' },
        evidence: { requiredFacts, facts: factList, verifiedFacts, missingFacts, unsupportedFacts },
        completeness: { status: completenessStatus, blockers },
        obligations: { requiredDisclosures: unique(disclosures), requiredClarifications: unique(clarifications), forbiddenClaims: unique(forbiddenClaims) },
        provenance: { sources: sourceProjection(toolResults) },
    });
}

module.exports = { buildBusinessSemanticFrame, catalogScopeVerified, officialCoilEvidence, requiredFactsFor };
