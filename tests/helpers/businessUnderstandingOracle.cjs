'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { calculateStoredCoilCost } = require('../../api/services/coilCost.cjs');
const { calculateRecipeCost } = require('../../api/services/costEngine.cjs');

function sha256(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function readDefinition(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function buildBusinessUnderstandingOracle(fixture, definition) {
    const { db, ids } = fixture;
    const coils = db.prepare("SELECT * FROM coils WHERE scheme_status='official' ORDER BY id").all();
    const variantRows = (sheets) => coils.filter(row => row.spec === '12' && row.sheets === sheets);
    const costs = Object.fromEntries(coils.map(row => [row.id, calculateStoredCoilCost({
        pricingMode: row.pricing_mode,
        kitPrice: row.kit_price,
        unitPrice: row.unit_price,
        sheets: row.sheets,
        wireWeight: row.wire_weight,
        copperBase: row.copper_base,
        coilFee: row.coil_fee,
        rotorFee: row.rotor_fee,
    })]));
    const recipe = db.prepare('SELECT * FROM recipes WHERE id=?').get(ids['activeRecipe.v550']);
    const parts = JSON.parse(recipe.parts_json);
    const partsCost = Number(calculateRecipeCost(parts, {}, Object.fromEntries(db.prepare('SELECT * FROM parts').all().map(row => [row.model, [row]]))).totalCost || 0);
    const currentRecipeCost = Number((partsCost + Number(recipe.assembly_wage || 0) + Number(recipe.packing_wage || 0)
        + Number(recipe.surface_treatment_cost || 0) + Number(recipe.management_fee || 0)).toFixed(2));
    const perCase = {};
    for (const item of definition.coreCases) {
        const targetIds = item.evidence.requiredCanonicalTargets.map(ref => ids[ref]).filter(Boolean);
        perCase[item.caseKey] = {
            canonicalTargets: targetIds,
            requiredCapabilities: item.evidence.requiredCapabilities,
            forbiddenCapabilities: item.evidence.forbiddenCapabilities,
            requiredFacts: item.answer.requiredFacts,
            requiredDisclosureGroups: item.answer.requiredDisclosureGroups,
            forbiddenClaims: item.answer.forbiddenClaims,
            expected: item.expected,
            formalFacts: {
                currentRecipeCost,
                copperBasis: 88,
                variants12_220: variantRows(220).map(row => ({ id: row.id, material: row.material, slotType: row.slot_type, cost: costs[row.id], stock: row.stock })),
                variants12_200: variantRows(200).filter(row => targetIds.includes(row.id)).map(row => ({ id: row.id, material: row.material, slotType: row.slot_type, cost: costs[row.id], stock: row.stock })),
                wireOverride: item.caseKey === 'BU-05' ? 0.8 : null,
            },
            requiredAmounts: item.caseKey === 'BU-01' || item.caseKey === 'BU-09'
                ? [{ kind: 'currentRecipeCost', value: currentRecipeCost }]
                : item.caseKey === 'BU-02'
                    ? variantRows(220).map(row => ({ kind: `coilCost:${row.id}`, value: costs[row.id] }))
                    : item.caseKey === 'BU-05'
                        ? [{ kind: 'coilCost', value: costs[ids['officialCoil.12-140']] }]
                        : [],
        };
    }
    return { version: 1, perCase };
}

/**
 * Frozen-asset identity is CONTENT identity, never the raw working-tree bytes.
 *
 * The frozen assets are shared between Windows and macOS. `git` checks the same blob out as LF on one
 * platform and CRLF on the other, so hashing raw working-tree bytes reports an unchanged asset as
 * changed on Windows — a platform artefact, not a business change. Git itself normalises line endings on
 * add, so a line-ending-normalised hash is the correct cross-platform identity.
 *
 * The normalisation is only ever applied to hashing. The frozen assets themselves are never rewritten.
 */
function contentIdentity(fileBuffer) {
    return Buffer.from(String(fileBuffer).replace(/\r\n?/g, '\n'), 'utf8');
}

function definitionHashes(definitionPath, fixtureModulePath, oracleModulePath) {
    return {
        caseHash: sha256(contentIdentity(fs.readFileSync(definitionPath))),
        fixtureHash: sha256(contentIdentity(fs.readFileSync(fixtureModulePath))),
        oracleHash: sha256(contentIdentity(fs.readFileSync(oracleModulePath))),
    };
}

module.exports = { buildBusinessUnderstandingOracle, contentIdentity, definitionHashes, readDefinition, sha256 };
