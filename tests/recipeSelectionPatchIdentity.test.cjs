const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');
const loaded = {};
new Function('exports', ts.transpileModule(fs.readFileSync('apps/web-next/lib/recipe-selection-identity.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(loaded);
const { patchRecipeSelectionIdentity: patchIdentity } = loaded;
const catalog = [
    { id: 1, model: '新名称', supplier: '甲', category: '配件' },
    { id: 2, model: '旧名称', supplier: '甲', category: '配件' },
    { id: 3, model: '新包材', supplier: '甲', category: '包装' },
];

test('仅修改数量/费用不重绑已改名或暂时不可见的 ID，不猜补历史引用', () => {
    for (const current of [{ partId: 1, model: '旧名称', supplier: '甲' }, { partId: 99, model: '未知' }, { model: '旧名称' }]) {
        for (const patch of [{ qty: '2' }, { snapshotPrice: '9', costSource: 'manual' }, { packagingMaterial: '木箱' }]) {
            const result = { ...current, ...patchIdentity(current, patch, catalog) };
            assert.equal(result.partId, current.partId);
        }
    }
});

test('显式更换物料才按唯一型号和供应商重绑，失配或歧义清空旧 ID', () => {
    const current = { partId: 1, model: '旧名称', supplier: '甲' };
    assert.equal(patchIdentity(current, { model: '旧名称' }, catalog).partId, 2);
    assert.equal(patchIdentity(current, { supplier: '乙' }, catalog).partId, undefined);
    assert.equal(patchIdentity(current, { model: '不存在' }, catalog).partId, undefined);
    assert.equal(patchIdentity(current, { model: '旧名称', supplier: '' }, [...catalog, { ...catalog[1], id: 4, supplier: '乙' }]).partId, undefined);
});

test('配方选配件与包装的重绑保持分类边界，原 patch 不被修改', () => {
    const patch = { model: '新包材', supplier: '甲' };
    assert.equal(patchIdentity({}, patch, catalog).partId, undefined);
    assert.equal(patchIdentity({}, patch, catalog, '包装').partId, 3);
    assert.equal(patchIdentity({}, { model: '新名称' }, catalog, '包装').partId, undefined);
    assert.equal(Object.hasOwn(patch, 'partId'), false);
});
