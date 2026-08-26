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
const e2eReportPath = path.join(ROOT, 'logs', 'mcp-write-local-e2e-latest.json');
const files = acceptanceTestFiles();

console.log(`MCP 写工具本地隔离验收：${MCP_WRITE_ACCEPTANCE_CASES.length} 个工具，${files.length} 个测试文件`);
console.log('边界：不读取生产 token，不连接 Mac Mini，不使用正式数据库，不调用物理打印机。');

const testDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-mcp-write-'));
const isolatedEnv = {
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
    MCP_WRITE_TOOL_ALLOWLISTS: '',
    HERMES_MCP_ENABLED: 'false',
    HERMES_MCP_TOKEN: '',
};
let matrixResult;
try {
    matrixResult = spawnSync(process.execPath, ['--test', ...files], {
        cwd: ROOT,
        env: isolatedEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
} finally {
    fs.rmSync(testDatabaseDir, { recursive: true, force: true });
}

if (matrixResult.stdout) process.stdout.write(matrixResult.stdout);
if (matrixResult.stderr) process.stderr.write(matrixResult.stderr);

let e2eResult = null;
let e2eReport = null;
if (matrixResult.status === 0) {
    console.log('快速矩阵通过，开始 17 个写工具的真实 localhost MCP → API → SQLite 回读闭环。');
    e2eResult = spawnSync(process.execPath, ['scripts/run-mcp-write-local-e2e.cjs'], {
        cwd: ROOT,
        env: isolatedEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (e2eResult.stdout) process.stdout.write(e2eResult.stdout);
    if (e2eResult.stderr) process.stderr.write(e2eResult.stderr);
    try {
        e2eReport = JSON.parse(fs.readFileSync(e2eReportPath, 'utf8'));
    } catch (error) {
        e2eReport = {
            status: 'failed',
            error: `无法读取 localhost E2E 报告: ${error.message}`,
        };
    }
}

const matrixPassed = matrixResult.status === 0;
const requiredReplayTools = [
    'create_order',
    'adjust_part_stock',
    'batch_update_prices',
    'sync_factory_knowledge',
];
const requiredFailureTools = [
    'update_order_item',
    'adjust_part_stock',
    'update_recipe',
    'archive_factory_file',
    'print_rotor_drawing',
];
const replayEvidence = Array.isArray(e2eReport?.idempotencyReplays)
    ? e2eReport.idempotencyReplays
    : [];
const failureEvidence = Array.isArray(e2eReport?.failedCalls)
    ? e2eReport.failedCalls
    : [];
const idempotencyReplayPassed = requiredReplayTools.every(name => replayEvidence.some(item => (
    item?.name === name
    && item?.idempotentReplay === true
    && item?.sideEffects === 0
    && typeof item?.operationId === 'string'
    && item.operationId.length > 0
)));
const businessFailurePassed = requiredFailureTools.every(name => failureEvidence.some(item => (
    item?.name === name
    && item?.sideEffects === 0
    && typeof item?.code === 'string'
    && item.code.length > 0
)));
const legacyCompatibilityPassed = e2eReport?.legacyCompatibility?.listedReadTools === 48
    && e2eReport?.legacyCompatibility?.readCall === 'passed'
    && e2eReport?.legacyCompatibility?.hiddenWrite === 'rejected'
    && e2eReport?.legacyCompatibility?.sideEffects === 0;
const e2ePassed = e2eResult?.status === 0
    && e2eReport?.status === 'passed'
    && e2eReport?.toolsPassed === MCP_WRITE_ACCEPTANCE_CASES.length
    && e2eReport?.productionTouched === false
    && e2eReport?.physicalSideEffects === false
    && e2eReport?.temporaryDatabaseCleaned === true
    && e2eReport?.persistentEvidence?.operationsVerified === MCP_WRITE_ACCEPTANCE_CASES.length
    && e2eReport?.persistentEvidence?.integrity === 'ok'
    && e2eReport?.persistentEvidence?.foreignKeyViolations === 0
    && legacyCompatibilityPassed
    && idempotencyReplayPassed
    && businessFailurePassed;
const passed = matrixPassed && e2ePassed;
const completedAt = new Date();
const report = {
    schemaVersion: 2,
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
        protocolMatrix: {
            status: matrixPassed ? 'passed' : 'failed',
            testFiles: files,
        },
        localhostE2E: e2eReport ? {
            status: e2eReport.status,
            protocolVersion: e2eReport.protocolVersion,
            toolsPassed: e2eReport.toolsPassed,
            operationsVerified: e2eReport.persistentEvidence?.operationsVerified || 0,
            databaseIntegrity: e2eReport.persistentEvidence?.integrity || null,
            foreignKeyViolations: e2eReport.persistentEvidence?.foreignKeyViolations ?? null,
            legacyCompatibility: {
                status: legacyCompatibilityPassed ? 'passed' : 'failed',
                listedReadTools: e2eReport.legacyCompatibility?.listedReadTools ?? null,
                readCall: e2eReport.legacyCompatibility?.readCall ?? null,
                hiddenWrite: e2eReport.legacyCompatibility?.hiddenWrite ?? null,
                sideEffects: e2eReport.legacyCompatibility?.sideEffects ?? null,
            },
            idempotencyReplays: {
                status: idempotencyReplayPassed ? 'passed' : 'failed',
                required: requiredReplayTools,
                verified: replayEvidence.map(item => item.name),
            },
            businessFailures: {
                status: businessFailurePassed ? 'passed' : 'failed',
                required: requiredFailureTools,
                verified: failureEvidence.map(item => ({
                    name: item.name,
                    code: item.code,
                    sideEffects: item.sideEffects,
                })),
            },
            declinedCallSideEffects: e2eReport.rejectedCall?.sideEffects ?? null,
            freecadStubCalls: e2eReport.externalStub?.freecadCalls ?? 0,
            printerStubCalls: e2eReport.externalStub?.printerCalls ?? 0,
            report: path.relative(ROOT, e2eReportPath),
        } : {
            status: 'not_run',
            reason: 'protocol_matrix_failed',
        },
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
        transport: '2025/2026 clients use real localhost Streamable HTTP transports',
        businessExecution: 'all 17 tools traverse MCP elicitation, formal executor/API, temporary SQLite operation/audit, and readback; external commands are counted stubs',
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

if (!passed) process.exit(matrixResult.status || e2eResult?.status || 1);
console.log('MCP 写工具本地隔离验收通过：17/17。');
