'use strict';

const { validateTrigger } = require('./validator.cjs');

function unique(rows) { return rows.length === 1 ? rows[0] : null; }
function liveCanonical(db, entityType, rawId) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const queries = {
        recipe: 'SELECT id,name,spec,template_id FROM recipes WHERE id=? AND deleted_at IS NULL',
        part: 'SELECT id,model,price,stock FROM parts WHERE id=? AND deleted_at IS NULL',
        coil: 'SELECT id,spec,sheets,material,slot_type FROM coils WHERE id=?',
        template: 'SELECT id,shell_model FROM pump_shell_templates WHERE id=? AND deleted_at IS NULL',
    };
    return queries[entityType] ? db.prepare(queries[entityType]).get(id) || null : null;
}
function verifiedCanonicalSubject(db, subject) {
    if (subject?.resolutionStatus !== 'UNIQUE') return null;
    const entityType = String(subject.canonicalType || '');
    const requestedType = String(subject.requestedType || '');
    if (['recipe', 'part', 'coil', 'template', 'order'].includes(requestedType)
        && requestedType !== entityType) return null;
    const row = liveCanonical(db, entityType, subject.canonicalId);
    return row ? { entityType, row, evidence: 'verified canonical subject receipt' } : null;
}
function formalRecipe(db, text) {
    const exactNameRows = db.prepare(`SELECT id,name,spec,template_id FROM recipes
        WHERE deleted_at IS NULL AND name<>'' AND instr(upper(?),upper(name))>0
        ORDER BY length(name) DESC,id LIMIT 3`).all(text);
    if (exactNameRows.length) return unique(exactNameRows);
    return unique(db.prepare(`SELECT id,name,spec,template_id FROM recipes
        WHERE deleted_at IS NULL AND spec<>'' AND instr(upper(?),upper(spec))>0
        ORDER BY length(spec) DESC,id LIMIT 3`).all(text));
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
function formalTemplate(db, text) {
    const rows = db.prepare(`SELECT id,shell_model FROM pump_shell_templates
        WHERE deleted_at IS NULL AND shell_model<>'' AND instr(upper(?),upper(shell_model))>0
        ORDER BY length(shell_model) DESC,id LIMIT 3`).all(text);
    return unique(rows);
}
function orderForRecipe(db, recipeId) {
    if (!recipeId) return null;
    return unique(db.prepare(`SELECT id FROM orders WHERE deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(items_json) THEN items_json ELSE '[]' END)
        WHERE CAST(json_extract(value,'$.recipeId') AS INTEGER)=?) ORDER BY id DESC LIMIT 2`).all(recipeId));
}
function source(...evidence) { return { authority: 'CANONICAL_DIRECT_IMPACT', evidence }; }

function buildImpactTrigger({ db, userText, impactEligibility: eligibility, canonicalSubject = null } = {}) {
    if (!eligibility?.eligible || !eligibility.changeType || !db?.prepare) return null;
    const text = String(userText || '');
    const verifiedSubject = verifiedCanonicalSubject(db, canonicalSubject);
    const recipe = formalRecipe(db, text);
    const part = formalPart(db, text);
    const coil = formalCoil(db, text);
    const template = formalTemplate(db, text);
    const subjectRow = type => verifiedSubject?.entityType === type ? verifiedSubject.row : null;
    let usedVerifiedSubject = Boolean(subjectRow('recipe'));
    let entityType = 'recipe'; let canonicalId = subjectRow('recipe')?.id || recipe?.id || null; let before = null; let after = null;
    if (eligibility.changeType === 'PART_PRICE_CHANGE') {
        const root = subjectRow('part') || part;
        usedVerifiedSubject = Boolean(subjectRow('part'));
        entityType = 'part'; canonicalId = root?.id || null; before = root?.price ?? null; after = null;
    } else if (eligibility.changeType === 'PART_INVENTORY_CHANGE') {
        const root = subjectRow('part') || part;
        usedVerifiedSubject = Boolean(subjectRow('part'));
        entityType = 'part'; canonicalId = root?.id || null; before = root?.stock ?? null; after = null;
    } else if (eligibility.changeType === 'TEMPLATE_CHANGE') {
        const root = subjectRow('template') || template;
        usedVerifiedSubject = Boolean(subjectRow('template'));
        entityType = 'template'; canonicalId = root?.id || recipe?.template_id || null;
    } else if (eligibility.changeType === 'ORDER_CONFIGURATION_COMPARE') {
        entityType = 'order'; canonicalId = orderForRecipe(db, recipe?.id)?.id || null;
    } else if (eligibility.changeType === 'ENGINEERING_PREDICTION') {
        usedVerifiedSubject = Boolean(subjectRow('coil'));
        entityType = 'coil'; canonicalId = subjectRow('coil')?.id || coil.row?.id || null;
    } else if (eligibility.changeType === 'QUOTATION_FRESHNESS') {
        const rootPart = subjectRow('part') || part;
        const rootRecipe = subjectRow('recipe') || recipe;
        usedVerifiedSubject = Boolean(subjectRow('part') || subjectRow('recipe'));
        entityType = rootPart ? 'part' : 'recipe'; canonicalId = rootPart?.id || rootRecipe?.id || null;
    } else if (eligibility.changeType === 'TEST_REPORT_VALIDITY') {
        usedVerifiedSubject = Boolean(subjectRow('recipe'));
        entityType = 'recipe'; canonicalId = subjectRow('recipe')?.id || recipe?.id || null;
    } else if (eligibility.changeType === 'RECIPE_CONFIGURATION_CHANGE') {
        const rootRecipe = subjectRow('recipe') || recipe;
        const rootCoil = subjectRow('coil') || coil.row;
        usedVerifiedSubject = Boolean(subjectRow('recipe') || subjectRow('coil'));
        entityType = rootRecipe ? 'recipe' : 'coil'; canonicalId = rootRecipe?.id || rootCoil?.id || null;
        before = rootRecipe?.id ? 'current recipe configuration' : coil.candidates.length ? 'ambiguous formal coil set' : null;
        after = coil.row?.id || null;
    }
    const rootEvidence = !canonicalId ? 'canonical identity unresolved'
        : usedVerifiedSubject ? verifiedSubject.evidence : 'exact persisted business identity';
    const mode = /(?:把|如果|假如|换成|换掉)/u.test(text)
        ? 'PROPOSED_CHANGE' : eligibility.changeType === 'TEMPLATE_CHANGE'
            ? 'VERIFIED_RECORDED_CHANGE' : 'VERIFIED_FACT_CHANGE';
    return validateTrigger({ version: 1, mode, entityType,
        canonicalId: canonicalId == null ? null : String(canonicalId), changeType: eligibility.changeType,
        before, after, source: source(rootEvidence, 'deterministic impact eligibility') });
}

module.exports = { buildImpactTrigger, formalRecipe, formalPart, formalCoil, formalTemplate,
    verifiedCanonicalSubject, orderForRecipe };
