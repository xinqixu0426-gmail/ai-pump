const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createMcpRouter } = require('../api/routes/mcp.cjs');

const TOKEN = 'mcp-conformance-token-0123456789abcdef';

function verifiedResult() {
    return {
        success: true,
        data: {},
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/conformance' }],
        },
    };
}

async function listen(app) {
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return server;
}

async function closeServer(server) {
    await new Promise((resolve, reject) => server.close(error => (
        error ? reject(error) : resolve()
    )));
}

async function run() {
    const router = createMcpRouter({
        env: {
            MCP_ENABLED: 'true',
            MCP_CLIENT_ID: 'conformance',
            MCP_TOKEN: TOKEN,
            MCP_RATE_LIMIT_PER_MINUTE: '600',
        },
        executeToolCall: async () => verifiedResult(),
    });
    const app = express();
    app.use(express.json());
    // 官方 CLI 目前没有自定义 Header 参数；只在本地测试宿主内注入测试凭证。
    app.use((req, res, next) => {
        req.headers.authorization = `Bearer ${TOKEN}`;
        req.requestId = 'mcp-conformance';
        next();
    });
    app.use('/mcp', router);
    const server = await listen(app);
    let failed = false;
    try {
        const address = server.address();
        const cli = path.join(
            __dirname,
            '..',
            'node_modules',
            '@modelcontextprotocol',
            'conformance',
            'dist',
            'index.js'
        );
        const scenarios = [
            'server-initialize',
            'ping',
            'tools-list',
            'dns-rebinding-protection',
        ];
        for (const scenario of scenarios) {
            const child = spawn(process.execPath, [
                cli,
                'server',
                '--url',
                `http://127.0.0.1:${address.port}/mcp`,
                '--scenario',
                scenario,
                '--verbose',
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
            child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
            const timeout = setTimeout(() => child.kill(), 30000);
            const exitCode = await new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', code => resolve(code ?? 1));
            });
            clearTimeout(timeout);
            process.stdout.write(output);
            if (exitCode !== 0 || /"status"\s*:\s*"FAILURE"/.test(output)) failed = true;
        }
    } finally {
        await closeServer(server);
        await router.closeMcpHandler();
    }
    if (failed) process.exitCode = 1;
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
