const test = require('node:test');
const assert = require('node:assert/strict');
const { answerInstruction, runAiDispatcherV2 } = require('../api/services/aiDispatcherV2.cjs');

const originalFetch = global.fetch;

function providerResponse(message) {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

function planResponse(plan) {
    return providerResponse({
        tool_calls: [{
            id: 'intent-plan',
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                arguments: JSON.stringify(plan),
            },
        }],
    });
}

test.afterEach(() => {
    global.fetch = originalFetch;
});

test('V2 回答契约：列表不扩写且默认禁止暴露内部编号', () => {
    const instruction = answerInstruction({
        goal: '列出报价中的报价',
        answerShape: 'list',
        needsBusinessData: true,
    });
    assert.match(instruction, /不得自行计算分组数量/);
    assert.match(instruction, /内部 id、sourceId、数据库序号/);
    assert.match(instruction, /不得输出/);
    assert.match(instruction, /不补充未询问的相邻统计/);
});

test('V2 调度器：模型理解口语后只调用计划内正式能力并以证据回答', async () => {
    const providerCalls = [];
    const provider = async (_messages, options) => {
        providerCalls.push(options);
        if (providerCalls.length === 1) {
            return planResponse({
                goal: '查询采购中的订单数量并逐单简报',
                mode: 'query',
                domains: ['order'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'count_with_brief',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'high',
                steps: [{ capabilityName: 'get_recent_orders', objective: '按采购中状态查询订单' }],
            });
        }
        if (providerCalls.length === 2) {
            const names = options.tools.map(tool => tool.function.name);
            assert.deepEqual(names, ['get_recent_orders']);
            assert.equal(options.toolChoice.function.name, 'get_recent_orders');
            assert.equal(names.includes('create_order'), false);
            return providerResponse({
                content: '',
                tool_calls: [{
                    id: 'orders',
                    type: 'function',
                    function: {
                        name: 'get_recent_orders',
                        arguments: JSON.stringify({ status: '采购中' }),
                    },
                }],
            });
        }
        return providerResponse({ content: '采购中的订单有 **1 个**：测试客户，创建于 2026-08-03。' });
    };
    global.fetch = async url => {
        assert.match(String(url), /\/api\/orders\?status=/);
        return new Response(JSON.stringify({
            success: true,
            data: [{ id: 3, customerName: '测试客户', status: '采购中', createdAt: '2026-08-03' }],
        }), { headers: { 'Content-Type': 'application/json' } });
    };

    const result = await runAiDispatcherV2({
        messages: [{ role: 'user', content: '采购中的单子有几个' }],
        fetchAiProvider: provider,
    });
    assert.equal(providerCalls.length, 3);
    assert.equal(result.toolResults[0].name, 'get_recent_orders');
    assert.equal(result.toolResults[0].result.executionEvidence.verified, true);
    assert.match(result.finalContent, /\*\*1 个\*\*/);
});

test('V2 调度器：需要业务事实但模型不调用工具时拒绝编造', async () => {
    let calls = 0;
    const provider = async () => {
        calls += 1;
        if (calls === 1) {
            return planResponse({
                goal: '列出所有零件',
                mode: 'query',
                domains: ['catalog'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'list',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'high',
                steps: [{ capabilityName: 'search_parts', objective: '读取正式零件库' }],
            });
        }
        return providerResponse({ content: '一共有 99 个零件。' });
    };
    const result = await runAiDispatcherV2({
        messages: [{ role: 'user', content: '列出所有零件' }],
        fetchAiProvider: provider,
    });
    assert.equal(calls, 3);
    assert.match(result.finalContent, /没有取得正式业务 API/);
    assert.doesNotMatch(result.finalContent, /99/);
});

test('V2 调度器：口语化缺货问题由模型映射为正式库存条件', async () => {
    let calls = 0;
    const provider = async (_messages, options) => {
        calls += 1;
        if (calls === 1) {
            return planResponse({
                goal: '列出当前缺货零件',
                mode: 'query',
                domains: ['catalog'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'list',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'high',
                steps: [{ capabilityName: 'search_parts', objective: '按缺货库存状态直接筛选零件' }],
            });
        }
        if (calls === 2) {
            assert.ok(options.tools.some(tool => tool.function.name === 'search_parts'));
            return providerResponse({
                content: '',
                tool_calls: [{
                    id: 'parts',
                    type: 'function',
                    function: {
                        name: 'search_parts',
                        arguments: JSON.stringify({ stockStatus: 'out' }),
                    },
                }],
            });
        }
        return providerResponse({ content: '当前缺货零件有 **1 个**：TEST-油封-01。' });
    };
    global.fetch = async url => {
        assert.match(String(url), /stockStatus=out/);
        return new Response(JSON.stringify({
            success: true,
            data: [{ id: 8, model: 'TEST-油封-01', stock: 0 }],
        }), { headers: { 'Content-Type': 'application/json' } });
    };

    const result = await runAiDispatcherV2({
        messages: [{ role: 'user', content: '有没有缺货的零件' }],
        fetchAiProvider: provider,
    });
    assert.equal(result.toolResults[0].result.executionEvidence.verified, true);
    assert.match(result.finalContent, /TEST-油封-01/);
});

test('V2 调度器：计划能力完成后不开放计划外工具扩搜', async () => {
    let calls = 0;
    const provider = async (_messages, options) => {
        calls += 1;
        if (calls === 1) {
            return planResponse({
                goal: '查询切割泵壳及专用配件',
                mode: 'query',
                domains: ['catalog'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'list',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'medium',
                steps: [{ capabilityName: 'search_parts', objective: '查询正式零件' }],
            });
        }
        if (calls === 2) {
            assert.ok(options.tools.some(tool => tool.function.name === 'search_parts'));
            return providerResponse({
                content: '',
                tool_calls: [{
                    id: `parts-${calls}`,
                    type: 'function',
                    function: {
                        name: 'search_parts',
                        arguments: JSON.stringify({ keyword: '切割' }),
                    },
                }],
            });
        }
        assert.deepEqual(options.tools, []);
        if (calls === 3) {
            return providerResponse({ content: '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="search_parts">' });
        }
        return providerResponse({ content: '正式零件查询未找到明确标注的切割专用配件。' });
    };
    global.fetch = async () => new Response(JSON.stringify({ success: true, data: [] }), {
        headers: { 'Content-Type': 'application/json' },
    });

    const result = await runAiDispatcherV2({
        messages: [{ role: 'user', content: '切割杂草用的泵壳和配件有哪些' }],
        fetchAiProvider: provider,
    });
    assert.equal(result.toolResults.length, 1);
    assert.equal(calls, 4);
    assert.match(result.finalContent, /未找到/);
});

test('V2 调度器：写意图没有正式工具证据时绝不采信模型的成功话术', async () => {
    let calls = 0;
    const provider = async () => {
        calls += 1;
        if (calls === 1) {
            return planResponse({
                goal: '将 TEST-机筒-1100 库存增加 100 件',
                mode: 'command',
                domains: ['catalog'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'confirmation',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'high',
                steps: [{ capabilityName: 'adjust_part_stock', objective: '解析目标零件并生成库存调整确认' }],
            });
        }
        return providerResponse({ content: '已成功入库 100 件。' });
    };

    const result = await runAiDispatcherV2({
        messages: [{ role: 'user', content: 'TEST-机筒-1100库存+100' }],
        fetchAiProvider: provider,
    });
    assert.equal(result.toolResults.length, 0);
    assert.doesNotMatch(result.finalContent, /成功入库/);
    assert.match(result.finalContent, /没有取得正式业务 API/);
});
