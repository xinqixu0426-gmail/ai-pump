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

const BUSINESS_ROUTES = ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates', 'knowledge'];
const READ_ONLY_PREVIEWS = [
    /^\/api\/coils\/calculate$/,
    /^\/api\/cost\/(?:full-estimate|dynamic|parts)$/,
    /^\/api\/recipes\/(?:bom-draft|cost-draft|[1-9][0-9]*\/cost-preview)$/,
    /^\/api\/templates\/[1-9][0-9]*\/cost-preview$/,
];

async function startAiHttpRuntime() {
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
        for (const name of BUSINESS_ROUTES) app.use(`/api/${name}`, require(`../../api/routes/${name}.cjs`));
        app.use('/api', require('../../api/routes/cost.cjs'));
        app.use(require('../../api/routes/ai/conversations.cjs'));
        app.use(require('../../api/routes/ai/personalMemory.cjs'));
        app.use(require('../../api/routes/ai/chat.cjs').router);
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

module.exports = { startAiHttpRuntime, BUSINESS_ROUTES, READ_ONLY_PREVIEWS };
