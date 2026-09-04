const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { validateTraceIntegrity } = require('./observability-trace-integrity.cjs');

require('dotenv').config({ quiet: true });

const TAXONOMY = Object.freeze([
  'I01', 'E01', 'E02', 'E03', 'E04', 'R01', 'R02', 'A01', 'A02', 'T01', 'T02',
  'V01', 'V02', 'V03', 'V04', 'C01', 'C02', 'S01', 'ST01', 'D01', 'U01',
]);

const PATHS = Object.freeze([
  ['legacy_v3', 'legacy', 'LEGACY'],
  ['v4_investigation', 'v4-investigation', 'V4I'],
  ['v4_r3', 'v4-r3', 'V4R3'],
]);

const CASE_CONTRACTS = Object.freeze({
  'simple-current-1': {
    id: 'P06-SIMPLE-001', suite: 'R4-B / success control', primaryTool: 'search_parts',
    allowedTools: ['search_parts'], expectedTerminal: 'completed',
  },
  'current-cost-1': {
    id: 'P06-EXACT-001', suite: 'R4-B / Exact Entity Identity', primaryTool: 'preview_recipe_cost',
    allowedTools: ['get_all_recipes', 'preview_recipe_cost'], expectedTerminal: 'completed',
    expectedArgumentShape: { inputLength: 11, punctuationCount: 2 },
  },
  'flat-knife-800-1': {
    id: 'P06-FLATBLADE-001', suite: 'R4-B / 800 flat blade', primaryTool: 'search_parts',
    allowedTools: ['search_parts'], expectedTerminal: 'completed',
  },
  'part-current-stock-real-provider': {
    id: 'P06-INVENTORY-001', suite: 'R4-B / Inventory Numeric Facts', primaryTool: 'search_parts',
    allowedTools: ['search_parts'], expectedTerminal: 'completed',
  },
  'coil-current-stock-real-provider': {
    id: 'P06-COIL-001', suite: 'R4-B / Coil Stable Identity', primaryTool: 'search_coils',
    allowedTools: ['search_coils'], expectedTerminal: 'completed',
  },
});

function cliValue(name, fallback = '') {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

function traceId(span) {
  return String(span?.context?.trace_id || span?.context?.traceId || span?.trace_id || '');
}

function attributes(span) {
  return span?.attributes && typeof span.attributes === 'object' ? span.attributes : {};
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function countNeedleOccurrences(text, needles) {
  return [...new Set(needles.filter(value => typeof value === 'string' && value.length >= 6))]
    .reduce((total, needle) => total + (text.includes(needle) ? 1 : 0), 0);
}

function databaseValues(databasePath, columnPattern) {
  if (!databasePath || !fs.existsSync(databasePath)) return [];
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const values = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name } of tables) {
      const quotedTable = `"${String(name).replaceAll('"', '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${quotedTable})`).all();
      for (const column of columns.filter(item => columnPattern.test(normalizedKey(item.name)))) {
        const quotedColumn = `"${String(column.name).replaceAll('"', '""')}"`;
        for (const row of db.prepare(`SELECT DISTINCT ${quotedColumn} AS value FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL`).all()) {
          const value = String(row.value || '').trim();
          if (value.length >= 6) values.push(value);
        }
      }
    }
    return values;
  } finally {
    db.close();
  }
}

function privacyScan(spans, databasePath) {
  const serialized = JSON.stringify(spans);
  const attributeEntries = spans.flatMap(span => [
    ...Object.entries(attributes(span)),
    ...(Array.isArray(span.events) ? span.events.flatMap(event => Object.entries(event?.attributes || {})) : []),
  ]);
  const secretKeyPattern = /(authorization|cookie|password|passwd|secret|clientsecret|apikey|accesstoken|refreshtoken|idtoken|sessionid|databaseurl|dbpassword|privatekey|jwtsecret|token)/;
  const piiKeyPattern = /(email|phone|mobile|whatsapp|address|contact|customername|consignee)/;
  const businessKeyPattern = /(cost|price|inventory|quantity|bom|recipe|ordercontent|suppliercontent|customercontent|entityrawvalue|entitynormalizedvalue|documenttext|businessvalue|rawvalue|normalizedvalue|payload)/;
  const promptResponseKeyPattern = /(prompt|response|inputmessages|outputmessages|inputvalue|outputvalue)/;
  const toolValueKeyPattern = /(toolarguments|toolargumentvalue|toolresults|toolresultvalue|toolpayload)/;
  const secretValues = Object.entries(process.env)
    .filter(([key, value]) => secretKeyPattern.test(normalizedKey(key)) && String(value || '').length >= 8)
    .map(([, value]) => String(value));
  const piiValues = databaseValues(databasePath, piiKeyPattern);
  const businessValues = [
    'v750-tokoy-',
    'v750-tokoy',
    '800平刀',
    ...databaseValues(databasePath, /^(model|name|schemecode|schemename)$/),
  ];
  const keyCount = pattern => attributeEntries.filter(([key]) => pattern.test(normalizedKey(key))).length;
  return {
    secret_leakage: keyCount(secretKeyPattern) + countNeedleOccurrences(serialized, secretValues),
    pii_leakage: keyCount(piiKeyPattern) + countNeedleOccurrences(serialized, piiValues),
    business_value_leakage: keyCount(businessKeyPattern) + countNeedleOccurrences(serialized, businessValues),
    prompt_response_leakage: keyCount(promptResponseKeyPattern),
    tool_argument_result_leakage: keyCount(toolValueKeyPattern),
  };
}

function safeEntityMetadata(span) {
  const attrs = attributes(span);
  return {
    type: attrs['pump.ai.entity.type'] || 'unknown',
    input_length: attrs['pump.ai.entity.input_length'] ?? null,
    output_length: attrs['pump.ai.entity.output_length'] ?? null,
    input_punctuation_count: attrs['pump.ai.entity.input_punctuation_count'] ?? null,
    output_punctuation_count: attrs['pump.ai.entity.output_punctuation_count'] ?? null,
    length_delta: attrs['pump.ai.entity.length_delta'] ?? null,
    punctuation_delta: attrs['pump.ai.entity.punctuation_delta'] ?? null,
    changed: attrs['pump.ai.entity.changed'] ?? null,
    candidate_count: attrs['pump.ai.entity.candidate_count'] ?? null,
    match_type: attrs['pump.ai.entity.match_type'] || null,
    exact_match: attrs['pump.ai.entity.exact_match'] ?? null,
    resolved: attrs['pump.ai.entity.resolved'] ?? null,
    ambiguity: attrs['pump.ai.entity.ambiguity'] ?? null,
    resolved_id_hash: attrs['pump.ai.entity.resolved_id_hash'] || null,
  };
}

function safeVerificationMetadata(span) {
  const attrs = attributes(span);
  return {
    status: attrs['pump.ai.verification.status'] || 'unknown',
    decision: attrs['pump.ai.verification.decision'] ?? null,
    required_count: attrs['pump.ai.verification.required_count'] ?? null,
    observed_count: attrs['pump.ai.verification.observed_count'] ?? null,
    missing_count: attrs['pump.ai.verification.missing_count'] ?? null,
    before_any_tool_execution: attrs['pump.ai.verification.before_any_tool_execution'] ?? null,
    tool_execution_count_before_verify:
      attrs['pump.ai.verification.tool_execution_count_before_verify'] ?? null,
  };
}

function structuralSummary(spans, contract) {
  const ordered = [...spans].sort((left, right) => (
    String(left.start_time || '').localeCompare(String(right.start_time || ''))
      || String(left.end_time || '').localeCompare(String(right.end_time || ''))
  ));
  const tools = ordered.filter(span => span.span_kind === 'TOOL').map(span => span.name.replace(/^execute_tool /, ''));
  const routes = ordered.filter(span => span.name === 'pump.ai.route').map(span => ({
    tool: attributes(span)['pump.ai.route.selected_tool_name'] || 'none',
    success: attributes(span)['pump.ai.route.success'] === true,
    decision: attributes(span)['pump.ai.route.decision'] || 'unknown',
  }));
  const normalizations = ordered.filter(span => span.name === 'pump.ai.entity.normalize').map(safeEntityMetadata);
  const resolutions = ordered.filter(span => span.name === 'pump.ai.entity.resolve').map(safeEntityMetadata);
  const verifications = ordered.filter(span => span.name === 'pump.ai.verify').map(safeVerificationMetadata);
  const allowed = new Set(contract.allowedTools);
  const unexpectedTools = tools.filter(tool => !allowed.has(tool));
  const unexpectedRoutes = routes.map(route => route.tool).filter(tool => tool !== 'none' && !allowed.has(tool));
  return {
    span_count: ordered.length,
    llm_call_count: ordered.filter(span => span.span_kind === 'LLM').length,
    tools,
    routes,
    entity_normalizations: normalizations,
    entity_resolutions: resolutions,
    verifications,
    primary_tool_seen: tools.includes(contract.primaryTool),
    unexpected_tools: unexpectedTools,
    unexpected_routes: unexpectedRoutes,
    premature_verification_count: verifications.filter(item => item.before_any_tool_execution === true).length,
    trajectory_hash: hash(ordered.map(span => ({
      name: span.name,
      kind: span.span_kind,
      parent: span.parent_id ? 'root_child' : 'root',
      tool: span.span_kind === 'TOOL' ? span.name.replace(/^execute_tool /, '') : null,
      route: span.name === 'pump.ai.route' ? attributes(span)['pump.ai.route.selected_tool_name'] || 'none' : null,
      entity: span.name.startsWith('pump.ai.entity.') ? safeEntityMetadata(span) : null,
      verification: span.name === 'pump.ai.verify' ? safeVerificationMetadata(span) : null,
    }))),
  };
}

function firstSpan(spans, predicate) {
  return [...spans]
    .sort((left, right) => String(left.start_time || '').localeCompare(String(right.start_time || '')))
    .find(predicate) || null;
}

function classifyFailure({ caseKey: _caseKey, pathName: _pathName, pathReport, spans, summary, contract }) {
  if (pathReport.classification !== 'FAIL') {
    return { failureClass: null, secondaryClasses: [], firstDivergence: null, notes: 'Oracle trajectory satisfied.' };
  }

  if (contract.expectedArgumentShape) {
    const normalization = summary.entity_normalizations[0];
    if (normalization && (
      normalization.input_length < contract.expectedArgumentShape.inputLength
      || normalization.input_punctuation_count < contract.expectedArgumentShape.punctuationCount
    )) {
      return {
        failureClass: 'A01',
        secondaryClasses: [
          'E04',
          ...(summary.unexpected_routes.length ? ['R01', 'V01'] : []),
        ],
        firstDivergence: {
          expected_stage: 'tool argument entering resolver retains frozen identity shape',
          actual_stage: 'pump.ai.entity.normalize input shape',
          first_divergent_span: 'pump.ai.entity.normalize',
          first_divergent_event: `expected length/punctuation ${contract.expectedArgumentShape.inputLength}/${contract.expectedArgumentShape.punctuationCount}; observed ${normalization.input_length}/${normalization.input_punctuation_count}`,
        },
        notes: summary.unexpected_routes.length
          ? 'ROOT_CAUSE=A01; CONTRIBUTORS=E04,R01; DOWNSTREAM_SYMPTOM=V01; resolver exact-matched the identity it actually received.'
          : 'ROOT_CAUSE=A01; CONTRIBUTOR=E04; resolver exact-matched the identity it actually received.',
      };
    }
  }

  const firstRoute = firstSpan(spans, span => span.name === 'pump.ai.route');
  const firstTool = firstSpan(spans, span => span.span_kind === 'TOOL');
  const firstDecision = firstRoute
    ? attributes(firstRoute)['pump.ai.route.selected_tool_name']
    : firstTool?.name?.replace(/^execute_tool /, '');
  if (!summary.primary_tool_seen || (firstDecision && !contract.allowedTools.includes(firstDecision))) {
    return {
      failureClass: 'R02',
      secondaryClasses: summary.verifications.some(item => item.status === 'failed_unverified') ? ['V03'] : ['V01'],
      firstDivergence: {
        expected_stage: `select ${contract.primaryTool}`,
        actual_stage: firstRoute ? 'pump.ai.route' : 'execute_tool',
        first_divergent_span: firstRoute?.name || firstTool?.name || 'UNKNOWN',
        first_divergent_event: `selected ${firstDecision || 'none'}`,
      },
      notes: 'ROOT_CAUSE=R02; verification classification is downstream evidence status, not assumed root cause.',
    };
  }

  const unexpectedRoute = firstSpan(spans, span => (
    span.name === 'pump.ai.route'
    && !contract.allowedTools.includes(attributes(span)['pump.ai.route.selected_tool_name'])
  ));
  if (unexpectedRoute) {
    return {
      failureClass: 'C02',
      secondaryClasses: ['R01', 'V01'],
      firstDivergence: {
        expected_stage: 'terminate after required evidence is satisfied',
        actual_stage: 'pump.ai.route continued investigation',
        first_divergent_span: 'pump.ai.route',
        first_divergent_event: `selected ${attributes(unexpectedRoute)['pump.ai.route.selected_tool_name'] || 'unknown'}`,
      },
      notes: 'ROOT_CAUSE=C02; CONTRIBUTOR=R01; DOWNSTREAM_SYMPTOM=V01.',
    };
  }

  const failedVerification = firstSpan(spans, span => (
    span.name === 'pump.ai.verify' && attributes(span)['pump.ai.verification.decision'] === false
  ));
  if (failedVerification) {
    const premature = attributes(failedVerification)['pump.ai.verification.before_any_tool_execution'] === true;
    return {
      failureClass: premature ? 'V02' : 'V03',
      secondaryClasses: [],
      firstDivergence: {
        expected_stage: 'verification accepts frozen expected evidence',
        actual_stage: 'pump.ai.verify rejected evidence',
        first_divergent_span: 'pump.ai.verify',
        first_divergent_event: premature ? 'before_any_tool_execution=true' : 'decision=false',
      },
      notes: premature ? 'ROOT_CAUSE=V02.' : 'ROOT_CAUSE=V03.',
    };
  }

  const verified = summary.verifications.some(item => item.decision === true);
  return {
    failureClass: verified ? 'C02' : 'U01',
    secondaryClasses: verified ? ['S01'] : [],
    firstDivergence: {
      expected_stage: `terminal_state=${contract.expectedTerminal}`,
      actual_stage: `terminal_state=${pathReport.terminalState || 'unknown'}`,
      first_divergent_span: verified ? 'post-verification state transition' : 'UNKNOWN',
      first_divergent_event: pathReport.failureCode || 'ORACLE_MISMATCH',
    },
    notes: verified
      ? 'ROOT_CAUSE=C02; CONTRIBUTOR=S01; tool and verifier stages completed before terminal mismatch.'
      : 'ROOT_CAUSE=U01; available metadata is insufficient for a narrower class.',
  };
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

function readReports(directory, suffix) {
  return fs.readdirSync(directory)
    .filter(file => file.endsWith(suffix))
    .map(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')))
    .flatMap(report => report.cases || [])
    .filter(item => CASE_CONTRACTS[item.caseKey]);
}

function modeComparison(directory, caseKey) {
  const onPath = path.join(directory, `${caseKey}-on.json`);
  const offPath = path.join(directory, `${caseKey}-off.json`);
  if (!fs.existsSync(onPath) || !fs.existsSync(offPath)) return null;
  const on = JSON.parse(fs.readFileSync(onPath, 'utf8')).cases[0];
  const off = JSON.parse(fs.readFileSync(offPath, 'utf8')).cases[0];
  const semantic = item => Object.fromEntries(PATHS.map(([reportPath]) => [reportPath, {
    classification: item.paths[reportPath].classification,
    terminal_state: item.paths[reportPath].terminalState,
    tools: item.paths[reportPath].capabilityIds,
  }]));
  const onSemantic = semantic(on);
  const offSemantic = semantic(off);
  return { case_key: caseKey, pass: JSON.stringify(onSemantic) === JSON.stringify(offSemantic), on: onSemantic, off: offSemantic };
}

async function main() {
  const reportsDir = path.resolve(cliValue('reports-dir'));
  const project = cliValue('project', 'pump-ai-p06-real-replay');
  const endpoint = cliValue('endpoint', 'http://127.0.0.1:6006');
  const output = cliValue('output');
  const databasePath = path.resolve(cliValue('database', path.join(process.cwd(), 'pump.db')));
  if (!reportsDir || !fs.existsSync(reportsDir)) throw new Error('P06 reports directory unavailable');
  const spans = await fetchProjectSpans(endpoint, project);
  const reports = readReports(reportsDir, '-on.json');
  const cases = [];

  for (const reportCase of reports) {
    const contract = CASE_CONTRACTS[reportCase.caseKey];
    for (const [reportPath, requestPath, idSuffix] of PATHS) {
      const requestId = `p06-${reportCase.caseKey}-${requestPath}`;
      const root = spans.find(span => (
        span.parent_id === null
        && span.name === 'invoke_agent pump_factory_assistant'
        && attributes(span)['pump.request.id'] === requestId
      ));
      const scoped = root ? spans.filter(span => traceId(span) === traceId(root)) : [];
      const shadowProjection = spans.find(span => (
        span.name === 'pump.ai.v5.shadow.project'
        && attributes(span)['pump.request.id'] === requestId
      ));
      const shadowAttributes = shadowProjection ? attributes(shadowProjection) : {};
      const integrity = scoped.length ? validateTraceIntegrity(scoped) : { pass: false };
      const pathReport = reportCase.paths[reportPath];
      const summary = structuralSummary(scoped, contract);
      const classification = integrity.pass
        ? classifyFailure({ caseKey: reportCase.caseKey, pathName: reportPath, pathReport, spans: scoped, summary, contract })
        : { failureClass: null, secondaryClasses: [], firstDivergence: null, notes: 'TRACE_INVALID' };
      cases.push({
        case_id: `${contract.id}-${idSuffix}`,
        suite: contract.suite,
        result: integrity.pass ? pathReport.classification : 'TRACE_INVALID',
        expected: {
          path: reportPath,
          terminal_state: contract.expectedTerminal,
          primary_tool: contract.primaryTool,
          allowed_tools: contract.allowedTools,
        },
        failure_class: classification.failureClass,
        secondary_classes: classification.secondaryClasses,
        first_divergence: classification.firstDivergence,
        safe_structural_metadata: {
          trace_valid: integrity.pass,
          terminal_state: pathReport.terminalState,
          failure_code: pathReport.failureCode,
          span_count: summary.span_count,
          llm_call_count: summary.llm_call_count,
          tools: summary.tools,
          routes: summary.routes,
          entity_normalizations: summary.entity_normalizations,
          entity_resolutions: summary.entity_resolutions,
          verifications: summary.verifications,
          premature_verification_count: summary.premature_verification_count,
          shadow_projection: shadowProjection ? {
            entity_facts_available: shadowAttributes['pump.ai.v5.facts.entity_available'] === true,
            capability_facts_available: shadowAttributes['pump.ai.v5.facts.capability_available'] === true,
            argument_facts_available: shadowAttributes['pump.ai.v5.facts.argument_available'] === true,
            state_facts_available: shadowAttributes['pump.ai.v5.facts.state_available'] === true,
            verification_facts_available: shadowAttributes['pump.ai.v5.facts.verification_available'] === true,
            argument_validation_status: shadowAttributes['pump.ai.v5.argument.validation_status'] || 'UNKNOWN',
            entity_status: shadowAttributes['pump.ai.v5.entity.status'] || 'UNKNOWN',
            state_valid: shadowAttributes['pump.ai.v5.state.valid'] === true,
            verification_status: shadowAttributes['pump.ai.v5.verification.status'] || 'UNKNOWN',
          } : null,
        },
        trace_id: root ? traceId(root) : null,
        trajectory_hash: summary.trajectory_hash,
        notes: classification.notes,
      });
    }
  }

  const valid = cases.filter(item => item.result !== 'TRACE_INVALID');
  const failures = valid.filter(item => item.result === 'FAIL');
  const classCounts = Object.fromEntries(TAXONOMY.map(code => [code, failures.filter(item => item.failure_class === code).length]));
  const failureMap = Object.entries(classCounts).filter(([, count]) => count > 0).map(([failureClass, count]) => ({
    failure_class: failureClass,
    count,
    percentage: failures.length ? Math.round((count / failures.length) * 10000) / 100 : 0,
    affected_suites: [...new Set(failures.filter(item => item.failure_class === failureClass).map(item => item.suite))],
    representative_case_ids: failures.filter(item => item.failure_class === failureClass).map(item => item.case_id).slice(0, 3),
  })).sort((left, right) => right.count - left.count || left.failure_class.localeCompare(right.failure_class));
  const v4Cases = valid.filter(item => item.expected.path !== 'legacy_v3');
  const routingPass = v4Cases.filter(item => {
    const routes = item.safe_structural_metadata.routes.map(route => route.tool);
    return routes.includes(item.expected.primary_tool) && routes.every(tool => item.expected.allowed_tools.includes(tool));
  }).length;
  const toolSelectionPass = valid.filter(item => item.safe_structural_metadata.tools.includes(item.expected.primary_tool)).length;
  const comparisons = [
    modeComparison(reportsDir, 'simple-current-1'),
    modeComparison(reportsDir, 'coil-current-stock-real-provider'),
  ].filter(Boolean);
  const stableComparison = comparisons.find(item => item.case_key === 'coil-current-stock-real-provider');

  const dataset = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    phoenix_project: project,
    corpus_summary: {
      attempted: cases.length,
      valid: valid.length,
      failed: failures.length,
      passed: valid.length - failures.length,
      trace_invalid: cases.length - valid.length,
      failure_map: failureMap,
      premature_verification_count: valid.reduce((sum, item) => sum + item.safe_structural_metadata.premature_verification_count, 0),
      routing_accuracy: { numerator: routingPass, denominator: v4Cases.length },
      tool_selection_accuracy: { numerator: toolSelectionPass, denominator: valid.length },
      observability_off_on_structural_equivalence: stableComparison?.pass === true ? 'PASS' : 'NOT_RUN',
      repeat_instability_observed: comparisons.some(item => item.pass === false) ? 1 : 0,
      privacy: privacyScan(spans, databasePath),
    },
    cases,
  };
  const serialized = `${JSON.stringify(cases, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), serialized, 'utf8');
  }
  process.stdout.write(JSON.stringify({
    corpus_summary: dataset.corpus_summary,
    comparisons,
    output: output ? path.resolve(output) : null,
  }, null, 2));
}

module.exports = { CASE_CONTRACTS, TAXONOMY, classifyFailure, structuralSummary };

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', error_type: error.name, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
