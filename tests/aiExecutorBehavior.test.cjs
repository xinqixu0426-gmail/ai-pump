const test = require('node:test');
const assert = require('node:assert/strict');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const { processAiChat } = require('../api/routes/ai/chat.cjs');
const {
    consumeAiToolConfirmation,
    resetAiToolConfirmationsForTests,
} = require('../api/services/aiToolConfirmation.cjs');

const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_SECRET;
const originalDeepseekApiKey = process.env.DEEPSEEK_API_KEY;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function aiMessageResponse(message) {
    return jsonResponse({ choices: [{ message }] });
}

function intentPlanMessage(overrides = {}) {
    const plan = {
        goal: '处理当前用户目标',
        mode: 'query',
        domains: ['catalog'],
        needsBusinessData: true,
        contextMode: 'current_turn',
        answerShape: 'direct',
        requiresClarification: false,
        ambiguities: [],
        confidence: 'high',
        steps: [{ capabilityName: 'search_parts', objective: '读取正式业务数据' }],
        ...overrides,
    };
    return {
        role: 'assistant',
        content: '',
        tool_calls: [{
            id: 'intent-plan',
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                arguments: JSON.stringify(plan),
            },
        }],
    };
}

function toolCallMessage(name, args, id = 'business-tool') {
    return {
        role: 'assistant',
        content: '',
        tool_calls: [{
            id,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
        }],
    };
}

function scriptedAiProvider(messages, inspect = null) {
    let index = 0;
    return async (_prompt, options) => {
        if (typeof inspect === 'function') inspect(index, options);
        const message = messages[index];
        index += 1;
        if (!message) throw new Error(`测试 AI provider 缺少第 ${index} 个响应`);
        return aiMessageResponse(message);
    };
}

let commandReceiptSequence = 0;

function commandData(capabilityId, data = {}) {
    commandReceiptSequence += 1;
    const result = {
        operationId: `formal-operation-${commandReceiptSequence}`,
        capabilityId,
        status: 'completed',
        auditIds: [7000 + commandReceiptSequence],
        completedAt: '2026-08-07T00:00:00.000Z',
        ...data,
    };
    if (result.status !== 'completed') result.operationStatus = 'completed';
    return result;
}

function installFetchStub(handler) {
    const calls = [];
    global.fetch = async (url, options = {}) => {
        const call = {
            url: String(url),
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body ? JSON.parse(options.body) : undefined,
        };
        calls.push(call);
        return handler(call);
    };
    return calls;
}

test.afterEach(() => {
    global.fetch = originalFetch;
    resetAiToolConfirmationsForTests();
    if (originalSecret === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = originalSecret;
    if (originalDeepseekApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepseekApiKey;
});

test('AI executor 行为：写操作未确认时只返回确认卡片，不调用 API', async () => {
    const calls = installFetchStub(() => jsonResponse({ success: false, error: '不应调用' }, 500));

    const result = await executeToolCall('update_part', { model: 'A', price: 2 }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.toolName, 'update_part');
    assert.equal(calls.length, 0);
});

test('AI executor 行为：确认修改零件后通过标准 parts API 查询并更新', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    const calls = installFetchStub((call) => {
        assert.equal(call.headers['x-internal-secret'], 'test-secret');
        assert.equal(call.headers['x-operation-id'], 'operation-test-1');
        assert.equal(call.headers['x-capability-id'], 'ai.update_part');
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 7, model: 'A', category: '螺丝', price: 1, supplier: 'S', stock: 3 }] });
        }
        if (call.url.endsWith('/api/parts/7') && call.method === 'PATCH') {
            assert.deepEqual(call.body, { price: 2 });
            return jsonResponse({ success: true, data: commandData('parts.update', { id: 7, model: 'A', category: '螺丝', price: 2, supplier: 'S', stock: 3 }) });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'update_part',
        { model: 'A', price: 2 },
        { allowWrite: true, operationId: 'operation-test-1' }
    );

    assert.equal(result.success, true);
    assert.equal(result.part.id, 7);
    assert.equal(result.part.price, 2);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'PATCH /api/parts/7',
    ]);
});

test('AI executor 行为：零件资料工具不再接受旧版库存字段', async () => {
    const calls = installFetchStub(() => jsonResponse({
        success: false,
        error: '不应调用正式 API',
    }, 500));
    const args = {
        model: 'A',
        price: 2,
        supplier: '新供应商',
        stockDelta: 3,
    };

    const result = await executeToolCall('update_part', args, { allowWrite: false });
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_AI_TOOL_INPUT');
    assert.match(result.error, /stockDelta/);
    assert.equal(result.requiresConfirmation, undefined);
    assert.equal(calls.length, 0);
});

test('AI executor 行为：新建和删除零件只调用正式 CRUD API', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    const createCalls = installFetchStub((call) => {
        assert.equal(call.method, 'POST');
        assert.ok(call.url.endsWith('/api/parts'));
        assert.deepEqual(call.body, {
            model: '新零件',
            category: '其他',
            subcategory: '',
            price: 3.5,
            supplier: '-',
            stock: 0,
        });
        return jsonResponse({
            success: true,
            data: commandData('parts.create', {
                id: 11,
                model: '新零件',
                category: '其他',
                price: 3.5,
                supplier: '-',
                stock: 0,
            }),
        });
    });

    const created = await executeToolCall(
        'create_part',
        { model: '新零件', price: 3.5 },
        { allowWrite: true, operationId: 'operation-create-part' }
    );
    assert.equal(created.success, true);
    assert.equal(created.id, 11);
    assert.equal(createCalls.length, 1);

    const deleteCalls = installFetchStub((call) => {
        if (call.method === 'GET' && call.url.endsWith('/api/parts')) {
            return jsonResponse({
                success: true,
                data: [{
                    id: 11,
                    model: '新零件',
                    updatedAt: '2026-08-03 11:00:00',
                }],
            });
        }
        if (call.method === 'DELETE' && call.url.endsWith('/api/parts/11')) {
            assert.deepEqual(call.body, { expectedUpdatedAt: '2026-08-03 11:00:00' });
            return jsonResponse({ success: true, data: commandData('parts.delete', { deleted: 1 }) });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const deleted = await executeToolCall(
        'delete_part',
        { model: '新零件' },
        { allowWrite: true, operationId: 'operation-delete-part' }
    );
    assert.equal(deleted.success, true);
    assert.deepEqual(deleteCalls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'DELETE /api/parts/11',
    ]);
});

test('AI executor 行为：批量新增零件只生成一次确认并调用正式批量 API', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    const args = {
        parts: [
            { model: '8*20*8', category: '油封', price: 0.18, supplier: '鹏杰', stock: 0 },
            { model: '10*22*5', category: '油封', price: 0.18, supplier: '鹏杰', stock: 0 },
        ],
    };
    const beforeCalls = installFetchStub((call) => {
        assert.equal(call.url.endsWith('/api/parts/batch-create-preview'), true);
        return jsonResponse({
            success: true,
            data: {
                confirmationToken: 'pre-confirm-batch-token',
                suggestedIdempotencyKey: 'pre-confirm-batch-key',
                createdCount: 2,
                skippedCount: 0,
            },
        });
    });
    const pending = await executeToolCall(
        'batch_create_parts',
        args,
        { allowWrite: false, confirmationSubject: 'session-batch-part' }
    );
    assert.equal(pending.requiresConfirmation, true);
    assert.equal(pending.confirmation.toolName, 'batch_create_parts');
    assert.equal(beforeCalls.length, 1);
    assert.equal(beforeCalls[0].method, 'POST');

    const calls = installFetchStub((call) => {
        assert.equal(call.headers['x-internal-secret'], 'test-secret');
        assert.equal(call.headers['x-operation-id'], 'operation-batch-part');
        assert.equal(call.headers['x-capability-id'], 'ai.batch_create_parts');
        if (call.url.endsWith('/api/parts/batch-create-preview')) {
            assert.deepEqual(call.body, args);
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'formal-batch-part-confirmation-token',
                    suggestedIdempotencyKey: 'part-batch-create:formal-operation',
                    skippedCount: 0,
                    skippedExisting: [],
                    warnings: [],
                },
            });
        }
        if (call.url.endsWith('/api/parts/batch-create')) {
            assert.deepEqual(call.body, {
                confirmationToken: 'formal-batch-part-confirmation-token',
                idempotencyKey: 'part-batch-create:formal-operation',
            });
            return jsonResponse({
                success: true,
                data: commandData('parts.batch_create', {
                    createdCount: 2,
                    parts: args.parts.map((part, index) => ({ id: index + 101, ...part })),
                    changes: [{ field: 'created' }, { field: 'created' }],
                    warnings: [],
                    auditId: 700,
                    auditIds: [700, 701],
                    operationId: 'formal-operation',
                }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'batch_create_parts',
        args,
        { allowWrite: true, operationId: 'operation-batch-part' }
    );
    assert.equal(result.success, true);
    assert.equal(result.createdCount, 2);
    assert.equal(result.auditId, 700);
    assert.deepEqual(
        calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`),
        [
            'POST /api/parts/batch-create-preview',
            'POST /api/parts/batch-create',
        ]
    );
});

test('AI executor 行为：多型号零件库存使用一张确认卡和一次正式原子命令', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    let stockCommandCompleted = false;
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 7, model: 'A', stock: stockCommandCompleted ? 34 : 4 },
                    { id: 8, model: 'B', stock: stockCommandCompleted ? 35 : 5 },
                ],
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                operations: [
                    { partId: 7, delta: 30 },
                    { partId: 8, delta: 30 },
                ],
            });
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'batch-stock-token',
                    suggestedIdempotencyKey: 'batch-stock-key',
                    operations: [
                        { partId: 7, model: 'A', currentStock: 4, nextStock: 34, delta: 30 },
                        { partId: 8, model: 'B', currentStock: 5, nextStock: 35, delta: 30 },
                    ],
                    warnings: [],
                },
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                confirmationToken: 'batch-stock-token',
                idempotencyKey: 'batch-stock-key',
            });
            stockCommandCompleted = true;
            return jsonResponse({
                success: true,
                data: {
                    operationId: 'formal-batch-stock-operation',
                    capabilityId: 'inventory.parts.batch_adjust_stock',
                    status: 'completed',
                    updatedCount: 2,
                    parts: [
                        { id: 7, model: 'A', stock: 34 },
                        { id: 8, model: 'B', stock: 35 },
                    ],
                    changes: [
                        { resourceId: 7, field: 'stock', from: 4, to: 34, delta: 30 },
                        { resourceId: 8, field: 'stock', from: 5, to: 35, delta: 30 },
                    ],
                    auditIds: [701, 702],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const pending = await executeToolCall('adjust_part_stock', {
        items: [
            { model: 'A', changeQty: 30 },
            { model: 'B', changeQty: 30 },
        ],
    }, {
        allowWrite: false,
        confirmationSubject: 'session-a',
        operationId: 'ai-batch-stock-operation',
    });
    assert.equal(pending.requiresConfirmation, true);
    assert.equal(pending.confirmation.toolName, 'adjust_part_stock');
    assert.deepEqual(pending.confirmation.rows, [
        { label: 'A', value: '当前 4 → 预计 34（+30 件）' },
        { label: 'B', value: '当前 5 → 预计 35（+30 件）' },
    ]);
    assert.equal(
        Object.prototype.hasOwnProperty.call(pending.confirmation, 'executionContext'),
        false
    );

    const consumed = consumeAiToolConfirmation({
        confirmationToken: pending.confirmation.confirmationToken,
        subject: 'session-a',
    });
    const result = await executeToolCall(consumed.toolName, consumed.args, {
        allowWrite: true,
        operationId: consumed.operationId,
        confirmationContext: consumed.executionContext,
    });

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(result.operationId, 'formal-batch-stock-operation');
    assert.deepEqual(result.auditIds, [701, 702]);
    assert.deepEqual(result.parts.map(part => part.stock), [34, 35]);
    assert.deepEqual(result.readback, [
        { id: 7, model: 'A', stock: 34 },
        { id: 8, model: 'B', stock: 35 },
    ]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'POST /api/parts/batch-stock-preview',
        'POST /api/parts/batch-stock',
        'GET /api/parts',
    ]);
});

test('AI 对话行为：指代前一轮两个型号入库时直接停在真实确认卡', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 7, model: 'TEST-机筒-1100', stock: 4 },
                    { id: 8, model: 'TEST-电容-30uF', stock: 5 },
                ],
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview') && call.method === 'POST') {
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'batch-stock-token',
                    suggestedIdempotencyKey: 'batch-stock-key',
                    operations: [
                        { partId: 7, model: 'TEST-机筒-1100', currentStock: 4, nextStock: 34, delta: 30 },
                        { partId: 8, model: 'TEST-电容-30uF', currentStock: 5, nextStock: 35, delta: 30 },
                    ],
                    warnings: [],
                },
            });
        }
        return jsonResponse({
            error: { message: '不应调用外部模型或其他业务 API' },
        }, 500);
    });
    const result = await processAiChat(
        '这两个型号我都进了30，把库存+30',
        {
            context: [{
                role: 'assistant',
                content: '| 型号 | 库存 |\n|---|---|\n| `TEST-机筒-1100` | 4 |\n| `TEST-电容-30uF` | 5 |',
            }],
            fetchAiProvider: scriptedAiProvider([
                intentPlanMessage({
                    goal: '把上轮两个零件型号的库存各增加30件',
                    mode: 'command',
                    domains: ['catalog'],
                    contextMode: 'previous_turn',
                    answerShape: 'confirmation',
                    steps: [{ capabilityName: 'adjust_part_stock', objective: '生成批量库存调整确认' }],
                }),
                toolCallMessage('adjust_part_stock', {
                    items: [
                        { model: 'TEST-机筒-1100', changeQty: 30 },
                        { model: 'TEST-电容-30uF', changeQty: 30 },
                    ],
                }),
            ]),
        }
    );

    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'POST /api/parts/batch-stock-preview',
    ]);
    assert.match(result.finalContent, /待确认|正式确认卡片/);
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].name, 'adjust_part_stock');
    assert.equal(result.toolResults[0].result.requiresConfirmation, true);
    assert.deepEqual(result.toolResults[0].result.confirmation.rows, [
        { label: 'TEST-机筒-1100', value: '当前 4 → 预计 34（+30 件）' },
        { label: 'TEST-电容-30uF', value: '当前 5 → 预计 35（+30 件）' },
    ]);
});

test('AI 对话行为：“型号的库存”先去掉语法连接词，再以正式预览生成确认卡', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 8, model: 'TEST-电容-30uF', stock: 5 }],
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                operations: [{ partId: 8, delta: 30 }],
            });
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'batch-stock-token',
                    suggestedIdempotencyKey: 'batch-stock-key',
                    operations: [
                        { partId: 8, model: 'TEST-电容-30uF', currentStock: 5, nextStock: 35, delta: 30 },
                    ],
                    warnings: [],
                },
            });
        }
        return jsonResponse({ success: false, error: '不应调用外部模型' }, 500);
    });

    const result = await processAiChat('TEST-电容-30uF的库存加30个', {
        fetchAiProvider: scriptedAiProvider([
            intentPlanMessage({
                goal: '把零件 TEST-电容-30uF 的库存增加30件',
                mode: 'command',
                domains: ['catalog'],
                answerShape: 'confirmation',
                steps: [{ capabilityName: 'adjust_part_stock', objective: '生成库存调整确认' }],
            }),
            toolCallMessage('adjust_part_stock', {
                items: [{ model: 'TEST-电容-30uF', changeQty: 30 }],
            }),
        ]),
    });

    assert.equal(result.toolResults[0].result.requiresConfirmation, true);
    assert.deepEqual(result.toolResults[0].result.confirmation.args, {
        items: [{ model: 'TEST-电容-30uF', changeQty: 30 }],
    });
    assert.deepEqual(result.toolResults[0].result.confirmation.rows, [
        { label: 'TEST-电容-30uF', value: '当前 5 → 预计 35（+30 件）' },
    ]);
    assert.equal(calls.length, 2);
});

test('AI 对话行为：符号库存增量直接生成服务端确认卡而不让模型伪造', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 5, model: 'TEST-机筒-1100', stock: 4 }],
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                operations: [{ partId: 5, delta: 100 }],
            });
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'batch-stock-token',
                    suggestedIdempotencyKey: 'batch-stock-key',
                    operations: [
                        { partId: 5, model: 'TEST-机筒-1100', currentStock: 4, nextStock: 104, delta: 100 },
                    ],
                    warnings: [],
                },
            });
        }
        return jsonResponse({ success: false, error: '不应调用外部模型' }, 500);
    });

    const result = await processAiChat('TEST-机筒-1100库存+100', {
        fetchAiProvider: scriptedAiProvider([
            intentPlanMessage({
                goal: '把零件 TEST-机筒-1100 的库存增加100件',
                mode: 'command',
                domains: ['catalog'],
                answerShape: 'confirmation',
                steps: [{ capabilityName: 'adjust_part_stock', objective: '生成库存调整确认' }],
            }),
            toolCallMessage('adjust_part_stock', {
                items: [{ model: 'TEST-机筒-1100', changeQty: 100 }],
            }),
        ]),
    });

    assert.equal(result.toolResults[0].name, 'adjust_part_stock');
    assert.equal(result.toolResults[0].result.requiresConfirmation, true);
    assert.deepEqual(result.toolResults[0].result.confirmation.rows, [
        { label: 'TEST-机筒-1100', value: '当前 4 → 预计 104（+100 件）' },
    ]);
    assert.equal(calls.length, 2);
});

test('AI executor 行为：零件型号不存在时不签发库存确认卡', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 8, model: 'TEST-电容-30uF', stock: 5 }],
            });
        }
        return jsonResponse({ success: false, error: '不存在时不应生成库存预览' }, 500);
    });

    const result = await executeToolCall('adjust_part_stock', {
        items: [{ model: 'TEST-电容-30uF的', changeQty: 30 }],
    }, { allowWrite: false });

    assert.equal(result.success, false);
    assert.equal(result.code, 'part_stock_target_not_found');
    assert.match(result.error, /未找到.*型号/);
    assert.deepEqual(result.candidates, [{
        id: 8,
        model: 'TEST-电容-30uF',
        category: '',
        subcategory: '',
        supplier: '',
        stock: 5,
    }]);
    assert.equal(result.requiresConfirmation, undefined);
    assert.equal(calls.length, 1);
});

test('AI 对话行为：强制业务查询失败时停止回答而不让模型补写数据', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: false, error: '零件 API 暂时不可用' }, 503);
        }
        return jsonResponse({
            error: { message: '业务 API 失败后不应继续调用模型' },
        }, 500);
    });

    const result = await processAiChat('列出所有零件', {
        fetchAiProvider: scriptedAiProvider([
            intentPlanMessage({
                goal: '列出全部零件',
                answerShape: 'list',
                steps: [{ capabilityName: 'search_parts', objective: '读取全部正式零件' }],
            }),
            toolCallMessage('search_parts', {}),
        ]),
    });
    assert.equal(calls.length, 1);
    assert.match(result.finalContent, /没有取得正式业务 API 的有效结果/);
    assert.equal(result.toolResults[0].result.success, false);
    assert.doesNotMatch(result.finalContent, /共有\\s*\d+|库存为|单价/);
});

test('AI 对话行为：口语“采购中的单子”由模型选订单工具并在正式结果后关闭扩搜', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders?status=%E9%87%87%E8%B4%AD%E4%B8%AD')) {
            return jsonResponse({
                success: true,
                data: [{
                    id: 3,
                    customerName: '测试客户',
                    contractNo: 'HT-003',
                    status: '采购中',
                    createdAt: '2026-08-03T00:00:00.000Z',
                }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const provider = scriptedAiProvider([
        intentPlanMessage({
            goal: '查询采购中的订单数量并逐单简报',
            mode: 'query',
            domains: ['order'],
            answerShape: 'count_with_brief',
            steps: [{ capabilityName: 'get_recent_orders', objective: '按采购中状态读取订单' }],
        }),
        toolCallMessage('get_recent_orders', { status: '采购中' }, 'call-order-list'),
        { role: 'assistant', content: '采购中的订单有 **1 个**：测试客户，创建日期 2026-8-3。' },
    ], (index, options) => {
        if (index !== 1) return;
        assert.deepEqual(options.tools.map(tool => tool.function.name), ['get_recent_orders']);
        assert.equal(options.toolChoice.function.name, 'get_recent_orders');
        assert.equal(options.tools.some(tool => tool.function.name === 'create_order'), false);
    });
    const result = await processAiChat('采购中的单子有几个', {
        fetchAiProvider: provider,
    });

    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].name, 'get_recent_orders');
    assert.equal(result.intent.answerShape, 'count_with_brief');
    assert.match(result.finalContent, /订单有 \*\*1 个\*\*/);
    assert.equal(calls.some(call => call.url.includes('/api/orders/purchase-overview')), false);
});

test('AI 对话行为：按客户追问采购情况时阻止猜测订单ID并改用正式名称解析', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders?customerName=%E9%82%B1%E7%84%95')) {
            return jsonResponse({
                success: true,
                data: [{ id: 1, customerName: '邱焕', contractNo: '', status: '采购中' }],
            });
        }
        if (call.url.endsWith('/api/orders/1')) {
            return jsonResponse({
                success: true,
                data: {
                    id: 1,
                    customerName: '邱焕',
                    contractNo: '',
                    status: '采购中',
                    itemsJson: '[]',
                    purchaseListJson: JSON.stringify([
                        { model: '12-120', name: '线圈转子', orderedQty: 100, receivedQty: 100, stockedQty: 100 },
                        { model: '珍珠棉', name: '珍珠棉', orderedQty: 200, receivedQty: 0, stockedQty: 0 },
                    ]),
                    todosJson: '[]',
                },
            });
        }
        if (call.url.endsWith('/api/orders/1/knowledge-package')) {
            return jsonResponse({
                success: true,
                data: {
                    order: { id: 1, customerName: '邱焕', status: '采购中' },
                    confirmedKnowledge: {
                        customerRequirement: null,
                        executionRecords: [],
                    },
                    coverage: {
                        hasConfirmedCustomerRequirement: false,
                        confirmedExecutionRecordCount: 0,
                        sourceFileCount: 0,
                    },
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });
    const provider = scriptedAiProvider([
        intentPlanMessage({
            goal: '查询邱焕订单已经采购的物料和进度',
            mode: 'query',
            domains: ['order'],
            contextMode: 'previous_turn',
            answerShape: 'list',
            steps: [{ capabilityName: 'get_order_detail', objective: '读取邱焕订单采购明细' }],
        }),
        toolCallMessage('get_order_detail', { orderId: 5 }, 'guessed-order-id'),
        toolCallMessage('get_order_detail', { orderQuery: '邱焕' }, 'resolved-order-name'),
        { role: 'assistant', content: '已下单：12-120 线圈转子 100 套、珍珠棉 200 件。' },
    ], (index, options) => {
        if (index === 2) {
            assert.equal(options.toolChoice.function.name, 'get_order_detail');
        }
    });

    const result = await processAiChat('邱焕的订单已经采购了什么了', {
        context: [
            { role: 'user', content: '看一下订单' },
            { role: 'assistant', content: '当前共有 2 个订单：台州叶总、邱焕。' },
        ],
        fetchAiProvider: provider,
    });

    assert.equal(result.toolResults.length, 2);
    assert.deepEqual(result.toolResults.map(item => item.name), [
        'get_order_detail',
        'get_order_knowledge_package',
    ]);
    assert.equal(result.toolResults[0].result.success, true);
    assert.match(result.finalContent, /12-120/);
    assert.equal(calls.some(call => call.url.endsWith('/api/orders/5')), false);
    assert.equal(calls.some(call => call.url.includes('/api/orders?customerName=')), true);
    assert.equal(calls.some(call => call.url.endsWith('/api/orders/1/knowledge-package')), true);
});

test('AI executor 行为：正式库存命令缺少 operation/audit 回执时拒绝报成功', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 7, model: 'A', stock: 4 }] });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview')) {
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'stock-token',
                    suggestedIdempotencyKey: 'stock-key',
                },
            });
        }
        return jsonResponse({
            success: true,
            data: {
                updatedCount: 1,
                parts: [{ id: 7, model: 'A', stock: 34 }],
            },
        });
    });

    const result = await executeToolCall('adjust_part_stock', {
        items: [{ model: 'A', changeQty: 30 }],
    }, { allowWrite: true });
    assert.equal(result.success, false);
    assert.match(result.error, /operation\/audit 回执/);
});

test('AI executor 行为：库存命令回执与正式回读不一致时拒绝报成功', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 7, model: 'A', stock: 4 }],
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock-preview')) {
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'stock-token',
                    suggestedIdempotencyKey: 'stock-key',
                    operations: [
                        { partId: 7, model: 'A', currentStock: 4, nextStock: 34, delta: 30 },
                    ],
                    warnings: [],
                },
            });
        }
        if (call.url.endsWith('/api/parts/batch-stock')) {
            return jsonResponse({
                success: true,
                data: {
                    operationId: 'formal-stock-operation',
                    capabilityId: 'inventory.parts.batch_adjust_stock',
                    status: 'completed',
                    updatedCount: 1,
                    parts: [{ id: 7, model: 'A', stock: 34 }],
                    changes: [
                        { resourceId: 7, field: 'stock', from: 4, to: 34, delta: 30 },
                    ],
                    auditIds: [701],
                },
            });
        }
        return jsonResponse({ success: false, error: 'unexpected request' }, 500);
    });

    const result = await executeToolCall('adjust_part_stock', {
        items: [{ model: 'A', changeQty: 30 }],
    }, { allowWrite: true });

    assert.equal(result.success, false);
    assert.equal(result.code, 'part_stock_readback_mismatch');
    assert.match(result.error, /库存回读/);
    assert.equal(calls.length, 4);
});

test('AI executor 行为：批量调价生成候选价后必须经正式预览和原子命令', async () => {
    process.env.INTERNAL_SECRET = 'test-secret';
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 7, model: '轴承A', category: '轴承', price: 10 },
                    { id: 8, model: '轴承B', category: '轴承', price: 12.34 },
                    { id: 9, model: '螺丝A', category: '螺丝', price: 1 },
                ],
            });
        }
        if (call.url.endsWith('/api/parts/prices-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                updates: [
                    { partId: 7, price: 11 },
                    { partId: 8, price: 13.57 },
                ],
            });
            return jsonResponse({
                success: true,
                data: {
                    updates: [
                        { partId: 7, price: 11, expectedUpdatedAt: 'v1' },
                        { partId: 8, price: 13.57, expectedUpdatedAt: 'v2' },
                    ],
                    previewHash: 'price-hash',
                    suggestedIdempotencyKey: 'price-key',
                },
            });
        }
        if (call.url.endsWith('/api/parts/prices') && call.method === 'PATCH') {
            assert.deepEqual(call.body, {
                updates: [
                    { partId: 7, price: 11, expectedUpdatedAt: 'v1' },
                    { partId: 8, price: 13.57, expectedUpdatedAt: 'v2' },
                ],
                previewHash: 'price-hash',
                idempotencyKey: 'price-key',
            });
            return jsonResponse({
                success: true,
                data: commandData('parts.batch_update_prices', { updatedCount: 2 }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'batch_update_prices',
        { category: '轴承', percentChange: 10 },
        { allowWrite: true, operationId: 'operation-test-prices' }
    );

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(result.changeType, '+10%');
    assert.deepEqual(result.details, [
        { model: '轴承A', oldPrice: 10, newPrice: 11 },
        { model: '轴承B', oldPrice: 12.34, newPrice: 13.57 },
    ]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'POST /api/parts/prices-preview',
        'PATCH /api/parts/prices',
    ]);
});

test('AI executor 行为：线圈库存未确认时先正式预览再显示标准方案', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [
                { id: 21, commonName: '12', spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 3 },
                { id: 22, commonName: '12', spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 7 },
            ] });
        }
        if (call.url.endsWith('/api/coils/stock-adjustments-preview')) {
            return jsonResponse({ success: true, data: {
                confirmationToken: 'coil-pre-confirm-token',
                suggestedIdempotencyKey: 'coil-pre-confirm-key',
            } });
        }
        return jsonResponse({ success: false, error: 'unexpected call' }, 500);
    });

    const result = await executeToolCall('adjust_coil_stock', {
        items: [
            { model: '12-120', changeQty: 50 },
            { model: '12-140', changeQty: 50 },
        ],
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.toolName, 'adjust_coil_stock');
    assert.equal(result.confirmation.title, '调整线圈库存');
    assert.match(result.confirmation.rows[0].label, /12-120/);
    assert.match(result.confirmation.rows[0].value, /当前 3 → 预计 53/);
    assert.match(result.confirmation.rows[1].label, /12-140/);
    assert.equal(calls.length, 2);
});

test('AI 对话行为：俗称批量入库正式预览后停在确认步骤且不再调用模型', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [
                { id: 21, commonName: '12', spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 3 },
                { id: 22, commonName: '12', spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 7 },
            ] });
        }
        if (call.url.endsWith('/api/coils/stock-adjustments-preview')) {
            return jsonResponse({ success: true, data: {
                confirmationToken: 'coil-chat-pre-confirm-token',
                suggestedIdempotencyKey: 'coil-chat-pre-confirm-key',
            } });
        }
        return jsonResponse({ success: false, error: 'unexpected call' }, 500);
    });

    const result = await processAiChat('12-120,12-140各入库50套', {
        fetchAiProvider: scriptedAiProvider([
            intentPlanMessage({
                goal: '把12-120和12-140线圈成品各入库50套',
                mode: 'command',
                domains: ['coil'],
                answerShape: 'confirmation',
                steps: [{ capabilityName: 'adjust_coil_stock', objective: '生成批量线圈库存调整确认' }],
            }),
            toolCallMessage('adjust_coil_stock', {
                items: [
                    { model: '12-120', changeQty: 50 },
                    { model: '12-140', changeQty: 50 },
                ],
            }),
        ]),
    });

    assert.match(result.finalContent, /待确认|确认卡片/);
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].name, 'adjust_coil_stock');
    assert.equal(result.toolResults[0].result.requiresConfirmation, true);
    assert.deepEqual(result.toolResults[0].result.confirmation.args.items, [
        { model: '12-120', changeQty: 50, material: '钢带', slotType: '小眼' },
        { model: '12-140', changeQty: 50, material: '钢带', slotType: '小眼' },
    ]);
    assert.equal(calls.length, 2);
});

test('AI executor 行为：确认后按俗称片数匹配正式方案并原子批量调整', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 21, commonName: '12', spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 3 },
                    { id: 22, commonName: '12', spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', stock: 7 },
                    { id: 23, commonName: '12', spec: '12', sheets: 120, material: '冷轧', slotType: '国标眼', schemeStatus: 'testing', stock: 0 },
                ],
            });
        }
        if (call.url.endsWith('/api/coils/stock-adjustments-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                adjustments: [
                    { coilId: 21, changeQty: 50 },
                    { coilId: 22, changeQty: 50 },
                ],
            });
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'inventory-preview-token',
                    suggestedIdempotencyKey: 'coil-stock:test-preview',
                },
            });
        }
        if (call.url.endsWith('/api/coils/stock-adjustments') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                confirmationToken: 'inventory-preview-token',
                idempotencyKey: 'coil-stock:test-preview',
            });
            return jsonResponse({
                success: true,
                data: commandData('inventory.coils.adjust_stock', {
                    updatedCount: 2,
                    adjustments: [
                        { coil: { id: 21 }, adjustment: { balanceAfter: 53 } },
                        { coil: { id: 22 }, adjustment: { balanceAfter: 57 } },
                    ],
                }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('adjust_coil_stock', {
        items: [
            { model: '12-120', changeQty: 50 },
            { model: '12-140', changeQty: 50 },
        ],
    }, { allowWrite: true });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'coil_stock_adjustment');
    assert.deepEqual(result.items.map(item => item.newStock), [53, 57]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/coils',
        'POST /api/coils/stock-adjustments-preview',
        'POST /api/coils/stock-adjustments',
    ]);
    assert.equal(calls.some(call => call.url.includes('/api/parts')), false);
});

test('AI executor 行为：线圈俗称匹配多个正式方案时不写库存', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 21, commonName: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official' },
                    { id: 24, commonName: '12', sheets: 120, material: '冷轧', slotType: '国标眼', schemeStatus: 'official' },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('adjust_coil_stock', {
        items: [{ model: '12-120', changeQty: 50 }],
    }, { allowWrite: true });

    assert.equal(result.success, false);
    assert.match(result.error, /存在多个正式方案/);
    assert.match(result.error, /请明确材质和槽眼/);
    assert.deepEqual(calls.map(call => call.method), ['GET']);
});

test('AI executor 行为：零件搜索不传筛选时通过标准 parts API 返回列表', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 1, model: '6202', category: '轴承', price: 1.5, supplier: 'S', stock: 8 }] });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_parts', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(result.returnedCount, 1);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.filters, {
        keyword: '',
        category: '',
        supplier: '',
        stockStatus: '',
        limit: null,
        minPrice: null,
        maxPrice: null,
        priceBelow: null,
        priceAbove: null,
        minStock: null,
        maxStock: null,
        stockBelow: null,
        stockAbove: null,
        sortBy: null,
        sortOrder: null,
    });
    assert.equal(result.stockStatusDefinition.low, '库存大于0且不超过5');
    assert.deepEqual(result.suppliers, [{ name: 'S', partCount: 1 }]);
    assert.deepEqual(result.categorySummary, [{ category: '轴承', partCount: 1 }]);
    assert.deepEqual(result.parts, [{ id: 1, model: '6202', category: '轴承', subcategory: '', price: 1.5, supplier: 'S', stock: 8 }]);
    assert.equal(result.provenance.kind, 'live_business');
    assert.equal(result.provenance.label, '实时业务数据');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/parts$/);
});

test('AI executor 行为：零件搜索向正式 parts API 透传排序参数', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.includes('/api/parts') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 9, model: 'SPA 3 叶', category: '泵壳', price: 147, supplier: 'S', stock: 0 }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_parts', {
        sortBy: 'price',
        sortOrder: 'desc',
        limit: 1,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/parts\?/);
    assert.match(calls[0].url, /sortBy=price/);
    assert.match(calls[0].url, /sortOrder=desc/);
    assert.match(calls[0].url, /limit=1/);
    assert.deepEqual(result.parts.map(part => part.price), [147]);
});

test('AI executor 行为：低库存筛选委托正式 parts API 而不在 executor 计算', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts?stockStatus=low') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 2, model: '低库存轴承', category: '轴承', price: 2, supplier: 'A', stock: 1 },
                    { id: 3, model: '临界油封', category: '油封', price: 3, supplier: 'B', stock: 5 },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_parts', {
        stockStatus: 'low',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.parts.map(part => part.stock), [1, 5]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/parts\?stockStatus=low$/);
});

test('AI executor 行为：采购中订单只返回正式筛选结果且不伪造创建日期', async () => {
    const calls = installFetchStub((call) => {
        if (
            call.url.endsWith('/api/orders?status=%E9%87%87%E8%B4%AD%E4%B8%AD')
            && call.method === 'GET'
        ) {
            return jsonResponse({
                success: true,
                data: [{
                    id: 9,
                    customerName: '华东泵业',
                    contractNo: 'HT-009',
                    status: '采购中',
                    createdAt: null,
                }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_recent_orders', {
        status: '采购中',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.deepEqual(result.data, [{
        id: 9,
        customer: '华东泵业',
        contract: 'HT-009',
        status: '采购中',
        createdAt: null,
    }]);
    assert.match(result.selectionBoundary, /不得改用采购任务/);
    assert.deepEqual(calls.map(call => call.method), ['GET']);
});

test('AI executor 行为：报价状态筛选委托正式 quotations API 且只返回命中项', async () => {
    const calls = installFetchStub((call) => {
        if (
            call.url.endsWith('/api/quotations?status=%E6%8A%A5%E4%BB%B7%E4%B8%AD&limit=50')
            && call.method === 'GET'
        ) {
            return jsonResponse({
                success: true,
                data: [{
                    id: 8,
                    customerName: '华东泵业',
                    status: '报价中',
                    totalCost: 700,
                    totalPrice: 1000,
                    itemsJson: JSON.stringify([{ recipeName: 'V750', qty: 2 }]),
                    createdAt: '2026-08-08T00:00:00.000Z',
                }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_quotations', {
        status: '报价中',
        limit: 50,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.deepEqual(result.filters, {
        status: '报价中',
        customerName: '',
        limit: 50,
    });
    assert.deepEqual(result.data, [{
        id: 8,
        customerName: '华东泵业',
        status: '报价中',
        totalCost: 700,
        totalPrice: 1000,
        createdAt: '2026-08-08T00:00:00.000Z',
        items: [{ model: 'V750', quantity: 2 }],
    }]);
    assert.match(result.selectionBoundary, /正式报价 API/);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => call.method), ['GET']);
});

test('AI executor 行为：客户和模板列表只传正式筛选字段并返回查询回执', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/customers?name=%E5%8D%8E%E4%B8%9C&limit=2')) {
            return jsonResponse({
                success: true,
                data: [{ id: 7, name: '华东泵业', contactInfo: '138', defaultMargin: 1.1 }],
            });
        }
        if (call.url.endsWith('/api/templates?shellModel=SHELL-1')) {
            return jsonResponse({
                success: true,
                data: [{ id: 3, shellModel: 'SHELL-1', description: '常用泵壳' }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const customers = await executeToolCall('search_customers', {
        name: '华东',
        limit: 2,
    }, { allowWrite: false });
    const templates = await executeToolCall('search_templates', {
        shellModel: 'SHELL-1',
    }, { allowWrite: false });

    assert.equal(customers.success, true);
    assert.deepEqual(customers.queryReceipt.appliedFilters, { name: '华东', limit: 2 });
    assert.equal(customers.queryReceipt.authoritative, true);
    assert.deepEqual(customers.data.map(item => item.name), ['华东泵业']);
    assert.equal(templates.success, true);
    assert.deepEqual(templates.queryReceipt.appliedFilters, { shellModel: 'SHELL-1' });
    assert.deepEqual(templates.data.map(item => item.shellModel), ['SHELL-1']);
    assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
});

test('AI executor 行为：全量零件查询不在 executor 内隐式截断', async () => {
    const source = Array.from({ length: 35 }, (_, index) => ({
        id: index + 1,
        model: `PART-${index + 1}`,
        category: '测试',
        supplier: 'S',
        stock: index,
    }));
    installFetchStub(call => (
        call.url.endsWith('/api/parts')
            ? jsonResponse({ success: true, data: source })
            : jsonResponse({ success: false, error: 'unexpected request' }, 500)
    ));

    const result = await executeToolCall('search_parts', {}, { allowWrite: false });

    assert.equal(result.count, 35);
    assert.equal(result.returnedCount, 35);
    assert.equal(result.parts.length, 35);
    assert.equal(result.queryReceipt.totalCount, 35);
    assert.equal(result.queryReceipt.truncated, false);
});

test('AI executor 行为：有测试报告的配方由正式配方 API 筛选并返回报告数量', async () => {
    const calls = installFetchStub(call => (
        call.url.endsWith('/api/recipes?hasTechnicalFiles=true')
            ? jsonResponse({
                success: true,
                data: [{
                    id: 1,
                    name: 'TEST-PUMP-750A',
                    spec: '750W/220V 测试配方',
                    technicalFileCount: 1,
                }],
            })
            : jsonResponse({ success: false, error: 'unexpected request' }, 500)
    ));

    const result = await executeToolCall(
        'get_all_recipes',
        { hasTechnicalFiles: true },
        { allowWrite: false }
    );

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.deepEqual(result.queryReceipt.appliedFilters, { hasTechnicalFiles: true });
    assert.deepEqual(result.data, [{
        id: 1,
        name: 'TEST-PUMP-750A',
        spec: '750W/220V 测试配方',
        savedCost: 0,
        technicalFileCount: 1,
    }]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/recipes?hasTechnicalFiles=true',
    ]);
});

test('AI executor 行为：配方技术档案按正式配方和附件 API 读取', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 8, name: 'V1600-3”-12-180', spec: '3寸' },
                    { id: 9, name: 'V750', spec: '2寸' },
                ],
            });
        }
        if (call.url.endsWith('/api/recipes/8/technical-files') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{
                    id: 21,
                    reportType: 'performance_test',
                    originalName: 'V1600测试报告.xlsx',
                    summary: { testPoints: [{ flow: 10, head: 20 }] },
                }],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'get_recipe_technical_files',
        { recipeName: 'V1600-3”-12-180' },
        { allowWrite: false }
    );

    assert.equal(result.success, true);
    assert.equal(result.recipe.id, 8);
    assert.equal(result.files[0].reportType, 'performance_test');
    assert.deepEqual(result.sources, [{
        sourceTable: 'recipes',
        sourceId: 8,
        title: 'V1600-3”-12-180 技术档案',
    }]);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/recipes',
        'GET /api/recipes/8/technical-files',
    ]);
});

test('AI executor 行为：客户报价使用连续展示顺序且不返回内部 ID', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/customers?name=%E9%82%B1%E7%84%95')) {
            return jsonResponse({ success: true, data: [{ id: 7, name: '邱焕' }] });
        }
        if (call.url.endsWith('/api/customers/7/context')) {
            return jsonResponse({
                success: true,
                data: {
                    customer: { id: 7, name: '邱焕' },
                    quotations: [
                        { displaySequence: 1, createdAt: '2026-07-22T00:00:00.000Z', items: [] },
                        { displaySequence: 2, createdAt: '2026-07-25T00:00:00.000Z', items: [] },
                    ],
                    orders: [],
                    summary: '找到 邱焕 的历史报价 2 条、订单 0 条。',
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_customer_history', { customerName: '邱焕' }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.quotations.map(item => item.displaySequence), [1, 2]);
    assert.deepEqual(result.data.quotations.map(item => item.createdAt), [
        '2026-07-22T00:00:00.000Z',
        '2026-07-25T00:00:00.000Z',
    ]);
    assert.equal(result.data.quotations.some(item => 'id' in item || 'Id' in item), false);
    assert.deepEqual(
        calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`),
        [
            'GET /api/customers?name=%E9%82%B1%E7%84%95',
            'GET /api/customers/7/context',
        ]
    );
});

test('AI executor 行为：订单生产准备通过只读标准 API 并返回实时结论', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/12/readiness') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    order: { id: 12, customerName: '测试客户', status: '采购中' },
                    verdict: 'waiting_materials',
                    canProduce: false,
                    summary: '订单 #12 当前不能直接生产：仍有 2 项物料库存不足。',
                    steps: [
                        { key: 'order', status: 'pass' },
                        { key: 'recipe', status: 'pass' },
                        { key: 'parts', status: 'warning' },
                        { key: 'coils', status: 'warning' },
                        { key: 'procurement', status: 'warning' },
                        { key: 'cost', status: 'pass' },
                    ],
                    shortages: [{ model: '轴承', shortageQty: 3 }],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('check_order_readiness', { orderId: 12 }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'order_readiness');
    assert.equal(result.data.verdict, 'waiting_materials');
    assert.equal(result.data.canProduce, false);
    assert.equal(result.data.steps.length, 6);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/orders/12/readiness',
    ]);
});

test('AI executor 行为：订单详情和生产准备的正式 404 是已验证负结果', async () => {
    const calls = installFetchStub((call) => {
        if (
            call.method === 'GET'
            && (
                call.url.endsWith('/api/orders/999999999')
                || call.url.endsWith('/api/orders/999999999/readiness')
            )
        ) {
            return jsonResponse({ success: false, error: '订单不存在' }, 404);
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const detail = await executeToolCall(
        'get_order_detail',
        { orderId: 999999999 },
        { allowWrite: false }
    );
    const readiness = await executeToolCall(
        'check_order_readiness',
        { orderId: 999999999 },
        { allowWrite: false }
    );

    for (const result of [detail, readiness]) {
        assert.equal(result.success, false);
        assert.equal(result.code, 'AI_RESOURCE_NOT_FOUND');
        assert.equal(result.executionEvidence.verified, true);
        assert.equal(result.executionEvidence.kind, 'formal_api_query_failure');
        assert.equal(result.executionEvidence.calls[0].outcome, 'not_found');
    }
    assert.match(detail.error, /找不到订单ID: 999999999/);
    assert.equal(readiness.error, '订单不存在');
    assert.equal(calls.length, 2);
});

test('AI executor 行为：订单详情的正式 API 故障不能冒充订单不存在', async () => {
    installFetchStub((call) => jsonResponse({
        success: false,
        error: `订单服务故障：${call.method} ${call.url}`,
    }, 500));

    const result = await executeToolCall(
        'get_order_detail',
        { orderId: 999999999 },
        { allowWrite: false }
    );

    assert.equal(result.success, false);
    assert.equal(result.code, 'internal_api_request_failed');
    assert.match(result.error, /订单服务故障/);
    assert.equal(result.executionEvidence, undefined);
});

test('AI executor 行为：订单知识包通过只读标准 API 并保留双层依据', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/12/knowledge-package') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    order: { id: 12, customerName: '测试客户', status: '采购中' },
                    readiness: { verdict: 'waiting_materials' },
                    confirmedKnowledge: {
                        customerRequirement: { text: '客户要求使用指定包装。' },
                        executionRecords: [{ id: 3, text: '已调整备用供应商。' }],
                    },
                    provenance: {
                        liveBusiness: { kind: 'live_business' },
                        confirmedKnowledge: { kind: 'human_confirmed', draftsExcluded: true },
                    },
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'get_order_knowledge_package',
        { orderId: 12 },
        { allowWrite: false }
    );

    assert.equal(result.success, true);
    assert.equal(result.intent, 'order_knowledge_package');
    assert.equal(result.data.readiness.verdict, 'waiting_materials');
    assert.equal(result.data.confirmedKnowledge.executionRecords.length, 1);
    assert.equal(result.data.provenance.confirmedKnowledge.draftsExcluded, true);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/orders/12/knowledge-package',
    ]);
});

test('AI executor 行为：订单准备总览通过只读标准 API 返回全部活动订单结论', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/readiness-overview') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    summary: '共检查 2 个活动订单。',
                    metrics: {
                        totalActiveOrders: 2,
                        ready: 1,
                        waitingMaterials: 1,
                        needsReview: 0,
                        blocked: 0,
                        attentionRequired: 1,
                    },
                    items: [
                        { order: { id: 12 }, verdict: 'waiting_materials' },
                        { order: { id: 13 }, verdict: 'ready' },
                    ],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_order_readiness_overview', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'order_readiness_overview');
    assert.equal(result.data.metrics.attentionRequired, 1);
    assert.equal(result.data.items.length, 2);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/orders/readiness-overview',
    ]);
});

test('AI executor 行为：采购总览通过只读标准 API 返回当前采购事实', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/purchase-overview') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    summary: {
                        activeOrderCount: 2,
                        taskCount: 3,
                        pendingTaskCount: 1,
                    },
                    tasks: [{
                        supplier: '供应商A',
                        model: '油封A',
                        plannedQty: 10,
                        orderedQty: 4,
                        pendingQty: 6,
                    }],
                    returnedCount: 1,
                    truncated: false,
                    filters: { supplier: '', pendingOnly: false, limit: null },
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_purchase_overview', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data.summary.pendingTaskCount, 1);
    assert.equal(result.data.tasks[0].pendingQty, 6);
    assert.deepEqual(result.queryReceipt.appliedFilters, { pendingOnly: false });
    assert.equal(result.queryReceipt.totalCount, 3);
    assert.equal(result.queryReceipt.returnedCount, 1);
    assert.equal(result.queryReceipt.authoritative, true);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/orders/purchase-overview',
    ]);
});

test('AI executor 行为：统一管理待办通过只读标准 API 返回实时优先级', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/workbench/action-center') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    summary: '当前有 2 项管理待办。',
                    metrics: {
                        total: 2,
                        critical: 1,
                        high: 1,
                        medium: 0,
                        low: 0,
                    },
                    items: [
                        { id: 'order-readiness:12', priority: 'critical', title: '订单 #12 数据阻塞' },
                        { id: 'business-risk:quotation:5', priority: 'high', title: '报价 #5 低于成本' },
                    ],
                    executionQueue: {
                        summary: '当前最先处理：订单 #12 数据阻塞。',
                        items: [{
                            id: 'order-readiness:12',
                            resolution: {
                                mode: 'navigate',
                                title: '修正订单产品与BOM',
                            },
                        }],
                    },
                    progress: {
                        summary: '最近 24 小时自动归档 1 项；当前仍待处理 2 项；1 项曾反复出现。',
                        resolvedCount: 1,
                        unresolvedCount: 2,
                        blockedCount: 0,
                        recurringCount: 1,
                    },
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_management_action_center', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'management_action_center');
    assert.equal(result.data.metrics.critical, 1);
    assert.equal(
        result.summary,
        '最近 24 小时自动归档 1 项；当前仍待处理 2 项；1 项曾反复出现。 当前最先处理：订单 #12 数据阻塞。'
    );
    assert.equal(result.data.executionQueue.items[0].resolution.mode, 'navigate');
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/workbench/action-center',
    ]);
});

test('AI executor 行为：V8 工厂执行计划通过只读工作台 API 生成', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/workbench/execution-plan') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                workflowType: 'quotation_to_order',
                goal: '转单后检查生产准备',
                quotationId: 5,
            });
            return jsonResponse({
                success: true,
                data: {
                    workflowType: 'quotation_to_order',
                    generatedAt: '2026-07-29T00:00:00.000Z',
                    status: 'needs_input',
                    summary: '报价 #5 需先确认客户是否接受，再进入转单。',
                    metrics: { totalSteps: 4, executableSteps: 0 },
                    steps: [],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('plan_factory_workflow', {
        workflowType: 'quotation_to_order',
        goal: '转单后检查生产准备',
        quotationId: 5,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'factory_execution_plan');
    assert.equal(result.data.status, 'needs_input');
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/workbench/execution-plan',
    ]);
});

test('AI executor 行为：V8.2 跨模块执行步骤未确认时只返回确认卡片', async () => {
    const calls = installFetchStub(() => jsonResponse({ success: false, error: '不应调用 API' }, 500));
    const args = {
        workflowType: 'quotation_to_order',
        quotationId: 5,
        actionId: 'convert_quotation',
    };

    const result = await executeToolCall('execute_factory_workflow_step', args, { allowWrite: false });

    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.toolName, 'execute_factory_workflow_step');
    assert.equal(result.confirmation.args.quotationId, 5);
    assert.equal(result.confirmation.rows.some(item => item.label === '工作流' && item.value === '报价转订单'), true);
    assert.equal(calls.length, 0);
});

test('AI executor 行为：V8.2 确认后重验计划、事务转单并检查新订单', async () => {
    let planReads = 0;
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/workbench/execution-plan') && call.method === 'POST') {
            planReads += 1;
            assert.deepEqual(call.body, {
                workflowType: 'quotation_to_order',
                quotationId: 5,
                goal: '将报价 #5 转为订单并检查生产准备',
            });
            if (planReads === 1) {
                return jsonResponse({
                    success: true,
                    data: {
                        status: 'ready',
                        steps: [{
                            id: 'convert_quotation',
                            mode: 'confirmable',
                            status: 'available',
                            canExecute: true,
                            confirmation: {
                                toolName: 'execute_factory_workflow_step',
                                args: {
                                    workflowType: 'quotation_to_order',
                                    quotationId: 5,
                                    actionId: 'convert_quotation',
                                },
                            },
                        }],
                    },
                });
            }
            return jsonResponse({
                success: true,
                data: {
                    status: 'complete',
                    summary: '报价 #5 已转为订单 #21，不会重复转单。',
                    steps: [{ id: 'quotation_already_converted', status: 'complete' }],
                },
            });
        }
        if (call.url.endsWith('/api/quotations/5/order-draft') && call.method === 'POST') {
            return jsonResponse({
                success: true,
                data: {
                    customerName: '测试客户',
                    items: [{ id: 'item-1' }],
                    expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
                    previewHash: 'a'.repeat(64),
                },
            });
        }
        if (call.url.endsWith('/api/quotations/5/convert') && call.method === 'POST') {
            assert.equal(call.body.expectedUpdatedAt, '2026-08-02T00:00:00.000Z');
            assert.equal(call.body.previewHash, 'a'.repeat(64));
            return jsonResponse({
                success: true,
                data: commandData('workflow.quotation.convert_to_order', {
                    quotation: { id: 5, status: '已转订单', convertedOrderId: 21 },
                    order: { id: 21, customerName: '测试客户', status: '待采购' },
                }),
            }, 201);
        }
        if (call.url.endsWith('/api/orders/21/readiness-plan') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    order: { id: 21, customerName: '测试客户', status: '待采购' },
                    planStatus: 'waiting',
                    summary: '订单 #21 等待采购到货。',
                    steps: [{ id: 'track_purchase_arrival', status: 'waiting', mode: 'monitor' }],
                },
            });
        }
        if (call.url.endsWith('/api/workbench/execution-runs') && call.method === 'POST') {
            assert.equal(call.body.status, 'completed');
            assert.equal(call.body.actionId, 'convert_quotation');
            assert.equal(call.body.result.orderId, 21);
            return jsonResponse({
                success: true,
                data: commandData('workbench.execution_runs.record', {
                    id: 31,
                    status: 'completed',
                    attemptNumber: 1,
                    actionId: 'convert_quotation',
                    outcomeSummary: '报价 #5 已转为订单 #21',
                }),
            }, 201);
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('execute_factory_workflow_step', {
        workflowType: 'quotation_to_order',
        quotationId: 5,
        actionId: 'convert_quotation',
    }, { allowWrite: true });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'factory_workflow_action');
    assert.equal(result.data.order.id, 21);
    assert.equal(result.data.nextPlan.planStatus, 'waiting');
    assert.equal(result.data.workflowPlan.status, 'complete');
    assert.equal(result.data.executionRun.id, 31);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/workbench/execution-plan',
        'POST /api/quotations/5/order-draft',
        'POST /api/quotations/5/convert',
        'GET /api/orders/21/readiness-plan',
        'POST /api/workbench/execution-plan',
        'POST /api/workbench/execution-runs',
    ]);
});

test('AI executor 行为：V8.2 计划过期时停止且不调用转单接口', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/workbench/execution-plan') && call.method === 'POST') {
            return jsonResponse({
                success: true,
                data: {
                    status: 'needs_input',
                    steps: [{
                        id: 'convert_quotation',
                        mode: 'confirmable',
                        status: 'blocked',
                        canExecute: false,
                        confirmation: null,
                    }],
                },
            });
        }
        if (call.url.endsWith('/api/workbench/execution-runs') && call.method === 'POST') {
            assert.equal(call.body.status, 'failed');
            assert.match(call.body.error, /已不可执行/);
            return jsonResponse({
                success: true,
                data: {
                    id: 32,
                    status: 'failed',
                    attemptNumber: 1,
                    actionId: 'convert_quotation',
                    errorText: call.body.error,
                },
            }, 201);
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('execute_factory_workflow_step', {
        workflowType: 'quotation_to_order',
        quotationId: 5,
        actionId: 'convert_quotation',
    }, { allowWrite: true });

    assert.equal(result.success, false);
    assert.match(result.error, /已不可执行/);
    assert.equal(result.data.executionRun.id, 32);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/workbench/execution-plan',
        'POST /api/workbench/execution-runs',
    ]);
});

test('AI executor 行为：客户名匹配多个订单时要求明确而不猜测', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/lookup?query=%E6%B5%8B%E8%AF%95%E5%AE%A2%E6%88%B7') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 12, customerName: '测试客户', contractNo: 'A', status: '采购中' },
                    { id: 13, customerName: '测试客户', contractNo: 'B', status: '待采购' },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('check_order_readiness', { orderQuery: '测试客户' }, { allowWrite: false });
    const detailResult = await executeToolCall('get_order_detail', { orderQuery: '测试客户' }, { allowWrite: false });

    assert.equal(result.success, false);
    assert.match(result.error, /匹配到 2 个订单/);
    assert.deepEqual(result.candidates.map(item => item.id), [12, 13]);
    assert.equal(detailResult.success, false);
    assert.match(detailResult.error, /匹配到 2 个订单/);
    assert.deepEqual(detailResult.candidates.map(item => item.id), [12, 13]);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(call => /\/api\/orders\/(12|13)$/.test(call.url)), false);
});

test('AI executor 行为：订单问题处理方案通过只读标准 API 生成', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/orders/12/readiness-plan') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    order: { id: 12, customerName: '测试客户', status: '待确认' },
                    readinessVerdict: 'blocked',
                    planStatus: 'ready_for_confirmation',
                    summary: '订单 #12 生成 1 个处理步骤。',
                    metrics: { totalSteps: 1, confirmableSteps: 1, manualSteps: 0, waitingSteps: 0 },
                    steps: [{
                        id: 'confirm_order',
                        sequence: 1,
                        mode: 'confirmable',
                        status: 'available',
                        toolCall: { name: 'update_order_status', args: { orderId: 12, status: '待采购' } },
                    }],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('plan_order_readiness_actions', { orderId: 12 }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'order_readiness_plan');
    assert.equal(result.data.planStatus, 'ready_for_confirmation');
    assert.equal(result.data.steps[0].mode, 'confirmable');
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/orders/12/readiness-plan',
    ]);
});

test('AI executor 行为：订单方案步骤未确认时只返回确认卡片', async () => {
    const calls = installFetchStub(() => jsonResponse({ success: false, error: '不应调用 API' }, 500));

    const result = await executeToolCall('execute_order_readiness_action', {
        orderId: 12,
        actionId: 'confirm_order',
    }, { allowWrite: false });

    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.toolName, 'execute_order_readiness_action');
    assert.equal(result.confirmation.args.actionId, 'confirm_order');
    assert.equal(result.confirmation.rows.some(item => item.label === '处理步骤'), true);
    assert.equal(calls.length, 0);
});

test('AI executor 行为：确认后通过实时重验 API 执行方案步骤', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/workbench/execution-plan') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                workflowType: 'order_readiness',
                orderId: 12,
                goal: '处理订单 #12 的生产准备问题',
            });
            return jsonResponse({
                success: true,
                data: {
                    workflowType: 'order_readiness',
                    status: 'ready',
                    subject: { type: 'order', id: 12 },
                    steps: [{
                        id: 'confirm_order',
                        mode: 'confirmable',
                        status: 'available',
                        canExecute: true,
                    }],
                },
            });
        }
        if (call.url.endsWith('/api/orders/12/readiness-plan') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    actions: {
                        confirm_order: {
                            expectedUpdatedAt: '2026-08-03T01:02:03.000Z',
                            previewHash: 'a'.repeat(64),
                            suggestedIdempotencyKey: 'order-readiness:12:confirm:test-1234',
                        },
                    },
                    steps: [],
                },
            });
        }
        if (call.url.endsWith('/api/orders/12/readiness-actions/confirm_order') && call.method === 'POST') {
            assert.deepEqual(call.body, {
                expectedUpdatedAt: '2026-08-03T01:02:03.000Z',
                previewHash: 'a'.repeat(64),
                idempotencyKey: 'order-readiness:12:confirm:test-1234',
            });
            return jsonResponse({
                success: true,
                data: commandData('orders.execute_readiness_action', {
                    action: { id: 'confirm_order', title: '确认订单进入采购' },
                    order: { id: 12, status: '待采购' },
                    nextPlan: {
                        order: { id: 12, status: '待采购' },
                        planStatus: 'action_required',
                        steps: [{ id: 'place_purchase_orders', mode: 'manual', status: 'available' }],
                    },
                }),
            });
        }
        if (call.url.endsWith('/api/workbench/execution-runs') && call.method === 'POST') {
            assert.equal(call.body.status, 'completed');
            assert.equal(call.body.actionId, 'confirm_order');
            assert.equal(call.body.result.orderStatus, '待采购');
            return jsonResponse({
                success: true,
                data: commandData('workbench.execution_runs.record', {
                    id: 33,
                    status: 'completed',
                    attemptNumber: 1,
                    actionId: 'confirm_order',
                }),
            }, 201);
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('execute_order_readiness_action', {
        orderId: 12,
        actionId: 'confirm_order',
    }, { allowWrite: true });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'order_readiness_action');
    assert.equal(result.data.action.id, 'confirm_order');
    assert.equal(result.data.order.status, '待采购');
    assert.equal(result.data.executionRun.id, 33);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/workbench/execution-plan',
        'GET /api/orders/12/readiness-plan',
        'POST /api/orders/12/readiness-actions/confirm_order',
        'POST /api/workbench/execution-runs',
    ]);
});

test('AI executor 行为：转子出图未确认时只返回确认卡片且不调用 API', async () => {
    const calls = installFetchStub((call) => {
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall(
        'generate_rotor_drawing',
        { shell_model: 'V750', piece_count: 160 },
        { allowWrite: false }
    );

    assert.equal(result.success, true);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.capabilityId, 'ai.generate_rotor_drawing');
    assert.equal(result.confirmation.riskLevel, 'high');
    assert.equal(result.confirmation.toolName, 'generate_rotor_drawing');
    assert.deepEqual(calls, []);
});

test('AI executor 行为：确认转子出图后通过模板草稿 API 补全参数', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/templates') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 3, shellModel: 'V750' }] });
        }
        if (call.url.endsWith('/api/rotor/template-draft') && call.method === 'POST') {
            assert.deepEqual(call.body, { templateId: 3 });
            return jsonResponse({
                success: true,
                data: {
                    patch: { upper_bearing: '6202', lower_bearing: '6203', bearing_span: '140' },
                    hints: ['上轴承6202'],
                    openOffset: 15,
                },
            });
        }
        if (call.url.endsWith('/api/rotor/draw-preview') && call.method === 'POST') {
            assert.equal(call.body.shell_model, undefined);
            assert.equal(call.body.upper_bearing, '6202');
            assert.equal(call.body.piece_count, 160);
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'formal-confirmation-token',
                    suggestedIdempotencyKey: 'rotor-draw:operation-1',
                },
            });
        }
        if (call.url.endsWith('/api/rotor/draw') && call.method === 'POST') {
            assert.equal(call.body.confirmationToken, 'formal-confirmation-token');
            assert.equal(call.body.idempotencyKey, 'rotor-draw:operation-1');
            return jsonResponse({
                success: true,
                data: commandData('drawings.rotor.generate_pdf', {
                    jobStatus: 'success',
                    jobId: 'job-1',
                    params: { piece_count: 160 },
                }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('generate_rotor_drawing', { shell_model: 'V750', piece_count: 160 }, { allowWrite: true });

    assert.equal(result.success, true);
    assert.equal(result.jobId, 'job-1');
    assert.equal(result.templateInfo.openOffset, 15);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/templates',
        'POST /api/rotor/template-draft',
        'POST /api/rotor/draw-preview',
        'POST /api/rotor/draw',
    ]);
});

test('AI executor 行为：配方对比按零件聚合数量和金额差额', async () => {
    let costCall = 0;
    installFetchStub((call) => {
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    {
                        id: 1,
                        name: 'A配方',
                        spec: 'A',
                        partsJson: JSON.stringify([
                            { model: '线圈转子', name: '线圈转子', qty: 1 },
                            { model: '线圈转子', name: '线圈转子', qty: 1 },
                            { model: '6202', name: '轴承', qty: 1 },
                        ]),
                    },
                    {
                        id: 2,
                        name: 'B配方',
                        spec: 'B',
                        partsJson: JSON.stringify([
                            { model: '线圈转子', name: '线圈转子', qty: 1 },
                            { model: '6203', name: '轴承', qty: 2 },
                        ]),
                    },
                ],
            });
        }
        if (call.url.endsWith('/api/cost/parts') && call.method === 'POST') {
            costCall += 1;
            if (costCall === 1) {
                return jsonResponse({
                    success: true,
                    data: {
                        totalCost: '23.00',
                        details: [
                            { model: '线圈转子', name: '线圈转子', qty: 1, price: '10.00', subtotal: '10.00' },
                            { model: '线圈转子', name: '线圈转子', qty: 1, price: '10.00', subtotal: '10.00' },
                            { model: '6202', name: '轴承', qty: 1, price: '3.00', subtotal: '3.00' },
                        ],
                    },
                });
            }
            return jsonResponse({
                success: true,
                data: {
                    totalCost: '16.00',
                    details: [
                        { model: '线圈转子', name: '线圈转子', qty: 1, price: '10.00', subtotal: '10.00' },
                        { model: '6203', name: '轴承', qty: 2, price: '3.00', subtotal: '6.00' },
                    ],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('compare_recipes', { recipe1: 'A配方', recipe2: 'B配方' }, { allowWrite: false });

    assert.equal(result.success, true);
    const coilRows = result.comparison.filter(row => row.model === '线圈转子');
    assert.equal(coilRows.length, 1);
    assert.deepEqual(coilRows[0], {
        key: 'name:线圈转子',
        model: '线圈转子',
        name: '线圈转子',
        model1: '线圈转子',
        model2: '线圈转子',
        qty1: 2,
        amount1: 20,
        qty2: 1,
        amount2: 10,
        diff: 10,
        difference: '数量不同',
        onlyIn: '两者共有',
    });
    const bearingRows = result.comparison.filter(row => row.name === '轴承');
    assert.equal(bearingRows.length, 1);
    assert.deepEqual(bearingRows[0], {
        key: 'name:轴承',
        model: '轴承',
        name: '轴承',
        model1: '6202',
        model2: '6203',
        qty1: 1,
        amount1: 3,
        qty2: 2,
        amount2: 6,
        diff: -3,
        difference: '型号不同',
        onlyIn: '两者共有',
    });
});

test('AI executor 行为：报价草稿工具复用客户、配方、成本预览和报价草稿 API 且不写库', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/customers') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 3, name: '张三', defaultMargin: 1.2 }] });
        }
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 5, name: 'V750 12-140', spec: '12-140', savedTotalCost: 90 }] });
        }
        if (call.url.endsWith('/api/recipes/5/cost-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, { overrides: { customBarrelLength: 170, hasFloat: true } });
            return jsonResponse({ success: true, data: { unitCost: 92 } });
        }
        if (call.url.endsWith('/api/quotations/save-payload-draft') && call.method === 'POST') {
            assert.equal(call.body.customerId, 3);
            assert.equal(call.body.items[0].baseRecipeId, 5);
            assert.equal(call.body.items[0].unitCost, 92);
            assert.equal(call.body.items[0].margin, 1.15);
            return jsonResponse({
                success: true,
                data: {
                    customerId: 3,
                    itemsJson: JSON.stringify(call.body.items),
                    totalCost: 184,
                    totalPrice: 211.6,
                    status: '报价中',
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('build_quotation_draft', {
        customerName: '张三',
        items: [
            {
                recipeName: 'V750',
                qty: 2,
                margin: 1.15,
                overrides: { customBarrelLength: 170, hasFloat: true },
            },
        ],
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'quotation_draft');
    assert.match(result.summary, /报价草稿/);
    assert.equal(result.data.draft.totalCost, 184);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/customers',
        'GET /api/recipes',
        'POST /api/recipes/5/cost-preview',
        'POST /api/quotations/save-payload-draft',
    ]);
});

test('AI executor 行为：报价文件识别只调用统一文件草稿接口且保持只读', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/files/12/quotation-draft') && call.method === 'POST') {
            assert.deepEqual(call.body, { customerName: '菲律宾客户' });
            return jsonResponse({
                success: true,
                data: {
                    summary: {
                        totalItems: 2,
                        exactMatchedItems: 1,
                        unmatchedItems: 1,
                        readyForSaveDraft: false,
                    },
                    items: [
                        { source: { rowNumber: 4, model: 'V750' }, recipeMatch: { status: 'matched' } },
                        { source: { rowNumber: 5, model: 'UNKNOWN' }, recipeMatch: { status: 'unmatched' } },
                    ],
                    quotationDraftInput: null,
                    boundary: '只读解析和映射草稿；未创建或修改客户、配方、报价。',
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('inspect_quotation_file', {
        fileId: 12,
        customerName: '菲律宾客户',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'quotation_file_draft');
    assert.match(result.summary, /待确认/);
    assert.equal(result.data.quotationDraftInput, null);
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/files/12/quotation-draft',
    ]);
});

test('AI executor 行为：客户默认利润率小数转换为报价倍率', async () => {
    installFetchStub((call) => {
        if (call.url.endsWith('/api/customers') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 3, name: '张三', defaultMargin: 0.2 }] });
        }
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 5, name: 'V750', spec: '12-140', savedTotalCost: 100 }] });
        }
        if (call.url.endsWith('/api/quotations/save-payload-draft') && call.method === 'POST') {
            assert.equal(call.body.items[0].margin, 1.2);
            return jsonResponse({
                success: true,
                data: {
                    customerId: 3,
                    itemsJson: JSON.stringify(call.body.items),
                    totalCost: 100,
                    totalPrice: 120,
                    status: '报价中',
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('build_quotation_draft', {
        customerName: '张三',
        items: [{ recipeName: 'V750', qty: 1 }],
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data.items[0].margin, 1.2);
});

test('AI executor 行为：泵壳机筒长度成本试算复用 BOM 草稿 API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/templates') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 3, shellModel: 'V750', description: '不锈钢泵壳' }] });
        }
        if (call.url.endsWith('/api/recipes/bom-draft') && call.method === 'POST') {
            assert.deepEqual(call.body, { templateId: 3, customBarrelLength: 180 });
            return jsonResponse({
                success: true,
                data: {
                    shellPrice: 93,
                    customBarrelLength: 180,
                    parts: [
                        {
                            model: 'V750',
                            name: '泵壳套件',
                            snapshotPrice: 93,
                            baseSnapshotPrice: 90,
                            barrelLength: 180,
                            barrelExtraCost: 3,
                            dynamicRule: 'stainlessShellBundleByBarrelLength',
                            formula: '泵壳套件基准价 90 + 机筒长度加价 3（150mm 起，每 10mm +1）',
                            source: 'pump_shell_template',
                        },
                    ],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('preview_pump_shell_cost', {
        shellModel: 'V750',
        customBarrelLength: 180,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'pump_shell_cost_preview');
    assert.match(result.summary, /93\.00 元/);
    assert.equal(result.data.shellModel, 'V750');
    assert.equal(result.data.shellPrice, 93);
    assert.equal(result.data.baseShellPrice, 90);
    assert.equal(result.data.barrelExtraCost, 3);
    assert.match(result.data.formula, /150mm 起/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/templates',
        'POST /api/recipes/bom-draft',
    ]);
});

test('AI executor 行为：知识库搜索和详情通过标准 knowledge API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/knowledge?query=V750&entryType=recipe&limit=3') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 9, entryType: 'recipe', sourceTable: 'recipes', sourceId: '7', title: '配方：V750', summary: '保存成本 90', matchMode: 'vector', evidenceLevel: 'semantic_candidate', syncedAt: '2026-01-01' }] });
        }
        if (call.url.endsWith('/api/knowledge/9') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { id: 9, entryType: 'recipe', sourceTable: 'recipes', sourceId: '7', title: '配方：V750', content: 'BOM 明细', syncedAt: '2026-01-01' } });
        }
        if (call.url.endsWith('/api/knowledge/overview') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    generatedAt: '2026-01-03',
                    changes: [{ status: 'pending_update', sourceTable: 'recipes', sourceId: '7', title: '配方：V750', sourceUpdatedAt: '2026-01-02' }],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const search = await executeToolCall('search_factory_knowledge', { query: 'V750', entryType: 'recipe', limit: 3 }, { allowWrite: false });
    const detail = await executeToolCall('get_factory_knowledge_detail', { id: 9 }, { allowWrite: false });

    assert.equal(search.success, true);
    assert.equal(search.intent, 'factory_knowledge_search');
    assert.equal(search.data[0].id, 9);
    assert.equal(search.provenance.kind, 'knowledge_snapshot');
    assert.equal(search.retrievalGuidance.semanticCandidatesAreEvidence, false);
    assert.equal(search.retrievalGuidance.semanticCandidateCount, 1);
    assert.match(search.summary, /仅为语义候选/);
    assert.equal(search.provenance.hasPendingSources, true);
    assert.equal(search.sources[0].freshness, 'pending_update');
    assert.equal(search.sources[0].knowledgePath, '/dashboard?view=knowledge&entry=9');
    assert.equal(search.sources[0].sourcePath, '/recipes');
    assert.equal(detail.success, true);
    assert.equal(detail.data.content, 'BOM 明细');
    assert.equal(detail.sources[0].sourceUpdatedAt, '2026-01-02');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/knowledge?query=V750&entryType=recipe&limit=3',
        'GET /api/knowledge/overview',
        'GET /api/knowledge/9',
        'GET /api/knowledge/overview',
    ]);
});

test('AI executor 行为：已有文本证据时不把纯向量候选交给回答模型', async () => {
    installFetchStub((call) => {
        if (call.url.includes('/api/knowledge?query=') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    {
                        id: 130,
                        entryType: 'business_rule',
                        sourceTable: 'business_rules',
                        sourceId: 'cutting_shell_semantics',
                        title: '业务规则：切割泵壳与配件识别',
                        matchMode: 'hybrid',
                        evidenceLevel: 'text_match',
                    },
                    {
                        id: 114,
                        entryType: 'template',
                        sourceTable: 'pump_shell_templates',
                        sourceId: '6',
                        title: '泵壳模板：SPA 3 叶',
                        matchMode: 'vector',
                        evidenceLevel: 'semantic_candidate',
                    },
                ],
            });
        }
        if (call.url.endsWith('/api/knowledge/130') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    id: 130,
                    entryType: 'business_rule',
                    sourceTable: 'business_rules',
                    sourceId: 'cutting_shell_semantics',
                    title: '业务规则：切割泵壳与配件识别',
                    summary: '明确用于切割杂草的泵壳是 800平刀切割泵壳；切边6mm长螺丝是外六角螺丝。',
                    content: [
                        '“切边6mm长螺丝”属于外六角螺丝，不是刀片，也不是切割杂草的专用配件。',
                        '系统未明确记录其它切割专用配件。',
                        '现有来源没有明确记录是否随泵壳附带刀片。',
                    ],
                    metadata: { bladeInclusionStatus: 'unconfirmed' },
                },
            });
        }
        if (call.url.endsWith('/api/knowledge/overview') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { generatedAt: '2026-01-03', changes: [] } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_factory_knowledge', {
        query: '切割杂草用的泵壳是哪一个',
        limit: 10,
    }, { allowWrite: false });

    assert.deepEqual(result.data.map(item => item.title), ['业务规则：切割泵壳与配件识别']);
    assert.match(result.data[0].content.join('\n'), /没有明确记录是否随泵壳附带刀片/);
    assert.equal(result.data[0].metadata.bladeInclusionStatus, 'unconfirmed');
    assert.equal(result.retrievalGuidance.omittedSemanticCandidateCount, 1);
    assert.match(result.answerGuidance.requiredEvidencePolicy, /明确肯定项和明确否定项/);
    assert.match(result.answerGuidance.businessRuleStatements.join('\n'), /切边6mm长螺丝.*外六角螺丝/);
    assert.match(result.summary, /系统未明确记录其它切割专用配件/);
    assert.equal(result.sources.some(source => /SPA/.test(source.title)), false);
    assert.match(result.summary, /纯语义候选因已有文本证据而未提供/);
});

test('AI executor 行为：外部资料搜索返回原文件下载来源', async () => {
    const calls = installFetchStub((call) => {
        const url = new URL(call.url);
        if (
            url.pathname === '/api/knowledge'
            && url.searchParams.get('query') === '试验报告'
            && url.searchParams.get('entryType') === 'document'
            && url.searchParams.get('limit') === '3'
            && call.method === 'GET'
        ) {
            return jsonResponse({
                success: true,
                data: [{
                    id: 12,
                    entryType: 'document',
                    sourceTable: 'knowledge_documents',
                    sourceId: '4',
                    title: '资料：V750 试验报告',
                    summary: '实测性能数据',
                    metadata: {
                        parserStatus: 'parsed',
                        downloadPath: '/api/knowledge/documents/4/download',
                    },
                    syncedAt: '2026-01-01',
                }],
            });
        }
        if (call.url.endsWith('/api/knowledge/overview') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { generatedAt: '2026-01-03', changes: [] } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_factory_knowledge', {
        query: '试验报告',
        entryType: 'document',
        limit: 3,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data[0].entryType, 'document');
    assert.equal(result.sources[0].sourceTable, 'knowledge_documents');
    assert.equal(result.sources[0].sourcePath, '/api/knowledge/documents/4/download');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.replace(/^http:\/\/localhost:\d+/, ''), '/api/knowledge/overview');
});

test('AI executor 行为：知识库健康检查通过只读 health API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/knowledge/health') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    status: 'attention',
                    summary: '1 项知识同步状态需要关注',
                    pendingTotal: 2,
                    needsRecovery: true,
                    issues: [{
                        code: 'sync_failed',
                        severity: 'attention',
                        title: '自动同步失败',
                        message: 'database is locked',
                        action: 'manual_sync',
                    }],
                    latestRun: {
                        mode: 'automatic',
                        status: 'failed',
                        attempt: 1,
                    },
                    checkedAt: '2026-07-28T00:00:00.000Z',
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_factory_knowledge_health', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'factory_knowledge_health');
    assert.match(result.summary, /需要关注/);
    assert.match(result.summary, /待同步 2 条/);
    assert.equal(result.data.needsRecovery, true);
    assert.equal(result.data.issues[0].code, 'sync_failed');
    assert.equal(result.provenance.kind, 'live_business');
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/knowledge/health',
    ]);
});

test('AI executor 行为：配方智能检查通过只读质量 API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/quality/recipe-analysis') && call.method === 'POST') {
            assert.deepEqual(call.body, { recipeId: 9, limit: 5 });
            return jsonResponse({
                success: true,
                data: {
                    summary: {
                        definiteIssueCount: 1,
                        reviewSuggestionCount: 2,
                        priceAlertCount: 1,
                    },
                    similarRecipes: [{ id: 3, name: 'V750F', score: 0.82 }],
                    missingItems: [{ title: '已启用电缆，但 BOM 中没有成品电缆', confidence: 'high' }],
                    priceAlerts: [{ model: '202', currentPrice: 9, referenceMedian: 1.2 }],
                },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('analyze_recipe_configuration', {
        recipeId: 9,
        limit: 5,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'recipe_configuration_analysis');
    assert.match(result.summary, /确定问题 1 项/);
    assert.match(result.summary, /复核建议 2 项/);
    assert.match(result.summary, /价格提醒 1 项/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/quality/recipe-analysis',
    ]);
});

test('AI executor 行为：配方检查反馈必须确认后写入质量 API', async () => {
    const args = {
        recipeId: 9,
        findingKey: 'peer_pattern:包装:fixed',
        findingType: 'peer_pattern',
        decision: 'special_case',
        note: '客户不需要说明书',
    };
    const blocked = await executeToolCall('set_recipe_analysis_feedback', args, { allowWrite: false });
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.toolName, 'set_recipe_analysis_feedback');

    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/quality/recipes/9/feedback') && call.method === 'POST') {
            assert.equal(call.body.findingKey, 'peer_pattern:包装:fixed');
            assert.equal(call.body.decision, 'special_case');
            return jsonResponse({
                success: true,
                data: commandData('quality.recipe_feedback.save', {
                    id: 12,
                    ...call.body,
                    ruleLearning: { refreshed: true, stats: { active: 1 } },
                }),
            });
        }
        return jsonResponse({ success: false, error: 'unexpected call' }, 500);
    });
    const result = await executeToolCall('set_recipe_analysis_feedback', args, { allowWrite: true });
    assert.equal(result.success, true);
    assert.equal(result.intent, 'recipe_analysis_feedback');
    assert.match(result.summary, /候选业务规则已自动重新归纳/);
    assert.equal(calls.length, 1);
});

test('AI executor 行为：候选规则可只读查询，审核必须确认后调用 PATCH API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/quality/rule-learning-health?limit=20') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    summary: { affectedRecipeCount: 2, recheckEvidenceCount: 3 },
                    items: [{ feedbackId: 7, recipeId: 9, status: 'outdated' }],
                },
            });
        }
        if (call.url.endsWith('/api/quality/rule-candidates?status=candidate') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 5, title: 'V750：通常包含说明书' }] });
        }
        if (call.url.endsWith('/api/quality/rule-candidates/5/impact') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: { summary: { totalRecipes: 4, needsReviewCount: 1 } },
            });
        }
        if (call.url.endsWith('/api/quality/rule-compliance') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: { summary: { approvedRuleCount: 2, affectedRecipeCount: 3 } },
            });
        }
        if (call.url.endsWith('/api/quality/rule-events?candidateId=5&limit=10') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 8, candidateId: 5, eventType: 'approved' }],
            });
        }
        if (call.url.endsWith('/api/quality/rule-events/8/restore') && call.method === 'POST') {
            assert.deepEqual(call.body, { restoreNote: '恢复误驳前状态' });
            return jsonResponse({
                success: true,
                data: commandData('quality.rule_events.restore', {
                    candidate: { id: 5, status: 'approved' },
                    restoredFromEvent: { id: 8, eventType: 'approved' },
                    knowledgeSync: { action: 'inserted' },
                }),
            });
        }
        if (call.url.endsWith('/api/quality/rule-candidates/5') && call.method === 'PATCH') {
            assert.deepEqual(call.body, { status: 'approved', reviewNote: '确认' });
            return jsonResponse({
                success: true,
                data: commandData('quality.rule_candidates.review', {
                    id: 5,
                    status: 'approved',
                    knowledgeSync: { action: 'inserted' },
                }),
            });
        }
        return jsonResponse({ success: false, error: 'unexpected call' }, 500);
    });

    const health = await executeToolCall('get_factory_learning_health', { limit: 20 }, { allowWrite: false });
    assert.equal(health.success, true);
    assert.match(health.summary, /2 个配方/);
    assert.match(health.summary, /3 条学习反馈/);

    const listed = await executeToolCall('get_factory_rule_candidates', { status: 'candidate' }, { allowWrite: false });
    assert.equal(listed.success, true);
    assert.equal(listed.data[0].id, 5);

    const impact = await executeToolCall('get_factory_rule_impact', { candidateId: 5 }, { allowWrite: false });
    assert.equal(impact.success, true);
    assert.match(impact.summary, /4 个同模板配方/);

    const compliance = await executeToolCall('get_factory_rule_compliance', {}, { allowWrite: false });
    assert.equal(compliance.success, true);
    assert.match(compliance.summary, /2 条已批准规则/);
    assert.match(compliance.summary, /3 个配方需要复核/);

    const history = await executeToolCall(
        'get_factory_rule_history',
        { candidateId: 5, limit: 10 },
        { allowWrite: false }
    );
    assert.equal(history.success, true);
    assert.match(history.summary, /1 条规则变更记录/);
    assert.equal(history.data[0].eventType, 'approved');

    const restoreArgs = { eventId: 8, restoreNote: '恢复误驳前状态' };
    const restoreBlocked = await executeToolCall('restore_factory_rule_event', restoreArgs, { allowWrite: false });
    assert.equal(restoreBlocked.requiresConfirmation, true);
    const restored = await executeToolCall('restore_factory_rule_event', restoreArgs, { allowWrite: true });
    assert.equal(restored.success, true);
    assert.equal(restored.data.candidate.status, 'approved');
    assert.match(restored.summary, /当前学习证据保持不变/);

    const args = { candidateId: 5, status: 'approved', reviewNote: '确认' };
    const blocked = await executeToolCall('review_factory_rule_candidate', args, { allowWrite: false });
    assert.equal(blocked.requiresConfirmation, true);
    const approved = await executeToolCall('review_factory_rule_candidate', args, { allowWrite: true });
    assert.equal(approved.success, true);
    assert.equal(approved.data.status, 'approved');
    assert.match(approved.summary, /规则知识已自动更新/);
    assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'GET', 'GET', 'GET', 'POST', 'PATCH']);
});

test('AI executor 行为：精确线圈知识查询返回全部材质槽眼详情', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/knowledge?query=12-220&entryType=coil&limit=10') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 6, title: '线圈：12-220 钢带 小眼' },
                    { id: 9, title: '线圈：12-220 冷轧 国标眼' },
                ],
            });
        }
        if (call.url.endsWith('/api/knowledge/6') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { id: 6, title: '线圈：12-220 钢带 小眼', content: '默认搭配电缆线径：1.2' } });
        }
        if (call.url.endsWith('/api/knowledge/9') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { id: 9, title: '线圈：12-220 冷轧 国标眼', content: '默认搭配电缆线径：2' } });
        }
        if (call.url.endsWith('/api/knowledge/overview') && call.method === 'GET') {
            return jsonResponse({ success: true, data: { generatedAt: '2026-01-03', changes: [] } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_factory_knowledge', {
        query: '12-220',
        entryType: 'coil',
        limit: 10,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);
    assert.match(result.data[0].content, /默认搭配电缆线径/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/knowledge?query=12-220&entryType=coil&limit=10',
        'GET /api/knowledge/6',
        'GET /api/knowledge/9',
        'GET /api/knowledge/overview',
    ]);
});

test('AI executor 行为：未指定材质槽眼时返回 12-220 全部正式方案', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 6, spec: '12', diameterMm: 120, sheets: 220, material: '钢带', slotType: '小眼', schemeStatus: 'official', defaultWireGauge: '1.2' },
                    { id: 9, spec: '12', diameterMm: 120, sheets: 220, material: '冷轧', slotType: '国标眼', schemeStatus: 'official', defaultWireGauge: '2' },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('calculate_coil_cost', { spec: '12', sheets: 220 }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.intent, 'coil_variant_choices');
    assert.equal(result.data.requiresVariantSelection, true);
    assert.deepEqual(result.data.variants.map(item => `${item.material}/${item.slotType}/${item.pairedCableWireGauge}`), [
        '钢带/小眼/1.2',
        '冷轧/国标眼/2',
    ]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/coils',
    ]);
});

test('AI executor 行为：线圈库存查询只返回正式 API 的实时匹配方案', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils?spec=150&sheets=96') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 6, spec: '150', sheets: 96, material: '钢带', slotType: '小眼', stock: 33, unitPrice: 18.5, cost: 29.6, updatedAt: '2026-08-07T00:00:00.000Z' },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_coils', {
        spec: '150',
        sheets: 96,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(result.data[0].stock, 33);
    assert.equal(result.data[0].cost, 29.6);
    assert.equal(result.sources[0].sourceTable, 'coils');
    assert.equal(result.sources[0].sourceId, 6);
    assert.deepEqual(result.filters, {
        spec: '150',
        sheets: 96,
        material: '',
        slotType: '',
    });
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/coils?spec=150&sheets=96',
    ]);
});

test('AI executor 行为：线圈俗称-片数简写自动拆分后再查询', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/coils?spec=12&sheets=120') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [
                    { id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', stock: 0, unitPrice: 0.21, cost: 98.90181 },
                ],
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_coils', {
        spec: '12-120',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(result.data[0].cost, 98.90181);
    assert.deepEqual(result.filters, { spec: '12', sheets: 120, material: '', slotType: '' });
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/coils?spec=12&sheets=120',
    ]);
});

test('AI executor 行为：线圈简称拆分不覆盖显式传入的片数', async () => {
    installFetchStub((call) => {
        if (call.url.endsWith('/api/coils?spec=12-120&sheets=96') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [] });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('search_coils', {
        spec: '12-120',
        sheets: 96,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.deepEqual(result.filters, { spec: '12-120', sheets: 96, material: '', slotType: '' });
});

test('AI executor 行为：配方明细与当前成本分别取自正式配方和成本预览 API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 5, name: 'TEST-PUMP-750A', spec: '750A' }],
            });
        }
        if (call.url.endsWith('/api/recipes/5') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: {
                    id: 5,
                    name: 'TEST-PUMP-750A',
                    spec: '750A',
                    partsJson: JSON.stringify([
                        { model: 'TEST-机筒-1100', quantity: 1 },
                        { model: 'TEST-电容-20', quantity: 1 },
                    ]),
                    savedTotalCost: 438.8,
                },
            });
        }
        if (call.url.endsWith('/api/recipes/5/cost-preview') && call.method === 'POST') {
            assert.deepEqual(call.body, { overrides: {} });
            return jsonResponse({
                success: true,
                data: { unitCost: 451.2, parts: [{ model: 'TEST-机筒-1100', quantity: 1 }] },
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_recipe_detail', {
        recipeName: 'TEST-PUMP-750A',
        includeCurrentCost: true,
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.recipe.partCount, 2);
    assert.equal(result.recipe.parts[0].model, 'TEST-机筒-1100');
    assert.equal(result.currentCost.unitCost, 451.2);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/recipes',
        'GET /api/recipes/5',
        'POST /api/recipes/5/cost-preview',
    ]);
});

test('AI executor 行为：配方成本试算可用大小写不敏感简称唯一定位正式配方', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/recipes') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 2, name: 'v750-tokoy', spec: '12-140' }],
            });
        }
        if (call.url.endsWith('/api/recipes/2/cost-preview') && call.method === 'POST') {
            return jsonResponse({ success: true, data: { unitCost: 286.51, parts: [] } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('preview_recipe_cost', {
        recipeName: 'V750',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data.recipeId, 2);
    assert.equal(result.data.recipeName, 'v750-tokoy');
    assert.equal(result.data.unitCost, 286.51);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/recipes',
        'POST /api/recipes/2/cost-preview',
    ]);
});

test('AI executor 行为：知识库同步未确认时返回确认卡片，确认后调用同步 API', async () => {
    const blockedCalls = installFetchStub(() => jsonResponse({ success: false, error: '不应调用' }, 500));
    const blocked = await executeToolCall('sync_factory_knowledge', {}, { allowWrite: false });
    assert.equal(blocked.success, true);
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.toolName, 'sync_factory_knowledge');
    assert.equal(blockedCalls.length, 0);

    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/knowledge/sync-preview') && call.method === 'POST') {
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'knowledge-confirmation-token',
                    suggestedIdempotencyKey: 'knowledge-sync:operation-1',
                },
            });
        }
        if (call.url.endsWith('/api/knowledge/sync') && call.method === 'POST') {
            assert.equal(call.body.confirmationToken, 'knowledge-confirmation-token');
            assert.equal(call.body.idempotencyKey, 'knowledge-sync:operation-1');
            return jsonResponse({
                success: true,
                data: commandData('knowledge.sync_derived', {
                    ftsEnabled: true,
                    stats: { inserted: 8, byType: { part: 2 } },
                }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const confirmed = await executeToolCall('sync_factory_knowledge', {}, { allowWrite: true });

    assert.equal(confirmed.success, true);
    assert.equal(confirmed.intent, 'factory_knowledge_sync');
    assert.match(confirmed.summary, /已同步 8 条/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/knowledge/sync-preview',
        'POST /api/knowledge/sync',
    ]);
});

test('AI executor 行为：文件归档先查真实目标且写入必须确认', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/files/archive-targets?targetType=recipe&query=V1600&limit=10') && call.method === 'GET') {
            return jsonResponse({
                success: true,
                data: [{ id: 18, targetType: 'recipe', label: 'V1600-12-180', detail: '60Hz' }],
            });
        }
        if (call.url.endsWith('/api/files/41/archive-preview') && call.method === 'POST') {
            assert.equal(call.body.targetType, 'recipe');
            assert.equal(call.body.targetId, 18);
            assert.equal(call.body.note, '客户确认参数');
            assert.equal(call.body.source, 'ai_chat');
            return jsonResponse({
                success: true,
                data: {
                    confirmationToken: 'file-confirmation-token',
                    suggestedIdempotencyKey: 'file-archive:operation-1',
                },
            });
        }
        if (call.url.endsWith('/api/files/41/archive') && call.method === 'POST') {
            assert.equal(call.body.confirmationToken, 'file-confirmation-token');
            assert.equal(call.body.idempotencyKey, 'file-archive:operation-1');
            return jsonResponse({
                success: true,
                data: commandData('files.archive', {
                    link: {
                        id: 3,
                        fileId: 41,
                        targetType: 'recipe',
                        targetId: 18,
                        target: { id: 18, label: 'V1600-12-180' },
                    },
                    knowledgeDocument: null,
                    deduplicated: false,
                }),
            });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const targets = await executeToolCall('search_factory_file_archive_targets', {
        targetType: 'recipe',
        query: 'V1600',
        limit: 10,
    }, { allowWrite: false });
    assert.equal(targets.success, true);
    assert.equal(targets.data[0].id, 18);
    assert.equal(targets.provenance.kind, 'live_business');

    const archiveArgs = {
        fileId: 41,
        targetType: 'recipe',
        targetId: 18,
        note: '客户确认参数',
    };
    const blocked = await executeToolCall('archive_factory_file', archiveArgs, { allowWrite: false });
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.title, '归档工厂文件');
    assert.equal(calls.length, 1);

    const archived = await executeToolCall('archive_factory_file', archiveArgs, { allowWrite: true });
    assert.equal(archived.success, true);
    assert.match(archived.summary, /V1600-12-180/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/files/archive-targets?targetType=recipe&query=V1600&limit=10',
        'POST /api/files/41/archive-preview',
        'POST /api/files/41/archive',
    ]);
});

test('V10.2 AI executor：客户要求只能保存草稿且必须先确认', async () => {
    const calls = installFetchStub((call) => {
        assert.equal(call.method, 'PUT');
        assert.match(call.url, /\/api\/orders\/27\/requirements\/draft$/);
        assert.equal(call.body.summaryText, '客户明确要求：线圈规格 12x180mm。');
        assert.deepEqual(call.body.sourceFileIds, [41]);
        return jsonResponse({
            success: true,
            data: commandData('orders.requirements.save_draft', {
                orderId: 27,
                draftText: call.body.summaryText,
                sourceFileIds: call.body.sourceFileIds,
                knowledgeStatus: 'not_confirmed',
            }),
        });
    });
    const args = {
        orderId: 27,
        summaryText: '客户明确要求：线圈规格 12x180mm。',
        sourceFileIds: [41],
    };

    const blocked = await executeToolCall('save_order_requirement_draft', args, { allowWrite: false });
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.title, '保存客户要求草稿');
    assert.match(blocked.confirmation.warning, /确认/);
    assert.equal(calls.length, 0);

    const saved = await executeToolCall('save_order_requirement_draft', args, { allowWrite: true });
    assert.equal(saved.success, true);
    assert.match(saved.message, /仍需在订单页面人工确认/);
    assert.equal(calls.length, 1);
});

test('V10.3 AI executor：订单执行事实只能新建草稿且必须先确认', async () => {
    const calls = installFetchStub((call) => {
        assert.equal(call.method, 'POST');
        assert.match(call.url, /\/api\/orders\/27\/execution-records$/);
        assert.equal(call.body.phase, 'in_production');
        assert.equal(call.body.recordType, 'supplier_adjustment');
        assert.match(call.body.summaryText, /备用供应商/);
        assert.deepEqual(call.body.sourceFileIds, [52]);
        return jsonResponse({
            success: true,
            data: commandData('orders.execution_records.create_draft', {
                id: 9,
                orderId: 27,
                phase: call.body.phase,
                recordType: call.body.recordType,
                draftText: call.body.summaryText,
                knowledgeStatus: 'not_confirmed',
            }),
        });
    });
    const args = {
        orderId: 27,
        phase: 'in_production',
        recordType: 'supplier_adjustment',
        title: '泵壳供应商临时调整',
        summaryText: '原供应商延期，人工决定后续 20 套改由备用供应商交付。',
        occurredAt: '2026-07-30T10:00:00.000Z',
        sourceFileIds: [52],
    };

    const blocked = await executeToolCall('save_order_execution_draft', args, { allowWrite: false });
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.title, '保存订单执行档案草稿');
    assert.equal(calls.length, 0);

    const saved = await executeToolCall('save_order_execution_draft', args, { allowWrite: true });
    assert.equal(saved.success, true);
    assert.match(saved.message, /仍需在订单页面人工确认/);
    assert.equal(saved.executionRecord.id, 9);
    assert.equal(calls.length, 1);
});
