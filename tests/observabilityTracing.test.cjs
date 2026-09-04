const assert = require('node:assert/strict');
const test = require('node:test');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const observability = require('../api/services/observability.cjs');

function fakeTracingRuntime() {
  const spans = [];
  const stack = [];
  let nextId = 1;
  const tracer = {
    startActiveSpan(name, options, operation) {
      const span = {
        id: `span-${nextId++}`,
        parentId: stack.at(-1)?.id || null,
        name,
        attributes: { ...(options?.attributes || {}) },
        status: null,
        ended: false,
        setAttribute(key, value) {
          this.attributes[key] = value;
          return this;
        },
        setAttributes(attributes) {
          Object.assign(this.attributes, attributes);
          return this;
        },
        setStatus(status) {
          this.status = status;
          return this;
        },
        updateName(nextName) {
          this.name = nextName;
          return this;
        },
        end() {
          this.ended = true;
        },
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
      return Promise.resolve(result).finally(() => {
        assert.equal(stack.pop(), span);
      });
    },
  };
  const provider = {
    getTracer() { return tracer; },
    async forceFlush() {},
    async shutdown() {},
  };
  return {
    spans,
    phoenixModule: { register() { return provider; } },
  };
}

function enableTracing(runtime, env = {}) {
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: 'true', ...env },
    phoenixModule: runtime.phoenixModule,
    logger: { warn() {} },
  });
}

test.afterEach(async () => {
  await observability.resetObservabilityForTesting();
});

test('disabled wrappers are no-ops and preserve result and error identity', async () => {
  observability.initializeObservability({ env: {}, logger: { warn() {} } });
  const marker = { unchanged: true };
  assert.equal(await observability.withAgentSpan({}, async () => marker), marker);
  const original = new Error('business failure');
  await assert.rejects(
    observability.withToolSpan({ toolName: 'x' }, async () => { throw original; }),
    error => error === original
  );
});

test('agent root span closes successfully without changing result', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const marker = { ok: true };
  assert.equal(await observability.withAgentSpan({ streaming: true }, async () => marker), marker);
  assert.equal(runtime.spans.length, 1);
  assert.equal(runtime.spans[0].name, 'invoke_agent pump_factory_assistant');
  assert.equal(runtime.spans[0].attributes['openinference.span.kind'], 'AGENT');
  assert.equal(runtime.spans[0].status.code, 1);
  assert.equal(runtime.spans[0].ended, true);
});

test('agent failure closes error span and preserves original error', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const original = new TypeError('private failure detail');
  await assert.rejects(
    observability.withAgentSpan({}, async () => { throw original; }),
    error => error === original
  );
  assert.equal(runtime.spans[0].status.code, 2);
  assert.equal(runtime.spans[0].attributes['pump.ai.error.type'], 'TypeError');
  assert.equal(runtime.spans[0].ended, true);
  assert.doesNotMatch(JSON.stringify(runtime.spans[0]), /private failure detail/);
});

test('dispatcher creates agent root with model children and preserves provider result', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const providerResult = { response: true };
  const result = await runAiDispatcherV3({
    stream: true,
    fetchAiProvider: async (_messages, options) => {
      await Promise.resolve();
      options.onProvider?.({ provider: 'test-provider', model: 'test-model' });
      return providerResult;
    },
  }, {
    runAiAgentRuntimeV3: async input => {
      const first = await input.fetchAiProvider([], { tools: [{}], stream: true });
      const second = await input.fetchAiProvider([], { tools: [], stream: false });
      return { first, second };
    },
  });
  assert.equal(result.first, providerResult);
  assert.equal(result.second, providerResult);
  assert.deepEqual(runtime.spans.map(span => span.name), [
    'invoke_agent pump_factory_assistant',
    'chat test-model',
    'chat test-model',
  ]);
  assert.equal(runtime.spans[1].parentId, runtime.spans[0].id);
  assert.equal(runtime.spans[2].parentId, runtime.spans[0].id);
  assert.equal(runtime.spans[1].attributes['openinference.span.kind'], 'LLM');
});

test('model failure closes error child and preserves original error', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const original = new RangeError('model payload detail');
  const provider = observability.traceModelProvider(async () => { throw original; });
  await assert.rejects(
    observability.withAgentSpan({}, () => provider([], { stream: false })),
    error => error === original
  );
  assert.equal(runtime.spans[1].status.code, 2);
  assert.equal(runtime.spans[1].attributes['pump.ai.error.type'], 'RangeError');
  assert.doesNotMatch(JSON.stringify(runtime.spans[1]), /model payload detail/);
});

test('tool success and returned failure are children with unchanged results', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const success = { success: true, payload: 'private-result' };
  const failure = { success: false, error: 'private-tool-error' };
  const results = await observability.withAgentSpan({}, async () => [
    await observability.withToolSpan({
      toolName: 'test_tool',
      executorType: 'test',
      access: 'read',
      args: { entityName: 'private-argument' },
    }, async () => success),
    await observability.withToolSpan({ toolName: 'test_tool', args: {} }, async () => failure),
  ]);
  assert.equal(results[0], success);
  assert.equal(results[1], failure);
  assert.equal(runtime.spans[1].parentId, runtime.spans[0].id);
  assert.equal(runtime.spans[1].attributes['openinference.span.kind'], 'TOOL');
  assert.equal(runtime.spans[1].status.code, 1);
  assert.equal(runtime.spans[2].status.code, 2);
});

test('tool thrown failure preserves error and metadata never contains payload values', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime, { AI_TRACE_CONTENT: 'diagnostic' });
  const original = new Error('secret-tool-result');
  await assert.rejects(observability.withToolSpan({
    toolName: 'privacy_tool',
    executorType: 'query',
    access: 'read',
    args: {
      recipeName: 'secret-tool-argument',
      authorization: 'secret-auth-value',
    },
  }, async () => { throw original; }), error => error === original);
  const serialized = JSON.stringify(runtime.spans);
  assert.doesNotMatch(serialized, /secret-tool-argument/);
  assert.doesNotMatch(serialized, /secret-auth-value/);
  assert.doesNotMatch(serialized, /secret-tool-result/);
  assert.match(serialized, /recipeName/);
  assert.doesNotMatch(serialized, /authorization/);
});
