const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { auditCatalogReferences, resolveReference } = require('../api/services/catalogReferenceAudit.cjs');
const { buildNamingCandidates, extractPartCandidate } = require('../api/services/catalogNamingCandidates.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.prepare('INSERT INTO parts (id, model, supplier, stock, price) VALUES (?, ?, ?, ?, ?)').run(1, '6202', '甲', 7, 3);
    db.prepare('INSERT INTO parts (id, model, supplier, stock, price) VALUES (?, ?, ?, ?, ?)').run(2, '6202', '乙', 8, 4);
    return db;
}

test('盘点在 query_only 下读取嵌套快照、白名单和文件引用，重复运行不改变业务事实', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (id, name, parts_json, configuration_policy_json) VALUES (?, ?, ?, ?)').run(
        1, 'V550', JSON.stringify([
            { model: '6202', supplier: '甲' },
            { model: '6202' },
            { partId: 2, model: '旧名称' },
            { model: '人工', inventoryType: 'none' },
            { subassemblyContents: [{ model: '套件内部非库存描述' }] },
            { 'a/b~c': { partsJson: JSON.stringify([{ partId: 1, model: '6202' }]) } },
        ]), JSON.stringify({ version: 1, packingPartIds: [1, 999], fields: { coilId: [999] } }),
    );
    db.prepare("INSERT INTO factory_files (original_name, extension, detected_type, mime_type, file_size, file_sha256, file_blob, created_at, updated_at) VALUES ('test.txt', 'txt', 'text', 'text/plain', 1, 'fixture', ?, 'now', 'now')").run(Buffer.from('a'));
    db.prepare("INSERT INTO factory_file_links (file_id, target_type, target_id, created_at, updated_at) VALUES (1, 'recipe', 1, 'now', 'now')").run();
    db.pragma('query_only = ON');
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    const report = auditCatalogReferences(db);
    assert.equal(report.complete, true);
    assert.equal(report.allReferencesResolved, false);
    assert.equal(report.coverage.migrationApproved, false);
    const at = path => report.references.find(ref => ref.sourceType === 'recipe' && ref.path === path);
    assert.equal(at('/parts_json/0/model').status, 'resolved_legacy');
    assert.deepEqual(at('/parts_json/1/model').candidateIds, [1, 2]);
    assert.equal(at('/parts_json/2/model').status, 'identity_mismatch');
    assert.equal(at('/parts_json/3/model').status, 'non_inventory');
    assert.equal(at('/parts_json/4/subassemblyContents').status, 'non_inventory');
    assert.equal(at('/parts_json/5/a~1b~0c/partsJson/0/model').status, 'resolved_id');
    assert.equal(at('/configuration_policy_json/packingPartIds/1').status, 'missing');
    assert.equal(at('/configuration_policy_json/fields/coilId/0').status, 'missing');
    assert.equal(report.references.find(ref => ref.sourceType === 'fileLink').status, 'resolved_id');
    assert.deepEqual(auditCatalogReferences(db), report);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
    assert.equal(db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 7);
});

test('目录截断不得把前 N 条中的唯一匹配当作完整解析；引用预算也必须失败关闭', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('V550', '[{"model":"6202"},{"partId":1}]');
    const report = auditCatalogReferences(db, { maxRowsPerTable: 1 });
    assert.equal(report.complete, false);
    assert.equal(report.allReferencesResolved, false);
    assert.ok(report.references.every(ref => ref.status === 'catalog_incomplete'));
    const limited = auditCatalogReferences(db, { maxReferences: 1 });
    assert.equal(limited.complete, false);
    assert.ok(limited.errors.some(error => error.code === 'REFERENCE_LIMIT'));
});

test('非法 JSON、缺表与非法参数不得返回完整结果', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (parts_json) VALUES (?)').run('{broken');
    assert.ok(auditCatalogReferences(db).errors.some(error => error.code === 'INVALID_SOURCE_JSON'));
    db.exec('DROP TABLE factory_file_links');
    assert.ok(auditCatalogReferences(db).errors.some(error => error.code === 'SOURCE_TABLE_MISSING'));
    for (const options of [{ maxRowsPerTable: 0 }, { maxReferences: '2' }, { sql: 'DROP TABLE parts' }, null]) {
        assert.throws(() => auditCatalogReferences(db, options));
    }
});

test('合法 JSON 的错误形状与过深嵌套也不能冒充已完整扫描', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (parts_json) VALUES (?)').run('42');
    let nested = { partId: 1 };
    for (let i = 0; i < 45; i += 1) nested = { child: nested };
    db.prepare('INSERT INTO recipes (parts_json) VALUES (?)').run(JSON.stringify(nested));
    const report = auditCatalogReferences(db);
    assert.equal(report.complete, false);
    assert.ok(report.errors.some(error => error.code === 'INVALID_SOURCE_JSON_SHAPE'));
    assert.ok(report.errors.some(error => error.code === 'JSON_DEPTH_LIMIT'));
});

test('明确 ID 不回退到同名对象，停用及非法 ID 保留异常状态', () => {
    const catalogs = new Map([['part', [{ id: 1, model: '6202', deleted_at: 'now' }, { id: 2, model: '6202' }]]]);
    assert.equal(resolveReference(catalogs, { targetType: 'part', targetId: 1, model: '6202' }).status, 'inactive');
    assert.equal(resolveReference(catalogs, { targetType: 'part', targetId: 999, model: '6202' }).status, 'missing');
    for (const targetId of [true, [], {}, -1, 1.5, '1e0']) {
        assert.equal(resolveReference(catalogs, { targetType: 'part', targetId }).status, 'invalid_id');
    }
});

test('候选名只使用已明确的旧规格，不补轴承代号、油封类型或未确认的浮球单位', () => {
    assert.equal(extractPartCandidate({ category: '轴承', model: '202' }).suggestedName, '轴承-202');
    assert.equal(extractPartCandidate({ category: '电容', model: '18μF' }).suggestedName, '电容-18μF');
    assert.equal(extractPartCandidate({ category: '螺丝', model: '6*25-内六-201-组合' }).suggestedName, '内六角螺丝-6*25-201-组合');
    for (const part of [
        { category: '油封', model: '14*28' },
        { category: '油封', model: '14*28*38' },
        { category: '浮球', model: '浮球-线径0.55' },
        { category: '电缆线', model: '电缆-线径0' },
        { category: '电缆线', model: '未知线径0.55' },
        { category: '泵壳', model: 'v1100-2' },
        { category: '包装', model: 'v1100DF' },
        { category: '螺丝', model: '6*25-未知材质' },
    ]) {
        const result = extractPartCandidate(part);
        assert.equal(result.suggestedName, null);
        assert.ok(result.missingFields.length > 0);
    }
});

test('候选名保留不同供应商身份，报告同供应商冲突并禁止自动迁移', () => {
    const catalogs = new Map([['part', [
        { id: 1, category: '轴承', model: '202', supplier: '甲' },
        { id: 2, category: '轴承', model: '202', supplier: '甲' },
        { id: 3, category: '轴承', model: '202', supplier: '乙' },
    ]]]);
    const rows = buildNamingCandidates(catalogs, [{ targetType: 'part', candidateIds: [1], status: 'resolved_id' }]);
    assert.deepEqual(rows[0].conflicts, [2]);
    assert.deepEqual(rows[2].conflicts, []);
    assert.equal(rows[0].referenceCount, 1);
    assert.ok(rows.every(row => row.reviewRequired && !row.migrationApproved));
});

test('库存目录变化会使基线哈希改变，未修改物料的源哈希保持一致', t => {
    const db = fixture(t);
    const first = auditCatalogReferences(db);
    db.prepare('INSERT INTO parts (model, stock) VALUES (?, ?)').run('新物料', 20);
    const second = auditCatalogReferences(db);
    assert.notEqual(first.baselineSha256, second.baselineSha256);
    assert.equal(first.sourceHashes.find(row => row.sourceType === 'part' && row.sourceId === 1).sha256,
        second.sourceHashes.find(row => row.sourceType === 'part' && row.sourceId === 1).sha256);
});

test('成本基线复用正式引擎并固定输入，只读取明确允许的业务设置', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('成本基线', '[{"partId":2,"model":"6202","supplier":"乙","qty":3}]');
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('management_fee', '5');
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('unrelated_private_setting', 'excluded-fixture-value');
    db.pragma('query_only = ON');
    const first = auditCatalogReferences(db);
    assert.equal(first.costBaseline.scenario, 'saved_bom_current_catalog_prices');
    assert.equal(first.costBaseline.inputsComplete, true);
    assert.equal(first.costBaseline.recipes[0].result.totalCost, '12.00');
    assert.equal(first.costBaseline.recipes[0].status, 'calculated');
    assert.deepEqual(first.costBaseline.inputs.settings.map(row => row.key), ['management_fee']);
    assert.equal(auditCatalogReferences(db).costBaseline.inputsSha256, first.costBaseline.inputsSha256);
    assert.equal(JSON.stringify(first).includes('excluded-fixture-value'), false);
});

test('不完整成本输入和计算失败不能报告为已计算的零成本', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (parts_json) VALUES (?)').run('[{"partId":999,"model":"6202","qty":1}]');
    const failure = auditCatalogReferences(db).costBaseline.recipes[0];
    assert.equal(failure.status, 'failed');
    assert.equal(failure.result, undefined);
    const limited = auditCatalogReferences(db, { maxRowsPerTable: 1 }).costBaseline;
    assert.equal(limited.inputsComplete, false);
    assert.equal(limited.recipes[0].status, 'incomplete_inputs');
});

test('电缆旧规格按已确认横截面积生成候选，不改原目录也不批准迁移', () => {
    const row = { category: '电缆线', model: '电缆-线径0.55' };
    const result = extractPartCandidate(row);
    assert.deepEqual(result.extractedSpec, { wireValue: 0.55, wireMeasure: '截面积', wireUnit: 'mm²' });
    assert.equal(result.suggestedName, '电缆-截面积0.55mm²');
    assert.deepEqual(result.missingFields, []);
    assert.equal(row.model, '电缆-线径0.55');
});
