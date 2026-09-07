const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { changePersonalMemory, listPersonalMemories, parseMemoryCommand } = require('../api/services/aiPersonalMemory.cjs');

function fixture() {
    const db = new Database(':memory:'); runMigrations(db);
    function audit(table, id) { return Number(db.prepare('INSERT INTO audit_log(action, table_name, record_id) VALUES (?, ?, ?)').run('TEST', table, id).lastInsertRowid); }
    return {
        db,
        safeInsert(table, values) {
            assert.ok(['ai_personal_memories', 'ai_personal_memory_revisions'].includes(table));
            const keys = Object.keys(values);
            const result = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => values[k]));
            return { ...result, auditId: audit(table, Number(result.lastInsertRowid)) };
        },
        safeUpdate(table, id, values) {
            assert.equal(table, 'ai_personal_memories');
            const result = db.prepare('UPDATE ai_personal_memories SET content = ?, deleted = ?, version = ? WHERE id = ?').run(values.content, values.deleted, values.version, id);
            return { ...result, auditId: audit(table, id) };
        },
    };
}
const context = key => ({ actorKey: 'test-user', idempotencyKey: `memory-test:${key}` });

test('memory save/update/delete/undo persist versions and share atomic audit receipts', () => {
    const deps = fixture();
    try {
        const save = changePersonalMemory(deps, { action: 'save', content: '12-200 先查线圈' }, context('save'));
        assert.equal(save.memory.version, 1); assert.equal(save.auditIds.length, 2);
        const update = changePersonalMemory(deps, { action: 'update', id: save.memory.id, expectedVersion: 1, content: '规格简称先查线圈' }, context('update'));
        assert.equal(update.memory.version, 2);
        const undo = changePersonalMemory(deps, { action: 'undo', id: save.memory.id, expectedVersion: 2 }, context('undo'));
        assert.equal(undo.memory.content, '12-200 先查线圈'); assert.equal(undo.memory.version, 3);
        changePersonalMemory(deps, { action: 'delete', id: save.memory.id, expectedVersion: 3 }, context('delete'));
        assert.equal(listPersonalMemories(deps).items.length, 0);
        const restored = changePersonalMemory(deps, { action: 'undo', id: save.memory.id, expectedVersion: 4 }, context('restore'));
        assert.equal(restored.memory.deleted, false);
    } finally { deps.db.close(); }
});
test('request replay, content duplicate and stale version cannot write twice or overwrite', () => {
    const deps = fixture();
    try {
        const input = { action: 'save', content: '偏好A' };
        const saved = changePersonalMemory(deps, input, context('same'));
        const writes = deps.db.prepare('SELECT total_changes() AS n').get().n;
        assert.equal(changePersonalMemory(deps, input, context('same')).idempotentReplay, true);
        assert.equal(deps.db.prepare('SELECT total_changes() AS n').get().n, writes);
        assert.throws(() => changePersonalMemory(deps, { ...input, content: 'B' }, context('same')), /不同请求/);
        assert.equal(changePersonalMemory(deps, input, context('other')).unchanged, true);
        assert.throws(() => changePersonalMemory(deps, { action: 'update', id: saved.memory.id, expectedVersion: 9, content: 'C' }, context('stale')), /发生变化/);
        assert.equal(listPersonalMemories(deps).items[0].content, '偏好A');
    } finally { deps.db.close(); }
});
test('audit failure rolls back memory, revisions and operation; list is read-only and bounded', () => {
    const deps = fixture();
    try {
        assert.throws(() => changePersonalMemory({ ...deps, safeInsert: (...args) => ({ ...deps.safeInsert(...args), auditId: null }) }, { action: 'save', content: 'A' }, context('rollback')), /审计/);
        assert.equal(deps.db.prepare('SELECT count(*) n FROM ai_personal_memories').get().n, 0);
        assert.equal(deps.db.prepare('SELECT count(*) n FROM api_operations').get().n, 0);
        const before = deps.db.prepare('SELECT total_changes() n').get().n;
        assert.equal(listPersonalMemories(deps).items.length, 0);
        assert.equal(deps.db.prepare('SELECT total_changes() n').get().n, before);
        assert.throws(() => listPersonalMemories(deps, { limit: 101 }), /分页/);
        assert.throws(() => changePersonalMemory(deps, { action: 'save', content: 'A', sql: 'DELETE' }, context('invalid')), /未知字段/);
    } finally { deps.db.close(); }
});
test('only explicit current chat commands save; quoted, negative and ordinary corrections do not', () => {
    for (const text of ['不要记入长期记忆：A', '他说“记入长期记忆：A”', '不是配方，是线圈', '如何记入长期记忆？']) assert.equal(parseMemoryCommand(text), null);
    assert.deepEqual(parseMemoryCommand('记入长期记忆：A'), { action: 'save', content: 'A' });
    assert.ok(parseMemoryCommand('记入长期记忆').clarification);
    assert.deepEqual(parseMemoryCommand('把刚才那条改成：B', { memory: { id: 1, version: 2 } }), { action: 'update', id: 1, expectedVersion: 2, content: 'B' });
    assert.ok(parseMemoryCommand('忘掉刚才那条记忆').clarification);
});

test('suffix memory requests preserve the rule while quotes, negations and questions do not save', () => {
    const rule = '当我询问你，列出泵壳的零件的时候，你需要去零件库中寻找泵壳类型的零件列出来给我，而不是在模板中';
    for (const suffix of ['。这点记入长期记忆', '，请把这一点记入长期记忆。', '；帮我记到长期记忆', '\n请帮我保存到长期记忆！']) {
        assert.deepEqual(parseMemoryCommand(rule + suffix), { action: 'save', content: rule });
    }
    for (const text of ['规则A，不要记入长期记忆', '他说：规则A，这点记入长期记忆', '“规则A。这点记入长期记忆”', '如果合适，记入长期记忆', '规则A，能否记入长期记忆？']) assert.equal(parseMemoryCommand(text), null);
});


test('conditional preference plus explicit trailing save is persisted without saving hypothetical or negated commands', () => {
    const rule = '如果没有特别提示，直接用默认的线圈';
    for (const suffix of ['，记到长期记忆里。', '。请保存到长期记忆中', '；记入长期记忆']) {
        assert.deepEqual(parseMemoryCommand(rule + suffix), { action: 'save', content: rule });
    }
    for (const text of ['如果合适，记到长期记忆里。', '假如可以，记入长期记忆', '如果没有特别提示，直接用默认的线圈，不要记到长期记忆里。', '如果没有特别提示，直接用默认的线圈，能否记到长期记忆里？', '他说：如果没有特别提示，直接用默认的线圈，记到长期记忆里。']) {
        assert.equal(parseMemoryCommand(text), null);
    }
});
