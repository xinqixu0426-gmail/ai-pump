const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildRecipeRotorDraft,
    buildTemplateRotorDraft,
    listOrderPumpModels,
    listRotorLinkTargets,
} = require('../api/services/rotorQueries.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_name TEXT,
            contract_no TEXT,
            items_json TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY,
            shell_model TEXT,
            parts_json TEXT,
            rotor_params_json TEXT
        );
        CREATE TABLE pump_model_variants (
            id INTEGER PRIMARY KEY,
            template_id INTEGER,
            model_name TEXT,
            barrel_length REAL,
            coil_spec TEXT,
            coil_sheets INTEGER,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            spec TEXT,
            template_id INTEGER,
            model_variant_id INTEGER,
            custom_barrel_length REAL,
            coil_spec TEXT,
            coil_sheets INTEGER,
            technical_data_json TEXT,
            impeller_thickness REAL,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY,
            model TEXT,
            category TEXT,
            remark TEXT,
            deleted_at TEXT
        );
        INSERT INTO pump_shell_templates (
            id, shell_model, parts_json, rotor_params_json
        ) VALUES (
            1,
            'SS-750',
            '[{"name":"花板轴承","model":"202"},{"name":"油缸轴承","model":"204"}]',
            '{"piece_count":150}'
        );
        INSERT INTO pump_model_variants (
            id, template_id, model_name, barrel_length, coil_spec, coil_sheets
        ) VALUES (10, 1, 'V750-180', 180, '12', 180);
        INSERT INTO pump_model_variants (
            id, template_id, model_name, barrel_length, coil_spec, coil_sheets
        ) VALUES (11, 2, 'OTHER', 170, '12', 170);
        INSERT INTO parts (
            id, model, category, remark
        ) VALUES (
            1,
            'ss-750',
            '泵壳',
            '{"isStainless":true,"openOffset":15}'
        );
        INSERT INTO recipes (
            id, name, spec, template_id, model_variant_id,
            custom_barrel_length, coil_spec, coil_sheets,
            technical_data_json, impeller_thickness, updated_at
        ) VALUES (
            20, 'V750配方', '220V', 1, 10,
            190, '12', 180,
            '{"pieceCount":160,"bearingSpan":176,"threadLength":22}',
            9, '2026-08-03T00:00:00.000Z'
        );
        INSERT INTO orders (
            id, customer_name, contract_no, items_json, updated_at
        ) VALUES (
            30, '客户A', 'HT-30',
            '[{"recipeName":"V750配方","spec":"220V"},{"name":"无配方"}]',
            '2026-08-03T00:00:00.000Z'
        );
        INSERT INTO orders (
            id, customer_name, contract_no, items_json, updated_at
        ) VALUES (
            31, '客户B', 'HT-31', '{bad json',
            '2026-08-02T00:00:00.000Z'
        );
    `);
    return db;
}

test('转子 Query：订单型号只聚合有效正式订单明细且容忍历史坏 JSON', () => {
    const db = createFixture();
    const models = listOrderPumpModels(db);
    assert.deepEqual(models, [{
        orderId: 30,
        customerName: '客户A',
        contractNo: 'HT-30',
        recipeName: 'V750配方',
        spec: '220V',
    }]);
    db.close();
});

test('转子 Query：关联目标统一聚合订单、变体和配方', () => {
    const db = createFixture();
    const targets = listRotorLinkTargets(db);
    assert.deepEqual(
        [...new Set(targets.map(item => item.type))].sort(),
        ['order', 'recipe', 'variant']
    );
    assert.ok(targets.some(
        item => item.value === '订单:V750配方 (220V)'
    ));
    assert.ok(targets.some(
        item => item.value === '变体:V750-180'
    ));
    assert.ok(targets.some(
        item => item.value === '配方:V750配方 (220V)'
    ));
    db.close();
});

test('转子 Query：配方技术档案覆盖模板默认值且保持只读', () => {
    const db = createFixture();
    const before = db.totalChanges;
    const draft = buildRecipeRotorDraft(db, 20);
    assert.equal(draft.recipeId, 20);
    assert.equal(draft.templateId, 1);
    assert.equal(draft.variantId, 10);
    assert.equal(draft.drawingName, 'V750配方');
    assert.equal(draft.patch.upper_bearing, '6202');
    assert.equal(draft.patch.lower_bearing, '6204');
    assert.equal(draft.patch.piece_count, '160');
    assert.equal(draft.patch.bearing_span, '176');
    assert.equal(draft.patch.thread_length, '22');
    assert.equal(draft.patch.impeller_depth, '9');
    assert.equal(db.totalChanges, before);
    db.close();
});

test('转子 Query：模板变体必须真实存在且属于当前模板', () => {
    const db = createFixture();
    const draft = buildTemplateRotorDraft(db, 1, 10);
    assert.equal(draft.templateId, 1);
    assert.equal(draft.variantId, 10);
    assert.equal(draft.patch.bearing_span, '165');

    assert.throws(
        () => buildTemplateRotorDraft(db, 1, 11),
        error => error.code === 'variant_template_mismatch'
            && error.statusCode === 400
    );
    assert.throws(
        () => buildRecipeRotorDraft(db, 999),
        error => error.code === 'recipe_not_found'
            && error.statusCode === 404
    );
    db.close();
});
