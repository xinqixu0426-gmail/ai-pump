const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p04-trace-'));
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = '1';
process.env.PUMP_TEST_DATABASE_PATH = path.join(tempDirectory, 'pump-{pid}.db');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const {
  initializeObservability,
  safeForceFlush,
  safeShutdown,
  withToolSpan,
} = require('../api/services/observability.cjs');

const REQUEST_ID = 'p04-request-001';
const OPERATION_ID = 'p04-operation-001';
const AUDIT_ID = 'p04-audit-001';

async function syntheticRuntime() {
  const toolResult = await withToolSpan({
    toolName: 'p04_correlation_test_tool',
    executorType: 'test',
    access: 'read',
    capability: 'p04.synthetic.read',
    operationId: OPERATION_ID,
    args: {
      api_key: 'P04_SECRET_API_KEY_SENTINEL',
      password: 'P04_SECRET_PASSWORD_SENTINEL',
      customer_email: 'P04_PII_EMAIL_SENTINEL',
      customer_phone: 'P04_PII_PHONE_SENTINEL',
      recipeName: 'P04_BUSINESS_VALUE_SENTINEL',
      model: 'P04_TOOL_ARG_SENTINEL',
    },
  }, async () => ({
    success: true,
    operationId: OPERATION_ID,
    auditId: AUDIT_ID,
    result: 'P04_TOOL_RESULT_SENTINEL',
  }));
  return {
    finalContent: 'p04-correlation-success',
    operationMatched: toolResult.operationId === OPERATION_ID,
  };
}

async function main() {
  try {
    initializeObservability();
    const result = await runAiDispatcherV3({
      requestId: REQUEST_ID,
      stream: false,
    }, { runAiAgentRuntimeV3: syntheticRuntime });
    const flushed = await safeForceFlush();
    const shutdown = await safeShutdown();
    const summary = {
      businessResult: result.finalContent,
      requestCorrelation: REQUEST_ID,
      operationCorrelation: OPERATION_ID,
      operationMatched: result.operationMatched,
      flushed,
      shutdown,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (result.finalContent !== 'p04-correlation-success'
      || !result.operationMatched) process.exitCode = 1;
  } finally {
    const { db, stopBackupScheduler, waitForBackupIdle } = require('../api/db.cjs');
    stopBackupScheduler();
    await waitForBackupIdle();
    if (db.open) db.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    status: 'failed',
    errorType: error instanceof Error ? error.name : 'HarnessError',
  })}\n`);
  process.exitCode = 1;
});
