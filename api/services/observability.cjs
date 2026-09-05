const { createLogger } = require('../logger.cjs');
const { createHash } = require('node:crypto');
const {
  recordEntityNormalizationFact,
  recordEntityResolutionFact,
  recordRoutingFact,
  recordToolExecutionFact,
  recordVerificationFact,
} = require('./ai-v5/shadowFacts.cjs');

const DEFAULT_PROJECT = 'pump-ai-v4-baseline';
const DEFAULT_COLLECTOR_ENDPOINT = 'http://127.0.0.1:6006';
const DEFAULT_TRACE_CONTENT = 'metadata';
const PUMP_AI_TRACE_SCHEMA_VERSION = 1;
const TRACE_CONTENT_MODES = new Set(['off', 'metadata', 'diagnostic']);
const MAX_TRACE_STRING_LENGTH = 256;
const MAX_TRACE_ARRAY_ITEMS = 20;
const MAX_TRACE_OBJECT_KEYS = 30;
const SAFE_CORRELATION_ID_RE = /^[a-zA-Z0-9._-]{8,128}$/;
const OPENINFERENCE_KIND_KEY = 'openinference.span.kind';
const STANDARD_TRACE_ATTRIBUTES = new Set([
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.provider.name',
  'gen_ai.request.stream',
]);
const SAFE_CUSTOM_ATTRIBUTE_PREFIXES = ['pump.', 'pump.ai.'];
const SENSITIVE_KEY_PARTS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie', 'password', 'passwd',
  'secret', 'clientsecret', 'apikey', 'accesstoken', 'refreshtoken', 'idtoken',
  'session', 'sessionid', 'databaseurl', 'dbpassword', 'privatekey', 'accesspassword',
  'jwtsecret', 'internalsecret', 'mcptoken', 'mcpservicetokens', 'deepseekapikey',
  'kimiapikey', 'moonshotapikey',
]);
const PII_KEY_PARTS = new Set([
  'email', 'phone', 'mobile', 'whatsapp', 'address', 'contact', 'customername',
  'customeremail', 'customerphone', 'consignee',
]);
const BUSINESS_VALUE_KEY_PARTS = new Set([
  'cost', 'price', 'inventory', 'quantity', 'bom', 'recipe', 'ordercontent',
  'suppliercontent', 'customercontent', 'toolarguments', 'toolargumentvalue',
  'toolresultvalue', 'entityrawvalue', 'entitynormalizedvalue', 'documenttext',
  'prompt', 'response', 'messages', 'inputvalue', 'outputvalue', 'rawvalue',
  'normalizedvalue', 'businessvalue', 'payload',
]);
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

function normalizedTraceKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keyMatchesParts(key, parts) {
  const normalized = normalizedTraceKey(key);
  if (!normalized) return false;
  for (const part of parts) {
    if (normalized === part || normalized.includes(part)) return true;
  }
  return false;
}

function isSensitiveTraceKey(key) {
  return keyMatchesParts(key, SENSITIVE_KEY_PARTS);
}

function isPiiTraceKey(key) {
  return keyMatchesParts(key, PII_KEY_PARTS);
}

function isBusinessValueTraceKey(key) {
  return keyMatchesParts(key, BUSINESS_VALUE_KEY_PARTS);
}

function sanitizeTraceValue(value) {
  try {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value.slice(0, MAX_TRACE_STRING_LENGTH);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'bigint') return String(value).slice(0, MAX_TRACE_STRING_LENGTH);
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value instanceof Error) return safeLabel(value.name, 'Error');
    if (Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
    if (Array.isArray(value)) {
      const safeItems = [];
      for (const item of value.slice(0, MAX_TRACE_ARRAY_ITEMS)) {
        if (item !== null && typeof item === 'object') continue;
        const safeItem = sanitizeTraceValue(item);
        if (safeItem !== undefined) safeItems.push(safeItem);
      }
      return safeItems;
    }
    if (typeof value === 'object') {
      let keyCount = 0;
      try {
        keyCount = Math.min(Object.keys(value).length, MAX_TRACE_OBJECT_KEYS);
      } catch {
        return '[Object]';
      }
      return `[Object keys=${keyCount}]`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isAllowedTraceAttribute(key, mode) {
  if (key === OPENINFERENCE_KIND_KEY) return true;
  if (key === 'pump.ai.trace.schema_version') return true;
  if (mode === 'off') return false;
  if (STANDARD_TRACE_ATTRIBUTES.has(key)) return true;
  return SAFE_CUSTOM_ATTRIBUTE_PREFIXES.some(prefix => key.startsWith(prefix));
}

function sanitizeTraceAttributes(attributes, options = {}) {
  try {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {};
    const mode = TRACE_CONTENT_MODES.has(options.mode) ? options.mode : state.traceContent;
    const output = {};
    for (const key of Object.keys(attributes).slice(0, MAX_TRACE_OBJECT_KEYS)) {
      if (!isAllowedTraceAttribute(key, mode)) continue;
      if (isSensitiveTraceKey(key) || isPiiTraceKey(key) || isBusinessValueTraceKey(key)) continue;
      const safeValue = sanitizeTraceValue(attributes[key]);
      if (safeValue !== undefined) output[key] = safeValue;
    }
    return output;
  } catch {
    return {};
  }
}

function correlationAttribute(baseKey, value) {
  try {
    if (value === undefined || value === null || value === '') return {};
    const candidate = String(value);
    if (SAFE_CORRELATION_ID_RE.test(candidate)) return { [baseKey]: candidate };
    return { [`${baseKey}_hash`]: stableIdHash(candidate) };
  } catch {
    return {};
  }
}

function collectKnownIds(result, keys) {
  const ids = [];
  const add = value => {
    if (value === undefined || value === null || value === '') return;
    const candidate = String(value);
    if (!ids.includes(candidate) && ids.length < MAX_TRACE_ARRAY_ITEMS) ids.push(candidate);
  };
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of keys) add(value[key]);
    if (keys.includes('auditId') && Array.isArray(value.auditIds)) {
      for (const auditId of value.auditIds.slice(0, MAX_TRACE_ARRAY_ITEMS)) add(auditId);
    }
  };
  inspect(result);
  inspect(result?.confirmation);
  inspect(result?.receipt);
  inspect(result?.operation);
  inspect(result?.executionEvidence);
  if (Array.isArray(result?.executionEvidence?.receipts)) {
    for (const receipt of result.executionEvidence.receipts.slice(0, MAX_TRACE_ARRAY_ITEMS)) inspect(receipt);
  }
  if (Array.isArray(result?.executionEvidence?.calls)) {
    for (const call of result.executionEvidence.calls.slice(0, MAX_TRACE_ARRAY_ITEMS)) inspect(call);
  }
  if (keys.includes('auditId')) {
    const auditIds = Array.isArray(result?.auditIds)
      ? result.auditIds
      : result?.executionEvidence?.auditIds;
    if (Array.isArray(auditIds)) {
      for (const id of auditIds.slice(0, MAX_TRACE_ARRAY_ITEMS)) add(id);
    }
  }
  return ids;
}

function correlationIdAttributes(baseKey, values) {
  const rawAttributes = values.map(value => correlationAttribute(baseKey, value));
  const directValues = rawAttributes.map(attributes => attributes[baseKey]).filter(Boolean);
  const hashes = rawAttributes.map(attributes => attributes[`${baseKey}_hash`]).filter(Boolean);
  if (directValues.length === 1 && hashes.length === 0) return { [baseKey]: directValues[0] };
  if (directValues.length > 0 && hashes.length === 0) {
    return { [`${baseKey}s`]: directValues, [`${baseKey}_count`]: directValues.length };
  }
  if (hashes.length === 1 && directValues.length === 0) return { [`${baseKey}_hash`]: hashes[0] };
  if (hashes.length > 0 && directValues.length === 0) {
    return { [`${baseKey}_hashes`]: hashes, [`${baseKey}_count`]: hashes.length };
  }
  return {};
}

function safeLabel(value, fallback = 'unknown') {
  try {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 160) : fallback;
  } catch {
    return fallback;
  }
}

function safeObjectKeyCount(value) {
  try {
    return value && typeof value === 'object' ? Object.keys(value).length : 0;
  } catch {
    return 0;
  }
}

function safeArgumentKeys(args) {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
    return Object.keys(args)
      .filter(key => !isSensitiveTraceKey(key) && !isPiiTraceKey(key))
      .slice(0, MAX_TRACE_ARRAY_ITEMS)
      .map(key => safeLabel(key));
  } catch {
    return [];
  }
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
        ...sanitizeTraceAttributes(spec.attributes),
      },
    }, async span => {
      operationStarted = true;
      const control = {
        update(update = {}) {
          if (update.name) safeSpanCall(() => span.updateName(safeLabel(update.name)));
          if (update.attributes) safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes(update.attributes)));
        },
      };
      try {
        operationResult = await operation(control);
        if (typeof spec.resultStatus === 'function') {
          let resultStatus = null;
          try {
            resultStatus = spec.resultStatus(operationResult);
          } catch {
            resultStatus = null;
          }
          if (resultStatus?.attributes) {
            safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes(resultStatus.attributes)));
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
        safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes({
          'pump.ai.error.type': errorType(error),
        })));
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
        ...sanitizeTraceAttributes(spec.attributes),
      },
    }, span => {
      operationStarted = true;
      const control = {
        update(update = {}) {
          if (update.name) safeSpanCall(() => span.updateName(safeLabel(update.name)));
          if (update.attributes) safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes(update.attributes)));
        },
      };
      try {
        operationResult = operation(control);
        if (typeof spec.resultStatus === 'function') {
          let resultStatus = null;
          try {
            resultStatus = spec.resultStatus(operationResult);
          } catch {
            resultStatus = null;
          }
          if (resultStatus?.attributes) safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes(resultStatus.attributes)));
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
        safeSpanCall(() => span.setAttributes(sanitizeTraceAttributes({
          'pump.ai.error.type': errorType(error),
        })));
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
  try {
    if (value === undefined || value === null || value === '') return null;
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
  } catch {
    return null;
  }
}

function withEntityNormalizationSpan(metadata = {}, operation) {
  const inputShape = textShape(metadata.input);
  return withObservedSpanSync({
    name: 'pump.ai.entity.normalize',
    kind: 'CHAIN',
    attributes: {
      'pump.ai.entity.type': safeLabel(metadata.entityType),
      'pump.ai.entity.input_length': inputShape.length,
      'pump.ai.entity.input_punctuation_count': inputShape.punctuationCount,
    },
    resultStatus(result) {
      const output = typeof metadata.output === 'function' ? metadata.output(result) : metadata.output;
      const outputShape = textShape(output);
      return {
        attributes: {
          'pump.ai.entity.output_length': outputShape.length,
          'pump.ai.entity.output_punctuation_count': outputShape.punctuationCount,
          'pump.ai.entity.length_delta': outputShape.length - inputShape.length,
          'pump.ai.entity.punctuation_delta': outputShape.punctuationCount - inputShape.punctuationCount,
          'pump.ai.entity.changed': String(metadata.input || '') !== String(output || ''),
        },
      };
    },
  }, control => {
    const result = operation(control);
    const output = typeof metadata.output === 'function' ? metadata.output(result) : metadata.output;
    recordEntityNormalizationFact(metadata, output);
    return result;
  });
}

function withEntityResolutionSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'pump.ai.entity.resolve',
    kind: 'CHAIN',
    attributes: {
      'pump.ai.entity.type': safeLabel(metadata.entityType),
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
          'pump.ai.entity.candidate_count': Array.isArray(receipt?.candidates) ? receipt.candidates.length : 0,
          'pump.ai.entity.match_type': safeLabel(receipt?.selected?.matchKind || status),
          'pump.ai.entity.exact_match': status === 'exact',
          'pump.ai.entity.resolved': Boolean(receipt?.selected),
          'pump.ai.entity.ambiguity': status === 'ambiguous',
          'pump.ai.entity.resolver_path': 'ai_entity_resolver_v3',
          'pump.ai.entity.fallback_used': status === 'unique_candidate',
          ...(selectedIdHash ? { 'pump.ai.entity.resolved_id_hash': selectedIdHash } : {}),
        },
      };
    },
  }, async control => {
    const result = await operation(control);
    recordEntityResolutionFact(metadata, result);
    return result;
  });
}

function withRoutingSpan(metadata = {}, operation) {
  return withObservedSpanSync({
    name: 'pump.ai.route',
    kind: 'CHAIN',
    attributes: {
      'pump.ai.route.available_tool_count': Number(metadata.availableToolCount) || 0,
      'pump.ai.route.source': safeLabel(metadata.routeSource, 'v4_capability_broker'),
    },
    resultStatus(result) {
      const selected = result?.status === 'selected';
      return {
        attributes: {
          'pump.ai.route.selected_tool_name': selected ? safeLabel(result.capabilityName) : 'none',
          'pump.ai.route.selected_executor': selected ? safeLabel(metadata.executor) : 'none',
          ...(metadata.domain ? { 'pump.ai.route.selected_domain': safeLabel(metadata.domain) } : {}),
          'pump.ai.route.read_write_classification': safeLabel(metadata.access, 'read'),
          'pump.ai.route.success': selected,
          'pump.ai.route.decision': safeLabel(result?.status),
        },
      };
    },
  }, control => {
    const result = operation(control);
    recordRoutingFact(metadata, result);
    return result;
  });
}

function verificationAttributes(metadata = {}, decision) {
  const toolExecutionCount = Math.max(0, Number(metadata.toolExecutionCount) || 0);
  const effectiveDecision = metadata.decision === undefined
    ? Boolean(decision)
    : Boolean(metadata.decision);
  return {
    'pump.ai.verification.decision': effectiveDecision,
    'pump.ai.verification.status': safeLabel(metadata.status || (effectiveDecision ? 'verified' : 'unverified')),
    'pump.ai.verification.required_count': Math.max(0, Number(metadata.requiredCount) || 0),
    'pump.ai.verification.observed_count': Math.max(0, Number(metadata.observedCount) || 0),
    'pump.ai.verification.missing_count': Math.max(0, Number(metadata.missingCount) || 0),
    'pump.ai.verification.early_exit': Boolean(metadata.earlyExit),
    'pump.ai.verification.tool_execution_count_before_verify': toolExecutionCount,
    'pump.ai.verification.before_any_tool_execution': toolExecutionCount === 0,
    ...(metadata.llmCallCount === undefined ? {} : {
      'pump.ai.verification.llm_call_count_before_verify': Math.max(0, Number(metadata.llmCallCount) || 0),
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
  }, control => {
    const result = operation(control);
    recordVerificationFact(metadata, result);
    return result;
  });
}

function withAgentSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'invoke_agent pump_factory_assistant',
    kind: 'AGENT',
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'pump.ai.trace.schema_version': PUMP_AI_TRACE_SCHEMA_VERSION,
      'pump.ai.assistant.runtime': 'pump_factory_assistant',
      'pump.ai.assistant.streaming': Boolean(metadata.streaming),
      ...(metadata.route ? { 'pump.ai.assistant.route': safeLabel(metadata.route) } : {}),
      ...correlationAttribute('pump.request.id', metadata.requestId),
    },
  }, operation);
}

function getActiveTraceContext() {
  try {
    const span = phoenix?.trace?.getSpan?.(phoenix.context.active());
    const context = span?.spanContext?.();
    if (!context || !context.traceId || !context.spanId) return null;
    return Object.freeze({ traceId: context.traceId, spanId: context.spanId });
  } catch {
    return null;
  }
}

function withDetachedTrace(operation) {
  try {
    if (phoenix?.context?.active && phoenix?.context?.with && phoenix?.trace?.deleteSpan) {
      const detached = phoenix.trace.deleteSpan(phoenix.context.active());
      return phoenix.context.with(detached, operation);
    }
  } catch {
    // Shadow tracing must remain detached and fail-open.
  }
  return operation();
}

function shadowCorrelationAttributes(metadata = {}) {
  return {
    ...correlationAttribute('pump.request.id', metadata.sourceRequestId),
    ...(metadata.sourceRequestIdHash ? { 'pump.request.id_hash': metadata.sourceRequestIdHash } : {}),
    ...(metadata.sourceTraceId ? { 'pump.ai.v5.source_trace_id': safeLabel(metadata.sourceTraceId) } : {}),
    'pump.ai.v5.shadow_task_id': safeLabel(metadata.shadowTaskId),
  };
}

function withV5ShadowSpan(metadata = {}, operation) {
  return withDetachedTrace(() => withObservedSpan({
    name: 'pump.ai.v5.shadow',
    kind: 'CHAIN',
    attributes: shadowCorrelationAttributes(metadata),
    resultStatus(result) {
      return {
        error: result?.comparisonStatus === 'SHADOW_ERROR',
        attributes: {
          'pump.ai.v5.comparison.status': safeLabel(result?.comparisonStatus),
          'pump.ai.v5.projection.status': safeLabel(result?.projectionStatus),
        },
      };
    },
  }, operation));
}

function withV5ShadowProjectionSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'pump.ai.v5.shadow.project',
    kind: 'CHAIN',
    attributes: shadowCorrelationAttributes(metadata),
    resultStatus(result) {
      const tools = Array.isArray(result?.toolExposureAssessment?.tools)
        ? result.toolExposureAssessment.tools.map(item => safeLabel(item.toolName))
        : [];
      return {
        error: result?.status === 'INVALID',
        attributes: {
          'pump.ai.v5.projection.status': safeLabel(result?.projectionStatus || result?.status),
          'pump.ai.v5.reason_codes': Array.isArray(result?.reasonCodes) ? result.reasonCodes : [],
          'pump.ai.v5.tool_names': tools,
          'pump.ai.v5.facts.entity_available': result?.availability?.entityFactsAvailable === true,
          'pump.ai.v5.facts.capability_available': result?.availability?.capabilityFactsAvailable === true,
          'pump.ai.v5.facts.argument_available': result?.availability?.argumentFactsAvailable === true,
          'pump.ai.v5.facts.state_available': result?.availability?.stateFactsAvailable === true,
          'pump.ai.v5.facts.verification_available': result?.availability?.verificationFactsAvailable === true,
          'pump.ai.v5.argument.validation_status': safeLabel(result?.argumentAssessment?.status),
          'pump.ai.v5.entity.status': safeLabel(result?.entityAssessment?.status),
          'pump.ai.v5.state.valid': result?.stateAssessment?.valid === true,
          'pump.ai.v5.verification.status': safeLabel(result?.verificationAssessment?.status),
          ...(result?.capabilityAssessment?.intendedCapabilityId ? {
            'pump.ai.v5.capability_id': safeLabel(result.capabilityAssessment.intendedCapabilityId),
          } : {}),
        },
      };
    },
  }, operation);
}

function withV5ShadowComparisonSpan(metadata = {}, operation) {
  return withObservedSpan({
    name: 'pump.ai.v5.shadow.compare',
    kind: 'CHAIN',
    attributes: shadowCorrelationAttributes(metadata),
    resultStatus(result) {
      return {
        error: result?.comparisonStatus === 'SHADOW_ERROR',
        attributes: {
          'pump.ai.v5.comparison.status': safeLabel(result?.comparisonStatus),
          'pump.ai.v5.comparison.entity': safeLabel(result?.entityComparison?.status),
          'pump.ai.v5.comparison.capability': safeLabel(result?.capabilityComparison?.status),
          'pump.ai.v5.comparison.tool_exposure': safeLabel(result?.toolExposureComparison?.status),
          'pump.ai.v5.comparison.argument': safeLabel(result?.argumentComparison?.status),
          'pump.ai.v5.comparison.state': safeLabel(result?.stateComparison?.status),
          'pump.ai.v5.comparison.policy': safeLabel(result?.policyComparison?.status),
          'pump.ai.v5.comparison.verification': safeLabel(result?.verificationComparison?.status),
          'pump.ai.v5.reason_codes': Array.isArray(result?.reasonCodes) ? result.reasonCodes : [],
        },
      };
    },
  }, operation);
}

function withV5InterpreterStage(stage, metadata = {}, operation) {
  const stages = ['span-selection', 'governed-lookup', 'local-task-class-build', 'local-intent', 'entity-finalization', 'capability-route', 'shadow-comparison'];
  if (!stages.includes(stage)) throw new TypeError('Unknown V5 interpreter stage');
  return withObservedSpan({
    name: `pump.ai.v5.${stage}`,
    kind: stage === 'span-selection' || stage === 'local-intent' ? 'LLM' : 'CHAIN',
    attributes: {
      ...shadowCorrelationAttributes(metadata),
      'pump.ai.v5.architecture_version': 3,
    },
    resultStatus(result) {
      return { error: result?.status === 'ERROR' || result?.status === 'TIMEOUT', attributes: {
        'pump.ai.v5.stage.status': safeLabel(result?.status),
        'pump.ai.v5.stage.candidate_count': Number(result?.candidateCount || 0),
        'pump.ai.v5.stage.candidate_type_count': Number(result?.candidateTypeCount || 0),
        'pump.ai.v5.stage.selected_span_count': Number(result?.selection?.spanRefs?.length || 0),
        'pump.ai.v5.stage.lookup_count': Number(result?.resolverCalls || 0),
        'pump.ai.v5.stage.local_class_count': Array.isArray(result) ? result.length : 0,
        ...(result?.errorMetadata ? {
          'pump.ai.v5.error.category': safeLabel(result.errorMetadata.category),
          'pump.ai.v5.error.code': safeLabel(result.errorMetadata.internalCode),
          'pump.ai.v5.error.http_status': Number(result.errorMetadata.httpStatus || 0),
          'pump.ai.v5.error.timeout': result.errorMetadata.timeout === true,
        } : {}),
      } };
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
      'gen_ai.request.stream': Boolean(metadata.streaming),
      'pump.ai.llm.tool_definition_count': Number(metadata.toolDefinitionCount) || 0,
      ...(metadata.shadowTaskId ? {
        'pump.ai.v5.shadow_task_id': safeLabel(metadata.shadowTaskId),
        'pump.ai.v5.interpreter.version': 1,
      } : {}),
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
  const initialOperationIds = metadata.operationId ? [metadata.operationId] : [];
  return withObservedSpan({
    name: `execute_tool ${toolName}`,
    kind: 'TOOL',
    attributes: {
      'pump.ai.tool.name': toolName,
      'pump.ai.tool.executor.type': safeLabel(metadata.executorType),
      'pump.ai.tool.access': safeLabel(metadata.access),
      ...(metadata.capability ? { 'pump.capability': safeLabel(metadata.capability) } : {}),
      'pump.ai.tool.argument.key_count': safeObjectKeyCount(metadata.args),
      ...(argumentKeys.length ? { 'pump.ai.tool.argument.keys': argumentKeys } : {}),
      ...correlationIdAttributes('pump.operation.id', initialOperationIds),
    },
    resultStatus(result) {
      const failed = result?.success === false;
      const operationIds = collectKnownIds(result, ['operationId', 'formalOperationId']);
      for (const id of initialOperationIds) {
        if (!operationIds.includes(String(id))) operationIds.unshift(String(id));
      }
      const auditIds = collectKnownIds(result, ['auditId']);
      return {
        error: failed,
        attributes: {
          'pump.ai.tool.execution.status': failed ? 'error' : 'success',
          'pump.ai.tool.result.type': Array.isArray(result) ? 'array' : typeof result,
          ...correlationIdAttributes('pump.operation.id', operationIds),
          ...correlationIdAttributes('pump.audit.id', auditIds),
        },
      };
    },
  }, async control => {
    try {
      const result = await operation(control);
      recordToolExecutionFact(metadata, result, false);
      return result;
    } catch (error) {
      recordToolExecutionFact(metadata, null, true);
      throw error;
    }
  });
}

function emitSyntheticSmokeSpan() {
  if (!provider || state.status !== 'enabled') return null;
  const tracer = provider.getTracer('pump-ai-observability-p02');
  const span = tracer.startSpan('pump.observability.smoke', {
    attributes: sanitizeTraceAttributes({
      'pump.observability.synthetic': true,
      'pump.observability.phase': 'P02',
      'pump.observability.project': state.project,
    }),
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
  MAX_TRACE_ARRAY_ITEMS,
  MAX_TRACE_OBJECT_KEYS,
  MAX_TRACE_STRING_LENGTH,
  PUMP_AI_TRACE_SCHEMA_VERSION,
  PRIVACY_TRACE_CONFIG,
  emitSyntheticSmokeSpan,
  getActiveTraceContext,
  getObservabilityState,
  initializeObservability,
  isSensitiveTraceKey,
  readObservabilityConfig,
  resetObservabilityForTesting,
  safeForceFlush,
  safeShutdown,
  sanitizeTraceAttributes,
  sanitizeTraceValue,
  traceModelProvider,
  textShape,
  withAgentSpan,
  withEntityNormalizationSpan,
  withEntityResolutionSpan,
  withModelSpan,
  withV5InterpreterStage,
  withRoutingSpan,
  withToolSpan,
  withV5ShadowComparisonSpan,
  withV5ShadowProjectionSpan,
  withV5ShadowSpan,
  withVerificationSpan,
};
