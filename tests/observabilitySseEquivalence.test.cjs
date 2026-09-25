const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p05-sse-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(tempDirectory, 'pump-{pid}.db');

const { handleAiChat } = require('../api/routes/ai/chat.cjs');
const { createAiRuntimeTelemetry } = require('../api/services/aiRuntimeTelemetry.cjs');
const observability = require('../api/services/observability.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

// NATIVE-R2：AI 入口冻结为 OWNER-ONLY。本测试以规范 Owner 身份驱动真实 chat 处理器。
const OWNER_ENV = Object.freeze({
  ACCESS_PASSWORD: 'sse-equivalence-access',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret',
  PUMP_OWNER_ACCESS_PASSWORD: 'sse-equivalence-owner-password-0123456789abcdef',
  PUMP_OWNER_SUBJECT: 'sse_equivalence_owner',
  AI_V5_OWNER_SUBJECTS: '["sse_equivalence_owner"]',
  AI_NATIVE_MODE: 'owner',
});
const OWNER_TOKEN = issueOwnerToken(OWNER_ENV.PUMP_OWNER_ACCESS_PASSWORD, OWNER_ENV);

function fakeTracingModule() {
  const tracer = {
    startActiveSpan(_name, _options, operation) {
      const span = {
        setAttribute() {}, setAttributes() {}, setStatus() {}, updateName() {}, end() {},
      };
      return operation(span);
    },
  };
  return {
    register() {
      return { getTracer: () => tracer, async forceFlush() {}, async shutdown() {} };
    },
  };
}

function requestResponse() {
  const req = new EventEmitter();
  req.body = { messages: [{ role: 'user', content: 'synthetic' }] };
  req.requestId = 'p05-sse-request';
  req.headers = {};
  req.cookies = { token: OWNER_TOKEN };
  const res = new EventEmitter();
  res.headers = {};
  res.output = '';
  res.writableEnded = false;
  res.destroyed = false;
  res.statusCode = 200;
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.output = JSON.stringify(body); res.writableEnded = true; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.flushHeaders = () => {};
  res.flush = () => {};
  res.write = chunk => { res.output += String(chunk); return true; };
  res.end = () => { res.writableEnded = true; };
  return { req, res };
}

async function capture(enabled) {
  await observability.resetObservabilityForTesting();
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: enabled ? 'true' : 'false' },
    ...(enabled ? { phoenixModule: fakeTracingModule() } : {}),
    logger: { warn() {} },
  });
  const { req, res } = requestResponse();
  const telemetry = createAiRuntimeTelemetry();
  await handleAiChat(req, res, {
    env: OWNER_ENV,
    heartbeatMs: 1000,
    timeoutMs: 100,
    telemetry,
    runAiDispatcherV3: input => observability.withAgentSpan({
      requestId: input.requestId,
      streaming: true,
    }, async () => {
      input.onProvider({ provider: 'test', model: 'test-model' });
      input.emit('content', { content: 'synthetic-content' });
      input.emit('done', {});
      return { telemetry: { outcome: 'completed', toolSteps: [] } };
    }),
  });
  const totals = telemetry.snapshot().totals;
  const stableOutput = res.output.replace(
    /"(durationMs|firstContentMs)":\d+/g,
    '"$1":"<dynamic>"'
  );
  return {
    headers: res.headers,
    output: stableOutput,
    writableEnded: res.writableEnded,
    totals: {
      total: totals.total,
      completed: totals.completed,
      failed: totals.failed,
      cancelled: totals.cancelled,
    },
  };
}

test('SSE event types, order, payload and termination are equivalent OFF vs ON', async () => {
  const disabled = await capture(false);
  const enabled = await capture(true);
  assert.deepEqual(enabled, disabled);
  assert.match(enabled.output, /"type":"provider"/);
  assert.match(enabled.output, /"type":"content"/);
  assert.match(enabled.output, /"type":"metrics"/);
  assert.match(enabled.output, /"type":"done"/);
  assert.ok(enabled.output.indexOf('"type":"provider"') < enabled.output.indexOf('"type":"content"'));
  assert.ok(enabled.output.indexOf('"type":"content"') < enabled.output.indexOf('"type":"done"'));
  assert.ok(enabled.output.indexOf('"type":"metrics"') < enabled.output.indexOf('"type":"done"'));
});

test.after(async () => {
  await observability.resetObservabilityForTesting();
  const { db, stopBackupScheduler, waitForBackupIdle } = require('../api/db.cjs');
  stopBackupScheduler();
  await waitForBackupIdle();
  if (db.open) db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});
