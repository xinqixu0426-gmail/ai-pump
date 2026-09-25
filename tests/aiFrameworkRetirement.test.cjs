const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');

test('（NATIVE-HC1 改写）退役的 shadow 开关不能唤起任何 Legacy runtime', async () => {
    const legacy = { read: 0, command: 0 };
    const emitted = [];
    const result = await runAiDispatcherV3({ messages: [{ role: 'user', content: 'fixture' }], emit: (type, payload) => emitted.push({ type, payload }) }, {
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        runAiAssistant: async () => { legacy.read += 1; return {}; },
        runAiAgentRuntimeV3: async () => { legacy.command += 1; return {}; },
        collectV5ShadowFacts: () => { throw Error('retired collector invoked'); },
        scheduleV5ShadowMirror: () => { throw Error('retired mirror invoked'); },
    });
    assert.equal(legacy.read, 0);
    assert.equal(legacy.command, 0);
    assert.equal(emitted.some(event => event.type === 'status' && event.payload.stage === 'ai_unavailable'), true);
    assert.equal(result.telemetry.outcome, 'ai_unavailable');
});

test('（NATIVE-HC1 改写）Native 失败直接抛出，不换引擎、不伪造成功', async () => {
    const error = new Error('fixture provider failure');
    let nativeCalls = 0;
    let legacyCalls = 0;
    await assert.rejects(runAiDispatcherV3({}, {
        nativeTaskDelegation: true,
        runAiTaskControllerV2: async () => { nativeCalls++; throw error; },
        runAiAssistant: async () => { legacyCalls++; return {}; },
        runAiAgentRuntimeV3: async () => { legacyCalls++; return {}; },
    }), e => e === error);
    assert.equal(nativeCalls, 1);
    assert.equal(legacyCalls, 0, '不得换用任何 Legacy 引擎');
});

test('retired private tools are absent while standard comparison remains registered', async () => {
    for (const name of ['read_collection', 'read_relation']) {
        assert.equal(getAiCapability(name), null);
        const result = await require('../api/routes/ai/executor.cjs').executeToolCall(name, {}, { allowWrite: false });
        assert.equal(result.success, false);
    }
    assert.ok(getAiCapability('compare_recipes'));
});

test('preserved customer query supports literal keyword, bounded keyset pages and zero writes', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
        require('../api/database/migrations.cjs').runMigrations(db);
        for (let n = 1; n <= 45; n++) db.prepare('INSERT INTO customers(name) VALUES(?)').run(`邱-${n}`);
        db.prepare('INSERT INTO customers(name) VALUES(?)').run('literal%_customer');
        const read = require('../api/services/collectionReadService.cjs').createCollectionReadService({ db }).read;
        const before = db.prepare('SELECT total_changes() AS n').get().n;
        let afterId; const ids = [];
        for (let page = 0; page < 3; page++) {
            const result = read({ resourceType: 'customers', operation: 'list', customerKeyword: '邱', ...(afterId ? { afterId } : {}) });
            assert.equal(result.totalCount, 45);
            assert.equal(result.filters.customerKeyword, '邱');
            assert.equal(result.items.length, page === 2 ? 5 : 20);
            ids.push(...result.items.map(item => item.canonicalId));
            afterId = result.pageBoundary.nextAfterId;
        }
        assert.equal(new Set(ids).size, 45);
        assert.equal(read({ resourceType: 'customers', operation: 'list', customerKeyword: '%_' }).totalCount, 1);
        assert.equal(read({ resourceType: 'customers', operation: 'list', customerKeyword: '不存在' }).totalCount, 0);
        assert.throws(() => read({ resourceType: 'customers', operation: 'list', pageSize: 51 }));
        assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
    } finally { db.close(); }
});
