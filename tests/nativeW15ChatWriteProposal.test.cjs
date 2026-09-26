'use strict';
/**
 * NATIVE-W1.5 —— 聊天写提案的确定性行为矩阵（不起服务，不碰数据库）。
 *
 * 覆盖 ticket §3/§5/§6/§14/§15/§20：命令路由判定、数量/目标抽取、写开关走向、
 * 非 W1 能力拒绝、多目标拒绝、[object Object] 缺陷修复。
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    describeCommandRoute,
    detectProtectedCommandRoute,
    extractSinglePartStockAdjustmentArgs,
    parsePartStockAdjustment,
} = require('../api/services/aiProtectedCommandRoute.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');

const MODEL = 'W15-6202轴承';

function routeOf(content) {
    return detectProtectedCommandRoute([{ role: 'user', content }]);
}

function emitted() {
    const events = [];
    return { events, emit: (type, payload = {}) => events.push({ type, ...payload }) };
}

async function dispatch(content, { writeAllowed = true, prepare = null, conversationId = null } = {}) {
    const sink = emitted();
    const result = await runAiDispatcherV3({
        messages: [{ role: 'user', content }],
        conversationId,
        ownerKey: 'admin',
        confirmationSubject: 'jwt:subject',
        stream: true,
        emit: sink.emit,
    }, {
        nativeTaskDelegation: true,
        nativeWriteAllowed: writeAllowed,
        ...(prepare ? { prepareNativeWriteProposal: prepare } : {}),
        resolveNativeWriteSource: () => ({ conversationId: 1, userMessageId: 1, content }),
    });
    return { events: sink.events, result };
}

// ── §5/§6/§7：语义族与抽取 ───────────────────────────────────────────────────────
test('W15-INTENT-1 支持的能力内说法都进入 adjust_part_stock（不要求出现「零件」）', () => {
    for (const [text, expected] of [
        [`把 ${MODEL} 库存增加 100`, { model: MODEL, changeQty: 100 }],
        [`${MODEL}库存加100`, { model: MODEL, changeQty: 100 }],
        [`把${MODEL}库存减少20`, { model: MODEL, changeQty: -20 }],
        [`${MODEL}库存减20个`, { model: MODEL, changeQty: -20 }],
        [`把 ${MODEL} 的库存增加到 30`, { model: MODEL, changeQty: 30 }],
        [`${MODEL}库存入库5件`, { model: MODEL, changeQty: 5 }],
    ]) {
        const route = routeOf(text);
        assert.equal(route?.preferredCapability, 'adjust_part_stock', text);
        assert.deepEqual(extractSinglePartStockAdjustmentArgs(text), { items: [expected] }, text);
    }
});

test('W15-INTENT-2 缺数量 / 多数量 / 方向不明 / 缺目标 / 多目标一律返回可澄清原因', () => {
    for (const [text, reason] of [
        [`把 ${MODEL} 库存增加`, 'quantity_required'],
        [`把 ${MODEL} 库存增加 100 再减少 50`, 'quantity_ambiguous'],
        [`把 ${MODEL} 库存改成 100`, 'action_ambiguous'],
        ['把库存增加100', 'target_required'],
        [`把 ${MODEL} 和 W15-6203 库存都增加 100`, 'target_multi'],
    ]) {
        assert.equal(parsePartStockAdjustment(text).reason, reason, text);
        assert.equal(extractSinglePartStockAdjustmentArgs(text), null, text);
        // 仍然必须被识别为库存调整族，才能给出澄清而不是落入只读规划。
        assert.equal(routeOf(text)?.preferredCapability, 'adjust_part_stock', text);
    }
});

test('W15-INTENT-3 线圈/价格/删除/配方等其它写意图不被零件库存族吞掉', () => {
    assert.equal(routeOf('把12-120线圈库存增加100套')?.preferredCapability, 'adjust_coil_stock');
    assert.equal(routeOf('把零件A的单价修改成5元')?.preferredCapability, 'update_part');
    assert.equal(routeOf('删除零件A')?.preferredCapability, 'delete_part');
    assert.equal(routeOf(`把配方A调整一下`)?.preferredCapability, null);
    // 否定与疑问永远不取得写权限。
    assert.equal(routeOf(`不要增加${MODEL}库存`), null);
    assert.equal(routeOf(`${MODEL}库存增加100吗`), null);
});

test('W15-TEXT-1 用户可见文案使用稳定能力描述，不再出现 [object Object]', () => {
    const route = routeOf(`把 ${MODEL} 库存增加 100`);
    assert.equal(describeCommandRoute(route), '零件库存调整');
    assert.equal(describeCommandRoute({ preferredCapability: null }), '受保护的业务变更');
    assert.equal(/\[object Object\]/u.test(describeCommandRoute(route)), false);
});

// ── §3/§14/§15：dispatcher 走向 ─────────────────────────────────────────────────
test('W15-DISPATCH-1 写开关关闭：仍是 WRITE_DISABLED，且绝不调用提案桥', async () => {
    let called = 0;
    const { events } = await dispatch(`把 ${MODEL} 库存增加 100`, {
        writeAllowed: false,
        prepare: async () => { called += 1; return { ok: false }; },
    });
    const detail = events.find(event => event.type === 'detail');
    assert.equal(detail.state, 'WRITE_DISABLED');
    assert.equal(detail.nativeWriteEnabled, false);
    assert.equal(detail.commandLabel, '零件库存调整');
    assert.equal(called, 0, '写开关关闭时不得调用提案桥');
    const content = events.find(event => event.type === 'content');
    assert.equal(content.content.includes('[object Object]'), false);
    assert.equal(events.some(event => event.type === 'write_proposal'), false);
});

test('W15-DISPATCH-2 写开关打开 + W1 能力：下发结构化 NATIVE_WRITE_PROPOSAL 事件', async () => {
    const transport = {
        type: 'write_proposal',
        stage: 'NATIVE_WRITE_PROPOSAL',
        proposal: { kind: 'part_stock_adjust', capabilityId: 'inventory.parts.batch_adjust_stock', items: [{ partId: 7, model: MODEL, currentStock: 100, delta: 100, nextStock: 200, clampedToZero: false }] },
        confirmation: { confirmationToken: 'opaque-token', operationId: 'op-1', expiresAt: null, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } },
        task: { taskId: 'task-1', revision: 5, state: 'WAITING_APPROVAL', statusPath: '/api/ai/tasks/task-1' },
    };
    const { events, result } = await dispatch(`把 ${MODEL} 库存增加 100`, { prepare: async () => ({ ok: true, transport }) });
    assert.equal(result.telemetry.outcome, 'native_write_proposal');
    const proposalEvent = events.find(event => event.type === 'write_proposal');
    assert.equal(proposalEvent.stage, 'NATIVE_WRITE_PROPOSAL');
    assert.deepEqual(proposalEvent, transport);
    assert.equal(events.some(event => event.type === 'status' && event.stage === 'native_write_proposal'), true);
    assert.equal(events.filter(event => event.type === 'done').length, 1);
    // 事件里不得出现内部哈希/凭据。
    const serialized = JSON.stringify(events);
    for (const forbidden of ['argsHash', 'subjectHash', 'proposalHash', 'INTERNAL_WRITE_SECRET']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});

test('W15-DISPATCH-3 写开关打开但能力不在 W1 白名单：WRITE_UNSUPPORTED，零提案', async () => {
    for (const text of ['把12-120线圈库存增加100套', '把零件A的单价改成5元', '删除零件A']) {
        const { events, result } = await dispatch(text, { prepare: async () => { throw new Error('不得调用提案桥'); } });
        const detail = events.find(event => event.type === 'detail');
        assert.equal(detail.state, 'WRITE_UNSUPPORTED', text);
        assert.equal(events.some(event => event.type === 'write_proposal'), false, text);
        assert.equal(result.telemetry.outcome, 'native_write_unsupported', text);
    }
});

test('W15-DISPATCH-4 澄清路径：桥拒绝时不发提案事件，只给可执行的澄清文案', async () => {
    const { events, result } = await dispatch('把库存增加100', {
        prepare: async () => ({ ok: false, kind: 'clarification', code: 'NATIVE_WRITE_TARGET_REQUIRED', message: '请说明要调整的零件。' }),
    });
    assert.equal(events.some(event => event.type === 'write_proposal'), false);
    const detail = events.find(event => event.type === 'detail');
    assert.equal(detail.state, 'WRITE_CLARIFICATION_REQUIRED');
    assert.equal(detail.code, 'NATIVE_WRITE_TARGET_REQUIRED');
    assert.equal(result.telemetry.outcome, 'native_write_clarification');
});

test('W15-DISPATCH-5 Native 未委派（非 Owner / 未开启）：AI 不可用，不进入任何写分支', async () => {
    const sink = emitted();
    const result = await runAiDispatcherV3({
        messages: [{ role: 'user', content: `把 ${MODEL} 库存增加 100` }],
        stream: true,
        emit: sink.emit,
    }, { nativeTaskDelegation: false, nativeWriteAllowed: true });
    assert.equal(result.telemetry.outcome, 'ai_unavailable');
    assert.equal(sink.events.some(event => event.type === 'write_proposal'), false);
});
