const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('../apps/web-next/node_modules/typescript');
const compiled = typescript.transpileModule(fs.readFileSync(path.join(__dirname, '../apps/web-next/components/recipe/useBomPreview.ts'), 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', compiled)(loaded.exports, () => ({}), loaded);
const { selectionToRecipeParts } = loaded.exports;

test('选配和包装预览保留用户选中的正式 ID，不因同名供应商不同而丢失身份', () => {
    const rows = [1, 2].map(partId => ({ id: `row-${partId}`, partId, model: '同名零件', supplier: `供应商${partId}`, qty: '2', packagingMaterial: '木箱', costSource: '', snapshotPrice: '5' }));
    for (const packaging of [false, true]) {
        const parts = selectionToRecipeParts(rows, packaging);
        assert.deepEqual(parts.map(part => part.partId), [1, 2]);
        assert.deepEqual(parts.map(part => part.supplier), ['供应商1', '供应商2']);
        assert.equal(parts[0].qty, 2);
        if (packaging) assert.equal(parts[0].packagingMaterial, '木箱');
    }
});

test('未建档手工项不生成虚假 ID，非法已选 ID 保留给服务端拒绝而不隐式改按名称匹配', () => {
    const row = { id: 'row', model: '手工费用', supplier: '', qty: '1', packagingMaterial: '', costSource: 'manual', snapshotPrice: '7' };
    const result = selectionToRecipeParts([row]);
    assert.equal(Object.hasOwn(result[0], 'partId'), false);
    assert.equal(result[0].snapshotPrice, 7);
    assert.equal(selectionToRecipeParts([{ ...row, partId: -1 }])[0].partId, -1);
});
