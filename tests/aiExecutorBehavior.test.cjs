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
    assert.equal(result.provenance.kind, 'live_business');
    assert.equal(result.provenance.label, '实时业务数据');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/parts$/);
});

test('AI executor 行为：客户报价使用连续展示顺序且不返回内部 ID', async () => {
    installFetchStub((call) => {
        if (call.url.endsWith('/api/customers')) {
            return jsonResponse({ success: true, data: [{ id: 7, name: '邱焕' }] });
        }
        if (call.url.endsWith('/api/quotations')) {
            return jsonResponse({
                success: true,
                data: [
                    { id: 5, customerId: 7, createdAt: '2026-07-25T00:00:00.000Z', itemsJson: '[]' },
                    { id: 3, customerId: 7, createdAt: '2026-07-22T00:00:00.000Z', itemsJson: '[]' },
                ],
            });
        }
        if (call.url.endsWith('/api/orders')) {
            return jsonResponse({ success: true, data: [] });
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
            return jsonResponse({ success: true, data: [{ id: 9, entryType: 'recipe', sourceTable: 'recipes', sourceId: '7', title: '配方：V750', summary: '保存成本 90', syncedAt: '2026-01-01' }] });
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
                data: {
                    id: 12,
                    ...call.body,
                    ruleLearning: { refreshed: true, stats: { active: 1 } },
                },
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
                data: {
                    candidate: { id: 5, status: 'approved' },
                    restoredFromEvent: { id: 8, eventType: 'approved' },
                    knowledgeSync: { action: 'inserted' },
                },
            });
        }
        if (call.url.endsWith('/api/quality/rule-candidates/5') && call.method === 'PATCH') {
            assert.deepEqual(call.body, { status: 'approved', reviewNote: '确认' });
            return jsonResponse({
                success: true,
                data: {
                    id: 5,
                    status: 'approved',
                    knowledgeSync: { action: 'inserted' },
                },
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

test('AI executor 行为：知识库同步未确认时返回确认卡片，确认后调用同步 API', async () => {
    const blockedCalls = installFetchStub(() => jsonResponse({ success: false, error: '不应调用' }, 500));
    const blocked = await executeToolCall('sync_factory_knowledge', {}, { allowWrite: false });
    assert.equal(blocked.success, true);
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(blocked.confirmation.toolName, 'sync_factory_knowledge');
    assert.equal(blockedCalls.length, 0);

    const calls = installFetchStub((call) => {
        if (call.url.endsWith('/api/knowledge/sync') && call.method === 'POST') {
            return jsonResponse({ success: true, data: { ftsEnabled: true, stats: { inserted: 8, byType: { part: 2 } } } });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const confirmed = await executeToolCall('sync_factory_knowledge', {}, { allowWrite: true });

    assert.equal(confirmed.success, true);
    assert.equal(confirmed.intent, 'factory_knowledge_sync');
    assert.match(confirmed.summary, /已同步 8 条/);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url.replace(/^http:\/\/localhost:\d+/, '')}`), [
        'POST /api/knowledge/sync',
    ]);
});
