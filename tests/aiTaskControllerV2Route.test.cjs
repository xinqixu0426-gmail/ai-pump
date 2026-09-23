'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'n3-controller-route-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startAiHttpRuntime } = require('./helpers/ontologyHttpRuntimeFixture.cjs');

test('N3.2 isolated /api/ai/chat injection emits only validated Task V2 content after formal reads', async t => {
    // The fixture configures a temporary SQLite file before loading the chat
    // route, so this route-level proof cannot touch the project database.
    const runtime = await startAiHttpRuntime({ aiChatOptions: { nativeTaskDelegation: true } });
    t.after(async () => runtime.close());
    runtime.db.prepare(`UPDATE recipes
        SET name = 'V550', coil_spec = '12', coil_sheets = 120, coil_material = '冷轧', coil_slot_type = '小眼'
        WHERE id = 301`).run();
    runtime.db.prepare(`UPDATE coils
        SET scheme_status = 'official', pricing_mode = 'kit', kit_price = 20, cost = 20
        WHERE id = 501`).run();
    runtime.db.prepare('UPDATE parts SET price = 10 WHERE id = 601').run();
    const response = await fetch(`${runtime.baseUrl}/api/ai/chat`, {
        method: 'POST', headers: runtime.headers(), body: JSON.stringify({ conversationId: 'n3-route-isolated', messages: [{ role: 'user', content: 'V550当前成本' }] }),
    });
    assert.equal(response.status, 200);
    const events = [...(await response.text()).matchAll(/^data: (.+)$/gmu)].map(match => JSON.parse(match[1]));
    const types = events.map(event => event.type);
    assert.ok(types.includes('status'));
    assert.ok(types.includes('content'));
    assert.ok(types.includes('detail'));
    assert.ok(types.includes('done'));
    assert.equal(types.indexOf('content') < types.indexOf('detail'), true);
    const content = events.find(event => event.type === 'content').content;
    assert.match(content, /当前完整成本为/);
    assert.match(content, /没有修改正式配方/);
    const detail = events.find(event => event.type === 'detail');
    assert.equal(detail.state, 'SUCCEEDED');
    assert.equal(JSON.stringify(events).includes('ownerKey'), false);
    assert.equal(JSON.stringify(events).includes('receiptId'), false);
    assert.equal(JSON.stringify(events).includes('arguments'), false);
});
