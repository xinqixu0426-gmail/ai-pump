'use strict';

const { validateTrigger } = require('./validator.cjs');

function unique(rows) { return rows.length === 1 ? rows[0] : null; }
function formalRecipe(db, text) {
    return unique(db.prepare(`SELECT id,name,spec,template_id FROM recipes
        WHERE deleted_at IS NULL AND spec<>'' AND instr(upper(?),upper(spec))>0
        ORDER BY length(spec) DESC,id LIMIT 2`).all(text));
}
function formalPart(db, text) {
    return unique(db.prepare(`SELECT id,model,price,stock FROM parts
        WHERE deleted_at IS NULL AND model<>'' AND instr(?,model)>0
        ORDER BY length(model) DESC,id LIMIT 2`).all(text));
}
function formalCoil(db, text) {
    const match = String(text).match(/(\d+)\s*[-—~]\s*(\d+)/u);
    if (!match) return { row: null, candidates: [] };
    const candidates = db.prepare(`SELECT id,spec,sheets,material,slot_type FROM coils
        WHERE spec=? AND sheets=? AND scheme_status='official' ORDER BY id LIMIT 3`).all(match[1], Number(match[2]));
    return { row: unique(candidates), candidates };
}
function orderForRecipe(db, recipeId) {
    if (!recipeId) return null;
    return unique(db.prepare(`SELECT id FROM orders WHERE deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(items_json) THEN items_json ELSE '[]' END)
        WHERE CAST(json_extract(value,'$.recipeId') AS INTEGER)=?) ORDER BY id DESC LIMIT 2`).all(recipeId));
}
function source(...evidence) { return { authority: 'CANONICAL_DIRECT_IMPACT', evidence }; }

function buildImpactTrigger({ db, userText, impactEligibility: eligibility } = {}) {
    if (!eligibility?.eligible || !eligibility.changeType || !db?.prepare) return null;
    const text = String(userText || '');
    const recipe = formalRecipe(db, text);
    const part = formalPart(db, text);
    const coil = formalCoil(db, text);
    let entityType = 'recipe'; let canonicalId = recipe?.id || null; let before = null; let after = null;
    if (eligibility.changeType === 'PART_PRICE_CHANGE') {
        entityType = 'part'; canonicalId = part?.id || null; before = part?.price ?? null; after = null;
    } else if (eligibility.changeType === 'PART_INVENTORY_CHANGE') {
        entityType = 'part'; canonicalId = part?.id || null; before = part?.stock ?? null; after = null;
    } else if (eligibility.changeType === 'TEMPLATE_CHANGE') {
        entityType = 'template'; canonicalId = recipe?.template_id || null;
    } else if (eligibility.changeType === 'ORDER_CONFIGURATION_COMPARE') {
        entityType = 'order'; canonicalId = orderForRecipe(db, recipe?.id)?.id || null;
    } else if (eligibility.changeType === 'ENGINEERING_PREDICTION') {
        entityType = 'coil'; canonicalId = coil.row?.id || null;
    } else if (eligibility.changeType === 'QUOTATION_FRESHNESS') {
        entityType = part ? 'part' : 'recipe'; canonicalId = part?.id || recipe?.id || null;
    } else if (eligibility.changeType === 'TEST_REPORT_VALIDITY') {
        entityType = 'recipe'; canonicalId = recipe?.id || null;
    } else if (eligibility.changeType === 'RECIPE_CONFIGURATION_CHANGE') {
        entityType = recipe ? 'recipe' : 'coil'; canonicalId = recipe?.id || coil.row?.id || null;
        before = recipe?.id ? 'current recipe configuration' : coil.candidates.length ? 'ambiguous formal coil set' : null;
        after = coil.row?.id || null;
    }
    const mode = /(?:把|如果|假如|换成|换掉)/u.test(text)
        ? 'PROPOSED_CHANGE' : eligibility.changeType === 'TEMPLATE_CHANGE'
            ? 'VERIFIED_RECORDED_CHANGE' : 'VERIFIED_FACT_CHANGE';
    return validateTrigger({ version: 1, mode, entityType,
        canonicalId: canonicalId == null ? null : String(canonicalId), changeType: eligibility.changeType,
        before, after, source: source('exact persisted business identity', 'deterministic impact eligibility') });
}

module.exports = { buildImpactTrigger, formalRecipe, formalPart, formalCoil, orderForRecipe };
