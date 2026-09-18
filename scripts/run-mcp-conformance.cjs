const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createMcpRouter } = require('../api/routes/mcp.cjs');

const TOKEN = 'mcp-conformance-token-0123456789abcdef';
const WINDOWS_LIBUV_ASSERTION = 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)';

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

function isSuccessfulConformanceOutput(output) {
    const summary = output.match(/Passed:\s+(\d+)\/(\d+),\s+0 failed,\s+0 warnings/);
    return Boolean(
        summary
        && Number(summary[1]) > 0
        && summary[1] === summary[2]
        && !/"status"\s*:\s*"FAILURE"/.test(output)
    );
}

function isKnownWindowsTeardownFailure(exitCode, output) {
    return process.platform === 'win32'
        && exitCode !== 0
        && isSuccessfulConformanceOutput(output)
        && output.includes(WINDOWS_LIBUV_ASSERTION)
        && /win\\async\.c, line \d+\s*$/.test(output);
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
    const windowsTeardownWarnings = [];
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
            if (isKnownWindowsTeardownFailure(exitCode, output)) {
                windowsTeardownWarnings.push(scenario);
            } else if (exitCode !== 0 || !isSuccessfulConformanceOutput(output)) {
                failed = true;
            }
        }
    } finally {
        await closeServer(server);
        await router.closeMcpHandler();
    }
    if (windowsTeardownWarnings.length > 0) {
        console.warn(
            `[mcp-conformance] Windows Node 在官方 CLI 完整输出成功摘要后的退出阶段触发已知 libuv 断言；`
            + `场景结果保留为通过，退出兼容警告: ${windowsTeardownWarnings.join(', ')}`
        );
    }
    if (failed) process.exitCode = 1;
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
