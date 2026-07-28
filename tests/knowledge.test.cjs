const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildKnowledgeEntries,
    syncFactoryRuleKnowledgeEntry,
    syncKnowledgeEntries,
    searchKnowledgeEntries,
    getKnowledgeEntryDetail,
    inspectKnowledgeOverview,
} = require('../api/services/knowledge.cjs');

function createMemoryAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_updated_at TEXT,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            content TEXT DEFAULT '',
            tags_json TEXT DEFAULT '[]',
            metadata_json TEXT DEFAULT '{}',
            search_text TEXT DEFAULT '',
            content_hash TEXT DEFAULT '',
            synced_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(source_table, source_id)
        );
        CREATE TABLE factory_rule_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_ref TEXT NOT NULL,
            finding_key TEXT NOT NULL,
            finding_type TEXT NOT NULL,
            evidence_count INTEGER NOT NULL DEFAULT 0,
            evidence_json TEXT DEFAULT '[]',
            support_count INTEGER NOT NULL DEFAULT 0,
            special_case_count INTEGER NOT NULL DEFAULT 0,
            ignored_count INTEGER NOT NULL DEFAULT 0,
            confidence_score REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'candidate',
            review_note TEXT DEFAULT '',
            approved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
    `);
    const accessors = {
        db,
        dbGetAllParts: () => [],
        dbGetAllTemplates: () => [],
        dbGetAllRecipes: () => [],
        dbGetAllCoils: () => [],
        dbGetAllCustomers: () => [],
        dbGetAllQuotations: () => [],
        dbGetAllOrders: () => [],
        dbGetAllModelVariants: () => [],
        dbGetAllRecipeTechnicalFiles: () => [],
        safeInsert(table, values) {
            assert.equal(table, 'knowledge_entries');
            const cols = Object.keys(values);
            const placeholders = cols.map(() => '?').join(', ');
            return db.prepare(`INSERT INTO knowledge_entries (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map(col => values[col]));
        },
        safeUpdate(table, id, values) {
            assert.equal(table, 'knowledge_entries');
            const entries = Object.entries(values).filter(([, value]) => value !== undefined);
            const sets = entries.map(([column]) => `${column} = ?`).join(', ');
            return db.prepare(`UPDATE knowledge_entries SET ${sets}, updated_at = ? WHERE id = ?`)
                .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
        },
        hardDelete(table, id) {
            assert.equal(table, 'knowledge_entries');
            return db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
        },
        knowledgeEntryRow(row) {
            return {
                id: row.id,
                entryType: row.entry_type,
                sourceTable: row.source_table,
                sourceId: row.source_id,
                sourceUpdatedAt: row.source_updated_at,
                title: row.title,
                summary: row.summary || '',
                content: row.content || '',
                tagsJson: row.tags_json || '[]',
                metadataJson: row.metadata_json || '{}',
                searchText: row.search_text || '',
                contentHash: row.content_hash || '',
                syncedAt: row.synced_at,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
    };
    return accessors;
}

function enableFts(accessors) {
    accessors.db.exec(`
        CREATE VIRTUAL TABLE knowledge_entries_fts USING fts5(
            entry_id UNINDEXED,
            title,
            summary,
            content,
            tags
        );
    `);
}

test('Knowledge service：单条已批准规则自动更新并在失效后移除', () => {
    const accessors = createMemoryAccessors();
    enableFts(accessors);
    accessors.db.prepare(`
        INSERT INTO factory_rule_candidates(
            rule_key, title, content, scope_type, scope_ref, finding_key,
            finding_type, evidence_count, support_count, confidence_score,
            status, review_note, approved_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'template:7:peer_pattern:包装:fixed',
        'V750：通常包含说明书',
        '同模板配方通常包含说明书',
        'pump_shell_template',
        '7',
        'peer_pattern:包装:fixed',
        'peer_pattern',
        2,
        2,
        1,
        'approved',
        '确认',
        '2026-01-02',
        '2026-01-01',
        '2026-01-02'
    );
    accessors.safeInsert('knowledge_entries', {
        entry_type: 'part',
        source_table: 'parts',
        source_id: 'keep',
        title: '保留知识',
        summary: '',
        content: '',
        tags_json: '[]',
        metadata_json: '{}',
        search_text: '保留知识',
        content_hash: 'keep',
        synced_at: '2026-01-01',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
    });

    const inserted = syncFactoryRuleKnowledgeEntry(1, { dbAccessors: accessors });
    assert.equal(inserted.action, 'inserted');
    assert.match(inserted.knowledgeEntry.title, /V750/);
    const knowledgeId = inserted.knowledgeEntry.id;

    accessors.db.prepare(`
        UPDATE factory_rule_candidates
        SET content = '同模板配方必须复核说明书', support_count = 3, updated_at = '2026-01-03'
        WHERE id = 1
    `).run();
    const updated = syncFactoryRuleKnowledgeEntry(1, { dbAccessors: accessors });
    assert.equal(updated.action, 'updated');
    assert.equal(updated.knowledgeEntry.id, knowledgeId);
    assert.match(
        accessors.db.prepare('SELECT content FROM knowledge_entries WHERE id = ?').get(knowledgeId).content,
        /必须复核说明书/
    );

    accessors.db.prepare("UPDATE factory_rule_candidates SET status = 'stale' WHERE id = 1").run();
    const deleted = syncFactoryRuleKnowledgeEntry(1, { dbAccessors: accessors });
    assert.equal(deleted.action, 'deleted');
    assert.equal(deleted.knowledgeEntry, null);
    assert.equal(
        accessors.db.prepare("SELECT COUNT(*) AS count FROM knowledge_entries WHERE source_table = 'parts'").get().count,
        1
    );
    assert.equal(accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries_fts').get().count, 1);
    accessors.db.close();
});

test('Knowledge service：从核心业务数据构建工厂知识条目', () => {
    const entries = buildKnowledgeEntries({
        dbAccessors: createMemoryAccessors(),
        parts: [{ id: 1, model: '6202轴承', category: '轴承', price: 1.5, supplier: 'S1', stock: 20, notes: '上轴承', updatedAt: '2026-01-01' }],
        templates: [{ id: 2, shellModel: 'V750', partsJson: '[]', shellComponentsJson: '[]', costMode: 'bundle', bundleCost: 90, assemblyWage: 3, packingWage: 1, surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 2 }],
        recipes: [{ id: 3, name: 'V750 12-140', spec: '1寸', partsJson: JSON.stringify([{ model: '6202轴承', qty: 2 }]), packingPartsJson: '[]', savedTotalCost: 120, coilSpec: '12', coilSheets: 140, coilMaterial: '钢带' }],
        coils: [{
            id: 4,
            spec: '12',
            sheets: 140,
            material: '钢带',
            cost: 40,
            wireWeight: 0.8,
            defaultWireGauge: '1.0',
            defaultCapacitor: '20uF',
            mainWireGauge: '0.55',
            mainWireData: '主线 820 匝',
            auxWireGauge: '0.45',
            auxWireData: '副线 960 匝',
        }],
        customers: [{ id: 5, name: '张三', defaultMargin: 0.15, contactInfo: '电话', remark: '' }],
        quotations: [{ id: 6, customerId: 5, status: '报价中', itemsJson: JSON.stringify([{ baseRecipeName: 'V750 12-140', qty: 2 }]), totalCost: 240, totalPrice: 276 }],
        orders: [{ id: 7, customerName: '张三', contractNo: 'HT-1', status: '待采购', itemsJson: JSON.stringify([{ recipeName: 'V750 12-140', qty: 2 }]), purchaseListJson: '[]', todosJson: '[]' }],
        settings: [{ key: 'management_fee', value: '5' }],
        qualitySummary: {
            generatedAt: '2026-01-02',
            issues: [{ key: 'missing_price_parts', title: '零件缺少价格', severity: 'danger', count: 1, suggestion: '补齐价格', items: [{ kind: 'part', id: 9, title: 'A', desc: '价格为0' }] }],
        },
    });

    const types = new Set(entries.map(entry => entry.entryType));
    for (const type of ['part', 'template', 'recipe', 'coil', 'customer', 'quotation', 'order', 'quality_issue', 'business_rule']) {
        assert.equal(types.has(type), true, type);
    }
    assert.ok(entries.find(entry => entry.title.includes('V750 12-140')).searchText.includes('6202轴承'));
    const coilEntry = entries.find(entry => entry.entryType === 'coil');
    assert.match(coilEntry.content, /默认搭配电缆线径：1\.0/);
    assert.match(coilEntry.content, /主线漆包线线径：0\.55/);
    assert.match(coilEntry.content, /副线数据：副线 960 匝/);
    const customerKnowledgeEntry = entries.find(entry => entry.entryType === 'customer');
    assert.match(customerKnowledgeEntry.summary, /默认利润率 15%/);
    assert.match(customerKnowledgeEntry.content, /默认利润率：15%/);
    assert.equal(customerKnowledgeEntry.metadata.defaultMargin, 0.15);
    assert.equal(customerKnowledgeEntry.metadata.defaultMarginPercent, 15);
    const quotationKnowledgeEntry = entries.find(entry => entry.entryType === 'quotation');
    assert.match(quotationKnowledgeEntry.title, /^报价：张三/);
    assert.doesNotMatch(quotationKnowledgeEntry.title, /#6/);
    const cableRule = entries.find(entry => entry.sourceTable === 'business_rules' && entry.sourceId === 'dynamic_accessories');
    assert.match(cableRule.summary, /成品电缆业务项/);
    assert.match(cableRule.content, /不把线材和插头\/规格拆成两个配件/);
});

test('Knowledge service：只把已批准候选规则同步成正式业务规则', () => {
    const entries = buildKnowledgeEntries({
        dbAccessors: createMemoryAccessors(),
        parts: [],
        templates: [],
        recipes: [],
        technicalFiles: [],
        coils: [],
        customers: [],
        quotations: [],
        orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-01', issues: [] },
        ruleCandidates: [
            {
                id: 21,
                title: 'V750：通常包含说明书',
                content: 'V750 同类配方应重点复核说明书。',
                status: 'approved',
                scopeRef: '7',
                findingKey: 'peer_pattern:包装:fixed',
                evidenceCount: 3,
                reviewNote: '已审核',
                approvedAt: '2026-01-02',
            },
            {
                id: 22,
                title: '待审核规则',
                content: '不应进入知识库',
                status: 'candidate',
            },
        ],
    });
    const learnedRules = entries.filter(entry => entry.sourceTable === 'factory_rule_candidates');
    assert.equal(learnedRules.length, 1);
    assert.equal(learnedRules[0].sourceId, '21');
    assert.match(learnedRules[0].content, /证据配方数：3/);
});

test('Knowledge service：同一规格片数按材质和槽眼保留全部线圈方案', () => {
    const accessors = createMemoryAccessors();
    enableFts(accessors);
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [],
        templates: [],
        recipes: [],
        coils: [
            {
                id: 6,
                spec: '12',
                commonName: '12',
                diameterMm: 120,
                sheets: 220,
                material: '钢带',
                slotType: '小眼',
                schemeStatus: 'official',
                cost: 149,
                wireWeight: 0.824,
                defaultWireGauge: '1.2',
                mainWireGauge: '0.55',
            },
            {
                id: 9,
                spec: '12',
                commonName: '12',
                diameterMm: 120,
                sheets: 220,
                material: '冷轧',
                slotType: '国标眼',
                schemeStatus: 'official',
                cost: 189,
                wireWeight: 1.202,
                defaultWireGauge: '2',
                mainWireGauge: '0.62',
            },
        ],
        customers: [],
        quotations: [],
        orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });

    const rows = searchKnowledgeEntries({ query: '12-220', entryType: 'coil', limit: 10 }, { dbAccessors: accessors });
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map(row => `${row.metadata.material}/${row.metadata.slotType}`)), new Set([
        '钢带/小眼',
        '冷轧/国标眼',
    ]));
    const coldRolled = getKnowledgeEntryDetail(rows.find(row => row.metadata.material === '冷轧').id, { dbAccessors: accessors });
    assert.match(coldRolled.content, /默认搭配电缆线径：2/);
    assert.match(coldRolled.content, /主线漆包线线径：0\.62/);
    assert.doesNotMatch(coldRolled.content, /默认线径：/);
});

test('Knowledge service：配方测试报告进入可检索内容', () => {
    const entries = buildKnowledgeEntries({
        dbAccessors: createMemoryAccessors(),
        parts: [],
        templates: [],
        recipes: [{ id: 3, name: 'QDX1.5-38', partsJson: '[]', packingPartsJson: '[]', updatedAt: '2026-01-01' }],
        technicalFiles: [{
            id: 8,
            recipeId: 3,
            originalName: 'QDX1.5-38-12-180.xls',
            reportType: 'pump_performance_test',
            extractedText: '规定点：流量 15m3/h，扬程 10m，效率 15%\n实测点：流量 11.6m3/h，扬程 7.8m，效率 14.6%\n偏差：流量 -22.4%，扬程 -22.4%，效率 -2.4%\n测试点2：流量 1.07m3/h，扬程 34.33m，机组效率 8.42%\n测试点11：电压 -V，电流 -A，功率因数 55K，输入功率 -kW，转速 -r/min，流量 -m3/h，扬程 -m，机组效率 -%',
            updatedAt: '2026-02-01',
        }],
        coils: [],
        customers: [],
        quotations: [],
        orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-02-01', issues: [] },
    });

    const recipe = entries.find(entry => entry.entryType === 'recipe');
    assert.match(recipe.content, /测试点2：流量 1\.07m3\/h/);
    assert.doesNotMatch(recipe.content, /测试点11/);
    assert.doesNotMatch(recipe.content, /规定点：|实测点：|偏差：/);
    assert.match(recipe.content, /性能测试报告附件（不是图纸）/);
    assert.ok(recipe.tags.includes('性能测试报告'));
    assert.equal(recipe.metadata.technicalFileCount, 1);
    assert.deepEqual(recipe.metadata.testReports, [{
        id: 8,
        kind: 'pump_performance_test',
        label: '性能测试报告',
        fileName: 'QDX1.5-38-12-180.xls',
    }]);
    assert.equal(recipe.sourceUpdatedAt, '2026-02-01');
});

test('Knowledge V5：独立工厂资料生成可追溯知识且限制未解析 PDF', () => {
    const entries = buildKnowledgeEntries({
        dbAccessors: createMemoryAccessors(),
        parts: [],
        templates: [],
        recipes: [],
        technicalFiles: [],
        coils: [],
        customers: [],
        quotations: [],
        orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-02-01', issues: [] },
        documents: [{
            id: 12,
            documentType: 'drawing',
            title: 'V750 泵壳总装图',
            description: '供应商确认版，用于核对外形',
            contentText: '',
            tagsJson: '["V750","泵壳"]',
            originalName: 'V750-shell.pdf',
            fileSize: 1024,
            parserStatus: 'metadata_only',
            extractedText: '',
            metadataJson: '{"extractionNote":"仅元数据"}',
            updatedAt: '2026-02-03',
        }],
    });

    const document = entries.find(entry => entry.entryType === 'document');
    assert.equal(document.sourceTable, 'knowledge_documents');
    assert.equal(document.sourceId, '12');
    assert.match(document.title, /图纸：V750 泵壳总装图/);
    assert.match(document.content, /不得据此推断图纸尺寸、材料或技术参数/);
    assert.equal(document.metadata.parserStatus, 'metadata_only');
    assert.equal(document.metadata.downloadPath, '/api/knowledge/documents/12/download');
    assert.ok(document.tags.includes('V750'));
});

test('Knowledge service：同步后可搜索并读取详情', () => {
    const accessors = createMemoryAccessors();
    enableFts(accessors);
    const result = syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [{ id: 1, model: '6202轴承', category: '轴承', price: 1.5, supplier: 'S1', stock: 20, updatedAt: '2026-01-01' }],
        templates: [],
        recipes: [],
        coils: [],
        customers: [],
        quotations: [],
        orders: [],
        settings: [{ key: 'management_fee', value: '5' }],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });

    assert.equal(result.stats.byType.part, 1);
    assert.equal(result.stats.byType.business_rule, 4);
    assert.equal(result.stats.inserted, 5);
    assert.equal(result.stats.updated, 0);
    assert.equal(result.stats.deleted, 0);

    const rows = searchKnowledgeEntries({ query: '6202', limit: 5 }, { dbAccessors: accessors });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entryType, 'part');
    assert.equal(rows[0].metadata.supplier, 'S1');

    const detail = getKnowledgeEntryDetail(rows[0].id, { dbAccessors: accessors });
    assert.equal(detail.title, '零件：6202轴承');
    assert.match(detail.content, /库存：20/);
    assert.deepEqual(detail.tags.slice(0, 2), ['零件', '轴承']);
    assert.equal(result.ftsEnabled, true);
    assert.equal(accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries_fts').get().count, result.stats.total);
});

test('Knowledge service：只读概况准确识别待新增、更新和移除条目', () => {
    const accessors = createMemoryAccessors();
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [
            { id: 1, model: '待更新型号', category: '测试', price: 1, stock: 1 },
            { id: 2, model: '待移除型号', category: '测试', price: 1, stock: 1 },
        ],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });
    const beforeCount = accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count;
    const overview = inspectKnowledgeOverview({
        dbAccessors: accessors,
        parts: [
            { id: 1, model: '待更新型号', category: '测试', price: 3, stock: 1 },
            { id: 3, model: '待新增型号', category: '测试', price: 1, stock: 1 },
        ],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-03', issues: [] },
    });

    assert.equal(overview.stats.pendingInsert, 1);
    assert.equal(overview.stats.pendingUpdate, 1);
    assert.equal(overview.stats.pendingDelete, 1);
    assert.equal(overview.stats.pendingTotal, 3);
    assert.equal(overview.stats.storedTotal, beforeCount);
    assert.ok(overview.lastSyncedAt);
    assert.deepEqual(new Set(overview.changes.map(item => item.status)), new Set([
        'pending_insert',
        'pending_update',
        'pending_delete',
    ]));
    assert.equal(
        accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count,
        beforeCount,
        '概况检查不得写入知识表'
    );
});

test('Knowledge service：内容未变化时概况保持最新，不受生成时间影响', () => {
    const accessors = createMemoryAccessors();
    const common = {
        dbAccessors: accessors,
        parts: [{ id: 1, model: '稳定型号', category: '测试', price: 1, stock: 1 }],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
    };
    syncKnowledgeEntries({
        ...common,
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });
    const overview = inspectKnowledgeOverview({
        ...common,
        qualitySummary: { generatedAt: '2026-02-02', issues: [] },
    });

    assert.equal(overview.stats.pendingTotal, 0);
    assert.equal(overview.stats.fresh, overview.stats.currentTotal);
    assert.equal(overview.changes.length, 0);
});

test('Knowledge service：异常 limit 使用默认值，LIKE 搜索按字面处理通配符', () => {
    const accessors = createMemoryAccessors();
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [
            { id: 1, model: 'A_100%', category: '测试', price: 1, stock: 1 },
            { id: 2, model: 'A2100X', category: '测试', price: 1, stock: 1 },
        ],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });

    const rows = searchKnowledgeEntries({ query: 'A_100%', limit: 'not-a-number' }, { dbAccessors: accessors });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '零件：A_100%');
});

test('Knowledge service：增量同步保留条目 ID 并移除过期来源', () => {
    const accessors = createMemoryAccessors();
    enableFts(accessors);
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [
            { id: 1, model: '保留型号', category: '测试', price: 1, stock: 1 },
            { id: 2, model: '待删除型号', category: '测试', price: 1, stock: 1 },
        ],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });
    const original = searchKnowledgeEntries({ query: '保留型号' }, { dbAccessors: accessors })[0];

    const result = syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [
            { id: 1, model: '保留型号', category: '测试', price: 2, stock: 1 },
            { id: 3, model: '新增型号', category: '测试', price: 1, stock: 1 },
        ],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });

    const updated = searchKnowledgeEntries({ query: '保留型号' }, { dbAccessors: accessors })[0];
    assert.equal(updated.id, original.id);
    assert.equal(updated.metadata.price, 2);
    assert.equal(searchKnowledgeEntries({ query: '待删除型号' }, { dbAccessors: accessors }).length, 0);
    assert.equal(result.stats.inserted, 1);
    assert.equal(result.stats.updated, 1);
    assert.equal(result.stats.deleted, 1);
    assert.equal(result.stats.unchanged, 4);
    assert.equal(accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries_fts').get().count, result.stats.total);
});

test('Knowledge service：同步写入失败时保留上一版完整知识', () => {
    const accessors = createMemoryAccessors();
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [{ id: 1, model: '旧数据', category: '测试', price: 1, stock: 1 }],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });
    const originalInsert = accessors.safeInsert;
    accessors.safeInsert = (table, values) => {
        if (values.title === '零件：触发失败') throw new Error('模拟写入失败');
        return originalInsert(table, values);
    };

    assert.throws(() => syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [{ id: 2, model: '触发失败', category: '测试', price: 1, stock: 1 }],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    }), /模拟写入失败/);

    const rows = searchKnowledgeEntries({ query: '旧数据' }, { dbAccessors: accessors });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '零件：旧数据');
});

test('Knowledge service：FTS 刷新失败时业务条目同步一并回滚', () => {
    const accessors = createMemoryAccessors();
    syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [{ id: 1, model: '事务前数据', category: '测试', price: 1, stock: 1 }],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    });
    accessors.db.exec('CREATE VIRTUAL TABLE knowledge_entries_fts USING fts5(entry_id UNINDEXED, title)');

    assert.throws(() => syncKnowledgeEntries({
        dbAccessors: accessors,
        parts: [{ id: 1, model: '事务后数据', category: '测试', price: 2, stock: 1 }],
        templates: [], recipes: [], coils: [], customers: [], quotations: [], orders: [],
        settings: [],
        qualitySummary: { generatedAt: '2026-01-02', issues: [] },
    }), /summary|content|tags/);

    const row = accessors.db.prepare("SELECT title FROM knowledge_entries WHERE source_table = 'parts' AND source_id = '1'").get();
    assert.equal(row.title, '零件：事务前数据');
});
