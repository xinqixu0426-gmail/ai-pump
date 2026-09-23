'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-virtual-readiness-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'fixture-{pid}.db');

const {
    db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, recipeRow, templateRow,
    modelVariantRow, loadPartsData, calculateRecipeCost, getSetting, stopBackupScheduler,
} = require('../api/db.cjs');
const { createRecipeQueries } = require('../api/services/recipeQueries.cjs');
const { createRecipeScenarioComparison } = require('../api/services/recipeScenarioComparison.cjs');
const { createVirtualReadinessPreview, normalizeVirtualReadinessRequest, VirtualReadinessPreviewError } = require('../api/services/virtualReadinessPreview.cjs');
const inventoryRouter = require('../api/routes/inventory.cjs');

function service({ afterComparison = null } = {}) {
    const recipeQueries = createRecipeQueries({ db, listCoils: dbGetAllCoils, listParts: dbGetAllParts, listRecipes: dbGetAllRecipes, modelVariantRow, recipeRow, templateRow, getSetting });
    const scenarioComparison = createRecipeScenarioComparison({ db, recipeRow, listCoils: dbGetAllCoils, loadPartsData, calculateRecipeCost, getSetting, getBomDraft: recipeQueries.getBomDraft });
    const observedScenarioComparison = typeof afterComparison === 'function'
        ? { compare(...args) { const result = scenarioComparison.compare(...args); afterComparison(); return result; } }
        : scenarioComparison;
    return createVirtualReadinessPreview({ db, recipeRow, listCoils: dbGetAllCoils, listParts: dbGetAllParts, getBomDraft: recipeQueries.getBomDraft, scenarioComparison: observedScenarioComparison });
}

function createFixture(t, { stock = 500, price = 5, parts = null } = {}) {
    const unique = `N42B-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const part = db.prepare(`INSERT INTO parts (model, supplier, category, price, stock, created_at, updated_at)
        VALUES (?, '正式供应商', '其他', ?, ?, datetime('now'), datetime('now'))`).run(`${unique}-part`, price, stock);
    const partId = Number(part.lastInsertRowid);
    const bom = parts || [{ partId, model: `${unique}-part`, supplier: '正式供应商', qty: 1 }];
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, ?, '[]', datetime('now'), datetime('now'))`).run(`${unique}-shell`, JSON.stringify(bom));
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id,
        assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N4.2B', '[]', '[]', '[]', ?, 0, 0, 'none', 0, 0, datetime('now'), datetime('now'))`).run(unique, template.lastInsertRowid);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM orders WHERE customer_name = ?').run(unique);
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare('DELETE FROM parts WHERE id = ?').run(partId);
    });
    return { unique, partId, recipeId, templateId: Number(template.lastInsertRowid), model: `${unique}-part` };
}

function request(recipeId, quantity = 300, scenarios = [], scenarioKey = 'base') {
    return { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios }, scenarioKey }, quantity };
}
function counts() {
    return Object.fromEntries(['orders', 'parts', 'coils', 'audit_log', 'order_execution_records'].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

test.after(() => { stopBackupScheduler(); if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('N4.2B request contract rejects version, unknown fields, unsupported basis, absent scenario, non-integer quantity, and client inventory policy', () => {
    const base = request(1);
    for (const mutation of [
        { ...base, version: 2 }, { ...base, stock: 99 }, { ...base, basisRef: { ...base.basisRef, ignoreReservations: true } },
        { ...base, basisRef: { ...base.basisRef, kind: 'ORDER' } }, { ...base, basisRef: { ...base.basisRef, scenarioKey: 'candidate' } },
        { ...base, quantity: 0 }, { ...base, quantity: 1.5 }, { ...base, quantity: 100001 },
    ]) assert.throws(() => normalizeVirtualReadinessRequest(mutation), VirtualReadinessPreviewError);
    assert.equal(normalizeVirtualReadinessRequest(request(1, 1)).quantity, 1);
});

test('N4.2B uses the shared planner for stable ready, shortage, supplier identity, read set and zero side effects', t => {
    const fixture = createFixture(t, { stock: 500 });
    const before = counts();
    const first = service().preview(request(fixture.recipeId, 300));
    const second = service().preview(request(fixture.recipeId, 300));
    for (let call = 0; call < 8; call += 1) service().preview(request(fixture.recipeId, 300));
    assert.equal(first.status, 'READY');
    assert.equal(first.coverage.complete, true);
    assert.equal(first.requirements.length, 1);
    assert.deepEqual(first.requirements[0], {
        requirementKey: first.requirements[0].requirementKey, resourceType: 'PART', partId: fixture.partId, coilId: null,
        model: fixture.model, supplier: '正式供应商', schemeCode: null, inventoryUnit: 'piece', quantityPerPump: 1,
        virtualRequiredQty: 300, stockOnHandQty: 500, reservedByActiveOrdersQty: 0, availableForVirtualQty: 500,
        shortageQty: 0, complete: true, sourcePointers: ['/requirements/0'],
    });
    assert.equal(first.readSetHash, second.readSetHash);
    assert.notEqual(first.readSetId, second.readSetId);
    assert.ok(first.sourceVersions.some(row => row.entityType === 'template' && row.entityId === String(fixture.templateId)));
    assert.deepEqual(counts(), before, 'virtual preview must not create a reservation, order, audit or operation');
    db.prepare('UPDATE parts SET stock = 100, updated_at = datetime(\'now\') WHERE id = ?').run(fixture.partId);
    const shortage = service().preview(request(fixture.recipeId, 300));
    assert.equal(shortage.status, 'SHORTAGE');
    assert.equal(shortage.requirements[0].availableForVirtualQty, 100);
    assert.equal(shortage.requirements[0].shortageQty, 200);
    assert.equal(shortage.shortages[0].shortageQty, 200);
    assert.notEqual(shortage.readSetHash, first.readSetHash, 'formal stock mutation must change read-set hash');
});

test('N4-AUDIT-FIX-01：virtual readiness 只评估通过正式 surface policy 的情景', t => {
    const fixture = createFixture(t, { stock: 500 });
    db.prepare('UPDATE recipes SET configuration_policy_json = ? WHERE id = ?').run(JSON.stringify({
        version: 1, fields: {}, surfaceTreatmentOptions: [{ mode: 'none', cost: 0 }, { mode: 'painting', cost: 5 }],
    }), fixture.recipeId);
    const validScenario = [{ scenarioKey: 'paint', label: 'paint', overrides: { surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 5 } }];
    const valid = service().preview(request(fixture.recipeId, 300, validScenario, 'paint'));
    assert.equal(valid.status, 'READY');
    assert.equal(valid.coverage.complete, true);
    const forbiddenScenario = [{ scenarioKey: 'wrong', label: 'wrong', overrides: { surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 6 } }];
    const forbidden = service().preview(request(fixture.recipeId, 300, forbiddenScenario, 'wrong'));
    assert.equal(forbidden.status, 'INCOMPLETE');
    assert.equal(forbidden.coverage.complete, false);
    assert.equal(forbidden.unresolvedRequirements[0].code, 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED');
});

test('N4.2B subtracts current active-order reservation through the same balanced planning projection', t => {
    const fixture = createFixture(t, { stock: 500 });
    const activeItems = [{ recipeId: fixture.recipeId, recipeName: fixture.unique, qty: 250, partsJson: JSON.stringify([{ partId: fixture.partId, model: fixture.model, supplier: '正式供应商', qty: 1 }]) }];
    db.prepare(`INSERT INTO orders (customer_name, contract_no, status, items_json, created_at, updated_at)
        VALUES (?, ?, '待确认', ?, datetime('now'), datetime('now'))`).run(fixture.unique, `${fixture.unique}-order`, JSON.stringify(activeItems));
    const reserved = service().preview(request(fixture.recipeId, 300));
    assert.equal(reserved.status, 'SHORTAGE');
    assert.equal(reserved.requirements[0].stockOnHandQty, 500);
    assert.equal(reserved.requirements[0].reservedByActiveOrdersQty, 250);
    assert.equal(reserved.requirements[0].availableForVirtualQty, 250);
    assert.equal(reserved.requirements[0].shortageQty, 50);
    const beforeHash = reserved.readSetHash;
    db.prepare("UPDATE orders SET status = '已关闭', updated_at = datetime('now') WHERE customer_name = ?").run(fixture.unique);
    const closed = service().preview(request(fixture.recipeId, 300));
    assert.equal(closed.status, 'READY');
    assert.equal(closed.requirements[0].reservedByActiveOrdersQty, 0);
    assert.notEqual(closed.readSetHash, beforeHash, 'active-order reservation source must change hash');
});

test('N4.2B reads a single SQLite snapshot when stock changes after scenario construction', t => {
    const fixture = createFixture(t, { stock: 500 });
    db.pragma('journal_mode = WAL');
    let writerRan = false;
    const first = service({ afterComparison: () => {
        if (writerRan) return;
        writerRan = true;
        const writer = spawnSync(process.execPath, ['-e', `
            const Database = require('better-sqlite3');
            const database = new Database(process.argv[1]);
            database.pragma('busy_timeout = 5000');
            database.prepare('UPDATE parts SET stock = 400 WHERE id = ?').run(Number(process.argv[2]));
            database.close();
        `, db.name, String(fixture.partId)], { cwd: process.cwd(), encoding: 'utf8' });
        assert.equal(writer.status, 0, writer.stderr);
    } }).preview(request(fixture.recipeId, 300));
    assert.equal(writerRan, true);
    assert.equal(first.requirements[0].stockOnHandQty, 500, 'preview A must retain its initial read snapshot');
    const second = service().preview(request(fixture.recipeId, 300));
    assert.equal(second.requirements[0].stockOnHandQty, 400, 'preview B must see the later committed stock');
    assert.notEqual(first.readSetHash, second.readSetHash);
});

test('N4.2B reads active-order reservations from the same snapshot and sees a later reservation only on the next preview', t => {
    const fixture = createFixture(t, { stock: 500 });
    db.pragma('journal_mode = WAL');
    const itemsJson = JSON.stringify([{ recipeId: fixture.recipeId, recipeName: fixture.unique, qty: 250,
        partsJson: JSON.stringify([{ partId: fixture.partId, model: fixture.model, supplier: '正式供应商', qty: 1 }]) }]);
    let writerRan = false;
    const first = service({ afterComparison: () => {
        if (writerRan) return;
        writerRan = true;
        const writer = spawnSync(process.execPath, ['-e', `
            const Database = require('better-sqlite3');
            const database = new Database(process.argv[1]);
            database.pragma('busy_timeout = 5000');
            database.prepare("INSERT INTO orders (customer_name, contract_no, status, items_json, created_at, updated_at) VALUES (?, ?, '待确认', ?, datetime('now'), datetime('now'))").run(process.argv[2], process.argv[3], process.argv[4]);
            database.close();
        `, db.name, fixture.unique, `${fixture.unique}-concurrent`, itemsJson], { cwd: process.cwd(), encoding: 'utf8' });
        assert.equal(writer.status, 0, writer.stderr);
    } }).preview(request(fixture.recipeId, 300));
    assert.equal(first.requirements[0].reservedByActiveOrdersQty, 0);
    const second = service().preview(request(fixture.recipeId, 300));
    assert.equal(second.requirements[0].reservedByActiveOrdersQty, 250);
    assert.equal(second.requirements[0].shortageQty, 50);
    assert.notEqual(first.readSetHash, second.readSetHash);
});

test('N4.2B keeps readiness complete when price is missing, and fails closed for unresolved identity', t => {
    const pricedMissing = createFixture(t, { stock: 500, price: null });
    const complete = service().preview(request(pricedMissing.recipeId, 300));
    assert.equal(complete.status, 'READY');
    assert.equal(complete.coverage.complete, true);
    const unresolved = createFixture(t, { stock: 500, parts: [{ partId: 999999999, model: '不存在的正式库存件', supplier: '不存在供应商', qty: 1 }] });
    const incomplete = service().preview(request(unresolved.recipeId, 300));
    assert.equal(incomplete.status, 'INCOMPLETE');
    assert.equal(incomplete.coverage.complete, false);
    assert.equal(incomplete.requirements.length, 0);
    assert.ok(incomplete.unresolvedRequirements.length > 0);
});

test('N4.2B applies the formal cable scenario configuration and shared stockQtyPerUnit meter arithmetic', t => {
    const unique = `N42B-cable-${Date.now()}`;
    const cable = db.prepare(`INSERT INTO parts (model, supplier, category, price, stock, created_at, updated_at)
        VALUES ('电缆-线径0.75', ?, '电缆线', 2, 1500, datetime('now'), datetime('now'))`).run(`${unique}-线缆厂`);
    const cableId = Number(cable.lastInsertRowid);
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, '[]', '[]', datetime('now'), datetime('now'))`).run(`${unique}-shell`);
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id,
        has_cable, cable_length, cable_wire, cable_accessory_type, assembly_wage, packing_wage,
        surface_treatment_mode, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N4.2B-cable', ?, '[]', '[]', ?, 1, 3, '0.75', 'standard', 0, 0, 'none', 0, 0, datetime('now'), datetime('now'))`)
        .run(unique, JSON.stringify([{ partId: cableId, model: '电缆-线径0.75', supplier: `${unique}-线缆厂`, qty: 1, cableAssembly: true, costRole: 'cable' }]), template.lastInsertRowid);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare('DELETE FROM parts WHERE id = ?').run(cableId);
    });
    const candidate = service().preview(request(recipeId, 300, [{ scenarioKey: 'five', label: '5米电缆', overrides: { cableLength: 5 } }], 'five'));
    assert.equal(candidate.status, 'READY');
    assert.equal(candidate.scenarioKey, 'five');
    assert.equal(candidate.requirements.length, 1);
    assert.equal(candidate.requirements[0].partId, cableId);
    assert.equal(candidate.requirements[0].inventoryUnit, 'meter');
    assert.equal(candidate.requirements[0].quantityPerPump, 5);
    assert.equal(candidate.requirements[0].virtualRequiredQty, 1500);
    assert.equal(candidate.requirements[0].stockQtyPerUnit, undefined, 'the response has only canonical requirement fields');
});

test('N4.2B keeps one exact official coil identity instead of aggregating same-spec variants', t => {
    const unique = `N42B-coil-${Date.now()}`;
    const coilA = db.prepare(`INSERT INTO coils (spec, material, slot_type, sheets, scheme_code, scheme_name, scheme_status, is_default, cost, stock, created_at, updated_at)
        VALUES ('12', '钢带', '小眼', 200, ?, ?, 'official', 1, 20, 300, datetime('now'), datetime('now'))`).run(`${unique}-A`, `${unique}-A`);
    const coilB = db.prepare(`INSERT INTO coils (spec, material, slot_type, sheets, scheme_code, scheme_name, scheme_status, is_default, cost, stock, created_at, updated_at)
        VALUES ('12', '冷轧', '国标眼', 200, ?, ?, 'official', 0, 20, 9999, datetime('now'), datetime('now'))`).run(`${unique}-B`, `${unique}-B`);
    const coilId = Number(coilA.lastInsertRowid);
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, '[]', '[]', datetime('now'), datetime('now'))`).run(`${unique}-shell`);
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, coil_id, coil_spec, coil_sheets, coil_material, coil_slot_type,
        assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N4.2B-coil', '[]', '[]', '[]', ?, ?, '12', 200, '钢带', '小眼', 0, 0, 'none', 0, 0, datetime('now'), datetime('now'))`).run(unique, template.lastInsertRowid, coilId);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare('DELETE FROM coils WHERE id IN (?, ?)').run(coilA.lastInsertRowid, coilB.lastInsertRowid);
    });
    const result = service().preview(request(recipeId, 300));
    assert.equal(result.status, 'READY', JSON.stringify(result));
    const requirement = result.requirements.find(item => item.resourceType === 'COIL');
    assert.ok(requirement, JSON.stringify(result));
    assert.equal(requirement.coilId, coilId);
    assert.equal(requirement.stockOnHandQty, 300);
    assert.equal(requirement.shortageQty, 0);
    assert.equal(result.sourceVersions.some(item => item.entityType === 'coil' && item.entityId === String(coilB.lastInsertRowid)), false);
});

test('N4.2B formal inventory endpoint returns the identical strict preview envelope', async t => {
    const fixture = createFixture(t, { stock: 500 });
    const app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(async () => {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory/virtual-readiness-preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request(fixture.recipeId, 300)),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, 'READY');
    const rejected = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory/virtual-readiness-preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request(fixture.recipeId), stock: 100000 }),
    });
    const rejectedPayload = await rejected.json();
    assert.equal(rejected.status, 422);
    assert.equal(rejectedPayload.code, 'VIRTUAL_READINESS_INVALID_INPUT');
});

test('N4.2B bounds exposed source versions while hashing the complete formal source set', t => {
    const unique = `N42B-bound-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const partRows = [];
    const bom = [];
    const insertPart = db.prepare(`INSERT INTO parts (model, supplier, category, price, stock, created_at, updated_at)
        VALUES (?, '正式供应商', '其他', 1, 10, datetime('now'), datetime('now'))`);
    for (let index = 0; index < 129; index += 1) {
        const inserted = insertPart.run(`${unique}-part-${index}`);
        const partId = Number(inserted.lastInsertRowid);
        partRows.push(partId);
        bom.push({ partId, model: `${unique}-part-${index}`, supplier: '正式供应商', qty: 1 });
    }
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, ?, '[]', datetime('now'), datetime('now'))`).run(`${unique}-shell`, JSON.stringify(bom));
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id,
        assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N4.2B-bound', '[]', '[]', '[]', ?, 0, 0, 'none', 0, 0, datetime('now'), datetime('now'))`).run(unique, template.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipe.lastInsertRowid);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare(`DELETE FROM parts WHERE id IN (${partRows.map(() => '?').join(',')})`).run(...partRows);
    });
    const first = service().preview(request(Number(recipe.lastInsertRowid), 1));
    const second = service().preview(request(Number(recipe.lastInsertRowid), 1));
    assert.equal(first.status, 'READY');
    assert.equal(first.coverage.complete, true);
    assert.equal(first.sourceVersionCount > 128, true);
    assert.equal(first.sourceVersions.length, 128);
    assert.equal(first.sourceVersionsComplete, false);
    assert.equal(first.readSetHash, second.readSetHash);
    db.prepare('UPDATE parts SET stock = 9, updated_at = datetime(\'now\') WHERE id = ?').run(partRows.at(-1));
    const changed = service().preview(request(Number(recipe.lastInsertRowid), 1));
    assert.notEqual(changed.readSetHash, first.readSetHash, 'the hidden tail of a bounded source list must remain hashed');
});
