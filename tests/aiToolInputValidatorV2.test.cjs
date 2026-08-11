const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AiToolInputValidationError,
    validateAiToolArgs,
} = require('../api/services/aiToolInputValidatorV2.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');

test('V2 工具目录：每个对象和数组都声明完整输入结构', () => {
    const gaps = [];
    function inspect(schema, path) {
        if (!schema || typeof schema !== 'object') return;
        if (schema.type === 'object') {
            if (!schema.properties && schema.additionalProperties !== true) {
                gaps.push(`${path}: object 缺少 properties`);
            }
            for (const [key, child] of Object.entries(schema.properties || {})) {
                inspect(child, `${path}.${key}`);
            }
        }
        if (schema.type === 'array') {
            if (!schema.items) gaps.push(`${path}: array 缺少 items`);
            inspect(schema.items, `${path}[]`);
        }
        for (const keyword of ['anyOf', 'oneOf']) {
            for (const [index, child] of (schema[keyword] || []).entries()) {
                if (!child.type) {
                    gaps.push(`${path}.${keyword}[${index}]: 组合分支缺少 type`);
                }
                inspect(child, `${path}.${keyword}[${index}]`);
            }
        }
    }
    for (const tool of AI_TOOLS) {
        inspect(tool.function.parameters, tool.function.name);
    }
    assert.deepEqual(gaps, []);
});

test('V2 工具输入：按 AI_TOOLS schema 统一规范化所有字段', () => {
    assert.deepEqual(validateAiToolArgs('search_parts', {
        category: '  油封  ',
        stockStatus: 'low',
        limit: 20,
    }), {
        category: '油封',
        stockStatus: 'low',
        limit: 20,
    });

    assert.deepEqual(validateAiToolArgs('adjust_part_stock', {
        items: [{ model: ' TEST-机筒-1100 ', changeQty: 100 }],
    }), {
        items: [{ model: 'TEST-机筒-1100', changeQty: 100 }],
    });

    assert.deepEqual(validateAiToolArgs('search_coils', {
        spec: ' 12 ',
        sheets: '220',
    }), {
        spec: '12',
        sheets: 220,
    });
});

test('V2 工具输入：未知字段、非法枚举和缺失必填统一在执行前拒绝', () => {
    for (const [name, args] of [
        ['search_parts', { query: '油封' }],
        ['get_recent_orders', { status: '报价中' }],
        ['adjust_part_stock', { items: [{ model: 'A' }] }],
    ]) {
        assert.throws(
            () => validateAiToolArgs(name, args),
            AiToolInputValidationError
        );
    }
});

test('V2 写工具输入：拒绝空白目标、空批次、零变动和冲突调价方式', () => {
    assert.throws(
        () => validateAiToolArgs('adjust_part_stock', { items: [] }),
        /至少需要 1 项/
    );
    assert.throws(
        () => validateAiToolArgs('adjust_part_stock', { items: [{ model: '   ', changeQty: 1 }] }),
        /必填字段|不能少于/
    );
    assert.throws(
        () => validateAiToolArgs('adjust_coil_stock', { items: [{ model: '12-120', changeQty: 0 }] }),
        /不符合任何允许的输入形式/
    );
    assert.throws(
        () => validateAiToolArgs('batch_update_prices', { category: '轴承' }),
        /必须且只能符合一种输入形式/
    );
    assert.throws(
        () => validateAiToolArgs('batch_update_prices', {
            category: '轴承',
            percentChange: 10,
            absoluteChange: 1,
        }),
        /必须且只能符合一种输入形式/
    );
});

test('V2 工具输入：查询与写入不再维护第二份手写参数白名单', () => {
    assert.deepEqual(validateAiToolArgs('get_all_recipes', {
        hasTechnicalFiles: true,
    }), { hasTechnicalFiles: true });
    assert.throws(
        () => validateAiToolArgs('search_quotations', { limit: 101 }),
        /不能大于 100/
    );
    assert.deepEqual(validateAiToolArgs('search_customer_history', {
        customerId: 3,
        limit: 10,
    }), { customerId: 3, limit: 10 });
    assert.throws(
        () => validateAiToolArgs('search_customer_history', { keyword: 'V750' }),
        /不符合任何允许的输入形式/
    );
});

test('V2 工具输入：按 ID 或业务名称定位时至少要求一种正式标识', () => {
    assert.throws(() => validateAiToolArgs('get_recipe_detail', {}), /不符合任何允许的输入形式/);
    assert.deepEqual(validateAiToolArgs('get_recipe_detail', { recipeName: 'TEST-PUMP-750A' }), {
        recipeName: 'TEST-PUMP-750A',
    });
    assert.throws(() => validateAiToolArgs('check_order_readiness', {}), /不符合任何允许的输入形式/);
    assert.deepEqual(validateAiToolArgs('check_order_readiness', { orderQuery: '测试客户' }), {
        orderQuery: '测试客户',
    });
    assert.throws(() => validateAiToolArgs('get_order_detail', {}), /必须且只能符合一种输入形式/);
    assert.deepEqual(validateAiToolArgs('get_order_detail', { orderQuery: '邱焕' }), {
        orderQuery: '邱焕',
    });
    assert.throws(
        () => validateAiToolArgs('get_order_detail', { orderId: 1, orderQuery: '邱焕' }),
        /必须且只能符合一种输入形式/
    );
});
