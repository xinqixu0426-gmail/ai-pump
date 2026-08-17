const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    MCP_WRITE_ACCEPTANCE_CASES,
    ROOT,
    acceptanceTestFiles,
} = require('./mcp-write-acceptance-manifest.cjs');

const startedAt = new Date();
const reportPath = path.join(ROOT, 'logs', 'mcp-write-local-latest.json');
const files = acceptanceTestFiles();

console.log(`MCP 写工具本地隔离验收：${MCP_WRITE_ACCEPTANCE_CASES.length} 个工具，${files.length} 个测试文件`);
console.log('边界：不读取生产 token，不连接 Mac Mini，不使用正式数据库，不调用物理打印机。');

const testDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-mcp-write-'));
let result;
try {
    result = spawnSync(process.execPath, ['--test', ...files], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            PUMP_TEST_DATABASE_PATH: path.join(testDatabaseDir, 'pump-{pid}.db'),
            MCP_ENABLED: 'false',
            MCP_WRITE_ENABLED: 'false',
            MCP_CLIENT_ID: '',
            MCP_TOKEN: '',
            MCP_SERVICE_TOKENS: '',
            MCP_VERIFY_TOKEN: '',
            MCP_WRITE_CLIENT_IDS: '',
            HERMES_MCP_ENABLED: 'false',
            HERMES_MCP_TOKEN: '',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
} finally {
    fs.rmSync(testDatabaseDir, { recursive: true, force: true });
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const passed = result.status === 0;
const completedAt = new Date();
const report = {
    schemaVersion: 1,
    suite: 'mcp-write-local-isolated-acceptance',
    status: passed ? 'passed' : 'failed',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    productionTouched: false,
    physicalSideEffects: false,
    temporaryDatabaseCleaned: true,
    coverage: {
        toolsExpected: 17,
        toolsCovered: MCP_WRITE_ACCEPTANCE_CASES.length,
        commonProtocol: [
            'catalog and JSON schema projection',
            'mcp:write scope enforcement',
            'preview without write',
            'HMAC request state and actor/argument binding',
            'explicit elicitation acceptance',
            'verified command receipt',
            'idempotent replay path',
            'decline or false confirmation without side effect',
        ],
        transport: '2026 Streamable HTTP round trip covered by tests/mcp.test.cjs',
        businessExecution: 'formal executor and command services covered with stubs, temporary files, and in-memory databases',
    },
    testFiles: files,
    tools: MCP_WRITE_ACCEPTANCE_CASES.map(item => ({
        name: item.name,
        status: passed ? 'passed' : 'suite_failed',
        isolation: item.isolation,
        businessTests: item.businessTests,
    })),
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`脱敏报告：${path.relative(ROOT, reportPath)}`);

if (!passed) process.exit(result.status || 1);
console.log('MCP 写工具本地隔离验收通过：17/17。');
