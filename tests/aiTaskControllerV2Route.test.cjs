'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'n3-controller-route-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startAiHttpRuntime } = require('./helpers/ontologyHttpRuntimeFixture.cjs');

test('N3.2 isolated /api/ai/chat injection emits only validated Task V2 content after formal reads', async t => {
    // The fixture configures a temporary SQLite file before loading the chat
    // route, so this route-level proof cannot touch the project database.
    const proposal = { proposal: { version: 1, goalSummary: 'V550成本和库存', subjects: [{ subjectKey: 'subject_1', mention: 'V550', typeHints: ['recipe'], sources: [{ sourceQuote: 'V550' }] }], scenarios: [], goals: [{ goalKey: 'goal_1', kind: 'CURRENT_COST', description: '查询当前成本', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: 'V550' }], quantity: null, unitPrice: null }], unparsedSpans: [] } };
    const providerResponse = { choices: [{ message: { tool_calls: [{ function: { name: 'submit_ai_task_proposal_candidate_v1', arguments: JSON.stringify(proposal) } }] } }] };
    const runtime = await startAiHttpRuntime({ aiChatOptions: {
        nativeTaskDelegation: true,
        taskSemanticsProvider: async request => {
            const content = request.messages?.at(-1)?.content || '';
            return new Response(content.includes('provider-invalid') ? '{' : JSON.stringify(providerResponse));
        },
    } });
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
    runtime.db.prepare(`UPDATE recipes SET name = 'V550', spec = '1.5kW' WHERE id = 301`).run();
    runtime.db.prepare(`UPDATE coils SET scheme_status = 'official' WHERE id = 501`).run();
    const chat = async content => {
        const response = await fetch(`${runtime.baseUrl}/api/ai/chat`, { method: 'POST', headers: runtime.headers(), body: JSON.stringify({ conversationId: `s2-${content}`, messages: [{ role: 'user', content }] }) });
        assert.equal(response.status, 200);
        return [...(await response.text()).matchAll(/^data: (.+)$/gmu)].map(match => JSON.parse(match[1]));
    };
    const coil = await chat('12-120');
    const coilDetail = coil.find(event => event.type === 'detail');
    assert.equal(coilDetail.goals[0].state, 'VERIFIED');
    assert.match(coil.find(event => event.type === 'content').content, /正式.*目录|线圈目录/u);
    const recipes = await chat('列一下配方');
    const recipeDetail = recipes.find(event => event.type === 'detail');
    assert.equal(recipeDetail.goals[0].state, 'VERIFIED');
    assert.match(recipes.find(event => event.type === 'content').content, /#301 V550/u);
    const modelResponse = await fetch(`${runtime.baseUrl}/api/ai/chat`, { method: 'POST', headers: runtime.headers(), body: JSON.stringify({ conversationId: 's2-model-response', messages: [{ role: 'user', content: 'V550成本和库存' }] }) });
    const modelEvents = [...(await modelResponse.text()).matchAll(/^data: (.+)$/gmu)].map(match => JSON.parse(match[1]));
    assert.equal(modelEvents.find(event => event.type === 'detail').goals[0].state, 'VERIFIED');
    assert.match(modelEvents.find(event => event.type === 'content').content, /当前完整成本/u);
    const invalidProvider = await chat('V550 provider-invalid 成本和库存');
    const invalidDetail = invalidProvider.find(event => event.type === 'detail');
    assert.equal(invalidDetail.goals[0].state, 'FAILED');
    assert.equal(invalidDetail.goals[0].facts?.length || 0, 0);
    assert.ok(invalidDetail.goals[0].blockerCodes.includes('SEMANTIC_TECHNICAL_FAILURE'));
});
