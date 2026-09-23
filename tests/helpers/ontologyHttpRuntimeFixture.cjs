'use strict';
/**
 * ONT-P7 isolated HTTP runtime fixture.
 *
 * Starts the REAL `POST /api/ai/chat` SSE entry point (plus the read-only business routes the tools
 * call) over an isolated temporary database, so the promotion can be validated through the actual
 * user-facing transport instead of only through internal functions.
 *
 * Nothing here touches a production database: the fixture always uses its own temp file, and the
 * business surface is restricted to GET plus the existing read-only previews.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUSINESS_ROUTES = [
    ['recipes', 'recipes'], ['coils', 'coils'], ['orders', 'orders'], ['quotations', 'quotations'],
    ['customers', 'customers'], ['parts', 'parts'], ['templates', 'templates'], ['knowledge', 'knowledge'],
    ['business-changes', 'businessChanges'], ['workbench', 'workbench'], ['inventory', 'inventory'],
];

/**
 * E1-D：业务面挂载顺序必须与生产 `api.cjs` 一致。
 *
 * 生产顺序里 `costRouter` 挂在 `/api` 上、**先于** `/api/recipes`，因此
 * `GET /api/recipes/current-costs` 由 cost 路由处理；顺序反了会被
 * `/api/recipes/:id` 参数路由吞掉并返回 400「非法配方ID」，使
 * `preview_recipe_cost`（无覆盖项的常见路径）在测试面上静默失败。
 *
 * 该列表由 `tests/routeTopologyParity.test.cjs` 从 `api.cjs` 解析后比对，
 * 未来漂移会直接失败。
 */
const API_MOUNT_ORDER = Object.freeze([
    '/api::cost.cjs',
    '/api/parts::parts.cjs',
    '/api/catalog::catalog.cjs',
    '/api/recipes::recipes.cjs',
    '/api/templates::templates.cjs',
    '/api/model-variants::modelVariants.cjs',
    '/api/orders::orders.cjs',
    '/api/inventory::inventory.cjs',
    '/api/coils::coils.cjs',
    '/api/rotor::rotor.cjs',
    '/api/settings::settings.cjs',
    '/api/customers::customers.cjs',
    '/api/quotations::quotations.cjs',
    '/api/workbench::workbench.cjs',
    '/api/quality::quality.cjs',
    '/api/files::files.cjs',
    '/api/knowledge::knowledge.cjs',
    '/api/business-changes::businessChanges.cjs',
]);
const READ_ONLY_PREVIEWS = [
    /^\/api\/coils\/calculate$/,
    /^\/api\/cost\/(?:full-estimate|dynamic|parts|profitability-preview)$/,
    /^\/api\/inventory\/virtual-readiness-preview$/,
    /^\/api\/recipes\/(?:bom-draft|cost-draft|[1-9][0-9]*\/cost-preview)$/,
    /^\/api\/recipes\/[1-9][0-9]*\/scenario-compare-preview$/,
    /^\/api\/templates\/[1-9][0-9]*\/cost-preview$/,
];

async function startAiHttpRuntime(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-http-runtime-'));
    const filename = path.join(directory, 'fixture.db');
    const internalSecret = 'p7-http-runtime-internal-secret';
    try {
        require('./ontologyShadowFixture.cjs').fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'p7-http-runtime',
            PUMP_TEST_DATABASE_PATH: filename, INTERNAL_SECRET: internalSecret,
            KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const express = require('express');
        const app = express();
        app.use(express.json({ limit: '4mb' }));
        // The read-only guard protects the BUSINESS surface. The AI entry point is mounted below it and
        // must stay reachable, since it is the transport under test.
        app.use((req, res, next) => req.path.startsWith('/api/ai/') ? next()
            : req.method === 'GET' || (req.method === 'POST' && READ_ONLY_PREVIEWS.some(pattern => pattern.test(req.path)))
                ? next()
                : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' }));
        // 顺序与生产 api.cjs 一致：costRouter 先挂，避免 /api/recipes/:id 抢走 /recipes/current-costs。
        app.use('/api', require('../../api/routes/cost.cjs'));
        for (const [mountPath, moduleName] of BUSINESS_ROUTES) app.use(`/api/${mountPath}`, require(`../../api/routes/${moduleName}.cjs`));
        app.use('/api/catalog', require('../../api/routes/catalog.cjs'));
        app.use('/api/model-variants', require('../../api/routes/modelVariants.cjs'));
        app.use('/api/rotor', require('../../api/routes/rotor.cjs'));
        app.use('/api/settings', require('../../api/routes/settings.cjs'));
        app.use('/api/quality', require('../../api/routes/quality.cjs'));
        app.use('/api/files', require('../../api/routes/files.cjs'));
        app.use(require('../../api/routes/ai/conversations.cjs'));
        app.use(require('../../api/routes/ai/personalMemory.cjs'));
        const chat = require('../../api/routes/ai/chat.cjs');
        app.use(options.aiChatOptions ? chat.createAiChatRouter(options.aiChatOptions) : chat.router);
        const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        // The runtime's internal fetch targets process.env.PORT, so it must be set before any request.
        process.env.PORT = String(server.address().port);
        const db = require('../../api/db.cjs').db;
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        return {
            baseUrl, internalSecret, db, filename,
            headers: () => ({ 'content-type': 'application/json', 'x-internal-secret': internalSecret }),
            close: async () => {
                await new Promise(resolve => server.close(resolve));
                if (db?.open) db.close();
                const resolved = path.resolve(directory);
                if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('INVALID_FIXTURE_DIRECTORY');
                fs.rmSync(resolved, { recursive: true, force: true });
            },
        };
    } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}

module.exports = { startAiHttpRuntime, BUSINESS_ROUTES, READ_ONLY_PREVIEWS, API_MOUNT_ORDER };
