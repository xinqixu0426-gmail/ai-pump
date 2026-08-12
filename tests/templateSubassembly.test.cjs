const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeShellComponentsJson,
} = require('../api/services/templateCommands.cjs');

test('泵壳模板可保存一级供应商小套件组成', () => {
    const normalized = JSON.parse(normalizeShellComponentsJson([
        {
            name: ' 铝铸件小套件 ',
            model: ' V750铝铸件小套件 ',
            supplier: ' 张启彪 ',
            qty: 1,
            unitCost: 45,
            pricingMode: 'lengthCm',
            included: true,
            componentType: 'subassembly',
            subassemblyContents: [
                { name: ' 上帽 ', qty: 1, referenceUnitPrice: 12.5 },
                { name: '油缸盖', qty: 2, referenceUnitPrice: 0, note: ' 同厂采购 ' },
            ],
        },
    ]));

    assert.equal(normalized[0].name, '铝铸件小套件');
    assert.equal(normalized[0].model, 'V750铝铸件小套件');
    assert.equal(normalized[0].supplier, '张启彪');
    assert.equal(normalized[0].pricingMode, 'fixed');
    assert.deepEqual(normalized[0].subassemblyContents, [
        { name: '上帽', qty: 1, referenceUnitPrice: 12.5 },
        { name: '油缸盖', qty: 2, referenceUnitPrice: 0, note: '同厂采购' },
    ]);
});

test('计入成本的供应商小套件必须填写组成项', () => {
    assert.throws(
        () => normalizeShellComponentsJson([
            {
                name: '空套件',
                model: '空套件',
                qty: 1,
                unitCost: 1,
                included: true,
                componentType: 'subassembly',
                subassemblyContents: [],
            },
        ]),
        /至少需要一个组成项/
    );
});

test('供应商小套件组成数量必须为正数', () => {
    assert.throws(
        () => normalizeShellComponentsJson([
            {
                name: '铝铸件小套件',
                model: 'V750铝铸件小套件',
                qty: 1,
                unitCost: 45,
                included: true,
                componentType: 'subassembly',
                subassemblyContents: [{ name: '上帽', qty: 0 }],
            },
        ]),
        /必须是正数/
    );
});

test('供应商小套件组成参考单价必须是非负数且允许省略', () => {
    const normalized = JSON.parse(normalizeShellComponentsJson([
        {
            name: '铝铸件小套件',
            model: 'V750铝铸件小套件',
            qty: 1,
            unitCost: 45,
            included: true,
            componentType: 'subassembly',
            subassemblyContents: [
                { name: '上帽', qty: 1 },
                { name: '油缸盖', qty: 1, referenceUnitPrice: 11.25 },
            ],
        },
    ]));
    assert.deepEqual(normalized[0].subassemblyContents, [
        { name: '上帽', qty: 1 },
        { name: '油缸盖', qty: 1, referenceUnitPrice: 11.25 },
    ]);
    assert.throws(
        () => normalizeShellComponentsJson([
            {
                name: '铝铸件小套件',
                model: 'V750铝铸件小套件',
                qty: 1,
                unitCost: 45,
                included: true,
                componentType: 'subassembly',
                subassemblyContents: [{ name: '上帽', qty: 1, referenceUnitPrice: -1 }],
            },
        ]),
        /必须是非负数字/
    );
});

test('计入成本的泵壳组件数量必须为正数且允许合法小数', () => {
    for (const qty of [0, -1]) {
        assert.throws(
            () => normalizeShellComponentsJson([{
                name: '上帽',
                model: 'V750上帽',
                qty,
                unitCost: 10,
                included: true,
                componentType: 'standard',
            }]),
            /必须是正数/
        );
    }

    const [normalized] = JSON.parse(normalizeShellComponentsJson([{
        name: '上帽',
        model: 'V750上帽',
        qty: 0.25,
        unitCost: 10,
        included: true,
        componentType: 'standard',
    }]));
    assert.equal(normalized.qty, 0.25);
});

test('未计入成本的组件仍可暂存数量 0', () => {
    const [normalized] = JSON.parse(normalizeShellComponentsJson([{
        name: '待选上帽',
        model: 'V750上帽',
        qty: 0,
        unitCost: 10,
        included: false,
        componentType: 'standard',
    }]));
    assert.equal(normalized.qty, 0);
});

test('泵壳组件只保存正式字段并只读兼容历史不锈钢标记', () => {
    const [normalized] = JSON.parse(normalizeShellComponentsJson([{
        id: 'client-row-id',
        name: ' 不锈钢拉伸筒 ',
        model: ' 不锈钢机筒 ',
        supplier: ' 机筒供应商 ',
        qty: 17,
        unitCost: 0.8,
        included: true,
        optional: true,
        isStainlessStretchBarrel: true,
        note: ' 按厘米计价 ',
        unexpected: { clientOnly: true },
    }]));

    assert.deepEqual(normalized, {
        name: '不锈钢拉伸筒',
        model: '不锈钢机筒',
        supplier: '机筒供应商',
        qty: 17,
        unitCost: 0.8,
        pricingMode: 'lengthCm',
        included: true,
        optional: true,
        componentType: 'stainlessStretchBarrel',
        note: '按厘米计价',
    });
});
