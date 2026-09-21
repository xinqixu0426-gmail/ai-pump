const test = require('node:test');
const assert = require('node:assert/strict');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// 12-220 的两套正式方案（生产真实数据形状）：钢带/小眼 COIL-0006、冷轧/国标眼 COIL-0010。
const COILS = [
    { id: 6, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0006', schemeStatus: 'official', isDefault: 1, cost: 166.9728, stock: 0 },
    { id: 10, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', schemeCode: 'COIL-0010', schemeStatus: 'official', isDefault: 1, cost: 196.1669, stock: 0 },
    { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0002', schemeStatus: 'official', isDefault: 1, cost: 116.99, stock: 0 },
];

function installFetchStub(handler) {
    const calls = [];
    global.fetch = async (url, options = {}) => {
        const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
        calls.push(call);
        return handler(call);
    };
    return calls;
}

test.afterEach(() => { global.fetch = originalFetch; });

test('线圈成本：按材质收窄时附上同规格片数的其它正式方案', async () => {
    const calls = installFetchStub((call) => {
        if (call.url.includes('/api/coils/calculate')) {
            return jsonResponse({ success: true, data: { coilId: 6, schemeCode: 'COIL-0006', spec: '12', sheets: 220, material: '钢带', slotType: '小眼', totalCost: 166.97 } });
        }
        if (call.url.includes('/api/coils')) {
            return jsonResponse({ success: true, data: COILS });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('calculate_coil_cost', {
        spec: '12', sheets: 220, material: '钢带', slotType: '小眼',
    }, { allowWrite: false });

    assert.equal(result.success, true);
    assert.equal(result.data.totalCost, 166.97);
    assert.deepEqual(result.data.sameSpecSheetsVariants.map(item => item.schemeCode), ['COIL-0010']);
    assert.match(result.data.sameSpecSheetsNotice, /12-220/);
    assert.match(result.data.sameSpecSheetsNotice, /不是该规格片数的唯一成本/);
    assert.ok(calls.some(call => call.url.includes('/api/coils?')));
});

test('线圈成本：该规格片数只有一套正式方案时不附加歧义提示', async () => {
    installFetchStub((call) => {
        if (call.url.includes('/api/coils/calculate')) {
            return jsonResponse({ success: true, data: { coilId: 2, schemeCode: 'COIL-0002', spec: '12', sheets: 140, material: '钢带', slotType: '小眼', totalCost: 116.99 } });
        }
        if (call.url.includes('/api/coils')) return jsonResponse({ success: true, data: COILS });
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const result = await executeToolCall('calculate_coil_cost', { spec: '12', sheets: 140 }, { allowWrite: false });
    assert.equal(result.success, true);
    assert.equal(result.data.sameSpecSheetsVariants, undefined);
    assert.equal(result.data.sameSpecSheetsNotice, undefined);
});

test('线圈查询：按材质收窄时提示同一规格片数的其它正式方案，普通查询不提示', async () => {
    installFetchStub((call) => {
        if (call.url.includes('/api/coils')) {
            // 仿真正式 API 的筛选语义：按 spec/sheets/material 过滤。
            const query = new URL(call.url).searchParams;
            const filtered = COILS.filter(coil => (
                (!query.get('spec') || coil.spec === query.get('spec'))
                && (!query.get('sheets') || coil.sheets === Number(query.get('sheets')))
                && (!query.get('material') || coil.material === query.get('material'))
            ));
            return jsonResponse({ success: true, data: filtered });
        }
        return jsonResponse({ success: false, error: `unexpected ${call.method} ${call.url}` }, 500);
    });

    const narrowed = await executeToolCall('search_coils', { spec: '12', sheets: 220, material: '钢带' }, { allowWrite: false });
    assert.equal(narrowed.success, true);
    assert.equal(narrowed.count, 1);
    assert.deepEqual(narrowed.sameSpecSheetsVariants.map(item => item.schemeCode), ['COIL-0010']);

    const plain = await executeToolCall('search_coils', { spec: '12', sheets: 220 }, { allowWrite: false });
    assert.equal(plain.count, 2);
    assert.equal(plain.sameSpecSheetsVariants, undefined);
});
