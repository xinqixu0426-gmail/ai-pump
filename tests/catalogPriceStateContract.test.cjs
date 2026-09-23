'use strict';

// PHASE 5-R3：正式目录价格状态的最终契约回归。
//
// 背景（本次整合定位到的真实缺陷）：
//   中间层 `api/services/partsDataCache.cjs` 曾用 `record.price || 0` 构造
//   partsByModel，把正式目录里的 NULL 价格压成数值 0。因为 0 是**合法**的正式
//   目录价格（见下），压成 0 之后 costEngine 再也无法区分「未定价」与「零成本」，
//   于是未定价零件被算进“完整成本”，情景比较也伪造出 COMPARABLE。
//   现在 partsByModel 保留 NULL，由 costEngine 的 hasUsableCatalogPrice 统一判定；
//   partsCache（box_type 推断等既有调用方的按型号单值索引）保持原有 0 语义。
//
// 正式零价 ≠ 未定价，依据：
//   1. schema：parts.price 为 `REAL DEFAULT 0`，约束 `CHECK(price IS NULL OR price >= 0)`；
//   2. 正式零件 API：partCommands 的 create / update / batch_update_prices 用
//      parseNonNegativeNumber，即 price >= 0 合法；
//   3. 正式列表过滤：partQueries 的价格下界是 min: 0。
//
// 本测试逐态断言「有效性 / 成本贡献 / missingParts / 完整性」，不依赖实现细节。

const test = require('node:test');
const assert = require('node:assert/strict');

const D = require('better-sqlite3');
const { calculateRecipeCost } = require('../api/services/costEngine.cjs');
const { buildCurrentRecipeCostBasis } = require('../api/services/currentRecipeCost.cjs');
const { createPartsDataCache } = require('../api/services/partsDataCache.cjs');

function costOf(catalogRows, part = { model: 'M', supplier: 'S', qty: 2 }) {
    const partsByModel = {};
    for (const row of catalogRows) {
        (partsByModel[row.model] = partsByModel[row.model] || []).push(row);
    }
    return calculateRecipeCost([part], {}, partsByModel, { getSetting: () => undefined });
}

function row(price, overrides = {}) {
    return { id: 1, model: 'M', supplier: 'S', category: '标准件', price, ...overrides };
}

// ── 六态价格矩阵 ────────────────────────────────────────────────────────────
const PRICE_MATRIX = [
    { label: 'positive 12.5', price: 12.5, usable: true, priceText: '12.50', missing: false, total: '25.00' },
    { label: 'zero 0', price: 0, usable: true, priceText: '0.00', missing: false, total: '0.00' },
    { label: 'numeric string 3.5', price: '3.5', usable: true, priceText: '3.50', missing: false, total: '7.00' },
    { label: 'negative -1', price: -1, usable: false, priceText: '0.00', missing: true, total: '0.00' },
    { label: 'null', price: null, usable: false, priceText: '0.00', missing: true, total: '0.00' },
    { label: 'undefined', price: undefined, usable: false, priceText: '0.00', missing: true, total: '0.00' },
    { label: 'non-numeric abc', price: 'abc', usable: false, priceText: '0.00', missing: true, total: '0.00' },
    { label: 'NaN', price: Number.NaN, usable: false, priceText: '0.00', missing: true, total: '0.00' },
];

for (const scenario of PRICE_MATRIX) {
    test(`正式目录价格状态：${scenario.label}`, () => {
        const result = costOf([row(scenario.price)]);
        const detail = result.details[0];

        // 有效性
        assert.equal(detail.price, scenario.priceText, `${scenario.label} 的明细单价`);
        assert.equal(result.totalCost, scenario.total, `${scenario.label} 的合计`);

        // 成本贡献：无效价不得产生负额或 NaN
        assert.ok(Number.isFinite(Number(result.totalCost)), `${scenario.label} 的合计必须有限`);
        assert.ok(Number(result.totalCost) >= 0, `${scenario.label} 的合计不得为负`);

        // missingParts：零价不得因为“是零”而被判缺价
        if (scenario.missing) {
            assert.deepEqual(result.missingParts, ['M'], `${scenario.label} 必须计入 missingParts`);
        } else {
            assert.deepEqual(result.missingParts, [], `${scenario.label} 不得计入 missingParts`);
        }
    });
}

test('正式目录价格状态：零价与未定价在完整性判定上必须区分开', () => {
    const recipe = () => ({
        id: 1,
        partsJson: JSON.stringify([{ partId: 1, model: 'M', supplier: 'S', qty: 2 }]),
        assemblyWage: 0, packingWage: 0, managementFee: 0,
        surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0,
    });
    const deps = catalogRows => {
        const partsByModel = {};
        for (const item of catalogRows) (partsByModel[item.model] = partsByModel[item.model] || []).push(item);
        return { partsByModel, calculateRecipeCost, getSetting: () => undefined };
    };

    // 零价：合法零成本 → 成本完整
    const zero = buildCurrentRecipeCostBasis(recipe(), deps([row(0)]));
    assert.deepEqual(zero.missingParts, [], '零价不得进入 missingParts');
    assert.equal(zero.costComplete, true, '零价必须视为成本完整');

    // NULL：未定价 → 成本不完整
    const missing = buildCurrentRecipeCostBasis(recipe(), deps([row(null)]));
    assert.deepEqual(missing.missingParts, ['M'], 'NULL 价格必须进入 missingParts');
    assert.equal(missing.costComplete, false, 'NULL 价格必须视为成本不完整');
});

test('partsDataCache：partsByModel 保留 NULL，partsCache 保持既有 0 语义', () => {
    const db = new D(':memory:');
    try {
        db.exec('CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, category TEXT, supplier TEXT, price REAL, remark TEXT, naming_json TEXT, deleted_at TEXT)');
        db.prepare("INSERT INTO parts (id, model, category, supplier, price) VALUES (1,'NUL','标准件','S',NULL)").run();
        db.prepare("INSERT INTO parts (id, model, category, supplier, price) VALUES (2,'ZERO','标准件','S',0)").run();
        db.prepare("INSERT INTO parts (id, model, category, supplier, price) VALUES (3,'POS','标准件','S',7.5)").run();
        const { partsCache, partsByModel } = createPartsDataCache(db).read();

        assert.equal(partsByModel.NUL[0].price, null, 'partsByModel 必须保留 NULL 价格');
        assert.equal(partsByModel.ZERO[0].price, 0, 'partsByModel 必须保留合法零价');
        assert.equal(partsByModel.POS[0].price, 7.5);
        // 既有调用方（box_type 推断等）继续读 0，本次修复不改变那部分行为。
        assert.equal(partsCache.NUL.price, 0);
        assert.equal(partsCache.ZERO.price, 0);
        assert.equal(partsCache.POS.price, 7.5);
    } finally {
        db.close();
    }
});

// ── 供应商回退：必须取“最低的可用价”，不得让缺失价赢得最小值 ────────────────
const FALLBACK_CASES = [
    { label: '[10, 0, null] 取 0', prices: [10, 0, null], total: '0.00', missing: false },
    { label: '[3, 0] 取 0', prices: [3, 0], total: '0.00', missing: false },
    { label: '[0, 0] 取 0', prices: [0, 0], total: '0.00', missing: false },
    { label: '[-1, 5] 取 5', prices: [-1, 5], total: '5.00', missing: false },
    { label: "['abc', 4] 取 4", prices: ['abc', 4], total: '4.00', missing: false },
    { label: '[null, undefined] 全部缺失', prices: [null, undefined], total: '0.00', missing: true },
    { label: '[-1, null] 全部不可用', prices: [-1, null], total: '0.00', missing: true },
    { label: "['abc', null] 全部不可用", prices: ['abc', null], total: '0.00', missing: true },
];

for (const scenario of FALLBACK_CASES) {
    test(`供应商回退价格选择：${scenario.label}`, () => {
        const catalogRows = scenario.prices.map((price, index) => ({
            id: index + 1, model: 'M', supplier: `S${index}`, category: '标准件', price,
        }));
        const partsByModel = { M: catalogRows };
        const result = calculateRecipeCost([{ model: 'M', supplier: 'ZZ', qty: 1 }], {}, partsByModel, { getSetting: () => undefined });

        assert.equal(result.totalCost, scenario.total);
        assert.equal(result.missingParts.length > 0, scenario.missing);
        assert.ok(Number(result.totalCost) >= 0, '合计不得为负');
    });
}
