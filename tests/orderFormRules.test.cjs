const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/orderFormRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const helpers = `
function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
function createOrderItem(recipeName, partsJson, qty, unitCost, recipeId, spec, profitMargin = 1.10, unitPrice) {
  const price = unitPrice ?? roundMoney(unitCost * profitMargin);
  return { id: 'item-1', recipeId, recipeName, spec, qty, partsJson, unitCost, profitMargin, unitPrice: price };
}
function createEmptyOrder(customerName, remark, contractNo) {
  return { id: 'new-order', customerName, contractNo, remark, status: '待采购', items: [], purchaseList: [], todos: [], totalCost: 0, totalPrice: 0, totalProfit: 0, createdAt: '', updatedAt: '' };
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { parseRecipeParts, resolveRecipeUnitCost, buildDraftOrderItem, removeDraftOrderItem, updateDraftOrderItemQty, updateDraftOrderItemMargin, updateDraftOrderItemPrice, buildOrderForSubmit, canAdvanceOrderStep };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    parseRecipeParts,
    resolveRecipeUnitCost,
    buildDraftOrderItem,
    removeDraftOrderItem,
    updateDraftOrderItemQty,
    updateDraftOrderItemMargin,
    updateDraftOrderItemPrice,
    buildOrderForSubmit,
    canAdvanceOrderStep,
} = moduleStub.exports;

test('订单表单规则安全解析配方 parts 并优先使用保存成本', async () => {
    assert.deepEqual(parseRecipeParts('[{"model":"A"}]'), [{ model: 'A' }]);
    assert.deepEqual(parseRecipeParts('{bad'), []);

    let calculateCalled = false;
    const cost = await resolveRecipeUnitCost(
        { savedTotalCost: 12.5, partsJson: '[{"model":"A"}]' },
        async () => {
            calculateCalled = true;
            return { totalCost: '99' };
        },
    );

    assert.equal(cost, 12.5);
    assert.equal(calculateCalled, false);
});

test('订单表单规则在无保存成本时调用成本计算并缓存历史价格', async () => {
    const cache = new Map();
    let historyCalls = 0;
    const recipe = { Id: 7, name: '测试配方', spec: 'A', partsJson: '[{"model":"轴承"}]' };
    const item = await buildDraftOrderItem({
        recipe,
        qty: 2,
        calculateCost: async (parts) => {
            assert.equal(parts[0].model, '轴承');
            return { totalCost: '20.25' };
        },
        findHistoryPrice: async () => {
            historyCalls += 1;
            return { unitPrice: 30, unitCost: 20, profitMargin: 1.5, customerName: '客户A', date: '2026-06-29' };
        },
        historyCache: cache,
    });
    const itemAgain = await buildDraftOrderItem({
        recipe,
        qty: 1,
        calculateCost: async () => ({ totalCost: '20.25' }),
        findHistoryPrice: async () => {
            historyCalls += 1;
            return null;
        },
        historyCache: cache,
    });

    assert.equal(item.qty, 2);
    assert.equal(item.unitCost, 20.25);
    assert.equal(item.recipeId, 7);
    assert.equal(item.history.customerName, '客户A');
    assert.equal(itemAgain.history.customerName, '客户A');
    assert.equal(historyCalls, 1);
});

test('订单表单规则更新数量、利润率和手输出厂价', () => {
    const items = [{ id: 'a', qty: 1, unitCost: 10, profitMargin: 1.1, unitPrice: 11 }];

    assert.equal(updateDraftOrderItemQty(items, 'a', 0)[0].qty, 1);
    assert.equal(updateDraftOrderItemMargin(items, 'a', 1.25)[0].unitPrice, 12.5);
    assert.equal(updateDraftOrderItemPrice(items, 'a', 15)[0].profitMargin, 1.5);
    assert.equal(removeDraftOrderItem(items, 'a').length, 0);
});

test('订单表单规则组装提交订单并校验步骤', () => {
    const order = buildOrderForSubmit({
        customerName: '客户A',
        contractNo: 'HT-1',
        remark: '备注',
        editOrderId: '88',
        draftItems: [{ id: 'a', qty: 2, unitCost: 10, unitPrice: 12, profitMargin: 1.2, recipeName: 'R', partsJson: '[]' }],
        orderTotals: { totalCost: 20, totalPrice: 24, totalProfit: 4 },
    });

    assert.equal(order.id, '88');
    assert.equal(order.customerName, '客户A');
    assert.equal(order.items.length, 1);
    assert.equal(order.purchaseList.length, 0);
    assert.equal(order.todos.length, 0);
    assert.equal(order.totalProfit, 4);
    assert.equal(canAdvanceOrderStep(0, ' ', 1), false);
    assert.equal(canAdvanceOrderStep(1, '客户A', 0), false);
    assert.equal(canAdvanceOrderStep(2, '客户A', 0), true);
});
