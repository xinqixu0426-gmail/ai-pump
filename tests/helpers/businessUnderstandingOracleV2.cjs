'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { calculateCoilCost, calculateStoredCoilCost } = require('../../api/services/coilCost.cjs');
const { calculateRecipeCost } = require('../../api/services/costEngine.cjs');

function sha256(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function readDefinitionV2(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function camelCoil(row) {
    return {
        id: row.id,
        spec: row.spec,
        sheets: row.sheets,
        material: row.material,
        slotType: row.slot_type,
        schemeCode: row.scheme_code,
        schemeName: row.scheme_name,
        schemeStatus: row.scheme_status,
        pricingMode: row.pricing_mode,
        kitPrice: row.kit_price,
        unitPrice: row.unit_price,
        cost: row.cost,
        stock: row.stock,
        copperBase: row.copper_base,
        wireWeight: row.wire_weight,
        coilFee: row.coil_fee,
        rotorFee: row.rotor_fee,
    };
}

function buildBusinessUnderstandingOracleV2(fixture, definition) {
    const { db, ids } = fixture;
    const coils = db.prepare("SELECT * FROM coils WHERE scheme_status='official' ORDER BY id").all().map(camelCoil);
    const variantRows = sheets => coils.filter(row => row.spec === '12' && row.sheets === sheets);
    const costs = Object.fromEntries(coils.map(row => [row.id, calculateStoredCoilCost(row)]));
    const calculatedOverride = calculateCoilCost(coils, {
        coilId: ids['officialCoil.12-140-calculated'], spec: '12', sheets: 140,
        material: '钢带', slotType: '小眼', wireWeight: 0.8,
    });
    const kitRejection = calculateCoilCost(coils, {
        coilId: ids['officialCoil.12-160-kit'], spec: '12', sheets: 160,
        material: '钢带', slotType: '小眼', wireWeight: 0.8,
    });
    if (!calculatedOverride.success || !kitRejection.success) throw new Error('V2 formal coil capability oracle unavailable');
    const recipe = db.prepare('SELECT * FROM recipes WHERE id=?').get(ids['activeRecipe.v550']);
    const parts = JSON.parse(recipe.parts_json);
    const partsCost = Number(calculateRecipeCost(parts, {}, Object.fromEntries(db.prepare('SELECT * FROM parts').all()
        .map(row => [row.model, [row]]))).totalCost || 0);
    const currentRecipeCost = Number((partsCost + Number(recipe.assembly_wage || 0) + Number(recipe.packing_wage || 0)
        + Number(recipe.surface_treatment_cost || 0) + Number(recipe.management_fee || 0)).toFixed(2));
    const perCase = {};
    for (const item of definition.coreCases) {
        const targetIds = item.evidence.requiredCanonicalTargets.map(ref => ids[ref]).filter(Boolean);
        const formalOverride = item.caseKey === 'BU-05' ? calculatedOverride.data
            : item.caseKey === 'BU-11' ? kitRejection.data : null;
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
                variants12_220: variantRows(220).map(row => ({ id: row.id, material: row.material, slotType: row.slotType, cost: costs[row.id], stock: row.stock })),
                variants12_200: variantRows(200).filter(row => targetIds.includes(row.id)).map(row => ({ id: row.id, material: row.material, slotType: row.slotType, cost: costs[row.id], stock: row.stock })),
                wireOverride: formalOverride,
            },
            requiredAmounts: item.caseKey === 'BU-01' || item.caseKey === 'BU-09'
                ? [{ kind: 'currentRecipeCost', value: currentRecipeCost }]
                : item.caseKey === 'BU-02'
                    ? variantRows(220).map(row => ({ kind: `coilCost:${row.id}`, value: costs[row.id] }))
                    : item.caseKey === 'BU-05'
                        ? [{ kind: 'calculatedCoilCost', value: calculatedOverride.data.totalCost }]
                        : item.caseKey === 'BU-11'
                            ? [{ kind: 'fixedKitCost', value: kitRejection.data.totalCost }]
                            : [],
        };
    }
    return { version: 2, perCase };
}

function definitionHashesV2(definitionPath, fixtureModulePath, oracleModulePath) {
    return {
        caseHash: sha256(fs.readFileSync(definitionPath)),
        fixtureHash: sha256(fs.readFileSync(fixtureModulePath)),
        oracleHash: sha256(fs.readFileSync(oracleModulePath)),
    };
}

module.exports = { buildBusinessUnderstandingOracleV2, definitionHashesV2, readDefinitionV2, sha256 };
