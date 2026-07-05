const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/quotationRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export type[^;]+;\n/g, '')
    .replace(/export function parseJsonArray/, 'function parseJsonArray')
    .replace(/export function getRecipePartSnapshotPrice/, 'function getRecipePartSnapshotPrice')
    .replace(/export function normalizePackingPart/, 'function normalizePackingPart')
    .replace(/export function getPackingParts/, 'function getPackingParts')
    .replace(/export function getCoilSnapshot/, 'function getCoilSnapshot')
    .replace(/export function createQuotationItem/, 'function createQuotationItem')
    .replace(/export function applyCustomerMargin/, 'function applyCustomerMargin')
    .replace(/export function recalculateQuotationItem/, 'function recalculateQuotationItem')
    .replace(/export function applyQuotationItemCost/, 'function applyQuotationItemCost')
    .replace(/export function applyQuotationItemMargin/, 'function applyQuotationItemMargin')
    .replace(/export function applyQuotationItemUnitPrice/, 'function applyQuotationItemUnitPrice')
    .replace(/export function buildRecipeDefaultOverrides/, 'function buildRecipeDefaultOverrides')
    .replace(/export function packingSummary/, 'function packingSummary')
    .replace(/export function calculateQuotationTotals/, 'function calculateQuotationTotals');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
const DEFAULT_QUOTATION_MARGIN = 0.15;
function inferPackingMaterial(model, explicit) {
  if (explicit) return explicit;
  if (String(model || '').includes('木箱')) return '木箱';
  if (String(model || '').includes('彩')) return '彩印纸箱';
  if (String(model || '').includes('泡沫')) return '泡沫';
  if (String(model || '').includes('商标')) return '商标';
  if (String(model || '').includes('说明书')) return '说明书';
  if (String(model || '').includes('珍珠棉')) return '珍珠棉';
  return '牛皮纸箱';
}
function partPriceByModelAndSupplier(parts, model, supplier = '') {
  const exact = parts.find(p => p.model === model && (!supplier || p.supplier === supplier));
  if (exact) return exact.price;
  const candidates = parts.filter(p => p.model === model);
  return candidates.length ? candidates.reduce((min, p) => p.price < min.price ? p : min, candidates[0]).price : 0;
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { parseJsonArray, getPackingParts, getCoilSnapshot, createQuotationItem, applyCustomerMargin, applyQuotationItemCost, applyQuotationItemMargin, applyQuotationItemUnitPrice, buildRecipeDefaultOverrides, packingSummary, calculateQuotationTotals };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    parseJsonArray,
    getPackingParts,
    getCoilSnapshot,
    createQuotationItem,
    applyCustomerMargin,
    applyQuotationItemCost,
    applyQuotationItemMargin,
    applyQuotationItemUnitPrice,
    buildRecipeDefaultOverrides,
    packingSummary,
    calculateQuotationTotals,
} = moduleStub.exports;

test('报价规则安全解析 JSON 数组', () => {
    assert.deepEqual(parseJsonArray('[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(parseJsonArray('{bad'), []);
    assert.deepEqual(parseJsonArray({}), []);
});

test('报价规则解析包装快照并从配方 parts 回填价格', () => {
    const recipe = {
        partsJson: JSON.stringify([{ name: '包装', model: '彩印纸箱A', supplier: 'P', qty: 1, snapshotPrice: 2.5 }]),
        packingPartsJson: JSON.stringify([{ model: '彩印纸箱A', supplier: 'P', qty: 1 }]),
    };

    const result = getPackingParts(recipe);

    assert.equal(result[0].packagingMaterial, '彩印纸箱');
    assert.equal(result[0].snapshotPrice, 2.5);
});

test('报价规则解析线圈快照并回退默认材质', () => {
    const recipe = {
        partsJson: JSON.stringify([{ name: '线圈转子', model: '750-24', snapshotPrice: 20, unitPrice: 0.2, source: '快照' }]),
    };

    const result = getCoilSnapshot(recipe);

    assert.equal(result.spec, '750');
    assert.equal(result.sheets, '24');
    assert.equal(result.material, '钢带');
    assert.equal(result.cost, 20);
});

test('报价项金额按成本、加价率和手输单价联动', () => {
    const item = createQuotationItem({ defaultMargin: 0.2 });
    const costed = applyQuotationItemCost({ ...item, qty: 3 }, 10);
    assert.equal(costed.unitPrice, 12);
    assert.equal(costed.totalPrice, 36);

    const remargined = applyQuotationItemMargin(costed, 0.5);
    assert.equal(remargined.unitPrice, 15);
    assert.equal(remargined.totalPrice, 45);

    const manual = applyQuotationItemUnitPrice(remargined, 20);
    assert.equal(manual.margin, 1);
    assert.equal(manual.totalPrice, 60);
});

test('报价规则生成配方默认覆盖项和汇总金额', () => {
    const recipe = {
        hasFloat: 1,
        floatWire: '0.55',
        hasCable: 1,
        cableLength: 3,
        cableWire: '0.75',
        coilSpec: '750',
        coilSheets: 24,
        packingPartsJson: JSON.stringify([{ model: '木箱A', supplier: '', qty: 1 }]),
        customBarrelLength: 170,
    };
    const overrides = buildRecipeDefaultOverrides(recipe);

    assert.equal(overrides.hasFloat, true);
    assert.equal(overrides.coilMaterial, '钢带');
    assert.match(overrides.packingPartsJson, /木箱A/);

    const items = applyCustomerMargin([
        { unitCost: 10, qty: 2, margin: 0.1, unitPrice: 11, totalPrice: 22 },
    ], { defaultMargin: 0.25 });
    assert.equal(items[0].unitPrice, 12.5);
    assert.deepEqual(calculateQuotationTotals(items), { totalCost: 20, totalPrice: 25 });
});

test('报价包装摘要优先使用快照价，否则查零件库', () => {
    const summary = packingSummary({
        overrides: {
            packingPartsJson: JSON.stringify([
                { model: '纸箱A', supplier: 'P', qty: 2 },
                { model: '木箱B', supplier: '', qty: 1, snapshotPrice: 5 },
            ]),
        },
    }, [{ model: '纸箱A', supplier: 'P', price: 2 }]);

    assert.equal(summary.total, 9);
    assert.equal(summary.source, '快照');
    assert.match(summary.label, /木箱B\/木箱/);
});
