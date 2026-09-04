const assert = require('node:assert/strict');
const test = require('node:test');

const observability = require('../api/services/observability.cjs');

function silentLogger() {
  return { warn() {} };
}

test.afterEach(async () => {
  await observability.resetObservabilityForTesting();
});

test('observability defaults to disabled with metadata content mode', () => {
  const config = observability.readObservabilityConfig({}, { logger: silentLogger() });
  assert.equal(config.enabled, false);
  assert.equal(config.traceContent, 'metadata');
  assert.equal(config.project, 'pump-ai-v4-baseline');
  assert.equal(config.collectorEndpoint, 'http://127.0.0.1:6006');
});

test('only the exact value true enables observability', () => {
  assert.equal(observability.readObservabilityConfig({
    AI_OBSERVABILITY_ENABLED: 'true',
  }, { logger: silentLogger() }).enabled, true);

  for (const value of ['1', 'yes', 'on', 'TRUE', 'banana']) {
    assert.equal(observability.readObservabilityConfig({
      AI_OBSERVABILITY_ENABLED: value,
    }, { logger: silentLogger() }).enabled, false);
  }
});

test('trace content accepts only off, metadata, and diagnostic', () => {
  for (const mode of ['off', 'metadata', 'diagnostic']) {
    assert.equal(observability.readObservabilityConfig({
      AI_TRACE_CONTENT: mode,
    }, { logger: silentLogger() }).traceContent, mode);
  }
  assert.equal(observability.readObservabilityConfig({
    AI_TRACE_CONTENT: 'random',
  }, { logger: silentLogger() }).traceContent, 'off');
});

test('privacy configuration hides every supported content surface', () => {
  const privacy = observability.readObservabilityConfig({}, {
    logger: silentLogger(),
  }).privacy;
  assert.equal(privacy.hideInputs, true);
  assert.equal(privacy.hideOutputs, true);
  assert.equal(privacy.hideInputMessages, true);
  assert.equal(privacy.hideOutputMessages, true);
  assert.equal(privacy.hideInputText, true);
  assert.equal(privacy.hideOutputText, true);
  assert.equal(privacy.hidePrompts, true);
  assert.equal(privacy.hideLLMTools, true);
});

test('disabled bootstrap is a no-op and does not load Phoenix', () => {
  let loaded = false;
  const state = observability.initializeObservability({
    env: {},
    logger: silentLogger(),
    phoenixModule: {
      register() {
        loaded = true;
      },
    },
  });
  assert.equal(loaded, false);
  assert.equal(state.status, 'disabled');
  assert.equal(observability.emitSyntheticSmokeSpan(), null);
});

test('bootstrap registration failure is fail-open', () => {
  assert.doesNotThrow(() => observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: 'true' },
    logger: silentLogger(),
    phoenixModule: {
      register() {
        throw new TypeError('synthetic registration failure');
      },
    },
  }));
  const state = observability.getObservabilityState();
  assert.equal(state.status, 'degraded');
  assert.equal(state.lastErrorType, 'TypeError');
});

test('invalid collector configuration degrades without loading Phoenix', () => {
  let loaded = false;
  const state = observability.initializeObservability({
    env: {
      AI_OBSERVABILITY_ENABLED: 'true',
      PHOENIX_COLLECTOR_ENDPOINT: 'not-a-url',
    },
    logger: silentLogger(),
    phoenixModule: {
      register() {
        loaded = true;
      },
    },
  });
  assert.equal(loaded, false);
  assert.equal(state.status, 'degraded');
  assert.equal(state.lastErrorType, 'InvalidCollectorEndpoint');
});

test('safe flush and shutdown contain telemetry failures', async () => {
  observability.initializeObservability({
    env: { AI_OBSERVABILITY_ENABLED: 'true' },
    logger: silentLogger(),
    phoenixModule: {
      register() {
        return {
          forceFlush: async () => { throw new Error('flush failed'); },
          shutdown: async () => { throw new Error('shutdown failed'); },
        };
      },
    },
  });

  assert.equal(await observability.safeForceFlush({ logger: silentLogger() }), false);
  assert.equal(await observability.safeShutdown({ logger: silentLogger() }), false);
  assert.equal(observability.getObservabilityState().status, 'degraded');
});
