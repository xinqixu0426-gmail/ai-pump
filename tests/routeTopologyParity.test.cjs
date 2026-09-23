'use strict';
/**
 * E1-D — Production / Test Route Topology Parity
 *
 * Phase D 发现：`tests/helpers/ontologyHttpRuntimeFixture.cjs` 的路由挂载顺序与生产
 * `api.cjs` 不一致，导致 `GET /api/recipes/current-costs` 被 `GET /api/recipes/:id`
 * 吞掉并返回 400「非法配方ID」，使 `preview_recipe_cost`（无覆盖项路径）在测试面上失败。
 *
 * 本文件把「测试面拓扑 = 生产拓扑」变成可执行的契约：
 *   1. 从 api.cjs 解析真实挂载顺序（不手抄）；
 *   2. 断言 fixture 的顺序与之逐项一致；
 *   3. 端到端断言 current-costs 真的由 cost 路由处理。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { API_MOUNT_ORDER, startAiHttpRuntime } = require('./helpers/ontologyHttpRuntimeFixture.cjs');

const root = path.resolve(__dirname, '..');

/**
 * 从 api.cjs 解析真实挂载顺序（保持源码顺序）。
 * 支持两种写法：`app.use('/api/x', require('./api/routes/y.cjs'))` 与
 * `const costRouter = require('./api/routes/cost.cjs'); app.use('/api', costRouter)`。
 */
function productionMountOrder() {
    const source = fs.readFileSync(path.join(root, 'api.cjs'), 'utf8');
    const moduleByVariable = new Map();
    for (const match of source.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*'\.\/api\/routes\/([A-Za-z0-9]+)\.cjs'\s*\)/gu)) {
        moduleByVariable.set(match[1], `${match[2]}.cjs`);
    }
    const mounts = [];
    const pattern = /app\.use\(\s*'(\/api(?:\/[a-z0-9-]+)?)'\s*,\s*(?:require\(\s*'\.\/api\/routes\/([A-Za-z0-9]+)\.cjs'\s*\)|([A-Za-z0-9_]+))/gu;
    for (const match of source.matchAll(pattern)) {
        const moduleName = match[2] ? `${match[2]}.cjs` : moduleByVariable.get(match[3]);
        if (moduleName) mounts.push(`${match[1]}::${moduleName}`);
    }
    return mounts;
}

test('E1-D-1 TEST_ROUTE_ORDER_MATCHES_PRODUCTION：测试面挂载顺序等于生产顺序', () => {
    const production = productionMountOrder();
    assert.ok(production.length >= 10, `api.cjs 解析到的挂载点过少：${production.length}`);
    const fixture = [...API_MOUNT_ORDER];
    // 只看 fixture 覆盖到的模块：顺序必须与生产完全一致（生产可能有 fixture 不需要的额外挂载）。
    const productionRestricted = production.filter(entry => fixture.includes(entry));
    assert.deepEqual(fixture, productionRestricted,
        'fixture 挂载顺序与 api.cjs 漂移；请同步 API_MOUNT_ORDER（尤其 costRouter 必须早于 /api/recipes）');
});

test('E1-D-2 costRouter 必须先于参数化配方路由（历史缺陷点）', () => {
    const order = [...API_MOUNT_ORDER];
    const costIndex = order.indexOf('/api::cost.cjs');
    const recipesIndex = order.indexOf('/api/recipes::recipes.cjs');
    assert.ok(costIndex >= 0 && recipesIndex >= 0);
    assert.ok(costIndex < recipesIndex,
        'costRouter 必须挂在 /api/recipes 之前，否则 /api/recipes/current-costs 会被 :id 参数路由吞掉');
});

test('E1-D-3 端到端：测试面上 /api/recipes/current-costs 不得被参数路由吞掉', async () => {
    const runtime = await startAiHttpRuntime();
    try {
        const headers = { 'content-type': 'application/json', 'x-internal-secret': runtime.internalSecret };
        const response = await fetch(`${runtime.baseUrl}/api/recipes/current-costs`, { headers });
        const payload = await response.json();
        // `/api/recipes/:id` 吞掉时的签名是 `{success:false, error:'非法配方ID'}`（无 code）；
        // cost 路由的失败带正式 error.code。前者出现即说明拓扑又漂移了。
        assert.notEqual(payload.error, '非法配方ID', `current-costs 被参数路由吞掉：${JSON.stringify(payload).slice(0, 120)}`);
        assert.ok(response.status === 200 || typeof payload.code === 'string',
            `current-costs 必须由 cost 路由处理：${JSON.stringify(payload).slice(0, 120)}`);
        // 参数路由本身仍必须可达（两条路由共存，不是用屏蔽换来的）。
        const detail = await fetch(`${runtime.baseUrl}/api/recipes/1`, { headers });
        const detailPayload = await detail.json();
        assert.notEqual(detailPayload.error, 'API 不存在', '参数化配方路由必须仍然可达');
    } finally {
        await runtime.close();
    }
});
