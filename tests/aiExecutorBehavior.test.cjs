const test = require('node:test');
const assert = require('node:assert/strict');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');

const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_SECRET;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
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
    if (originalSecret === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = originalSecret;
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
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 7, model: 'A', category: '螺丝', price: 1, supplier: 'S', stock: 3 }] });
        }
        if (call.url.endsWith('/api/parts/7') && call.method === 'PATCH') {
            assert.deepEqual(call.body, { price: 2 });
            return jsonResponse({ success: true, data: { id: 7, model: 'A', category: '螺丝', price: 2, supplier: 'S', stock: 3 } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('update_part', { model: 'A', price: 2 }, { allowWrite: true });

    assert.equal(result.success, true);
    assert.equal(result.part.id, 7);
    assert.equal(result.part.price, 2);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/parts',
        'PATCH /api/parts/7',
    ]);
});

test('AI executor 行为：查询零件列表通过标准 parts API', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/parts') && call.method === 'GET') {
            return jsonResponse({ success: true, data: [{ id: 1, model: '6202', category: '轴承', price: 1.5, supplier: 'S', stock: 8 }] });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('get_all_parts', {}, { allowWrite: false });

    assert.equal(result.success, true);
    assert.deepEqual(result.data, [{ id: 1, model: '6202', category: '轴承', price: 1.5, supplier: 'S', stock: 8 }]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/parts$/);
});

test('AI executor 行为：转子模板出图通过模板草稿 API 补全参数', async () => {
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
        if (call.url.endsWith('/api/rotor/draw') && call.method === 'POST') {
            assert.equal(call.body.shell_model, undefined);
            assert.equal(call.body.upper_bearing, '6202');
            assert.equal(call.body.piece_count, 160);
            return jsonResponse({ success: true, data: { status: 'success', jobId: 'job-1', params: { piece_count: 160 } } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('generate_rotor_drawing', { shell_model: 'V750', piece_count: 160 }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.jobId, 'job-1');
    assert.equal(result.templateInfo.openOffset, 15);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'GET /api/templates',
        'POST /api/rotor/template-draft',
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
