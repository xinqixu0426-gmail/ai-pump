const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadResolver() {
    const moduleUrl = pathToFileURL(path.resolve(
        __dirname,
        '../apps/web-next/lib/inline-part-resolution.ts'
    )).href;
    return import(moduleUrl);
}

function part(overrides = {}) {
    return {
        id: 1,
        model: '6204',
        category: '轴承',
        subcategory: '',
        price: 8,
        supplier: '供应商A',
        stock: 0,
        ...overrides,
    };
}

function input(overrides = {}) {
    return {
        model: '6204',
        category: '轴承',
        subcategory: '',
        price: 8,
        supplier: '供应商A',
        stock: 0,
        ...overrides,
    };
}

test('就地建档 resolver 复用同身份同分类记录且不调用创建', async () => {
    const { resolveInlineCatalogPart } = await loadResolver();
    let createCalls = 0;
    const existing = part();
    const result = await resolveInlineCatalogPart({
        input: input({ model: ' 6204 ', supplier: '供应商a' }),
        readParts: async () => [existing],
        createPart: async () => {
            createCalls += 1;
            return part({ id: 2 });
        },
    });
    assert.equal(result.created, false);
    assert.equal(result.part.id, existing.id);
    assert.equal(createCalls, 0);
});

test('就地建档 resolver 拒绝跨分类和包装二级分类冲突', async () => {
    const { resolveInlineCatalogPart } = await loadResolver();
    await assert.rejects(
        resolveInlineCatalogPart({
            input: input({ category: '油封' }),
            readParts: async () => [part()],
            createPart: async () => part({ id: 2 }),
        }),
        /不能从当前表单静默改为/
    );
    await assert.rejects(
        resolveInlineCatalogPart({
            input: input({ category: '包装', subcategory: '内衬' }),
            readParts: async () => [part({ category: '包装', subcategory: '外包装' })],
            createPart: async () => part({ id: 2 }),
        }),
        /已属于“外包装”/
    );
});

test('就地建档 resolver 使用正式拒重策略并在写后回读正式目录', async () => {
    const { resolveInlineCatalogPart } = await loadResolver();
    const created = part({ id: 3, supplier: '供应商B', price: 9 });
    let reads = 0;
    let beforeCreateCalls = 0;
    let submitted;
    const result = await resolveInlineCatalogPart({
        input: input({ supplier: '供应商B', price: 9 }),
        readParts: async () => {
            reads += 1;
            return reads === 1 ? [part()] : [created, part()];
        },
        createPart: async (value) => {
            submitted = value;
            return created;
        },
        beforeCreate: async () => {
            beforeCreateCalls += 1;
        },
    });
    assert.equal(reads, 2);
    assert.equal(beforeCreateCalls, 1);
    assert.equal(submitted.duplicatePolicy, 'reject');
    assert.equal(result.created, true);
    assert.equal(result.part.id, created.id);
    assert.deepEqual(result.rows.map((row) => row.id), [3, 1]);
});

test('就地建档 resolver 在创建或写后刷新失败时不返回成功', async () => {
    const { resolveInlineCatalogPart } = await loadResolver();
    await assert.rejects(
        resolveInlineCatalogPart({
            input: input(),
            readParts: async () => [],
            createPart: async () => { throw new Error('创建失败'); },
        }),
        /创建失败/
    );
    let reads = 0;
    await assert.rejects(
        resolveInlineCatalogPart({
            input: input(),
            readParts: async () => {
                reads += 1;
                if (reads === 1) return [];
                throw new Error('刷新失败');
            },
            createPart: async () => part({ id: 4 }),
        }),
        /刷新失败/
    );
});

test('就地建档 resolver 在并发拒重后回读并选中另一请求刚创建的正式记录', async () => {
    const { resolveInlineCatalogPart } = await loadResolver();
    const concurrent = part({ id: 5 });
    let reads = 0;
    const result = await resolveInlineCatalogPart({
        input: input(),
        readParts: async () => {
            reads += 1;
            return reads === 1 ? [] : [concurrent];
        },
        createPart: async () => { throw new Error('part_identity_conflict'); },
    });
    assert.equal(reads, 2);
    assert.equal(result.created, false);
    assert.equal(result.part.id, concurrent.id);
});
