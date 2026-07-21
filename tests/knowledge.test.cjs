const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildKnowledgeEntries,
    syncKnowledgeEntries,
    searchKnowledgeEntries,
    getKnowledgeEntryDetail,
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
        safeInsert(table, values) {
            assert.equal(table, 'knowledge_entries');
            const cols = Object.keys(values);
            const placeholders = cols.map(() => '?').join(', ');
            return db.prepare(`INSERT INTO knowledge_entries (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map(col => values[col]));
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

test('Knowledge service：从核心业务数据构建工厂知识条目', () => {
    const entries = buildKnowledgeEntries({
        dbAccessors: createMemoryAccessors(),
        parts: [{ id: 1, model: '6202轴承', category: '轴承', price: 1.5, supplier: 'S1', stock: 20, notes: '上轴承', updatedAt: '2026-01-01' }],
        templates: [{ id: 2, shellModel: 'V750', partsJson: '[]', shellComponentsJson: '[]', costMode: 'bundle', bundleCost: 90, assemblyWage: 3, packingWage: 1, surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 2 }],
        recipes: [{ id: 3, name: 'V750 12-140', spec: '1寸', partsJson: JSON.stringify([{ model: '6202轴承', qty: 2 }]), packingPartsJson: '[]', savedTotalCost: 120, coilSpec: '12', coilSheets: 140, coilMaterial: '钢带' }],
        coils: [{ id: 4, spec: '12', sheets: 140, material: '钢带', cost: 40, wireWeight: 0.8, defaultWireGauge: '1.0', defaultCapacitor: '20uF' }],
        customers: [{ id: 5, name: '张三', defaultMargin: 1.15, contactInfo: '电话', remark: '' }],
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
