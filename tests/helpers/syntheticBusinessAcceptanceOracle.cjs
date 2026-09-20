'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { calculateCoilCost, calculateStoredCoilCost } = require('../../api/services/coilCost.cjs');
const { buildBusinessUnderstandingOracleV2 } = require('./businessUnderstandingOracleV2.cjs');
const v2Definition = require('../fixtures/business-understanding-benchmark-v2.json');
const { createRelationReadService } = require('../../api/services/relationReadService.cjs');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function entityForRef(db, ids, ref) {
    const id = ids[ref];
    if (!Number.isSafeInteger(id)) throw new Error(`SYNTHETIC_ORACLE_UNKNOWN_REF:${ref}`);
    const table = ref.startsWith('part.') ? ['parts', 'model', 'part']
        : ref.includes('Coil.') ? ['coils', 'scheme_name', 'coil']
            : ref.includes('Recipe.') ? ['recipes', 'name', 'recipe'] : null;
    if (!table) throw new Error(`SYNTHETIC_ORACLE_REF_TYPE:${ref}`);
    const row = db.prepare(`SELECT * FROM ${table[0]} WHERE id=?`).get(id);
    if (!row) throw new Error(`SYNTHETIC_ORACLE_TARGET_MISSING:${ref}`);
    return { ref, id, entityType: table[2], currentName: row[table[1]], deleted: Boolean(row.deleted_at) };
}

function relationIds(service, relation, rootId) {
    return service.read({ version: 1, relation, rootId, pageSize: 50 }).items.map(item => Number(item.canonicalId));
}

function buildSyntheticBusinessAcceptanceOracle(fixture, definition) {
    const { db, ids } = fixture;
    const v2 = buildBusinessUnderstandingOracleV2(fixture, v2Definition);
    const coils = db.prepare('SELECT * FROM coils ORDER BY id').all().map(row => ({
        id: row.id, spec: row.spec, sheets: row.sheets, material: row.material, slotType: row.slot_type,
        schemeName: row.scheme_name, schemeStatus: row.scheme_status, pricingMode: row.pricing_mode,
        kitPrice: row.kit_price, unitPrice: row.unit_price, cost: row.cost, stock: row.stock,
        copperBase: row.copper_base, wireWeight: row.wire_weight, coilFee: row.coil_fee, rotorFee: row.rotor_fee,
    }));
    const byId = new Map(coils.map(item => [item.id, item]));
    const calculated = calculateCoilCost(coils, { coilId: ids['officialCoil.12-140-calculated'], spec: '12', sheets: 140,
        material: '钢带', slotType: '小眼', wireWeight: 0.8 });
    const kit = calculateCoilCost(coils, { coilId: ids['officialCoil.12-160-kit'], spec: '12', sheets: 160,
        material: '钢带', slotType: '小眼', wireWeight: 0.8 });
    if (!calculated.success || !kit.success) throw new Error('SYNTHETIC_ORACLE_COIL_CAPABILITY_UNAVAILABLE');
    const amountValues = {
        'recipe.v550.currentCost': v2.perCase['BU-01'].formalFacts.currentRecipeCost,
        'part.bearing.unitCost': db.prepare('SELECT price FROM parts WHERE id=?').get(ids['part.bearing']).price,
        'coil.12-140.override0.8': calculated.data.totalCost,
        'coil.12-160.fixedKitCost': kit.data.totalCost,
        'coil.12-200-a.stock': byId.get(ids['officialCoil.12-200-steel-small']).stock,
        'coil.12-200-b.stock': byId.get(ids['officialCoil.12-200-cold-standard']).stock,
        'coil.12-220-a.cost': calculateStoredCoilCost(byId.get(ids['officialCoil.12-220-steel-small'])),
        'coil.12-220-b.cost': calculateStoredCoilCost(byId.get(ids['officialCoil.12-220-cold-standard'])),
    };
    const relationService = createRelationReadService({ db, canonicalOnly: true });
    const relationChecks = {
        'SB-21': relationIds(relationService, 'coil.recipes', ids['officialCoil.12-200-steel-small']),
        'SB-22': relationIds(relationService, 'coil.recipes', ids['officialCoil.12-160-kit']),
        'SB-23': relationIds(relationService, 'coil.recipes', ids['officialCoil.12-240-unused']),
        'SB-24': relationIds(relationService, 'recipe.parts', ids['activeRecipe.v550']),
        'SB-25': relationIds(relationService, 'recipe.parts', ids['activeRecipe.v750']),
        'SB-26': relationIds(relationService, 'part.recipes', ids['part.bearing']),
        'SB-27': relationIds(relationService, 'part.recipes', ids['part.capacitor18']),
    };
    const expectedRelations = {
        'SB-21': [ids['activeRecipe.v550']],
        'SB-22': [ids['activeRecipe.v750']],
        'SB-23': [],
        'SB-24': [ids['part.v550-shell'], ids['part.bearing'], ids['part.cable'], ids['part.packing']],
        'SB-25': [ids['part.mechanicalSeal108']],
        'SB-26': [ids['activeRecipe.v550']],
        'SB-27': [ids['activeRecipe.v1100']],
    };
    for (const [caseKey, expected] of Object.entries(expectedRelations)) {
        const actual = [...relationChecks[caseKey]].sort((a, b) => a - b);
        const wanted = [...expected].sort((a, b) => a - b);
        if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`SYNTHETIC_ORACLE_RELATION_MISMATCH:${caseKey}`);
    }
    const perCase = {};
    for (const item of definition.cases) {
        perCase[item.caseKey] = {
            targets: (item.targetRefs || []).map(ref => entityForRef(db, ids, ref)),
            forbiddenTargets: (item.forbiddenTargetRefs || []).map(ref => entityForRef(db, ids, ref)),
            amounts: (item.amountRefs || []).map(ref => {
                if (!Object.hasOwn(amountValues, ref)) throw new Error(`SYNTHETIC_ORACLE_AMOUNT_MISSING:${ref}`);
                return { ref, value: Number(amountValues[ref]) };
            }),
            formalOverride: item.formalAssertion === 'CALCULATED_OVERRIDE_APPLIED' ? calculated.data
                : item.formalAssertion === 'KIT_OVERRIDE_REJECTED' ? kit.data : null,
            relationTargetIds: relationChecks[item.caseKey] || null,
        };
    }
    return { version: 1, perCase };
}

function definitionHashes(definitionPath, fixturePath, oraclePath) {
    const normalize = filename => fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
    return {
        caseHash: sha256(normalize(definitionPath)),
        fixtureHash: sha256(normalize(fixturePath)),
        oracleHash: sha256(normalize(oraclePath)),
    };
}

module.exports = { buildSyntheticBusinessAcceptanceOracle, definitionHashes, sha256 };
