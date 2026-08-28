const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('../apps/web-next/node_modules/typescript');

const sourcePath = path.join(__dirname, '..', 'apps', 'web-next', 'lib', 'parts.ts');
const compiled = typescript.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2020,
    },
}).outputText;

function loadClient(responses = []) {
    const calls = [];
    const api = {
        createIdempotencyKey(prefix) {
            return `${prefix}:test`;
        },
        async proxyRequest(url, options = {}) {
            calls.push({ url, options });
            const response = responses.shift();
            if (!response) throw new Error(`缺少 ${url} 的测试响应`);
            return response;
        },
    };
    const loaded = { exports: {} };
    new Function('exports', 'require', 'module', compiled)(
        loaded.exports,
        request => {
            if (request === './api') return api;
            throw new Error(`不允许的测试依赖: ${request}`);
        },
        loaded,
    );
    return { client: loaded.exports, calls };
}

function input(overrides = {}) {
    return {
        model: 'P-CLIENT',
        category: '轴承',
        catalogUnitCost: 12.5,
        supplier: '供应商A',
        stock: 3,
        remark: '规范备注',
        ...overrides,
    };
}

test('零件客户端适配：目录成本在 API 边界映射为 price，备注保持规范 remark', () => {
    const { client } = loadClient();
    const payload = client.partInputToApi(input());

    assert.equal(payload.price, 12.5);
    assert.equal(payload.remark, '规范备注');
    assert.equal(payload.catalogUnitCost, undefined);
    assert.equal(payload.notes, undefined);
});

test('零件客户端适配：规范 remark 优先，只有旧 notes 时仍可兼容回填', () => {
    const { client } = loadClient();

    assert.equal(client.rowToPart({ id: 1, price: 3, remark: '', notes: '旧备注' }).remark, '');
    assert.equal(client.rowToPart({ id: 2, price: 4, notes: '仅旧备注' }).remark, '仅旧备注');
    assert.equal(client.rowToPart({ id: 3, price: 5 }).catalogUnitCost, 5);
});

test('零件客户端适配：单项创建发送规范 API 字段并返回规范页面模型', async () => {
    const { client, calls } = loadClient([{
        success: true,
        data: { id: 7, model: 'P-CLIENT', category: '轴承', price: 12.5, supplier: '供应商A', stock: 3, notes: '规范备注' },
    }]);

    const created = await client.createPart(input());
    const requestBody = JSON.parse(calls[0].options.body);
    assert.equal(requestBody.price, 12.5);
    assert.equal(requestBody.remark, '规范备注');
    assert.equal(requestBody.notes, undefined);
    assert.equal(requestBody.catalogUnitCost, undefined);
    assert.equal(created.catalogUnitCost, 12.5);
    assert.equal(created.remark, '规范备注');
});

test('零件客户端适配：批量预览和确认均归一化返回记录', async () => {
    const { client, calls } = loadClient([
        {
            success: true,
            data: {
                capabilityId: 'parts.batch_create',
                preview: true,
                confirmationToken: 'token',
                previewHash: 'hash',
                suggestedIdempotencyKey: 'batch:key',
                requestedCount: 1,
                createCount: 1,
                skippedCount: 0,
                parts: [{ model: 'P-BATCH', category: '轴承', price: 8, supplier: 'S', stock: 0, remark: '' }],
                skippedExisting: [{ id: 9, model: 'OLD', category: '轴承', price: 6, supplier: 'S', stock: 1, notes: '旧说明' }],
                warnings: [],
            },
        },
        {
            success: true,
            data: {
                status: 'completed',
                operationId: 'op-1',
                createdCount: 1,
                parts: [{ id: 10, model: 'P-BATCH', category: '轴承', price: 8, supplier: 'S', stock: 0, remark: '' }],
                auditIds: [1],
            },
        },
    ]);

    const preview = await client.previewPartBatchCreate([input({ model: 'P-BATCH', catalogUnitCost: 8, supplier: 'S', stock: 0, remark: '' })]);
    assert.deepEqual(JSON.parse(calls[0].options.body).parts[0], {
        model: 'P-BATCH',
        category: '轴承',
        supplier: 'S',
        stock: 0,
        price: 8,
        remark: '',
    });
    assert.equal(preview.parts[0].catalogUnitCost, 8);
    assert.equal(preview.skippedExisting[0].remark, '旧说明');

    const receipt = await client.confirmPartBatchCreate(preview);
    assert.equal(calls[1].options.headers['Idempotency-Key'], 'batch:key');
    assert.equal(receipt.parts[0].catalogUnitCost, 8);
    assert.equal(receipt.parts[0].remark, '');
});

test('零件客户端适配：编辑预览发送规范输入的兼容序列化结果', async () => {
    const { client, calls } = loadClient([
        { success: true, data: { confirmationToken: 'save-token', suggestedIdempotencyKey: 'save:key' } },
        { success: true, data: { id: 11, model: 'P-EDIT', category: '轴承', price: 15, supplier: 'S', stock: 2, remark: '编辑后', updatedAt: 'v2' } },
    ]);

    const updated = await client.updatePart(
        { id: 11, model: 'P-EDIT', category: '轴承', catalogUnitCost: 10, supplier: 'S', stock: 2, remark: '编辑前', updatedAt: 'v1' },
        input({ model: 'P-EDIT', catalogUnitCost: 15, supplier: 'S', stock: 2, remark: '编辑后' }),
    );
    const previewBody = JSON.parse(calls[0].options.body);
    assert.equal(previewBody.price, 15);
    assert.equal(previewBody.remark, '编辑后');
    assert.equal(previewBody.notes, undefined);
    assert.equal(previewBody.expectedUpdatedAt, 'v1');
    assert.equal(updated.catalogUnitCost, 15);
    assert.equal(updated.remark, '编辑后');
});
