'use strict';

const { createBusinessUnderstandingFixtureV2 } = require('./businessUnderstandingFixtureV2.cjs');
const { calculateStoredCoilCost } = require('../../api/services/coilCost.cjs');

const NOW = '2026-09-20T00:00:00.000Z';

function insertId(db, sql, params) {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

function createSyntheticBusinessAcceptanceFixture(options = {}) {
    const fixture = createBusinessUnderstandingFixtureV2({ scale: Boolean(options.scale) });
    const { db, ids } = fixture;
    const addPart = (ref, model, category, price, stock, supplier = '验收供应商') => {
        ids[ref] = insertId(db, `INSERT INTO parts(model,category,price,stock,supplier,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?)`, [model, category, price, stock, supplier, NOW, NOW]);
        return ids[ref];
    };
    const addCoil = (ref, values) => {
        const pricingMode = values.pricingMode || 'kit';
        const cost = calculateStoredCoilCost({
            pricingMode,
            kitPrice: values.kitPrice,
            unitPrice: values.unitPrice,
            sheets: values.sheets,
            wireWeight: values.wireWeight,
            copperBase: values.copperBase,
            coilFee: values.coilFee,
            rotorFee: values.rotorFee,
        });
        ids[ref] = insertId(db, `INSERT INTO coils(spec,sheets,material,slot_type,scheme_code,scheme_name,
            scheme_status,pricing_mode,kit_price,unit_price,cost,stock,copper_base,wire_weight,coil_fee,rotor_fee,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [values.spec, values.sheets, values.material,
            values.slotType, values.code, values.name, values.status || 'official', pricingMode,
            values.kitPrice ?? 0, values.unitPrice ?? 0, cost, values.stock ?? 0, values.copperBase ?? 88,
            values.wireWeight ?? 0.5, values.coilFee ?? 0, values.rotorFee ?? 0, NOW, NOW]);
        return ids[ref];
    };
    const addRecipe = (ref, values) => {
        ids[ref] = insertId(db, `INSERT INTO recipes(name,spec,coil_id,coil_spec,coil_sheets,coil_material,coil_slot_type,
            parts_json,assembly_wage,packing_wage,surface_treatment_cost,management_fee,saved_total_cost,created_at,updated_at,deleted_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [values.name, values.spec, values.coilId,
            values.coilSpec, values.coilSheets, values.coilMaterial, values.coilSlotType,
            JSON.stringify(values.parts), values.assemblyWage ?? 8, values.packingWage ?? 3,
            values.surfaceTreatmentCost ?? 2, values.managementFee ?? 6, values.savedTotalCost ?? 0,
            NOW, NOW, values.deletedAt || null]);
        return ids[ref];
    };
    const addAlias = (recipeRef, alias) => {
        const existing = db.prepare('SELECT id FROM catalog_identity_profiles WHERE recipe_id=?').get(ids[recipeRef]);
        const profileId = existing?.id || insertId(db, `INSERT INTO catalog_identity_profiles(recipe_id,naming_state,rule_id,rule_version,spec_json,
            spec_fingerprint,spec_revision,name_revision,external_model,created_at,updated_at)
            VALUES(?,'legacy',NULL,1,'{}','',1,1,?,?,?)`, [ids[recipeRef], '', NOW, NOW]);
        db.prepare(`INSERT INTO catalog_name_aliases(profile_id,alias,spec_revision,created_at,updated_at)
            VALUES(?,?,?,?,?)`).run(profileId, alias, 1, NOW, NOW);
    };

    const seal = addPart('part.mechanicalSeal108', '机械油封-108', '油封', 6.8, 18);
    const capacitor = addPart('part.capacitor18', '电容-18μF', '电容', 9.6, 22);
    const impeller = addPart('part.impellerV1100', '叶轮-V1100-3叶', '叶轮', 18.5, 11);
    addCoil('testingCoil.12-200', { spec: '12', sheets: 200, material: '钢带', slotType: '小眼',
        code: 'T-12-200', name: '12-200钢带小眼测试方案', status: 'testing', kitPrice: 81, stock: 99 });
    addCoil('testingCoil.12-220', { spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼',
        code: 'T-12-220', name: '12-220冷轧国标眼测试方案', status: 'testing', kitPrice: 93, stock: 88 });
    addCoil('officialCoil.12-240-unused', { spec: '12', sheets: 240, material: '钢带', slotType: '小眼',
        code: 'C-12-240-Z', name: '12-240钢带小眼未使用方案', kitPrice: 118, stock: 5 });

    addRecipe('activeRecipe.v750', {
        name: '配方-V750耐腐经典款-12-160', spec: 'V750', coilId: ids['officialCoil.12-160-kit'],
        coilSpec: '12', coilSheets: 160, coilMaterial: '钢带', coilSlotType: '小眼',
        parts: [{ partId: seal, model: '机械油封-108', supplier: '验收供应商', qty: 1, snapshotPrice: 6.8 },
            { name: '线圈转子', coilId: ids['officialCoil.12-160-kit'], qty: 1, snapshotPrice: 76 }],
        savedTotalCost: 101.8,
    });
    addRecipe('activeRecipe.v1100', {
        name: '配方-V1100高扬程-12-220钢带小眼', spec: 'V1100', coilId: ids['officialCoil.12-220-steel-small'],
        coilSpec: '12', coilSheets: 220, coilMaterial: '钢带', coilSlotType: '小眼',
        parts: [{ partId: capacitor, model: '电容-18μF', supplier: '验收供应商', qty: 1, snapshotPrice: 9.6 },
            { partId: impeller, model: '叶轮-V1100-3叶', supplier: '验收供应商', qty: 1, snapshotPrice: 18.5 },
            { name: '线圈转子', coilId: ids['officialCoil.12-220-steel-small'], qty: 1, snapshotPrice: 102 }],
        savedTotalCost: 149.1,
    });
    addRecipe('deletedRecipe.prototype', {
        name: '配方-停产样机-12-240', spec: '停产样机', coilId: ids['officialCoil.12-240-unused'],
        coilSpec: '12', coilSheets: 240, coilMaterial: '钢带', coilSlotType: '小眼', parts: [],
        deletedAt: NOW,
    });

    addAlias('activeRecipe.v750', '老V750耐腐款');
    addAlias('activeRecipe.v550', '老经典通用款');
    addAlias('activeRecipe.v750', '老经典通用款');
    addAlias('deletedRecipe.prototype', '老停产样机');

    return fixture;
}

function runSyntheticFixtureSelfChecks(fixture) {
    const { db, ids } = fixture;
    const checks = [];
    const add = (key, passed, actual) => checks.push({ key, passed: Boolean(passed), actual });
    const official200 = db.prepare("SELECT id FROM coils WHERE spec='12' AND sheets=200 AND scheme_status='official'").all();
    const testing200 = db.prepare("SELECT id FROM coils WHERE spec='12' AND sheets=200 AND scheme_status='testing'").all();
    add('official-testing-separated', official200.length === 2 && testing200.length === 1,
        { official: official200.length, testing: testing200.length });
    add('three-active-recipes', db.prepare('SELECT COUNT(*) count FROM recipes WHERE deleted_at IS NULL').get().count === 3,
        db.prepare('SELECT COUNT(*) count FROM recipes WHERE deleted_at IS NULL').get().count);
    add('ambiguous-alias-shape', db.prepare("SELECT COUNT(*) count FROM catalog_name_aliases WHERE alias='老经典通用款' AND deleted_at IS NULL").get().count === 2, 2);
    add('unavailable-alias-shape', Boolean(db.prepare('SELECT deleted_at FROM recipes WHERE id=?').get(ids['deletedRecipe.prototype'])?.deleted_at), true);
    add('unused-official-coil', db.prepare('SELECT COUNT(*) count FROM recipes WHERE coil_id=? AND deleted_at IS NULL').get(ids['officialCoil.12-240-unused']).count === 0, 0);
    return { passed: checks.every(item => item.passed), checks };
}

module.exports = { createSyntheticBusinessAcceptanceFixture, runSyntheticFixtureSelfChecks };
