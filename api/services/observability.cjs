const { createLogger } = require('../logger.cjs');

const DEFAULT_PROJECT = 'pump-ai-v4-baseline';
const DEFAULT_COLLECTOR_ENDPOINT = 'http://127.0.0.1:6006';
const DEFAULT_TRACE_CONTENT = 'metadata';
const TRACE_CONTENT_MODES = new Set(['off', 'metadata', 'diagnostic']);
const logger = createLogger('observability');

const PRIVACY_TRACE_CONFIG = Object.freeze({
  hideLLMTools: true,
  hideInputs: true,
  hideOutputs: true,
  hideInputMessages: true,
  hideOutputMessages: true,
  hideInputImages: true,
  hideInputText: true,
  hideOutputText: true,
  hideEmbeddingVectors: true,
  base64ImageMaxLength: 0,
  hidePrompts: true,
});

let provider = null;
let phoenix = null;
let state = initialState();

function initialState() {
  return {
    enabled: false,
    status: 'not_initialized',
    project: DEFAULT_PROJECT,
    collectorEndpoint: DEFAULT_COLLECTOR_ENDPOINT,
    traceContent: DEFAULT_TRACE_CONTENT,
    privacy: { ...PRIVACY_TRACE_CONFIG },
    autoInstrumentation: false,
    lastErrorType: null,
  };
}

function warn(targetLogger, message, meta) {
  try {
    targetLogger?.warn?.(message, meta);
  } catch {
    // Logging must never turn telemetry configuration into an application failure.
  }
}

function readObservabilityConfig(env = process.env, options = {}) {
  const targetLogger = options.logger || logger;
  const enabledValue = env.AI_OBSERVABILITY_ENABLED;
  const enabled = enabledValue === 'true';
  if (enabledValue !== undefined && enabledValue !== 'true' && enabledValue !== 'false') {
    warn(targetLogger, '忽略非法 AI_OBSERVABILITY_ENABLED，Observability 保持关闭', {
      state: 'disabled',
    });
  }

  const requestedTraceContent = env.AI_TRACE_CONTENT || DEFAULT_TRACE_CONTENT;
  const traceContent = TRACE_CONTENT_MODES.has(requestedTraceContent)
    ? requestedTraceContent
    : 'off';
  if (!TRACE_CONTENT_MODES.has(requestedTraceContent)) {
    warn(targetLogger, '忽略非法 AI_TRACE_CONTENT，采用保守模式', {
      state: 'content_off',
    });
  }

  const project = String(env.AI_OBSERVABILITY_PROJECT || '').trim() || DEFAULT_PROJECT;
  const collectorEndpoint = String(env.PHOENIX_COLLECTOR_ENDPOINT || '').trim()
    || DEFAULT_COLLECTOR_ENDPOINT;

  let endpointValid = false;
  try {
    const parsed = new URL(collectorEndpoint);
    endpointValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    endpointValid = false;
  }
  if (!endpointValid) {
    warn(targetLogger, 'Collector endpoint 非法，Observability 将安全降级', {
      state: 'invalid_endpoint',
    });
  }

  return Object.freeze({
    enabled,
    traceContent,
    project,
    collectorEndpoint,
    endpointValid,
    privacy: PRIVACY_TRACE_CONFIG,
  });
}

function errorType(error) {
  return error instanceof Error && error.name ? error.name : 'TelemetryError';
}

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid';
  }
}

function initializeObservability(options = {}) {
  const targetLogger = options.logger || logger;
  const config = readObservabilityConfig(options.env || process.env, { logger: targetLogger });
  state = {
    ...initialState(),
    enabled: config.enabled,
    project: config.project,
    collectorEndpoint: config.collectorEndpoint,
    traceContent: config.traceContent,
  };

  if (!config.enabled) {
    state.status = 'disabled';
    return getObservabilityState();
  }
  if (!config.endpointValid) {
    state.status = 'degraded';
    state.lastErrorType = 'InvalidCollectorEndpoint';
    return getObservabilityState();
  }

  try {
    phoenix = options.phoenixModule || require('@arizeai/phoenix-otel');
    provider = phoenix.register({
      projectName: config.project,
      url: config.collectorEndpoint,
      batch: true,
      global: true,
      instrumentations: [],
    });
    state.status = 'enabled';
  } catch (error) {
    provider = null;
    phoenix = null;
    state.status = 'degraded';
    state.lastErrorType = errorType(error);
    warn(targetLogger, 'Observability 初始化失败，应用将继续启动', {
      errorType: state.lastErrorType,
      endpointHost: endpointHost(config.collectorEndpoint),
      state: state.status,
    });
  }
  return getObservabilityState();
}

function getObservabilityState() {
  return {
    ...state,
    privacy: { ...state.privacy },
  };
}

async function safeForceFlush(options = {}) {
  if (!provider || typeof provider.forceFlush !== 'function') return true;
  try {
    await provider.forceFlush();
    return true;
  } catch (error) {
    warn(options.logger || logger, 'Observability flush 失败，业务流程不受影响', {
      errorType: errorType(error),
      endpointHost: endpointHost(state.collectorEndpoint),
      state: state.status,
    });
    return false;
  }
}

async function safeShutdown(options = {}) {
  const activeProvider = provider;
  provider = null;
  if (!activeProvider || typeof activeProvider.shutdown !== 'function') return true;
  try {
    await activeProvider.shutdown();
    state.status = state.enabled ? 'shutdown' : state.status;
    return true;
  } catch (error) {
    state.status = 'degraded';
    state.lastErrorType = errorType(error);
    warn(options.logger || logger, 'Observability shutdown 失败，应用将继续退出', {
      errorType: state.lastErrorType,
      endpointHost: endpointHost(state.collectorEndpoint),
      state: state.status,
    });
    return false;
  }
}

function emitSyntheticSmokeSpan() {
  if (!provider || state.status !== 'enabled') return null;
  const tracer = provider.getTracer('pump-ai-observability-p02');
  const span = tracer.startSpan('pump.observability.smoke', {
    attributes: {
      'test.synthetic': true,
      phase: 'P02',
      'project.identifier': state.project,
    },
  });
  const context = span.spanContext();
  span.end();
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    project: state.project,
  };
}

async function resetObservabilityForTesting() {
  await safeShutdown({ logger: { warn() {} } });
  provider = null;
  phoenix = null;
  state = initialState();
}

module.exports = {
  DEFAULT_COLLECTOR_ENDPOINT,
  DEFAULT_PROJECT,
  DEFAULT_TRACE_CONTENT,
  PRIVACY_TRACE_CONFIG,
  emitSyntheticSmokeSpan,
  getObservabilityState,
  initializeObservability,
  readObservabilityConfig,
  resetObservabilityForTesting,
  safeForceFlush,
  safeShutdown,
};
