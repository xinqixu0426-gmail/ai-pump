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
