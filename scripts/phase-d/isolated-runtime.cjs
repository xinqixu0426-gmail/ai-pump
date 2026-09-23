'use strict';
/**
 * PHASE D 隔离运行时：在**调用方指定的数据库副本**上启动真实的 HTTP 业务面 + AI 入口。
 *
 * 复用 ONT-P7 fixture 的路由白名单与只读守卫（业务面只允许 GET 与已登记的只读预览），
 * 只把数据来源从合成 fixture 换成真实数据库副本。任何情况下都不打开生产数据库或
 * 工作区 pump.db —— 调用方必须先自行复制到临时目录。
 */
const fs = require('node:fs');
const path = require('node:path');
const { BUSINESS_ROUTES, READ_ONLY_PREVIEWS } = require('../../tests/helpers/ontologyHttpRuntimeFixture.cjs');

// PHASE D 额外放行的**只读**计算端点。
// `/api/cost/recipe-difference` 是 compare_recipes 依赖的正式只读试算（costQueries 内为
// deferred 只读事务），ONT-P7 的预览白名单没有登记它，因此这里显式补上 —— 只影响本脚本
// 启动的运行时，不改动共享 fixture，也不放开任何业务写操作。
const PHASE_D_READ_ONLY_PREVIEWS = Object.freeze([
    /^\/api\/cost\/recipe-difference$/,
]);
const ALLOWED_READ_ONLY_PREVIEWS = Object.freeze([...READ_ONLY_PREVIEWS, ...PHASE_D_READ_ONLY_PREVIEWS]);

async function startPhaseDRuntime(databasePath, options = {}) {
    const resolved = path.resolve(databasePath);
    if (!fs.existsSync(resolved)) {
        throw Object.assign(new Error(`PHASE_D_DATABASE_MISSING ${resolved}`), { code: 'PHASE_D_DATABASE_MISSING' });
    }
    const internalSecret = options.internalSecret || `phase-d-${Math.random().toString(16).slice(2)}${Date.now()}`;
    Object.assign(process.env, {
        NODE_ENV: 'test',
        NODE_TEST_CONTEXT: 'phase-d-live',
        PUMP_TEST_DATABASE_PATH: resolved,
        INTERNAL_SECRET: internalSecret,
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
        KNOWLEDGE_VECTOR_ENABLED: 'false',
        KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
        ...(options.env || {}),
    });
    const express = require('express');
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    app.use((req, res, next) => (req.path.startsWith('/api/ai/') ? next()
        : req.method === 'GET' || (req.method === 'POST' && ALLOWED_READ_ONLY_PREVIEWS.some(pattern => pattern.test(req.path)))
            ? next()
            : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' })));
    // 挂载顺序必须与 api.cjs 一致：costRouter 在 `/api` 上先挂，
    // 它的 `/recipes/current-costs` 会被后挂的 `/api/recipes/:id` 抢走。
    app.use('/api', require('../../api/routes/cost.cjs'));
    for (const [mountPath, moduleName] of BUSINESS_ROUTES) {
        app.use(`/api/${mountPath}`, require(`../../api/routes/${moduleName}.cjs`));
    }
    app.use(require('../../api/routes/ai/conversations.cjs'));
    app.use(require('../../api/routes/ai/personalMemory.cjs'));
    const chat = require('../../api/routes/ai/chat.cjs');
    app.use(options.aiChatOptions ? chat.createAiChatRouter(options.aiChatOptions) : chat.router);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    process.env.PORT = String(server.address().port);
    const db = require('../../api/db.cjs').db;
    const totalChangesAtStart = db.prepare('SELECT total_changes() n').get().n;
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        internalSecret,
        db,
        databasePath: resolved,
        headers: () => ({ 'content-type': 'application/json', 'x-internal-secret': internalSecret }),
        businessWrites: () => db.prepare('SELECT total_changes() n').get().n - totalChangesAtStart,
        close: async () => {
            await new Promise(resolve => server.close(resolve));
            if (db?.open) db.close();
        },
    };
}

module.exports = { startPhaseDRuntime, BUSINESS_ROUTES, READ_ONLY_PREVIEWS, PHASE_D_READ_ONLY_PREVIEWS };
