const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const observability = require('../api/services/observability.cjs');
const {
  validateContextIsolation,
  validateTraceIntegrity,
} = require('../scripts/observability-trace-integrity.cjs');

function fakeTracingRuntime() {
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
      if (result && typeof result.then === 'function') {
        return result.finally(() => stack.pop());
      }
      stack.pop();
      return result;
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

function phoenixSpan({ traceId = 'trace-a', spanId, parentId = null, name, start, end, attributes = {} }) {
  return {
    name,
    context: { trace_id: traceId, span_id: spanId },
    parent_id: parentId,
    start_time: `2026-09-04T00:00:00.${String(start).padStart(3, '0')}Z`,
    end_time: `2026-09-04T00:00:00.${String(end).padStart(3, '0')}Z`,
    attributes,
  };
}

function validTrace(traceId = 'trace-a', requestId = 'p05-request-a', operationId = 'p05-operation-a') {
  return [
    phoenixSpan({ traceId, spanId: `${traceId}-root`, name: 'invoke_agent pump_factory_assistant', start: 0, end: 90,
      attributes: { 'pump.ai.trace.schema_version': 1, 'pump.request.id': requestId } }),
    phoenixSpan({ traceId, spanId: `${traceId}-llm1`, parentId: `${traceId}-root`, name: 'chat test-model', start: 10, end: 20 }),
    phoenixSpan({ traceId, spanId: `${traceId}-route`, parentId: `${traceId}-root`, name: 'pump.ai.route', start: 25, end: 30 }),
    phoenixSpan({ traceId, spanId: `${traceId}-tool`, parentId: `${traceId}-root`, name: 'execute_tool p05_test_tool', start: 35, end: 45,
      attributes: { 'pump.operation.id': operationId } }),
    phoenixSpan({ traceId, spanId: `${traceId}-llm2`, parentId: `${traceId}-root`, name: 'chat test-model', start: 50, end: 60 }),
    phoenixSpan({ traceId, spanId: `${traceId}-verify`, parentId: `${traceId}-root`, name: 'pump.ai.verify', start: 70, end: 80 }),
  ];
}

async function deterministicOutcome(enabled, failure = null) {
  await observability.resetObservabilityForTesting();
  const tracing = fakeTracingRuntime();
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: enabled ? 'true' : 'false' },
    ...(enabled ? { phoenixModule: tracing.phoenixModule } : {}),
    logger: { warn() {} },
  });
  try {
    return await runAiDispatcherV3({
      requestId: 'p05-request-equivalence',
      fetchAiProvider: async (_messages, options = {}) => {
        options.onProvider?.({ provider: 'test', model: 'test-model' });
        if (failure === 'model') throw Object.assign(new RangeError('model'), { code: 'MODEL_FAILURE' });
        return { ok: true };
      },
    }, {
      runAiAgentRuntimeV3: async input => {
        try {
          await input.fetchAiProvider([], { tools: [] });
        } catch (error) {
          return { status: 'model_error', type: error.name, code: error.code };
        }
        try {
          await observability.withToolSpan({
            toolName: 'p05_test_tool',
            operationId: 'p05-operation-equivalence',
          }, async () => {
            if (failure === 'tool') throw Object.assign(new TypeError('tool'), { code: 'TOOL_FAILURE' });
            return { success: true };
          });
        } catch (error) {
          return { status: 'tool_error', type: error.name, code: error.code };
        }
        const verified = observability.withVerificationSpan({
          status: failure === 'verification' ? 'failed_unverified' : 'completed',
          toolExecutionCount: 1,
        }, () => failure !== 'verification');
        return { status: verified ? 'completed' : 'failed_unverified', result: 'same' };
      },
    });
  } finally {
    await observability.resetObservabilityForTesting();
  }
}

test.afterEach(() => observability.resetObservabilityForTesting());

test('schema v1 is present on Agent root and is the only off-mode custom metadata', async () => {
  const runtime = fakeTracingRuntime();
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'off' },
    phoenixModule: runtime.phoenixModule,
    logger: { warn() {} },
  });
  await observability.withAgentSpan({ requestId: 'p05-request-a', route: 'hidden' }, async () => true);
  assert.equal(observability.PUMP_AI_TRACE_SCHEMA_VERSION, 1);
  assert.deepEqual(runtime.spans[0].attributes, {
    'openinference.span.kind': 'AGENT',
    'pump.ai.trace.schema_version': 1,
  });
});

test('integrity validator accepts schema-valid parentage and canonical order', () => {
  const result = validateTraceIntegrity(validTrace());
  assert.equal(result.pass, true);
  assert.equal(result.root_count, 1);
  assert.equal(result.orphan_count, 0);
  assert.equal(result.duplicate_span_id_count, 0);
  assert.equal(result.invalid_parent_count, 0);
  assert.equal(result.span_after_root_end_count, 0);
  assert.equal(result.execution_order, 'PASS');
});

test('integrity validator detects orphan, duplicate, invalid order and root-boundary violations', () => {
  const spans = validTrace();
  spans[1].parent_id = 'missing';
  spans[2].context.span_id = spans[1].context.span_id;
  spans[3].end_time = '2026-09-04T00:00:00.999Z';
  spans[4].start_time = '2026-09-04T00:00:00.005Z';
  const result = validateTraceIntegrity(spans);
  assert.equal(result.pass, false);
  assert.ok(result.orphan_count > 0);
  assert.ok(result.duplicate_span_id_count > 0);
  assert.ok(result.span_after_root_end_count > 0);
  assert.equal(result.execution_order, 'FAIL');
});

test('context validator accepts isolated traces and rejects cross-operation contamination', () => {
  const spans = [
    ...validTrace('trace-a', 'p05-request-a', 'p05-operation-a'),
    ...validTrace('trace-b', 'p05-request-b', 'p05-operation-b'),
  ];
  const expected = [
    { requestId: 'p05-request-a', operationId: 'p05-operation-a' },
    { requestId: 'p05-request-b', operationId: 'p05-operation-b' },
  ];
  assert.equal(validateContextIsolation(spans, expected).pass, true);
  spans.at(-3).attributes['pump.operation.id'] = 'p05-operation-a';
  const contaminated = validateContextIsolation(spans, expected);
  assert.equal(contaminated.pass, false);
  assert.equal(contaminated.cross_operation_contamination_count, 1);
});

test('normal path is behaviorally equivalent with observability disabled and enabled', async () => {
  assert.deepEqual(await deterministicOutcome(false), await deterministicOutcome(true));
});

test('model error path is behaviorally equivalent', async () => {
  assert.deepEqual(await deterministicOutcome(false, 'model'), await deterministicOutcome(true, 'model'));
});

test('tool error path is behaviorally equivalent', async () => {
  assert.deepEqual(await deterministicOutcome(false, 'tool'), await deterministicOutcome(true, 'tool'));
});

test('verification failure path is behaviorally equivalent', async () => {
  assert.deepEqual(await deterministicOutcome(false, 'verification'), await deterministicOutcome(true, 'verification'));
});

test('P05 harness establishes test database isolation before loading business modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-observability-p05-integrity-harness.cjs'), 'utf8');
  const isolationIndex = source.indexOf("process.env.PUMP_TEST_DATABASE_PATH");
  const dispatcherIndex = source.indexOf("require('../api/services/aiDispatcherV3.cjs')");
  assert.ok(isolationIndex >= 0 && dispatcherIndex > isolationIndex);
});
