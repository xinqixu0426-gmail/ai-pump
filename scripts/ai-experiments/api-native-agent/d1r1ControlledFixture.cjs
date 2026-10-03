'use strict';

// D1-R1 controlled acceptance data.  This module only seeds the temporary
// database created by the existing real HTTP-runtime fixture; business reads,
// previews and cost calculations continue through their production services.
const { startAiHttpRuntime } = require('../../../tests/helpers/ontologyHttpRuntimeFixture.cjs');

const NOW = '2026-10-03T00:00:00.000Z';

function insertId(db, sql, values) { return Number(db.prepare(sql).run(...values).lastInsertRowid); }

async function startD1R1ControlledFixture() {
    const runtime = await startAiHttpRuntime();
    const { db } = runtime;
    const ids = {};
    // ontologyFormalFixture intentionally contains a broad baseline.  D1-R1
    // needs a *small, exhaustive* formal catalog so complete read results can
    // be shown without turning projection truncation into fake ambiguity.
    // This runs only after startAiHttpRuntime created its temporary DB.
    db.exec(`DELETE FROM catalog_name_aliases;
        DELETE FROM catalog_identity_profiles;
        DELETE FROM recipes;
        DELETE FROM coils;
        DELETE FROM parts;
        DELETE FROM pump_shell_templates;`);
    const part = (key, model, category, price) => {
        ids[key] = insertId(db, 'INSERT INTO parts(model,category,price,stock,supplier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            [model, category, price, 30, 'D1-R1受控供应商', NOW, NOW]);
        return ids[key];
    };
    const coil = (key, code, sheets, kitPrice) => {
        ids[key] = insertId(db, `INSERT INTO coils(spec,sheets,material,slot_type,scheme_code,scheme_name,scheme_status,
            pricing_mode,kit_price,unit_price,cost,stock,copper_base,wire_weight,coil_fee,rotor_fee,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['12', sheets, '钢带', '小眼', code, code, 'official', 'kit', kitPrice, 0, kitPrice, 20, 88, 0.5, 2, 1, NOW, NOW]);
        return ids[key];
    };

    db.prepare("UPDATE system_settings SET value='6' WHERE key='management_fee'").run();
    // Formal preview authority for the Rotor Process scenario.  This is a
    // setting read by the production cost service, not an evaluator oracle.
    db.prepare("UPDATE system_settings SET value='6' WHERE key='stainless_shaft_joint_default_cost'").run();
    const shell = part('shell', 'D1-R1泵壳-V750', '泵壳', 80);
    const bearing = part('bearing', 'D1-R1轴承-202', '轴承', 8);
    // Cost engine resolves cable by its formal wire-gauge catalog name.
    const cable = part('cable', '电缆-线径0.75mm²', '电缆', 12);
    const float = part('float', '浮球-线径0.75mm²', '浮球', 18);
    const carton = part('carton', 'D1-R1纸箱', '包装', 6);
    const woodBox = part('woodBox', '木箱', '包装', 30);
    coil('coil12120a', '12-120-A', 120, 66);
    coil('coil12120b', '12-120-B', 120, 71);
    coil('coil12130a', '12-130-A', 130, 76);

    const template = insertId(db, `INSERT INTO pump_shell_templates(shell_model,parts_json,assembly_wage,packing_wage,painting_wage,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`, ['D1-R1模板-V750', JSON.stringify([
        { partId: shell, model: 'D1-R1泵壳-V750', qty: 1, snapshotPrice: 80 },
        { partId: bearing, model: 'D1-R1轴承-202', qty: 2, snapshotPrice: 8 },
    ]), 10, 4, 3, NOW, NOW]);
    const policy = JSON.stringify({ version: 1, fields: {
        hasFloat: [false, true], floatWire: ['0.75mm²'], floatAccessoryType: ['standard'],
        hasCable: [true], cableLength: [3, 5], cableWire: ['0.75mm²'], cableAccessoryType: ['standard'],
    }, packingPartIds: [carton, woodBox], packingRemovalPolicy: {
        removableRoles: ['container'], removablePartIds: [carton], allowClearAll: false,
    }, surfaceTreatmentOptions: [{ mode: 'electrophoresis', cost: 25 }] });
    const baseParts = coilId => [
        { partId: shell, model: 'D1-R1泵壳-V750', qty: 1, snapshotPrice: 80 },
        { partId: bearing, model: 'D1-R1轴承-202', qty: 2, snapshotPrice: 8 },
        { name: '线圈转子', coilId, qty: 1 },
        { partId: cable, model: '电缆-线径0.75mm²', qty: 1, snapshotPrice: 12 },
        { partId: float, model: '浮球-线径0.75mm²', qty: 1, snapshotPrice: 18 },
        { partId: carton, model: 'D1-R1纸箱', qty: 1, snapshotPrice: 6 },
    ];
    const recipe = (key, name, spec, coilId) => {
        ids[key] = insertId(db, `INSERT INTO recipes(name,spec,template_id,coil_id,coil_spec,coil_sheets,coil_material,coil_slot_type,
            parts_json,has_float,float_wire,float_accessory_type,has_cable,cable_length,cable_wire,cable_accessory_type,packing_parts_json,
            assembly_wage,packing_wage,surface_treatment_mode,surface_treatment_cost,management_fee,configuration_policy_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            name, spec, template, coilId, '12', coilId === ids.coil12130a ? 130 : 120, '钢带', '小眼', JSON.stringify(baseParts(coilId)),
            0, '0.75mm²', 'standard', 1, 3, '0.75mm²', 'standard', JSON.stringify([{ partId: carton, model: 'D1-R1纸箱', qty: 1, snapshotPrice: 6, role: 'container' }]),
            10, 4, 'none', 0, 6, policy, NOW, NOW,
        ]);
        return ids[key];
    };
    recipe('v750General', 'V750-通用款', 'V750', ids.coil12120a);
    recipe('v750Haobei', 'V750-豪贝款', 'V750', ids.coil12120b);
    recipe('v110General', 'V110-通用款', 'V110', ids.coil12130a);
    const recipeAlias = (recipeId, alias) => {
        const profileId = insertId(db, `INSERT INTO catalog_identity_profiles(recipe_id,naming_state,rule_id,rule_version,spec_json,
            spec_fingerprint,spec_revision,name_revision,external_model,created_at,updated_at)
            VALUES(?,'legacy',NULL,1,'{}','',1,1,?,?,?)`, [recipeId, alias, NOW, NOW]);
        db.prepare('INSERT INTO catalog_name_aliases(profile_id,alias,spec_revision,created_at,updated_at) VALUES(?,?,?,?,?)')
            .run(profileId, alias, 1, NOW, NOW);
    };
    recipeAlias(ids.v750General, 'V750通用款');
    recipeAlias(ids.v750Haobei, 'V750豪贝款');
    recipeAlias(ids.v110General, 'V110');
    return Object.freeze({ ...runtime, ids: Object.freeze({ ...ids }), fixtureKind: 'D1-R1-isolated-formal-runtime' });
}

module.exports = { startD1R1ControlledFixture };
