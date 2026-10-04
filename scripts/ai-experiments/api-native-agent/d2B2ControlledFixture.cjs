'use strict';

// D2-B2 uses a new, isolated operational fixture.  It extends the D1 HTTP
// runtime only after that runtime has created its temporary SQLite database;
// no local business data is read or written.
const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs');

const NOW = '2026-10-04T00:00:00.000Z';

function insert(db, sql, values) { return Number(db.prepare(sql).run(...values).lastInsertRowid); }

async function startD2B2ControlledFixture() {
    const runtime = await startD1R1ControlledFixture();
    const { db } = runtime;
    const ids = { ...runtime.ids };
    // ORDER-A consumes ten bearings while the formal catalog has seven.  The
    // planner, not this fixture or its evaluator, derives its three-unit gap.
    db.prepare('UPDATE parts SET stock = ? WHERE id = ?').run(7, ids.bearing);
    const orderPart = { partId: ids.bearing, model: 'D1-R1轴承-202', supplier: 'D1-R1受控供应商', purchaseUnit: '个', qty: 2, snapshotPrice: 8 };
    const orderRecipe = { recipeId: ids.v750General, recipeName: 'V750-通用款', qty: 5, unitCost: 224, unitPrice: 250,
        partsJson: JSON.stringify([orderPart]) };
    ids.orderA = insert(db, `INSERT INTO orders(customer_name,contract_no,remark,status,items_json,purchase_list_json,todos_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, ['D2受控客户', 'ORDER-A', 'D2-B2 shortage fixture', '采购中', JSON.stringify([orderRecipe]), '[]', '[]', NOW, NOW]);

    ids.readyPart = insert(db, 'INSERT INTO parts(model,category,price,stock,supplier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        ['D2-B2齐料件', '测试', 5, 100, 'D2-B2供应商', NOW, NOW]);
    ids.readyRecipe = insert(db, `INSERT INTO recipes(name,spec,parts_json,assembly_wage,packing_wage,surface_treatment_mode,surface_treatment_cost,management_fee,configuration_policy_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, ['D2-B2齐料配方', 'D2-READY', JSON.stringify([{ partId: ids.readyPart, model: 'D2-B2齐料件', qty: 1, snapshotPrice: 5 }]), 0, 0, 'none', 0, 0, JSON.stringify({ version: 1, fields: {} }), NOW, NOW]);
    const readyItem = { recipeId: ids.readyRecipe, recipeName: 'D2-B2齐料配方', qty: 1, unitCost: 5, unitPrice: 8,
        partsJson: JSON.stringify([{ partId: ids.readyPart, model: 'D2-B2齐料件', qty: 1, snapshotPrice: 5 }]) };
    ids.orderB = insert(db, `INSERT INTO orders(customer_name,contract_no,remark,status,items_json,purchase_list_json,todos_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, ['D2受控客户', 'ORDER-B', 'D2-B2 ready fixture', '采购完成', JSON.stringify([readyItem]), '[]', '[]', NOW, NOW]);

    // A persisted unresolved item is deliberate.  It has no canonical part or
    // coil identity and must remain an unresolved requirement in formal facts.
    const unresolvedItem = { recipeName: 'D2-未绑定快照', qty: 1, unitCost: 0, unitPrice: 0,
        partsJson: JSON.stringify([{ model: 'D2-B2未绑定物料', qty: 4 }]) };
    ids.orderUnresolved = insert(db, `INSERT INTO orders(customer_name,contract_no,remark,status,items_json,purchase_list_json,todos_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, ['D2受控客户', 'ORDER-U', 'D2-B2 unresolved fixture', '采购中', JSON.stringify([unresolvedItem]), '[]', '[]', NOW, NOW]);
    return Object.freeze({ ...runtime, ids: Object.freeze({ ...ids }), fixtureKind: 'D2-B2-isolated-operational-runtime' });
}

module.exports = { startD2B2ControlledFixture };
