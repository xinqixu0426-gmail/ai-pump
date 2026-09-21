'use strict';

const { createSyntheticBusinessAcceptanceFixture } = require('./syntheticBusinessAcceptanceFixture.cjs');

const NOW = '2026-09-20T01:00:00.000Z';

function createBusinessImpactFixture() {
    const fixture = createSyntheticBusinessAcceptanceFixture();
    const { db, ids } = fixture;
    const recipe = db.prepare('SELECT * FROM recipes WHERE id=?').get(ids['activeRecipe.v550']);
    const savedConfiguration = {
        recipeId: recipe.id,
        recipeUpdatedAt: recipe.updated_at,
        coilId: recipe.coil_id,
        coilSpec: recipe.coil_spec,
        coilSheets: recipe.coil_sheets,
        coilMaterial: recipe.coil_material,
        coilSlotType: recipe.coil_slot_type,
    };
    const savedLine = {
        id: 'impact-line-v550',
        recipeId: recipe.id,
        recipeName: recipe.name,
        qty: 3,
        unitCost: Number(recipe.saved_total_cost),
        unitPrice: 240,
        partsJson: recipe.parts_json,
        configurationSnapshot: savedConfiguration,
        costSnapshot: { version: 1, generatedAt: NOW, totalCost: Number(recipe.saved_total_cost) },
        snapshotVersion: 2,
        snapshotSource: 'impact_fixture',
    };
    ids['quotation.impact'] = Number(db.prepare(`INSERT INTO quotations
        (customer_id,status,items_json,total_cost,total_price,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(ids['customer.benchmark'], '报价中', JSON.stringify([{
        id: 'quote-line-v550', baseRecipeId: recipe.id, baseRecipeName: recipe.name,
        qty: 3, unitCost: Number(recipe.saved_total_cost), unitPrice: 240,
        snapshotVersion: 1, snapshotAt: NOW, configurationSnapshot: savedConfiguration,
        costSnapshot: savedLine.costSnapshot, bomSnapshot: JSON.parse(recipe.parts_json),
    }]), Number(recipe.saved_total_cost) * 3, 720, NOW, NOW).lastInsertRowid);
    ids['order.impact'] = Number(db.prepare(`INSERT INTO orders
        (customer_id,customer_name,contract_no,status,items_json,purchase_list_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(ids['customer.benchmark'], '基准客户', 'IMP-ORDER-001', '待采购',
        JSON.stringify([savedLine]), '[]', NOW, NOW).lastInsertRowid);
    ids['technicalFile.v550'] = Number(db.prepare(`INSERT INTO recipe_technical_files
        (recipe_id,original_name,mime_type,file_size,file_sha256,file_blob,report_type,summary_json,parsed_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(recipe.id, 'V550-历史性能报告.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, 'impact-report-sha', Buffer.from('test'),
        'pump_performance_test', JSON.stringify({ model: 'V550' }), JSON.stringify({ testPoints: [{ flow: 10, head: 20 }] }), NOW, NOW).lastInsertRowid);

    // Production shape: multiple current recipes share one formal template.
    db.prepare('UPDATE recipes SET template_id=? WHERE id=?').run(ids['template.v550'], ids['activeRecipe.v750']);
    return fixture;
}

function runBusinessImpactFixtureChecks(fixture) {
    const { db, ids } = fixture;
    const checks = [
        ['order-snapshot', JSON.parse(db.prepare('SELECT items_json value FROM orders WHERE id=?').get(ids['order.impact']).value)[0].snapshotVersion === 2],
        ['quotation-snapshot', JSON.parse(db.prepare('SELECT items_json value FROM quotations WHERE id=?').get(ids['quotation.impact']).value)[0].snapshotVersion === 1],
        ['technical-file-recipe-only', db.prepare('SELECT recipe_id FROM recipe_technical_files WHERE id=?').get(ids['technicalFile.v550']).recipe_id === ids['activeRecipe.v550']],
        ['two-template-recipes', db.prepare('SELECT COUNT(*) n FROM recipes WHERE template_id=? AND deleted_at IS NULL').get(ids['template.v550']).n === 2],
        ['ambiguous-12-220', db.prepare("SELECT COUNT(*) n FROM coils WHERE spec='12' AND sheets=220 AND scheme_status='official'").get().n === 2],
    ].map(([key, passed]) => ({ key, passed: Boolean(passed) }));
    return { passed: checks.every(item => item.passed), checks };
}

module.exports = { createBusinessImpactFixture, runBusinessImpactFixtureChecks };
