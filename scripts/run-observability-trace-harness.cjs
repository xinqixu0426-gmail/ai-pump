const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p03a-trace-'));
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

async function fakeModel(_messages, options = {}) {
  await new Promise(resolve => setTimeout(resolve, 2));
  options.onProvider?.({ provider: 'test', model: 'test-model' });
  return { ok: true, status: 200 };
}

async function fakeRuntime(input) {
  await input.fetchAiProvider([], {
    tools: [{ type: 'function', function: { name: 'observability_test_tool' } }],
    stream: false,
    onProvider: input.onProvider,
  });
  const toolResult = await withToolSpan({
    toolName: 'observability_test_tool',
    executorType: 'test',
    access: 'read',
    args: { syntheticKey: 'never-export-this-value' },
  }, async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return { success: true, syntheticResult: 'never-export-this-result' };
  });
  await input.fetchAiProvider([], {
    tools: [],
    stream: false,
    onProvider: input.onProvider,
  });
  return { finalContent: 'synthetic-success', toolResult };
}

async function main() {
  try {
    initializeObservability();
    const result = await runAiDispatcherV3({
      fetchAiProvider: fakeModel,
      stream: false,
      onProvider() {},
    }, { runAiAgentRuntimeV3: fakeRuntime });
    const flushed = await safeForceFlush();
    const shutdown = await safeShutdown();
    process.stdout.write(`${JSON.stringify({
      businessResult: result.finalContent,
      toolSuccess: result.toolResult.success,
      flushed,
      shutdown,
    })}\n`);
    if (result.finalContent !== 'synthetic-success'
      || result.toolResult.success !== true) {
      process.exitCode = 1;
    }
  } finally {
    const {
      db,
      stopBackupScheduler,
      waitForBackupIdle,
    } = require('../api/db.cjs');
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
