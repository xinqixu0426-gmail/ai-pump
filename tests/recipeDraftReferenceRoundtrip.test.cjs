const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');

test('配方读取适配保留独立对外型号，旧响应不伪造型号', () => {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync('apps/web-next/lib/recipes.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('exports', 'require', code)(exports, name => {
        assert.equal(name, './api');
        return {};
    });
    const row = { id: 4, name: '水泵-V750-12-140片-普通', externalModel: 'v750-普通', partsJson: '[]' };
    const recipe = exports.rowToRecipe(row);
    assert.equal(recipe.name, row.name);
    assert.equal(recipe.externalModel, row.externalModel);
    assert.equal(exports.rowToRecipe({ id: 4, name: row.name }).externalModel, undefined);
});

function fixture() {
    const states = [];
    const dependencies = {
        react: {
            useState(initial) {
                const index = states.length;
                states.push(typeof initial === 'function' ? initial() : initial);
                return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
            },
            useCallback: callback => callback,
        },
        '@/lib/recipes': { parseRecipePartsJson: value => JSON.parse(value || '[]') },
        '@/lib/technical-data': { parseTechnicalDataJson: value => JSON.parse(value || '{}') },
    };
    const load = name => {
        const exports = {};
        const code = ts.transpileModule(fs.readFileSync(`apps/web-next/components/recipe/${name}.ts`, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText;
        new Function('exports', 'require', code)(exports, name => {
            if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
            return dependencies[name];
        });
        return exports;
    };
    return { states, draft: load('useRecipeDraft').useRecipeDraft(), serialize: load('useBomPreview').selectionToRecipeParts };
}

test('编辑和复制配方经过预览序列化保留原始 ID，非法值不被改成另一有效物料', () => {
    for (const action of ['startEdit', 'startClone']) {
        for (const partId of [71, 0, -1, true, '71', [71], undefined]) {
            const { states, draft, serialize } = fixture();
            const selection = { ...(partId !== undefined ? { partId } : {}), model: '旧名称', supplier: '甲', qty: 2 };
            const recipe = { id: 1, name: '配方', extraPartsJson: JSON.stringify([selection]), packingPartsJson: JSON.stringify([selection]) };
            const before = structuredClone(recipe);
            draft[action](recipe);
            for (const [index, packaging] of [[2, false], [3, true]]) {
                const rows = serialize(states[index], packaging);
                assert.deepEqual(rows[0].partId, partId);
                assert.equal(rows[0].model, selection.model);
                assert.equal(rows[0].qty, 2);
            }
            assert.deepEqual(recipe, before);
        }
    }
});
