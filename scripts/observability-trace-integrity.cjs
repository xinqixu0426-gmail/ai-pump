const ROOT_SPAN_NAME = 'invoke_agent pump_factory_assistant';
const TRACE_SCHEMA_VERSION = 1;
const TIMESTAMP_TOLERANCE_MS = 1;

function spanNameAllowed(name) {
  return name === ROOT_SPAN_NAME
    || /^chat .+/.test(name)
    || /^execute_tool .+/.test(name)
    || [
      'pump.ai.entity.normalize',
      'pump.ai.entity.resolve',
      'pump.ai.route',
      'pump.ai.verify',
    ].includes(name);
}

function spanIdentity(span) {
  return span?.context?.span_id || span?.span_id || null;
}

function traceIdentity(span) {
  return span?.context?.trace_id || span?.trace_id || null;
}

function parentIdentity(span) {
  return span?.parent_id || span?.parent_span_id || null;
}

function timeValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupByTrace(spans) {
  const groups = new Map();
  for (const span of spans) {
    const traceId = traceIdentity(span);
    if (!groups.has(traceId)) groups.set(traceId, []);
    groups.get(traceId).push(span);
  }
  return groups;
}

function validateCanonicalOrder(traceSpans) {
  const llmSpans = traceSpans
    .filter(span => /^chat .+/.test(span.name))
    .sort((left, right) => timeValue(left.start_time) - timeValue(right.start_time));
  const route = traceSpans.find(span => span.name === 'pump.ai.route');
  const tool = traceSpans.find(span => /^execute_tool .+/.test(span.name));
  const verify = traceSpans.find(span => span.name === 'pump.ai.verify');
  if (llmSpans.length < 2 || !route || !tool || !verify) {
    return { applicable: false, pass: true };
  }
  const firstLlm = llmSpans[0];
  const secondLlm = llmSpans[1];
  const precedes = (left, right) => (
    timeValue(left.end_time) <= timeValue(right.start_time) + TIMESTAMP_TOLERANCE_MS
  );
  return {
    applicable: true,
    pass: precedes(firstLlm, route)
      && precedes(route, tool)
      && precedes(tool, secondLlm)
      && precedes(secondLlm, verify),
  };
}

function validateTraceIntegrity(spans, options = {}) {
  const input = Array.isArray(spans) ? spans : [];
  const requiredSchemaVersion = options.schemaVersion ?? TRACE_SCHEMA_VERSION;
  const spanIds = new Map();
  let duplicateSpanIdCount = 0;
  for (const span of input) {
    const spanId = spanIdentity(span);
    if (!spanId) continue;
    if (spanIds.has(spanId)) duplicateSpanIdCount += 1;
    else spanIds.set(spanId, span);
  }

  const traces = groupByTrace(input);
  let rootCount = 0;
  let orphanCount = 0;
  let invalidParentCount = 0;
  let spanAfterRootEndCount = 0;
  let invalidNameCount = 0;
  let canonicalOrderTraceCount = 0;
  let canonicalOrderFailureCount = 0;
  let requiredRootPresent = traces.size > 0;
  let traceIdConsistency = traces.size > 0;
  let schemaVersionValid = traces.size > 0;

  for (const [traceId, traceSpans] of traces) {
    if (!traceId) traceIdConsistency = false;
    const roots = traceSpans.filter(span => span.name === ROOT_SPAN_NAME);
    rootCount += roots.length;
    if (roots.length !== 1) {
      requiredRootPresent = false;
      schemaVersionValid = false;
    }
    const root = roots[0];
    if (root?.attributes?.['pump.ai.trace.schema_version'] !== requiredSchemaVersion) {
      schemaVersionValid = false;
    }
    if (root && parentIdentity(root)) invalidParentCount += 1;

    const rootStart = timeValue(root?.start_time);
    const rootEnd = timeValue(root?.end_time);
    for (const span of traceSpans) {
      if (!spanNameAllowed(span.name)) invalidNameCount += 1;
      if (traceIdentity(span) !== traceId) traceIdConsistency = false;
      if (span === root) continue;
      const parentId = parentIdentity(span);
      const parent = parentId ? spanIds.get(parentId) : null;
      if (!parent) orphanCount += 1;
      else if (traceIdentity(parent) !== traceId) invalidParentCount += 1;
      const childStart = timeValue(span.start_time);
      const childEnd = timeValue(span.end_time);
      if (rootStart === null || rootEnd === null || childStart === null || childEnd === null
        || childStart < rootStart - TIMESTAMP_TOLERANCE_MS
        || childEnd > rootEnd + TIMESTAMP_TOLERANCE_MS) spanAfterRootEndCount += 1;
    }

    const order = validateCanonicalOrder(traceSpans);
    if (order.applicable) {
      canonicalOrderTraceCount += 1;
      if (!order.pass) canonicalOrderFailureCount += 1;
    }
  }

  return {
    trace_count: traces.size,
    root_count: rootCount,
    orphan_count: orphanCount,
    duplicate_span_id_count: duplicateSpanIdCount,
    invalid_parent_count: invalidParentCount,
    span_after_root_end_count: spanAfterRootEndCount,
    invalid_name_count: invalidNameCount,
    required_root_present: requiredRootPresent,
    trace_id_consistency: traceIdConsistency ? 'PASS' : 'FAIL',
    schema_version: requiredSchemaVersion,
    schema_version_valid: schemaVersionValid,
    canonical_order_trace_count: canonicalOrderTraceCount,
    canonical_order_failure_count: canonicalOrderFailureCount,
    timestamp_tolerance_ms: TIMESTAMP_TOLERANCE_MS,
    execution_order: canonicalOrderFailureCount === 0 ? 'PASS' : 'FAIL',
    pass: traces.size > 0
      && requiredRootPresent
      && rootCount === traces.size
      && orphanCount === 0
      && duplicateSpanIdCount === 0
      && invalidParentCount === 0
      && spanAfterRootEndCount === 0
      && invalidNameCount === 0
      && traceIdConsistency
      && schemaVersionValid
      && canonicalOrderFailureCount === 0,
  };
}

function attributeValues(attributes, singularKey, pluralKey) {
  const values = [];
  if (attributes?.[singularKey]) values.push(String(attributes[singularKey]));
  if (Array.isArray(attributes?.[pluralKey])) {
    values.push(...attributes[pluralKey].map(String));
  }
  return values;
}

function validateContextIsolation(spans, expectedRuns) {
  const expected = new Map((expectedRuns || []).map(run => [run.requestId, run.operationId]));
  const traces = groupByTrace(Array.isArray(spans) ? spans : []);
  const requestIds = new Set();
  let crossRequestContaminationCount = 0;
  let crossOperationContaminationCount = 0;

  for (const traceSpans of traces.values()) {
    const root = traceSpans.find(span => span.name === ROOT_SPAN_NAME);
    const requestId = root?.attributes?.['pump.request.id'];
    if (!expected.has(requestId) || requestIds.has(requestId)) {
      crossRequestContaminationCount += 1;
      continue;
    }
    requestIds.add(requestId);
    const expectedOperationId = expected.get(requestId);
    for (const span of traceSpans) {
      const seenRequestIds = attributeValues(span.attributes, 'pump.request.id', 'pump.request.ids');
      if (seenRequestIds.some(value => value !== requestId)) crossRequestContaminationCount += 1;
      const operationIds = attributeValues(span.attributes, 'pump.operation.id', 'pump.operation.ids');
      if (operationIds.some(value => value !== expectedOperationId)) {
        crossOperationContaminationCount += 1;
      }
    }
  }

  return {
    trace_count: traces.size,
    unique_request_count: requestIds.size,
    cross_request_contamination_count: crossRequestContaminationCount,
    cross_operation_contamination_count: crossOperationContaminationCount,
    pass: traces.size === expected.size
      && requestIds.size === expected.size
      && crossRequestContaminationCount === 0
      && crossOperationContaminationCount === 0,
  };
}

module.exports = {
  ROOT_SPAN_NAME,
  TIMESTAMP_TOLERANCE_MS,
  TRACE_SCHEMA_VERSION,
  spanNameAllowed,
  validateCanonicalOrder,
  validateContextIsolation,
  validateTraceIntegrity,
};

function cliArgument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function fetchProjectSpans(endpoint, project) {
  const spans = [];
  let cursor = null;
  do {
    const url = new URL(`/v1/projects/${encodeURIComponent(project)}/spans`, endpoint);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Phoenix spans request failed: ${response.status}`);
    const page = await response.json();
    spans.push(...(Array.isArray(page.data) ? page.data : []));
    cursor = page.next_cursor || null;
  } while (cursor);
  return spans;
}

if (require.main === module) {
  const endpoint = cliArgument('endpoint', 'http://127.0.0.1:6006');
  const project = cliArgument('project');
  const expectedPrefix = cliArgument('expected-prefix');
  const expectedCount = Math.max(0, Number(cliArgument('expected-count', '0')) || 0);
  if (!project) {
    process.stderr.write('Missing --project\n');
    process.exitCode = 2;
  } else {
    fetchProjectSpans(endpoint, project).then(spans => {
      const integrity = validateTraceIntegrity(spans);
      let isolation = null;
      if (expectedPrefix && expectedCount > 0) {
        const selected = spans.filter(span => {
          const traceSpansRequestId = span?.attributes?.['pump.request.id'];
          return typeof traceSpansRequestId === 'string' && traceSpansRequestId.startsWith(`${expectedPrefix}-request-`);
        });
        const traceIds = new Set(selected.map(traceIdentity));
        const scopedSpans = spans.filter(span => traceIds.has(traceIdentity(span)));
        const expectedRuns = Array.from({ length: expectedCount }, (_, index) => {
          const suffix = String(index + 1).padStart(3, '0');
          return {
            requestId: `${expectedPrefix}-request-${suffix}`,
            operationId: `${expectedPrefix}-operation-${suffix}`,
          };
        });
        isolation = validateContextIsolation(scopedSpans, expectedRuns);
      }
      const output = { project, span_count: spans.length, integrity, isolation };
      process.stdout.write(`${JSON.stringify(output)}\n`);
      if (!integrity.pass || (isolation && !isolation.pass)) process.exitCode = 1;
    }).catch(error => {
      process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name })}\n`);
      process.exitCode = 1;
    });
  }
}
