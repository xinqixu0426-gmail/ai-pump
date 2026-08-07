const test = require('node:test');
const assert = require('node:assert/strict');
const {
    compileBusinessQuery,
    normalizeBusinessQueryArgs,
} = require('../api/services/aiBusinessQueryCompiler.cjs');

function callFor(text) {
    const compiled = compileBusinessQuery(text);
    return compiled && { name: compiled.name, args: compiled.args };
}

test('统一查询编译器：零件疑问词不会成为关键词', () => {
    assert.deepEqual(callFor('有没有缺货的零件'), {
        name: 'search_parts',
        args: { stockStatus: 'out' },
    });
    assert.deepEqual(callFor('低库存的零件有哪些'), {
        name: 'search_parts',
        args: { stockStatus: 'low' },
    });
    assert.deepEqual(
        normalizeBusinessQueryArgs('search_parts', { keyword: '有没有', stockStatus: 'out' }),
        { stockStatus: 'out' }
    );
});

test('统一查询编译器：零件支持全量、品类、类别和组合条件', () => {
    assert.deepEqual(callFor('列出所有零件'), { name: 'search_parts', args: {} });
    assert.deepEqual(callFor('列出电缆'), {
        name: 'search_parts',
        args: { keyword: '电缆' },
    });
    assert.deepEqual(callFor('查一下类别为油封的低库存零件'), {
        name: 'search_parts',
        args: { category: '油封', stockStatus: 'low' },
    });
    assert.deepEqual(callFor('800平刀切割泵壳成本是多少'), {
        name: 'search_parts',
        args: { keyword: '800平刀切割泵壳' },
    });
    assert.deepEqual(callFor('查询型号TEST-机筒-1100的当前库存、单价和供应商'), {
        name: 'search_parts',
        args: { keyword: 'TEST-机筒-1100' },
    });
    assert.deepEqual(callFor('查询800平刀切割泵壳目前的单价，并说明数据来源'), {
        name: 'search_parts',
        args: { keyword: '800平刀切割泵壳' },
    });
    assert.deepEqual(callFor('“TEST-机筒-1100”现在还剩多少，多少钱一个'), {
        name: 'search_parts',
        args: { keyword: 'TEST-机筒-1100' },
    });
});

test('统一查询编译器：线圈库存和方案使用正式线圈筛选字段', () => {
    assert.deepEqual(callFor('150-96线圈库存是多少'), {
        name: 'search_coils',
        args: { spec: '150', sheets: 96 },
    });
    assert.deepEqual(callFor('列出所有线圈'), {
        name: 'search_coils',
        args: {},
    });
    assert.deepEqual(
        normalizeBusinessQueryArgs('search_coils', {
            spec: '150',
            sheets: '96',
            material: '钢带',
            slotType: '小眼',
        }),
        { spec: '150', material: '钢带', slotType: '小眼', sheets: 96 }
    );
});

test('统一查询编译器：订单列表使用正式状态、客户、合同号和数量字段', () => {
    assert.deepEqual(callFor('有没有待采购的订单'), {
        name: 'get_recent_orders',
        args: { limit: 10, status: '待采购' },
    });
    assert.deepEqual(callFor('最近5个订单'), {
        name: 'get_recent_orders',
        args: { limit: 5 },
    });
    assert.deepEqual(callFor('客户为华东泵业的订单有哪些'), {
        name: 'get_recent_orders',
        args: { limit: 10, customerName: '华东泵业' },
    });
    assert.deepEqual(callFor('合同号HT-2026-08的订单'), {
        name: 'get_recent_orders',
        args: { limit: 10, contractNo: 'HT-2026-08' },
    });
});

test('统一查询编译器：采购任务使用供应商、待采购和数量字段', () => {
    assert.deepEqual(callFor('当前采购情况'), {
        name: 'get_purchase_overview',
        args: {},
    });
    assert.deepEqual(callFor('A供应商的待采购任务前5项'), {
        name: 'get_purchase_overview',
        args: { supplier: 'A', pendingOnly: true, limit: 5 },
    });
});

test('统一查询编译器：配方列表、成本和技术档案使用类型化目标', () => {
    assert.deepEqual(callFor('列出所有配方'), {
        name: 'get_all_recipes',
        args: {},
    });
    assert.deepEqual(callFor('V750配方成本是多少'), {
        name: 'preview_recipe_cost',
        args: { recipeName: 'V750' },
    });
    assert.deepEqual(callFor('配方 #12 的技术档案'), {
        name: 'get_recipe_technical_files',
        args: { recipeId: 12 },
    });
    assert.deepEqual(callFor('配方TEST-PUMP-750A用了哪些零件'), {
        name: 'get_recipe_detail',
        args: { recipeName: 'TEST-PUMP-750A' },
    });
    assert.deepEqual(callFor('查一下配方TEST-PUMP-750A的明细和当前成本'), {
        name: 'get_recipe_detail',
        args: { recipeName: 'TEST-PUMP-750A', includeCurrentCost: true },
    });
});

test('统一查询校验器拒绝未知字段、无意义关键词和越界参数', () => {
    assert.throws(
        () => normalizeBusinessQueryArgs('search_parts', { query: '轴承' }),
        /不支持查询字段/
    );
    assert.throws(
        () => normalizeBusinessQueryArgs('search_parts', { keyword: '有没有' }),
        /关键词没有包含/
    );
    assert.throws(
        () => normalizeBusinessQueryArgs('get_recent_orders', { limit: 101 }),
        /1 到 100/
    );
});
