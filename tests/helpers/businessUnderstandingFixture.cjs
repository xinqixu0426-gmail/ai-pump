'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../api/database/migrations.cjs');

const NOW = '2026-09-20T00:00:00.000Z';

function insertId(db, sql, params) {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

function createBusinessUnderstandingFixture(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'business-understanding-v1-'));
    const filename = path.join(directory, 'fixture.db');
    const db = new Database(filename);
    runMigrations(db);
    const ids = {};
    const part = (ref, model, category, price, stock = 0, supplier = '基准供应商') => {
        ids[ref] = insertId(db, `INSERT INTO parts(model,category,price,stock,supplier,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?)`, [model, category, price, stock, supplier, NOW, NOW]);
        return ids[ref];
    };
    const coil = (ref, values) => {
        ids[ref] = insertId(db, `INSERT INTO coils(spec,sheets,material,slot_type,scheme_code,scheme_name,
            scheme_status,pricing_mode,kit_price,cost,stock,copper_base,wire_weight,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [values.spec, values.sheets, values.material,
            values.slotType, values.code, values.name, 'official', 'kit', values.cost, values.cost, values.stock,
            values.copperBase ?? 88, values.wireWeight ?? 0.5, NOW, NOW]);
        return ids[ref];
    };

    db.prepare("UPDATE system_settings SET value='6' WHERE key='management_fee'").run();
    const shell = part('part.v550-shell', '泵壳-V550-大脚板-2寸', '泵壳', 60, 8);
    const bearing = part('part.bearing', '轴承-202', '轴承', 5, 40);
    const cable = part('part.cable', '电缆-0.75mm²', '电缆', 12, 30);
    const packing = part('part.packing', '纸箱-V550', '包装', 8, 25);
    part('part.v800-shell', '泵壳-V800-平刀', '泵壳', 95, 3);
    coil('officialCoil.12-140', { spec: '12', sheets: 140, material: '钢带', slotType: '小眼', code: 'C-12-140-A', name: '12-140钢带小眼', cost: 70, stock: 9 });
    coil('officialCoil.12-200-steel-small', { spec: '12', sheets: 200, material: '钢带', slotType: '小眼', code: 'C-12-200-A', name: '12-200钢带小眼', cost: 88, stock: 7 });
    coil('officialCoil.12-200-cold-standard', { spec: '12', sheets: 200, material: '冷轧', slotType: '国标眼', code: 'C-12-200-B', name: '12-200冷轧国标眼', cost: 96, stock: 0 });
    coil('officialCoil.12-220-steel-small', { spec: '12', sheets: 220, material: '钢带', slotType: '小眼', code: 'C-12-220-A', name: '12-220钢带小眼', cost: 102, stock: 4 });
    coil('officialCoil.12-220-cold-standard', { spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', code: 'C-12-220-B', name: '12-220冷轧国标眼', cost: 111, stock: 2 });
    ids['customer.benchmark'] = insertId(db, 'INSERT INTO customers(name,created_at,updated_at) VALUES(?,?,?)', ['基准客户', NOW, NOW]);
    ids['template.v550'] = insertId(db, `INSERT INTO pump_shell_templates(shell_model,parts_json,assembly_wage,packing_wage,painting_wage,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`, ['模板-V550大脚板-2寸-经典款', JSON.stringify([
        { partId: shell, model: '泵壳-V550-大脚板-2寸', qty: 1, snapshotPrice: 60 },
        { partId: bearing, model: '轴承-202', qty: 2, snapshotPrice: 5 },
    ]), 10, 4, 3, NOW, NOW]);
    const baseParts = [
        { partId: shell, model: '泵壳-V550-大脚板-2寸', qty: 1, snapshotPrice: 60 },
        { partId: bearing, model: '轴承-202', qty: 2, snapshotPrice: 5 },
        { name: '线圈转子', coilId: ids['officialCoil.12-200-steel-small'], qty: 1, snapshotPrice: 88 },
        { partId: cable, model: '电缆-0.75mm²', qty: 1, snapshotPrice: 12 },
        { partId: packing, model: '纸箱-V550', qty: 1, snapshotPrice: 8 },
    ];
    ids['activeRecipe.v550'] = insertId(db, `INSERT INTO recipes(name,spec,template_id,coil_id,coil_spec,coil_sheets,
        coil_material,coil_slot_type,parts_json,has_cable,cable_length,cable_wire,packing_parts_json,
        assembly_wage,packing_wage,surface_treatment_cost,management_fee,saved_total_cost,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        '配方-V550大脚板-2寸-经典款-12-200', 'V550', ids['template.v550'],
        ids['officialCoil.12-200-steel-small'], '12', 200, '钢带', '小眼', JSON.stringify(baseParts),
        1, 1, '0.75mm²', JSON.stringify([{ partId: packing, model: '纸箱-V550', qty: 1, snapshotPrice: 8 }]),
        10, 4, 3, 6, 201, NOW, NOW,
    ]);
    const profileId = insertId(db, `INSERT INTO catalog_identity_profiles(recipe_id,naming_state,rule_id,rule_version,spec_json,
        spec_fingerprint,spec_revision,name_revision,external_model,created_at,updated_at)
        VALUES(?,'legacy',NULL,1,'{}','',1,1,?,?,?)`, [ids['activeRecipe.v550'], 'V550大脚板-2寸-经典款', NOW, NOW]);
    db.prepare(`INSERT INTO catalog_name_aliases(profile_id,alias,spec_revision,created_at,updated_at)
        VALUES(?,?,?,?,?)`).run(profileId, '老V550经典款', 1, NOW, NOW);

    if (options.scale) {
        const payload = '大数据形状'.repeat(70);
        const insert = db.prepare('INSERT INTO recipes(name,spec,parts_json,created_at,updated_at) VALUES(?,?,?,?,?)');
        db.transaction(() => {
            for (let index = 0; index < 320; index += 1) {
                insert.run(`规模配方-${index}`, `S-${index}`, JSON.stringify([{ model: payload, qty: 1 }]), NOW, NOW);
            }
        })();
    }

    function close() {
        if (db.open) db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
    return { db, filename, directory, ids, close };
}

function runFixtureSelfChecks(fixture) {
    const { db, ids } = fixture;
    const checks = [];
    const add = (key, passed, actual) => checks.push({ key, passed: Boolean(passed), actual });
    const variants = (spec, sheets) => db.prepare(`SELECT id,material,slot_type,stock FROM coils
        WHERE spec=? AND sheets=? AND scheme_status='official' ORDER BY id`).all(spec, sheets);
    add('BU-02-two-official-variants', variants('12', 220).length === 2, variants('12', 220).length);
    add('BU-03-cross-catalog-shape', db.prepare("SELECT COUNT(*) count FROM recipes WHERE name LIKE '%V800%'").get().count === 0
        && db.prepare("SELECT COUNT(*) count FROM pump_shell_templates WHERE shell_model LIKE '%V800%'").get().count === 0
        && db.prepare("SELECT COUNT(*) count FROM parts WHERE model LIKE '%V800%'").get().count === 1, true);
    add('BU-07-all-catalogs-empty', ['recipes', 'pump_shell_templates', 'parts'].every(table => {
        const column = table === 'recipes' ? 'name' : table === 'pump_shell_templates' ? 'shell_model' : 'model';
        return db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column} LIKE '%V900%'`).get().count === 0;
    }), true);
    add('BU-08-two-stock-variants', variants('12', 200).length === 2
        && variants('12', 200).every(row => [ids['officialCoil.12-200-steel-small'], ids['officialCoil.12-200-cold-standard']].includes(row.id)), variants('12', 200).length);
    add('BU-09-alias-bound', db.prepare('SELECT COUNT(*) count FROM catalog_name_aliases WHERE alias=? AND deleted_at IS NULL').get('老V550经典款').count === 1, true);
    return { passed: checks.every(check => check.passed), checks };
}

module.exports = { createBusinessUnderstandingFixture, runFixtureSelfChecks };
