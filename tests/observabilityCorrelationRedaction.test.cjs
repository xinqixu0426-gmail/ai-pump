const assert = require('node:assert/strict');
const test = require('node:test');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const observability = require('../api/services/observability.cjs');

function fakeRuntime() {
  const spans = [];
  const stack = [];
  const tracer = {
    startActiveSpan(name, options, operation) {
      const span = {
        id: `span-${spans.length + 1}`,
        parentId: stack.at(-1)?.id || null,
        name,
        attributes: { ...(options?.attributes || {}) },
        setAttribute(key, value) { this.attributes[key] = value; },
        setAttributes(attributes) { Object.assign(this.attributes, attributes); },
        setStatus(status) { this.status = status; },
        updateName(nextName) { this.name = nextName; },
        end() { this.ended = true; },
      };
      spans.push(span);
      stack.push(span);
      let result;
      try {
        result = operation(span);
      } catch (error) {
        stack.pop();
        throw error;
      }
      return Promise.resolve(result).finally(() => stack.pop());
    },
  };
  return {
    spans,
    phoenixModule: {
      register() {
        return { getTracer: () => tracer, async forceFlush() {}, async shutdown() {} };
      },
    },
  };
}

function enable(runtime, traceContent = 'metadata') {
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: traceContent },
    phoenixModule: runtime.phoenixModule,
    logger: { warn() {} },
  });
}

test.afterEach(() => observability.resetObservabilityForTesting());

test('secret and PII keys are omitted case-insensitively', () => {
  const attributes = observability.sanitizeTraceAttributes({
    'pump.ai.Authorization': 'P04_SECRET_API_KEY_SENTINEL',
    'pump.ai.DB_PASSWORD': 'P04_SECRET_PASSWORD_SENTINEL',
    'pump.ai.Customer_Email': 'P04_PII_EMAIL_SENTINEL',
    'pump.ai.customer_PHONE': 'P04_PII_PHONE_SENTINEL',
    'pump.ai.structure.count': 3,
  }, { mode: 'metadata' });
  assert.deepEqual(attributes, { 'pump.ai.structure.count': 3 });
  assert.equal(observability.isSensitiveTraceKey('Proxy-Authorization'), true);
  assert.equal(observability.isSensitiveTraceKey('MCP_SERVICE_TOKENS'), true);
});

test('business, tool, prompt and response values are suppressed', () => {
  const serialized = JSON.stringify(observability.sanitizeTraceAttributes({
    'pump.ai.business.value': 'P04_BUSINESS_VALUE_SENTINEL',
    'pump.ai.tool.argument.value': 'P04_TOOL_ARG_SENTINEL',
    'pump.ai.tool.result.value': 'P04_TOOL_RESULT_SENTINEL',
    'pump.ai.prompt': 'P04_PROMPT_SENTINEL',
    'pump.ai.response': 'P04_RESPONSE_SENTINEL',
    'pump.ai.tool.argument.key_count': 2,
  }, { mode: 'diagnostic' }));
  assert.equal(serialized, '{"pump.ai.tool.argument.key_count":2}');
});

test('content modes retain only approved structure', () => {
  const attrs = {
    'gen_ai.operation.name': 'chat',
    'pump.ai.structure.count': 2,
    'gen_ai.unapproved.custom': 'drop-standard-namespace-misuse',
    'vendor.unapproved': 'drop-me',
  };
  assert.deepEqual(observability.sanitizeTraceAttributes(attrs, { mode: 'off' }), {});
  assert.deepEqual(observability.sanitizeTraceAttributes(attrs, { mode: 'metadata' }), {
    'gen_ai.operation.name': 'chat',
    'pump.ai.structure.count': 2,
  });
  assert.deepEqual(observability.sanitizeTraceAttributes(attrs, { mode: 'diagnostic' }), {
    'gen_ai.operation.name': 'chat',
    'pump.ai.structure.count': 2,
  });
});

test('size guards bound strings, arrays and object inspection', () => {
  assert.equal(observability.sanitizeTraceValue('x'.repeat(400)).length,
    observability.MAX_TRACE_STRING_LENGTH);
  assert.equal(observability.sanitizeTraceValue(Array.from({ length: 50 }, (_, index) => index)).length,
    observability.MAX_TRACE_ARRAY_ITEMS);
  assert.equal(observability.sanitizeTraceValue(Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`key${index}`, index])
  )), `[Object keys=${observability.MAX_TRACE_OBJECT_KEYS}]`);
});

test('sanitizer is fail-open for hostile and unexpected values', () => {
  const circular = {};
  circular.self = circular;
  const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  const values = [circular, hostile, new Error('private'), Buffer.alloc(5), undefined, null, () => {}];
  for (const value of values) assert.doesNotThrow(() => observability.sanitizeTraceValue(value));
  assert.doesNotThrow(() => observability.sanitizeTraceAttributes(hostile));
});

test('hostile metadata cannot escape into the business path', async () => {
  const runtime = fakeRuntime();
  enable(runtime);
  const hostile = new Proxy({}, { ownKeys() { throw new Error('telemetry-only failure'); } });
  const marker = { success: true };
  assert.equal(await observability.withToolSpan({ toolName: 'safe_tool', args: hostile }, async () => marker), marker);
});

test('existing request and operation IDs correlate through Agent and Tool boundaries', async () => {
  const runtime = fakeRuntime();
  enable(runtime);
  const marker = { success: true, operationId: 'p04-operation-001', auditId: 'p04-audit-001' };
  const result = await runAiDispatcherV3({ requestId: 'p04-request-001' }, {
    runAiAgentRuntimeV3: () => observability.withToolSpan({
      toolName: 'p04_test_tool',
      operationId: 'p04-operation-001',
      args: { model: 'P04_TOOL_ARG_SENTINEL' },
    }, async () => marker),
  });
  assert.equal(result, marker);
  assert.equal(runtime.spans[0].attributes['pump.request.id'], 'p04-request-001');
  assert.equal(runtime.spans[1].attributes['pump.operation.id'], 'p04-operation-001');
  assert.equal(runtime.spans[1].attributes['pump.audit.id'], 'p04-audit-001');
  assert.equal(runtime.spans[1].parentId, runtime.spans[0].id);
  assert.doesNotMatch(JSON.stringify(runtime.spans), /P04_TOOL_ARG_SENTINEL/);
});

test('unsafe correlation values use hash without retaining raw input', async () => {
  const runtime = fakeRuntime();
  enable(runtime);
  await observability.withAgentSpan({ requestId: 'unsafe id with spaces' }, async () => true);
  assert.match(runtime.spans[0].attributes['pump.request.id_hash'], /^[a-f0-9]{24}$/);
  assert.equal(runtime.spans[0].attributes['pump.request.id'], undefined);
  assert.doesNotMatch(JSON.stringify(runtime.spans), /unsafe id with spaces/);
});

test('multiple existing operation IDs are retained without overwrite', async () => {
  const runtime = fakeRuntime();
  enable(runtime);
  await observability.withToolSpan({
    toolName: 'multi_operation_tool',
    operationId: 'p04-operation-001',
  }, async () => ({
    success: true,
    operationId: 'p04-operation-002',
    executionEvidence: { receipts: [{ operationId: 'p04-operation-003' }] },
  }));
  assert.deepEqual(runtime.spans[0].attributes['pump.operation.ids'], [
    'p04-operation-001',
    'p04-operation-002',
    'p04-operation-003',
  ]);
  assert.equal(runtime.spans[0].attributes['pump.operation.id_count'], 3);
});

test('off mode keeps span structure but removes business metadata and correlation', async () => {
  const runtime = fakeRuntime();
  enable(runtime, 'off');
  await observability.withAgentSpan({ requestId: 'p04-request-001', route: 'test' }, async () => true);
  assert.deepEqual(runtime.spans[0].attributes, { 'openinference.span.kind': 'AGENT' });
});

test('disabled observability remains a no-op with unchanged results and errors', async () => {
  observability.initializeObservability({ env: {}, logger: { warn() {} } });
  const marker = { unchanged: true };
  assert.equal(await observability.withAgentSpan({ requestId: 'p04-request-001' }, async () => marker), marker);
  const failure = new Error('business error');
  await assert.rejects(observability.withToolSpan({}, async () => { throw failure; }), error => error === failure);
});
