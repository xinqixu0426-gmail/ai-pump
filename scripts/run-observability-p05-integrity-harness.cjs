const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p05-trace-'));
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = '1';
process.env.PUMP_TEST_DATABASE_PATH = path.join(tempDirectory, 'pump-{pid}.db');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const {
  initializeObservability,
  safeForceFlush,
  safeShutdown,
  withEntityNormalizationSpan,
  withRoutingSpan,
  withToolSpan,
  withVerificationSpan,
} = require('../api/services/observability.cjs');

const SENTINELS = Object.freeze({
  secret: 'P05_SECRET_SENTINEL',
  pii: 'P05_PII_SENTINEL',
  business: 'P05_BUSINESS_VALUE_SENTINEL',
  toolArgument: 'P05_TOOL_ARG_SENTINEL',
  toolResult: 'P05_TOOL_RESULT_SENTINEL',
  rawEntity: 'P05_RAW_ENTITY_SENTINEL',
  normalizedEntity: 'P05_NORMALIZED_ENTITY_SENTINEL',
  prompt: 'P05_PROMPT_SENTINEL',
  response: 'P05_RESPONSE_SENTINEL',
});

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

async function fakeModel(messages, options = {}) {
  await delay(Number(options.syntheticDelayMs) || 1);
  options.onProvider?.({ provider: 'test', model: 'test-model' });
  if (options.syntheticFailure === 'model') {
    const error = new RangeError('synthetic model failure');
    error.code = 'P05_MODEL_FAILURE';
    throw error;
  }
  return { ok: true, text: SENTINELS.response, messageCount: messages.length };
}

function runtimeFor(run) {
  return async input => {
    const firstModel = await input.fetchAiProvider([
      { role: 'user', content: SENTINELS.prompt },
    ], {
      stream: false,
      tools: [{ type: 'function', function: { name: 'p05_test_tool' } }],
      syntheticDelayMs: run.delayMs,
      syntheticFailure: run.failure === 'model' ? 'model' : null,
    });

    withEntityNormalizationSpan({
      entityType: 'recipe',
      input: SENTINELS.rawEntity,
      output: SENTINELS.normalizedEntity,
    }, () => SENTINELS.normalizedEntity);

    const route = withRoutingSpan({
      availableToolCount: 1,
      routeSource: 'p05_fixture',
      executor: 'test',
      access: 'read',
    }, () => ({ status: 'selected', capabilityName: 'p05_test_tool' }));

    let toolResult;
    try {
      toolResult = await withToolSpan({
        toolName: 'p05_test_tool',
        executorType: 'test',
        access: 'read',
        capability: 'p05.synthetic.read',
        operationId: run.operationId,
        args: {
          api_key: SENTINELS.secret,
          customer_email: SENTINELS.pii,
          recipeName: SENTINELS.business,
          model: SENTINELS.toolArgument,
        },
      }, async () => {
        await delay(run.delayMs);
        if (run.failure === 'tool') {
          const error = new TypeError('synthetic tool failure');
          error.code = 'P05_TOOL_FAILURE';
          throw error;
        }
        return {
          success: true,
          operationId: run.operationId,
          visible: 'synthetic-tool-visible',
          hiddenResult: SENTINELS.toolResult,
        };
      });
    } catch (error) {
      return {
        status: 'tool_error',
        errorType: error.name,
        errorCode: error.code,
      };
    }

    const secondModel = await input.fetchAiProvider([], {
      stream: false,
      tools: [],
      syntheticDelayMs: run.delayMs,
    });
    const verified = withVerificationSpan({
      status: run.failure === 'verification' ? 'failed_unverified' : 'completed',
      requiredCount: 1,
      observedCount: run.failure === 'verification' ? 0 : 1,
      missingCount: run.failure === 'verification' ? 1 : 0,
      toolExecutionCount: 1,
      llmCallCount: 2,
    }, () => run.failure !== 'verification');

    return {
      status: verified ? 'completed' : 'failed_unverified',
      route: route.status,
      toolVisible: toolResult.visible,
      firstModelOk: firstModel.ok,
      secondModelOk: secondModel.ok,
      finalResponse: 'p05-deterministic-response',
    };
  };
}

async function executeRun(run) {
  try {
    const output = await runAiDispatcherV3({
      requestId: run.requestId,
      stream: false,
      fetchAiProvider: fakeModel,
    }, { runAiAgentRuntimeV3: runtimeFor(run) });
    return { requestId: run.requestId, operationId: run.operationId, output };
  } catch (error) {
    return {
      requestId: run.requestId,
      operationId: run.operationId,
      output: { status: 'model_error', errorType: error.name, errorCode: error.code },
    };
  }
}

function createRuns(prefix, count, failure = null) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    return {
      requestId: `${prefix}-request-${suffix}`,
      operationId: `${prefix}-operation-${suffix}`,
      delayMs: (index % 3) + 1,
      failure,
    };
  });
}

async function benchmark(count) {
  const warmupRuns = createRuns('p05-warmup', 5);
  for (const run of warmupRuns) await executeRun(run);
  const durations = [];
  for (const run of createRuns('p05-bench', count)) {
    const started = process.hrtime.bigint();
    await executeRun(run);
    durations.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return {
    runs: count,
    warmupRuns: warmupRuns.length,
    medianMs: Number(percentile(sorted, 50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 95).toFixed(3)),
    meanMs: Number(mean.toFixed(3)),
  };
}

async function main() {
  const scenario = argument('scenario', 'normal');
  const count = Math.max(1, Number(argument('count', '1')) || 1);
  const failure = argument('failure', null);
  initializeObservability();

  let result;
  if (scenario === 'batch') {
    result = await Promise.all(createRuns(argument('prefix', 'p05-batch'), count, failure).map(executeRun));
  } else if (scenario === 'benchmark') {
    result = await benchmark(count);
  } else {
    result = await executeRun({
      requestId: argument('request-id', 'p05-request-001'),
      operationId: argument('operation-id', 'p05-operation-001'),
      delayMs: 2,
      failure,
    });
  }

  const flushed = await safeForceFlush();
  const shutdown = await safeShutdown();
  const summary = {
    scenario,
    enabled: process.env.AI_OBSERVABILITY_ENABLED === 'true',
    traceContent: process.env.AI_TRACE_CONTENT || 'metadata',
    result,
    canonicalHash: canonicalHash(result),
    flushed,
    shutdown,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error?.name || 'HarnessError' })}\n`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    const { db, stopBackupScheduler, waitForBackupIdle } = require('../api/db.cjs');
    stopBackupScheduler();
    await waitForBackupIdle();
    if (db.open) db.close();
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
