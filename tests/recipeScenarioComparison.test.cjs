'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-scenario-compare-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'fixture-{pid}.db');

const express = require('express');
const router = require('../api/routes/cost.cjs');
const {
    db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, recipeRow, templateRow,
    modelVariantRow, loadPartsData, calculateRecipeCost, getSetting, stopBackupScheduler,
} = require('../api/db.cjs');
const { createRecipeQueries } = require('../api/services/recipeQueries.cjs');
const { createRecipeScenarioComparison, makeScenarioRecipe } = require('../api/services/recipeScenarioComparison.cjs');
const { createProfitabilityPreview } = require('../api/services/profitabilityPreview.cjs');

let server;
let baseUrl;

async function post(pathname, body) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
}

async function get(pathname) {
    const response = await fetch(`${baseUrl}${pathname}`);
    return { response, payload: await response.json() };
}

function pointerValue(value, pointer) {
    return pointer.slice(1).split('/').reduce((current, token) => current[
        token.replace(/~1/g, '/').replace(/~0/g, '~')
    ], value);
}

function scenarioService({ calculate = calculateRecipeCost } = {}) {
    const recipeQueries = createRecipeQueries({
        db,
        listCoils: dbGetAllCoils,
        listParts: dbGetAllParts,
        listRecipes: dbGetAllRecipes,
        modelVariantRow,
        recipeRow,
        templateRow,
        getSetting,
    });
    return createRecipeScenarioComparison({
        db,
        recipeRow,
        listCoils: dbGetAllCoils,
        loadPartsData,
        calculateRecipeCost: calculate,
        getSetting,
        getBomDraft: recipeQueries.getBomDraft,
    });
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    stopBackupScheduler();
    server?.closeAllConnections?.();
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
});

test('同口径情景比较：空覆盖保持当前重建金额、读取集合一致且零写入', async t => {
    const unique = `N22-${Date.now()}`;
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, '[]', '[]', datetime('now'), datetime('now'))`).run(`${unique}-shell`);
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, saved_total_cost,
        template_id, assembly_wage, packing_wage, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N2.2', '[]', ?, '[]', 999, ?, 2, 3, 4, 5, datetime('now'), datetime('now'))`)
        .run(unique, '[]', template.lastInsertRowid);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
    });
    const before = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
    const body = { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'same', label: '原样', overrides: {} }] };
    const { response, payload } = await post(`/api/recipes/${recipeId}/scenario-compare-preview`, body);
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.success, true);
    const data = payload.data;
    assert.equal(data.preview, true);
    assert.equal(data.scenarios.length, 2);
    assert.equal(data.scenarios[0].cost.costBasis, 'CURRENT_REBUILT_BASE');
    assert.equal(data.scenarios[1].cost.costBasis, 'CURRENT_REBUILT_SCENARIO');
    assert.equal(data.scenarios[0].cost.currentTotalCost, data.scenarios[1].cost.currentTotalCost);
    assert.equal(data.scenarios[0].configurationHash, data.scenarios[1].configurationHash);
    assert.equal(data.comparisons[0].status, 'COMPARABLE');
    assert.equal(data.comparisons[0].delta, 0);
    assert.ok(data.readSetId);
    assert.match(data.readSetHash, /^[a-f0-9]{64}$/);
    const current = await get('/api/recipes/current-costs');
    assert.equal(current.response.status, 200, JSON.stringify(current.payload));
    const currentRecipe = current.payload.data.items.find(item => item.recipeId === recipeId);
    assert.ok(currentRecipe, '当前成本 API 应包含同一正式配方');
    assert.equal(data.scenarios[0].cost.currentTotalCost, currentRecipe.currentTotalCost);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, before);

    const changed = await post(`/api/recipes/${recipeId}/scenario-compare-preview`, {
        version: 1,
        baselinePolicy: 'CURRENT_REBUILT',
        scenarios: [{ scenarioKey: 'barrel', label: '机筒试算', overrides: { customBarrelLength: 180 } }],
    });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
    assert.deepEqual(changed.payload.data.changes, [{
        scenarioKey: 'barrel', field: 'customBarrelLength', from: null, to: 180,
    }]);
    const driver = changed.payload.data.comparisons[0].drivers[0];
    assert.equal(driver.costRole, 'configuration');
    for (const pointer of driver.sourcePointers) assert.notEqual(pointerValue(changed.payload.data, pointer), undefined, pointer);
});

test('同口径情景比较：拒绝客户端价格、保留字段和错误线圈片数', async () => {
    const request = { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'bad', label: '非法', overrides: { copperPrice: 95 } }] };
    const { response, payload } = await post('/api/recipes/1/scenario-compare-preview', request);
    assert.equal(response.status, 422);
    assert.equal(payload.code, 'CLIENT_PRICE_FORBIDDEN');
    const mismatch = await post('/api/recipes/1/scenario-compare-preview', {
        version: 1, baselinePolicy: 'CURRENT_REBUILT',
        scenarios: [{ scenarioKey: 'mismatch', label: '片数不符', overrides: { coilId: 1, coilSheets: 999999 } }],
    });
    assert.ok([404, 422].includes(mismatch.response.status));
    if (mismatch.response.status === 422) assert.equal(mismatch.payload.code, 'COIL_SHEETS_MISMATCH');
});

test('同口径情景比较：正式线圈替换重建身份且不保留旧方案字段', () => {
    const baseRecipe = {
        id: 1, name: '旧线圈配方', partsJson: '[]', extraPartsJson: '[]', packingPartsJson: '[]',
        coilId: 1, coilSpec: '12', coilSheets: 120, coilMaterial: '钢带', coilSlotType: '小眼',
        coilSchemeFamilyCode: 'legacy-family', coilWireWeight: 2, hasFloat: false, hasCable: false,
    };
    const result = makeScenarioRecipe(baseRecipe, {}, { coilId: 2, coilSheets: 200 }, [{
        id: 2, spec: '12', sheets: 200, material: '铜带', slotType: '大眼', schemeStatus: 'official',
        schemeFamilyCode: '', wireWeight: 3, pricingMode: 'kit', kitPrice: 88,
    }]);
    assert.equal(result.recipe.coilId, 2);
    assert.equal(result.recipe.coilSheets, 200);
    assert.equal(result.recipe.coilMaterial, '铜带');
    assert.equal(result.recipe.coilSlotType, '大眼');
    assert.equal(result.recipe.coilSchemeFamilyCode, '');
    assert.equal(result.recipe.coilWireWeight, 3);
    assert.deepEqual(result.applied, { coilId: 2, coilSheets: 200 });
    assert.throws(() => makeScenarioRecipe(baseRecipe, {}, { coilId: 2, coilSheets: 201 }, [{ id: 2, sheets: 200, schemeStatus: 'official' }]), /正式片数/);
});

test('同口径情景比较：未启用电缆或浮球时不会静默应用其依赖覆盖', () => {
    const baseRecipe = {
        id: 1, name: '依赖配置配方', partsJson: '[]', extraPartsJson: '[]', packingPartsJson: '[]',
        hasCable: false, cableLength: 0, cableWire: '', cableAccessoryType: 'standard',
        hasFloat: false, floatWire: '', floatAccessoryType: 'standard',
    };
    const baseConfig = {
        hasCable: false, cableLength: 0, cableWire: '', cableAccessoryType: 'standard',
        hasFloat: false, floatWire: '', floatAccessoryType: 'standard',
    };
    const rejected = makeScenarioRecipe(baseRecipe, baseConfig, {
        cableLength: 5,
        floatAccessoryType: 'xinjie',
    }, []);
    assert.deepEqual(rejected.applied, {});
    assert.deepEqual(rejected.notApplied.map(item => item.reasonCode), ['CABLE_NOT_ENABLED', 'FLOAT_NOT_ENABLED']);
    assert.equal(rejected.recipe.cableLength, 0);
    assert.equal(rejected.recipe.floatAccessoryType, 'standard');
    const enabled = makeScenarioRecipe(baseRecipe, baseConfig, { hasCable: true, cableLength: 5 }, []);
    assert.deepEqual(enabled.applied, { hasCable: true, cableLength: 5 });
    assert.deepEqual(enabled.notApplied, []);
    assert.equal(enabled.recipe.cableLength, 5);
});

test('同口径情景比较：候选保留正式配方工资、管理费、包装和零件供应商身份', t => {
    const unique = `N22-preserve-${Date.now()}`;
    const model = `${unique}-part`;
    const supplierA = db.prepare(`INSERT INTO parts (model, supplier, category, price, created_at, updated_at)
        VALUES (?, '供应商A', '其他', 11, datetime('now'), datetime('now'))`).run(model);
    const supplierB = db.prepare(`INSERT INTO parts (model, supplier, category, price, created_at, updated_at)
        VALUES (?, '供应商B', '其他', 2, datetime('now'), datetime('now'))`).run(model);
    const packaging = db.prepare(`INSERT INTO parts (model, supplier, category, price, created_at, updated_at)
        VALUES (?, '包装供应商', '包装', 3, datetime('now'), datetime('now'))`).run(`${unique}-box`);
    const template = db.prepare(`INSERT INTO pump_shell_templates
        (shell_model, parts_json, shell_components_json, assembly_wage, created_at, updated_at)
        VALUES (?, ?, '[]', 7, datetime('now'), datetime('now'))`).run(
        `${unique}-shell`, JSON.stringify([{ partId: Number(supplierA.lastInsertRowid), model, supplier: '供应商A', qty: 1 }])
    );
    const packingPartsJson = JSON.stringify([{
        partId: Number(packaging.lastInsertRowid), model: `${unique}-box`, supplier: '包装供应商', qty: 1, packingRole: 'container',
    }]);
    const recipe = db.prepare(`INSERT INTO recipes
        (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage,
         surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N2.2-preserve', '[]', '[]', ?, ?, 13, 2, 3, 5, datetime('now'), datetime('now'))`)
        .run(unique, packingPartsJson, template.lastInsertRowid);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare('DELETE FROM parts WHERE id IN (?, ?, ?)').run(supplierA.lastInsertRowid, supplierB.lastInsertRowid, packaging.lastInsertRowid);
    });
    assert.ok(db.prepare('SELECT id FROM parts WHERE id = ?').get(packaging.lastInsertRowid));
    assert.ok(dbGetAllParts().some(part => Number(part.id) === Number(packaging.lastInsertRowid)));
    const result = scenarioService().compare(recipeId, {
        version: 1,
        baselinePolicy: 'CURRENT_REBUILT',
        scenarios: [{ scenarioKey: 'barrel', label: '机筒试算', overrides: { customBarrelLength: 180 } }],
    });
    assert.equal(result.scenarios[0].cost.currentTotalCost, 34, 'uses recipe assembly wage 13, not template wage 7; none surface mode remains zero cost');
    assert.equal(result.scenarios[1].cost.currentTotalCost, 34);
    assert.equal(result.comparisons[0].delta, 0);
    assert.equal(result.scenarios[1].configuration.packingPartsJson, packingPartsJson);
    assert.ok(result.sourceVersions.some(source => source.entityType === 'part' && source.entityId === String(supplierA.lastInsertRowid)));
    assert.ok(result.sourceVersions.some(source => source.entityType === 'part' && source.entityId === String(packaging.lastInsertRowid)));
    assert.equal(result.sourceVersions.some(source => source.entityType === 'part' && source.entityId === String(supplierB.lastInsertRowid)), false);
});

test('同口径情景比较：SQLite 并发价格更新不会混入同一 read set，下一次读取会得到新 hash', t => {
    const unique = `N22-concurrency-${Date.now()}`;
    const part = db.prepare(`INSERT INTO parts (model, supplier, category, price, created_at, updated_at)
        VALUES (?, '并发供应商', '其他', 11, datetime('now'), datetime('now'))`).run(`${unique}-part`);
    const partId = Number(part.lastInsertRowid);
    const template = db.prepare(`INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at)
        VALUES (?, ?, '[]', datetime('now'), datetime('now'))`).run(
        `${unique}-shell`, JSON.stringify([{ partId, model: `${unique}-part`, supplier: '并发供应商', qty: 1 }]
    ));
    const recipe = db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json,
        template_id, assembly_wage, packing_wage, surface_treatment_cost, management_fee, created_at, updated_at)
        VALUES (?, 'N2.2-concurrency', '[]', '[]', '[]', ?, 0, 0, 0, 0, datetime('now'), datetime('now'))`)
        .run(unique, template.lastInsertRowid);
    const recipeId = Number(recipe.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(template.lastInsertRowid);
        db.prepare('DELETE FROM parts WHERE id = ?').run(partId);
    });
    db.pragma('journal_mode = WAL');
    const beforeAudit = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
    let calculationCount = 0;
    const calculateWithConcurrentWriter = (...args) => {
        const result = calculateRecipeCost(...args);
        calculationCount += 1;
        if (calculationCount === 1) {
            const writer = spawnSync(process.execPath, ['-e', `
                const Database = require('better-sqlite3');
                const database = new Database(process.argv[1]);
                database.pragma('busy_timeout = 5000');
                database.prepare('UPDATE parts SET price = ? WHERE id = ?').run(Number(process.argv[3]), Number(process.argv[2]));
                database.close();
            `, db.name, String(partId), '29'], { cwd: process.cwd(), encoding: 'utf8' });
            assert.equal(writer.status, 0, writer.stderr);
        }
        return result;
    };
    const request = {
        version: 1,
        baselinePolicy: 'CURRENT_REBUILT',
        scenarios: [{ scenarioKey: 'same', label: '原样', overrides: {} }],
    };
    const first = scenarioService({ calculate: calculateWithConcurrentWriter }).compare(recipeId, request);
    assert.equal(calculationCount, 2, 'base and candidate must calculate during one service transaction');
    assert.equal(first.scenarios[0].cost.currentTotalCost, 11);
    assert.equal(first.scenarios[1].cost.currentTotalCost, 11);
    assert.equal(first.comparisons[0].delta, 0);
    assert.deepEqual(first.sourceVersions.map(source => `${source.entityType}:${source.entityId}`), [
        `part:${partId}`, `recipe:${recipeId}`, `template:${template.lastInsertRowid}`,
    ]);
    const second = scenarioService().compare(recipeId, request);
    assert.equal(second.scenarios[0].cost.currentTotalCost, 29);
    assert.equal(second.scenarios[1].cost.currentTotalCost, 29);
    assert.notEqual(first.readSetHash, second.readSetHash);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, beforeAudit);
});

test('N4.1C：包装角色由正式目录绑定、固定包材保留，表面处理使用正式政策费用', t => {
    const unique = `N41C-packing-${Date.now()}`;
    const insertPart = (model, supplier, price, category = '包装') => Number(db.prepare(
        'INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
    ).run(model, supplier, category, price).lastInsertRowid);
    const paperId = insertPart(`${unique}-纸箱`, '包装A', 2);
    const woodId = insertPart(`${unique}-木箱`, '包装B', 7);
    const guideId = insertPart(`${unique}-说明书`, '包装A', 1);
    const templateId = Number(db.prepare(
        'INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, \'[]\', \'[]\', datetime(\'now\'), datetime(\'now\'))'
    ).run(`${unique}-shell`).lastInsertRowid);
    const policy = JSON.stringify({ version: 1, fields: {}, packingPartIds: [woodId], surfaceTreatmentOptions: [
        { mode: 'painting', cost: 3 }, { mode: 'electrophoresis', cost: 5 }, { mode: 'none', cost: 0 },
    ] });
    const initialPacking = JSON.stringify([
        { partId: paperId, model: `${unique}-纸箱`, supplier: '包装A', qty: 1, packingRole: 'container' },
        { partId: guideId, model: `${unique}-说明书`, supplier: '包装A', qty: 1, packingRole: 'fixed' },
    ]);
    const recipeId = Number(db.prepare(`INSERT INTO recipes
        (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage,
         surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at)
         VALUES (?, 'N4.1C', '[]', '[]', ?, ?, 0, 0, 'painting', 3, 0, ?, datetime('now'), datetime('now'))`)
        .run(unique, initialPacking, templateId, policy).lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId);
        db.prepare('DELETE FROM parts WHERE id IN (?, ?, ?)').run(paperId, woodId, guideId);
    });
    const result = scenarioService().compare(recipeId, {
        version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{
            scenarioKey: 'wood-electro', label: '木箱电泳', overrides: {
                packingParts: [{ partId: woodId, model: `${unique}-木箱`, supplier: '包装B', qty: 1, packingRole: 'container' }],
                surfaceTreatmentMode: 'electrophoresis',
            },
        }],
    });
    const candidate = result.scenarios[1];
    const candidatePacking = JSON.parse(candidate.configuration.packingPartsJson);
    assert.deepEqual(candidate.requestedOverrides.surfaceTreatmentMode, 'electrophoresis');
    assert.equal(Object.hasOwn(candidate.appliedOverrides, 'surfaceTreatmentCost'), false, 'policy cost is not presented as user override');
    assert.equal(candidate.configuration.surfaceTreatmentCost, 5);
    assert.deepEqual(candidatePacking.map(item => item.partId).sort((a, b) => a - b), [woodId, guideId].sort((a, b) => a - b));
    assert.equal(candidatePacking.some(item => item.partId === paperId), false);
    assert.ok(result.sourceVersions.some(item => item.entityType === 'part' && item.entityId === String(woodId)));
    assert.equal(result.comparisons[0].status, 'COMPARABLE');
});

test('N4.1C：包装身份和表面处理矛盾 fail closed', t => {
    const unique = `N41C-invalid-${Date.now()}`;
    const normalId = Number(db.prepare(
        'INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, \'普通供应商\', \'其他\', 1, datetime(\'now\'), datetime(\'now\'))'
    ).run(`${unique}-normal`).lastInsertRowid);
    const templateId = Number(db.prepare(
        'INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, \'[]\', \'[]\', datetime(\'now\'), datetime(\'now\'))'
    ).run(`${unique}-shell`).lastInsertRowid);
    const recipeId = Number(db.prepare(`INSERT INTO recipes
        (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage,
         surface_treatment_mode, surface_treatment_cost, management_fee, created_at, updated_at)
         VALUES (?, 'N4.1C', '[]', '[]', '[]', ?, 0, 0, 'painting', 3, 0, datetime('now'), datetime('now'))`)
        .run(unique, templateId).lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId);
        db.prepare('DELETE FROM parts WHERE id = ?').run(normalId);
    });
    assert.throws(() => scenarioService().compare(recipeId, {
        version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'badpack', label: '错误包装', overrides: {
            packingParts: [{ partId: normalId, model: `${unique}-normal`, supplier: '普通供应商', qty: 1, packingRole: 'container' }],
        } }],
    }), error => error.code === 'PACKING_PART_CATEGORY_INVALID');
    assert.throws(() => scenarioService().compare(recipeId, {
        version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'nonecost', label: '无表面处理有费用', overrides: {
            surfaceTreatmentMode: 'none', surfaceTreatmentCost: 3,
        } }],
    }), error => error.code === 'SURFACE_TREATMENT_COST_CONFLICT');
    assert.throws(() => scenarioService().compare(recipeId, {
        version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'electro', label: '无政策电泳', overrides: {
            surfaceTreatmentMode: 'electrophoresis',
        } }],
    }), error => error.code === 'SURFACE_TREATMENT_COST_REQUIRED');
});

test('N4-AUDIT-FIX-01：surface policy 缺失时允许显式假设，存在时严格匹配且正确派生费用', t => {
    const unique = `N4-audit-surface-${Date.now()}`;
    const templateId = Number(db.prepare(
        "INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, '[]', '[]', datetime('now'), datetime('now'))"
    ).run(`${unique}-shell`).lastInsertRowid);
    const recipeId = Number(db.prepare(`INSERT INTO recipes
        (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage,
         surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at)
        VALUES (?, 'N4-AUDIT-FIX-01', '[]', '[]', '[]', ?, 0, 0, 'painting', 3, 0, ?, datetime('now'), datetime('now'))`
    ).run(unique, templateId, JSON.stringify({ version: 1, fields: {} })).lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId);
    });
    const compare = (scenarioKey, overrides) => scenarioService().compare(recipeId, {
        version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey, label: scenarioKey, overrides }],
    });

    assert.throws(() => compare('absent-mode-only', { surfaceTreatmentMode: 'electrophoresis' }), error => error.code === 'SURFACE_TREATMENT_COST_REQUIRED');
    const hypothetical = compare('absent-explicit', { surfaceTreatmentMode: 'electrophoresis', surfaceTreatmentCost: 6 });
    assert.equal(hypothetical.scenarios[1].configuration.surfaceTreatmentCost, 6);
    assert.equal(hypothetical.scenarios[1].appliedOverrides.surfaceTreatmentCost, 6);

    db.prepare('UPDATE recipes SET configuration_policy_json = ? WHERE id = ?').run(JSON.stringify({
        version: 1, fields: {}, surfaceTreatmentOptions: [
            { mode: 'painting', cost: 3 }, { mode: 'electrophoresis', cost: 5 }, { mode: 'none', cost: 0 },
        ],
    }), recipeId);
    const derived = compare('policy-derived', { surfaceTreatmentMode: 'electrophoresis' });
    assert.equal(derived.scenarios[1].configuration.surfaceTreatmentCost, 5);
    assert.equal(Object.hasOwn(derived.scenarios[1].requestedOverrides, 'surfaceTreatmentCost'), false);
    assert.equal(Object.hasOwn(derived.scenarios[1].appliedOverrides, 'surfaceTreatmentCost'), false);
    assert.doesNotThrow(() => compare('policy-exact', { surfaceTreatmentMode: 'electrophoresis', surfaceTreatmentCost: 5 }));
    assert.throws(() => compare('policy-wrong-cost', { surfaceTreatmentMode: 'electrophoresis', surfaceTreatmentCost: 6 }), error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED');
    assert.throws(() => compare('policy-unknown-mode', { surfaceTreatmentMode: 'powder_coating', surfaceTreatmentCost: 6 }), error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED');
    assert.throws(() => compare('policy-unknown-mode-only', { surfaceTreatmentMode: 'powder_coating' }), error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED');
    assert.doesNotThrow(() => compare('none-zero', { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 }));
    assert.throws(() => compare('none-nonzero', { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 1 }), error => error.code === 'SURFACE_TREATMENT_COST_CONFLICT');
});

test('N4-AUDIT-FIX-01：盈利 preview 只能消费通过正式 surface policy 的情景', t => {
    const unique = `N4-audit-profit-${Date.now()}`;
    const templateId = Number(db.prepare(
        "INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, '[]', '[]', datetime('now'), datetime('now'))"
    ).run(`${unique}-shell`).lastInsertRowid);
    const recipeId = Number(db.prepare(`INSERT INTO recipes
        (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage,
         surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at)
        VALUES (?, 'N4-AUDIT-FIX-01', '[]', '[]', '[]', ?, 0, 0, 'none', 0, 0, ?, datetime('now'), datetime('now'))`
    ).run(unique, templateId, JSON.stringify({ version: 1, fields: {}, surfaceTreatmentOptions: [{ mode: 'none', cost: 0 }, { mode: 'painting', cost: 5 }] })).lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId);
    });
    const preview = createProfitabilityPreview({ scenarioComparison: scenarioService() });
    const request = overrides => ({
        version: 1,
        basisRef: { kind: 'SCENARIO_COMPARISON', recipeId, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'surface', label: 'surface', overrides }] }, scenarioKey: 'surface' },
        unitPrice: 340, quantity: 300, currency: 'CNY',
    });
    const valid = preview.preview(request({ surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 5 }));
    assert.equal(valid.costComplete, true);
    assert.equal(valid.scenarioKey, 'surface');
    assert.throws(
        () => preview.preview(request({ surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 6 })),
        error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED'
    );
});

test('N4.1C-R3 preserves legacy-open packing removal when policy omits packingRemovalPolicy', t => {
    const unique = `N41C-policy-gap-${Date.now()}`;
    const insertPart = (model, supplier, price) => Number(db.prepare('INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, ?, \'包装\', ?, datetime(\'now\'), datetime(\'now\'))').run(model, supplier, price).lastInsertRowid);
    const containerId = insertPart(`${unique}-箱`, '供应商A', 2);
    const templateId = Number(db.prepare('INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, \'[]\', \'[]\', datetime(\'now\'), datetime(\'now\'))').run(`${unique}-shell`).lastInsertRowid);
    const recipeId = Number(db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at) VALUES (?, 'N4.1C', '[]', '[]', ?, ?, 0, 0, 'none', 0, 0, ?, datetime('now'), datetime('now'))`).run(unique, JSON.stringify([{ partId: containerId, model: `${unique}-箱`, supplier: '供应商A', qty: 1, packingRole: 'container' }]), templateId, JSON.stringify({ version: 1, fields: {}, packingPartIds: [] })).lastInsertRowid);
    t.after(() => { db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId); db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId); db.prepare('DELETE FROM parts WHERE id = ?').run(containerId); });
    const result = scenarioService().compare(recipeId, { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'clear', label: '清空包装', overrides: { packingParts: [] } }] });
    assert.equal(result.scenarios[1].configuration.packingPartsJson, '[]');
});

test('N4.1C-R3：正式情景预览在同一共享政策层区分包装替换、删除和清空', t => {
    const unique = `N41CR3-policy-${Date.now()}`;
    const addPart = (suffix, supplier, price) => Number(db.prepare("INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, ?, '包装', ?, datetime('now'), datetime('now'))").run(`${unique}-${suffix}`, supplier, price).lastInsertRowid);
    const paperId = addPart('纸箱', '包装A', 2);
    const woodId = addPart('木箱', '包装B', 5);
    const pearlId = addPart('珍珠棉', '包装A', 1);
    const guideId = addPart('说明书', '包装A', 1);
    const templateId = Number(db.prepare("INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, '[]', '[]', datetime('now'), datetime('now'))").run(`${unique}-shell`).lastInsertRowid);
    const baseline = [
        { partId: paperId, model: `${unique}-纸箱`, supplier: '包装A', qty: 1, packingRole: 'container' },
        { partId: pearlId, model: `${unique}-珍珠棉`, supplier: '包装A', qty: 1, packingRole: 'pearlCotton' },
        { partId: guideId, model: `${unique}-说明书`, supplier: '包装A', qty: 1, packingRole: 'fixed' },
    ];
    const policy = { version: 1, fields: {}, packingPartIds: [woodId], packingRemovalPolicy: { removableRoles: ['pearlCotton'], removablePartIds: [guideId], allowClearAll: false } };
    const recipeId = Number(db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at)
        VALUES (?, 'N4.1C-R3', '[]', '[]', ?, ?, 0, 0, 'none', 0, 0, ?, datetime('now'), datetime('now'))`).run(unique, JSON.stringify(baseline), templateId, JSON.stringify(policy)).lastInsertRowid);
    t.after(() => { db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId); db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId); db.prepare('DELETE FROM parts WHERE id IN (?, ?, ?, ?)').run(paperId, woodId, pearlId, guideId); });
    const compare = overrides => scenarioService().compare(recipeId, { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'candidate', label: 'R3', overrides }] });
    const replacement = compare({ packingParts: [{ partId: woodId, model: `${unique}-木箱`, supplier: '包装B', qty: 1, packingRole: 'container' }] });
    assert.deepEqual(JSON.parse(replacement.scenarios[1].configuration.packingPartsJson).map(item => item.partId).sort((a, b) => a - b), [woodId, pearlId, guideId].sort((a, b) => a - b));
    const removedByRole = compare({ packingParts: [{ partId: pearlId, model: `${unique}-珍珠棉`, supplier: '包装A', qty: 0, packingRole: 'pearlCotton' }] });
    assert.equal(JSON.parse(removedByRole.scenarios[1].configuration.packingPartsJson).some(item => item.partId === pearlId), false);
    const removedById = compare({ packingParts: [{ partId: guideId, model: `${unique}-说明书`, supplier: '包装A', qty: 0, packingRole: 'fixed' }] });
    assert.equal(JSON.parse(removedById.scenarios[1].configuration.packingPartsJson).some(item => item.partId === guideId), false);
    assert.throws(() => compare({ packingParts: [{ partId: paperId, model: `${unique}-纸箱`, supplier: '包装A', qty: 0, packingRole: 'container' }] }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_REMOVAL_NOT_ALLOWED');
    assert.throws(() => compare({ packingParts: [] }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_CLEAR_ALL_NOT_ALLOWED');
    const firstHash = replacement.readSetHash;
    policy.packingRemovalPolicy.allowClearAll = true;
    db.prepare('UPDATE recipes SET configuration_policy_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(policy), recipeId);
    const clear = compare({ packingParts: [] });
    assert.equal(clear.scenarios[1].configuration.packingPartsJson, '[]');
    assert.notEqual(clear.readSetHash, firstHash, '配置政策变化必须进入读取集合哈希');
});

test('N4.1C-R3：缺少正式包装价格时情景金额和差额均不伪造为零', t => {
    const unique = `N41CR3-missing-${Date.now()}`;
    const baselineId = Number(db.prepare("INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, '包装A', '包装', 2, datetime('now'), datetime('now'))").run(`${unique}-纸箱`).lastInsertRowid);
    const missingId = Number(db.prepare("INSERT INTO parts (model, supplier, category, price, created_at, updated_at) VALUES (?, '包装B', '包装', NULL, datetime('now'), datetime('now'))").run(`${unique}-未定价木箱`).lastInsertRowid);
    const templateId = Number(db.prepare("INSERT INTO pump_shell_templates (shell_model, parts_json, shell_components_json, created_at, updated_at) VALUES (?, '[]', '[]', datetime('now'), datetime('now'))").run(`${unique}-shell`).lastInsertRowid);
    const recipeId = Number(db.prepare(`INSERT INTO recipes (name, spec, parts_json, extra_parts_json, packing_parts_json, template_id, assembly_wage, packing_wage, surface_treatment_mode, surface_treatment_cost, management_fee, configuration_policy_json, created_at, updated_at)
        VALUES (?, 'N4.1C-R3', '[]', '[]', ?, ?, 0, 0, 'none', 0, 0, ?, datetime('now'), datetime('now'))`).run(unique, JSON.stringify([{ partId: baselineId, model: `${unique}-纸箱`, supplier: '包装A', qty: 1, packingRole: 'container' }]), templateId, JSON.stringify({ version: 1, fields: {}, packingPartIds: [missingId] })).lastInsertRowid);
    t.after(() => { db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId); db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(templateId); db.prepare('DELETE FROM parts WHERE id IN (?, ?)').run(baselineId, missingId); });
    const result = scenarioService().compare(recipeId, { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'missing', label: '未定价包装', overrides: { packingParts: [{ partId: missingId, model: `${unique}-未定价木箱`, supplier: '包装B', qty: 1, packingRole: 'container' }] } }] });
    assert.equal(result.scenarios[1].cost.complete, false);
    assert.equal(result.scenarios[1].cost.currentTotalCost, null);
    assert.equal(result.comparisons[0].status, 'INCOMPLETE');
    assert.equal(result.comparisons[0].delta, null);
});
