const { createLogger } = require('../logger.cjs');
const { createHash } = require('node:crypto');

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
let openInferenceTracer = null;
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
    openInferenceTracer = null;
    state.status = 'enabled';
  } catch (error) {
    provider = null;
    phoenix = null;
    openInferenceTracer = null;
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
  openInferenceTracer = null;
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

function activeTracer() {
  if (!provider || state.status !== 'enabled' || typeof provider.getTracer !== 'function') {
    return null;
  }
  if (openInferenceTracer) return openInferenceTracer;
  const tracer = provider.getTracer('pump-ai-observability');
  openInferenceTracer = typeof phoenix?.OITracer === 'function'
    ? new phoenix.OITracer({ tracer, traceConfig: PRIVACY_TRACE_CONFIG })
    : tracer;
  return openInferenceTracer;
}

function safeSpanCall(operation) {
  try {
    return operation();
  } catch {
    return undefined;
  }
}

function safeLabel(value, fallback = 'unknown') {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
}

function safeArgumentKeys(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.keys(args)
    .filter(key => !/password|secret|token|api.?key|authorization|cookie/i.test(key))
    .slice(0, 50)
    .map(key => safeLabel(key));
}

function openInferenceKind(kind) {
  return phoenix?.OpenInferenceSpanKind?.[kind] || kind;
}

function spanStatusCode(status) {
  return phoenix?.SpanStatusCode?.[status] ?? (status === 'ERROR' ? 2 : 1);
}

async function withObservedSpan(spec, operation) {
  let tracer;
  try {
    tracer = activeTracer();
  } catch {
    tracer = null;
  }
  if (!tracer) return operation({ update() {} });

  let operationStarted = false;
  let operationCompleted = false;
  let operationResult;
  let operationError;
  try {
    return await tracer.startActiveSpan(spec.name, {
      attributes: {
        [phoenix?.SemanticConventions?.OPENINFERENCE_SPAN_KIND || 'openinference.span.kind']:
          openInferenceKind(spec.kind),
        ...spec.attributes,
      },
    }, async span => {
      operationStarted = true;
      const control = {
        update(update = {}) {
          if (update.name) safeSpanCall(() => span.updateName(safeLabel(update.name)));
          if (update.attributes) safeSpanCall(() => span.setAttributes(update.attributes));
        },
      };
      try {
        operationResult = await operation(control);
        if (typeof spec.resultStatus === 'function') {
          const resultStatus = spec.resultStatus(operationResult);
          if (resultStatus?.attributes) {
            safeSpanCall(() => span.setAttributes(resultStatus.attributes));
          }
          safeSpanCall(() => span.setStatus({
            code: spanStatusCode(resultStatus?.error ? 'ERROR' : 'OK'),
          }));
        } else {
          safeSpanCall(() => span.setStatus({ code: spanStatusCode('OK') }));
        }
        operationCompleted = true;
        return operationResult;
      } catch (error) {
        operationError = error;
        safeSpanCall(() => span.setAttribute('error.type', errorType(error)));
        safeSpanCall(() => span.setStatus({ code: spanStatusCode('ERROR') }));
        throw error;
      } finally {
        safeSpanCall(() => span.end());
      }
    });
  } catch (error) {
    if (operationError) throw operationError;
    if (operationCompleted) return operationResult;
    if (operationStarted) throw error;
    return operation({ update() {} });
  }
}

function withObservedSpanSync(spec, operation) {
  let tracer;
  try {
    tracer = activeTracer();
  } catch {
    tracer = null;
  }
  if (!tracer) return operation({ update() {} });

  let operationStarted = false;
  let operationCompleted = false;
  let operationResult;
  let operationError;
  try {
    return tracer.startActiveSpan(spec.name, {
      attributes: {
        [phoenix?.SemanticConventions?.OPENINFERENCE_SPAN_KIND || 'openinference.span.kind']:
          openInferenceKind(spec.kind),
        ...spec.attributes,
      },
    }, span => {
      operationStarted = true;
      const control = {
        update(update = {}) {
          if (update.name) safeSpanCall(() => span.updateName(safeLabel(update.name)));
          if (update.attributes) safeSpanCall(() => span.setAttributes(update.attributes));
        },
      };
      try {
        operationResult = operation(control);
        if (typeof spec.resultStatus === 'function') {
          const resultStatus = spec.resultStatus(operationResult);
          if (resultStatus?.attributes) safeSpanCall(() => span.setAttributes(resultStatus.attributes));
          safeSpanCall(() => span.setStatus({
            code: spanStatusCode(resultStatus?.error ? 'ERROR' : 'OK'),
          }));
        } else {
          safeSpanCall(() => span.setStatus({ code: spanStatusCode('OK') }));
        }
        operationCompleted = true;
        return operationResult;
      } catch (error) {
        operationError = error;
        safeSpanCall(() => span.setAttribute('error.type', errorType(error)));
        safeSpanCall(() => span.setStatus({ code: spanStatusCode('ERROR') }));
        throw error;
      } finally {
        safeSpanCall(() => span.end());
      }
    });
  } catch (error) {
    if (operationError) throw operationError;
    if (operationCompleted) return operationResult;
    if (operationStarted) throw error;
    return operation({ update() {} });
  }
}

function textShape(value) {
  const text = String(value || '');
  const characters = [...text];
  return Object.freeze({
    length: characters.length,
    punctuationCount: characters.filter(character => /\p{P}/u.test(character)).length,
    digitCount: characters.filter(character => /\p{N}/u.test(character)).length,
    alphaCount: characters.filter(character => /[A-Za-z]/u.test(character)).length,
    cjkCount: characters.filter(character => /\p{Script=Han}/u.test(character)).length,
  });
}

function stableIdHash(value) {
  if (value === undefined || value === null || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function withEntityNormalizationSpan(metadata = {}, operation) {
  const inputShape = textShape(metadata.input);
  return withObservedSpanSync({
    name: 'pump.ai.entity.normalize',
    kind: 'CHAIN',
    attributes: {
      'entity.type': safeLabel(metadata.entityType),
      'entity.input_length': inputShape.length,
      'entity.input_punctuation_count': inputShape.punctuationCount,
    },
    resultStatus(result) {
      const output = typeof metadata.output === 'function' ? metadata.output(result) : metadata.output;
      const outputShape = textShape(output);
      return {
        attributes: {
          'entity.output_length': outputShape.length,
          'entity.output_punctuation_count': outputShape.punctuationCount,
          'entity.length_delta': outputShape.length - inputShape.length,
          'entity.punctuation_delta': outputShape.punctuationCount - inputShape.punctuationCount,
          'entity.changed': String(metadata.input || '') !== String(output || ''),
        },
      };
    },
  }, operation);
}

function withEntityResolutionSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'pump.ai.entity.resolve',
    kind: 'CHAIN',
    attributes: {
      'entity.type': safeLabel(metadata.entityType),
    },
    resultStatus(result) {
      const receipt = result?.receipt || null;
      const status = safeLabel(result?.status, 'unknown');
      const selectedId = receipt?.selected?.stableIdentity?.primaryStableId
        ?? receipt?.selected?.id
        ?? null;
      const selectedIdHash = stableIdHash(selectedId);
      return {
        error: status === 'system_error',
        attributes: {
          'entity.candidate_count': Array.isArray(receipt?.candidates) ? receipt.candidates.length : 0,
          'entity.match_type': safeLabel(receipt?.selected?.matchKind || status),
          'entity.exact_match': status === 'exact',
          'entity.resolved': Boolean(receipt?.selected),
          'entity.ambiguity': status === 'ambiguous',
          'entity.resolver_path': 'ai_entity_resolver_v3',
          'entity.fallback_used': status === 'unique_candidate',
          ...(selectedIdHash ? { 'entity.resolved_id_hash': selectedIdHash } : {}),
        },
      };
    },
  }, operation);
}

function withRoutingSpan(metadata = {}, operation) {
  return withObservedSpanSync({
    name: 'pump.ai.route',
    kind: 'CHAIN',
    attributes: {
      'route.available_tool_count': Number(metadata.availableToolCount) || 0,
      'route.source': safeLabel(metadata.routeSource, 'v4_capability_broker'),
    },
    resultStatus(result) {
      const selected = result?.status === 'selected';
      return {
        attributes: {
          'route.selected_tool_name': selected ? safeLabel(result.capabilityName) : 'none',
          'route.selected_executor': selected ? safeLabel(metadata.executor) : 'none',
          ...(metadata.domain ? { 'route.selected_domain': safeLabel(metadata.domain) } : {}),
          'route.read_write_classification': safeLabel(metadata.access, 'read'),
          'route.success': selected,
          'route.decision': safeLabel(result?.status),
        },
      };
    },
  }, operation);
}

function verificationAttributes(metadata = {}, decision) {
  const toolExecutionCount = Math.max(0, Number(metadata.toolExecutionCount) || 0);
  const effectiveDecision = metadata.decision === undefined
    ? Boolean(decision)
    : Boolean(metadata.decision);
  return {
    'verification.decision': effectiveDecision,
    'verification.status': safeLabel(metadata.status || (effectiveDecision ? 'verified' : 'unverified')),
    'verification.required_count': Math.max(0, Number(metadata.requiredCount) || 0),
    'verification.observed_count': Math.max(0, Number(metadata.observedCount) || 0),
    'verification.missing_count': Math.max(0, Number(metadata.missingCount) || 0),
    'verification.early_exit': Boolean(metadata.earlyExit),
    'verification.tool_execution_count_before_verify': toolExecutionCount,
    'verification.before_any_tool_execution': toolExecutionCount === 0,
    ...(metadata.llmCallCount === undefined ? {} : {
      'verification.llm_call_count_before_verify': Math.max(0, Number(metadata.llmCallCount) || 0),
    }),
  };
}

function withVerificationSpan(metadata = {}, operation) {
  return withObservedSpanSync({
    name: 'pump.ai.verify',
    kind: 'CHAIN',
    attributes: {},
    resultStatus(result) {
      return { attributes: verificationAttributes(metadata, result) };
    },
  }, operation);
}

function withAgentSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'invoke_agent pump_factory_assistant',
    kind: 'AGENT',
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'assistant.runtime': 'pump_factory_assistant',
      'assistant.streaming': Boolean(metadata.streaming),
      ...(metadata.route ? { 'assistant.route': safeLabel(metadata.route) } : {}),
    },
  }, operation);
}

function withModelSpan(metadata = {}, operation) {
  const model = safeLabel(metadata.model);
  return withObservedSpan({
    name: `chat ${model}`,
    kind: 'LLM',
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': model,
      'gen_ai.provider.name': safeLabel(metadata.provider),
      'gen_ai.request.streaming': Boolean(metadata.streaming),
      'gen_ai.tool.definitions.count': Number(metadata.toolDefinitionCount) || 0,
    },
  }, operation);
}

function traceModelProvider(providerFunction) {
  if (typeof providerFunction !== 'function') return providerFunction;
  if (!provider || state.status !== 'enabled') return providerFunction;
  return (messages, options = {}) => withModelSpan({
    streaming: Boolean(options.stream),
    toolDefinitionCount: Array.isArray(options.tools) ? options.tools.length : 0,
  }, control => {
    const onProvider = options.onProvider;
    return providerFunction(messages, {
      ...options,
      onProvider(info = {}) {
        const model = safeLabel(info.model);
        control.update({
          name: `chat ${model}`,
          attributes: {
            'gen_ai.request.model': model,
            'gen_ai.provider.name': safeLabel(info.provider),
          },
        });
        return onProvider?.(info);
      },
    });
  });
}

function withToolSpan(metadata = {}, operation) {
  const toolName = safeLabel(metadata.toolName);
  const argumentKeys = safeArgumentKeys(metadata.args);
  return withObservedSpan({
    name: `execute_tool ${toolName}`,
    kind: 'TOOL',
    attributes: {
      'tool.name': toolName,
      'tool.executor.type': safeLabel(metadata.executorType),
      'tool.access': safeLabel(metadata.access),
      'tool.argument.key_count': metadata.args && typeof metadata.args === 'object'
        ? Object.keys(metadata.args).length
        : 0,
      ...(argumentKeys.length ? { 'tool.argument.keys': argumentKeys } : {}),
    },
    resultStatus(result) {
      const failed = result?.success === false;
      return {
        error: failed,
        attributes: {
          'tool.execution.status': failed ? 'error' : 'success',
          'tool.result.type': Array.isArray(result) ? 'array' : typeof result,
        },
      };
    },
  }, operation);
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
  openInferenceTracer = null;
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
  traceModelProvider,
  textShape,
  withAgentSpan,
  withEntityNormalizationSpan,
  withEntityResolutionSpan,
  withModelSpan,
  withRoutingSpan,
  withToolSpan,
  withVerificationSpan,
};
