const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/quotationOrderConversion.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/type PriceGetter[\s\S]*?type EmptyOrderFactory = [^;]+;\n\n/, '')
    .replace(/export async function buildOrderItemsFromQuotation/, 'async function buildOrderItemsFromQuotation')
    .replace(/export async function buildOrderFromQuotation/, 'async function buildOrderFromQuotation');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function buildOrderBomFromQuotation(input) {
  const parts = [...input.baseParts];
  if (input.overrides?.hasCable) {
    parts.push({ model: '电缆-线径' + input.overrides.cableWire, name: '电缆线', supplier: '', qty: input.overrides.cableLength, snapshotPrice: input.getPrice('电缆-线径' + input.overrides.cableWire, '') });
  }
  return parts;
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildOrderItemsFromQuotation, buildOrderFromQuotation };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildOrderItemsFromQuotation, buildOrderFromQuotation } = moduleStub.exports;

const quotationItems = [{
    id: 'q1',
    baseRecipeId: 7,
    baseRecipeName: '测试配方',
    qty: 2,
    overrides: { hasCable: true, cableWire: '0.75', cableLength: 3, customBarrelLength: 170 },
    unitCost: 10,
    margin: 0.2,
    unitPrice: 12,
}];

const recipes = [{
    Id: 7,
    name: '测试配方',
    partsJson: JSON.stringify([{ model: '轴承', name: '轴承', supplier: 'A', qty: 1, snapshotPrice: 2 }]),
    assemblyWage: 1,
    packingWage: 2,
    surfaceTreatmentMode: 'none',
    surfaceTreatmentCost: 0,
    managementFee: 3,
    coilMaterial: '冷轧800',
}];

test('报价转订单明细会使用成本草稿回填重算后的 BOM', async () => {
    let draftPayload = null;
    const items = await buildOrderItemsFromQuotation({
        quotationItems,
        recipes,
        getPrice: () => 1.5,
        getCableAccessoryFee: () => 0,
        getCableAccessoryName: () => '普通铜套',
        previewRecipeCostDraft: async (payload) => {
            draftPayload = payload;
            return { parts: [{ model: '轴承', name: '轴承', supplier: 'A', qty: 1, snapshotPrice: 2 }, { model: '电缆-线径0.75', name: '电缆线', supplier: '', qty: 3, snapshotPrice: 1.5 }], savedTotalCost: 6.5 };
        },
    });

    assert.equal(draftPayload.customBarrelLength, 170);
    assert.equal(draftPayload.coilMaterial, '冷轧800');
    assert.equal(items[0].recipeId, 7);
    assert.equal(items[0].profitMargin, 0.2);
    assert.equal(JSON.parse(items[0].partsJson)[1].model, '电缆-线径0.75');
});

test('报价转订单生成订单客户和备注', async () => {
    const order = await buildOrderFromQuotation({
        quotation: { customerId: 3, itemsJson: JSON.stringify(quotationItems), remark: '备注' },
        customers: [{ Id: 3, name: '客户A' }],
        recipes,
        getPrice: () => 1.5,
        getCableAccessoryFee: () => 0,
        getCableAccessoryName: () => '普通铜套',
        previewRecipeCostDraft: async () => ({ parts: [], savedTotalCost: 0 }),
        createEmptyOrder: (customerName, remark, contractNo) => ({ id: 'o1', customerName, remark, contractNo, status: '待采购', items: [], purchaseList: [], todos: [], totalCost: 0, totalPrice: 0, totalProfit: 0, createdAt: '', updatedAt: '' }),
    });

    assert.equal(order.customerName, '客户A');
    assert.equal(order.remark, '由报价单转化: 备注');
    assert.equal(order.items.length, 1);
});
