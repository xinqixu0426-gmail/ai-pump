const assert = require('node:assert/strict');
const test = require('node:test');

const observability = require('../api/services/observability.cjs');
const {
  buildSearchProbes,
  resolveAiToolTargetV3,
} = require('../api/services/aiEntityResolverV3.cjs');
const {
  createFactRequirement,
  createInvestigationGoal,
  createInvestigationState,
} = require('../api/services/aiFactModelV4.cjs');
const { selectNextCapability } = require('../api/services/aiCapabilityBrokerV4.cjs');
const { createReadInvestigationController } = require('../api/services/aiReadInvestigationRuntimeV4.cjs');

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
        setAttribute(key, value) { this.attributes[key] = value; },
        setAttributes(attributes) { Object.assign(this.attributes, attributes); },
        setStatus(status) { this.status = status; },
        updateName(nextName) { this.name = nextName; },
        end() { this.ended = true; },
      };
      spans.push(span);
      stack.push(span);
      try {
        const result = operation(span);
        if (result && typeof result.then === 'function') {
          return result.finally(() => assert.equal(stack.pop(), span));
        }
        assert.equal(stack.pop(), span);
        return result;
      } catch (error) {
        assert.equal(stack.pop(), span);
        throw error;
      }
    },
  };
  return {
    spans,
    phoenixModule: {
      register() {
        return {
          getTracer() { return tracer; },
          async forceFlush() {},
          async shutdown() {},
        };
      },
    },
  };
}

function enableTracing(runtime) {
  observability.initializeObservability({
    env: {
      AI_OBSERVABILITY_ENABLED: 'true',
      AI_TRACE_CONTENT: 'diagnostic',
    },
    phoenixModule: runtime.phoenixModule,
    logger: { warn() {} },
  });
}

function partRoutingFixture() {
  const requirement = createFactRequirement({
    identity: {
      entityType: 'part',
      entityId: null,
      predicate: 'currentScalar',
      temporalScope: 'current',
      scenario: 'catalog_current',
      qualifiers: { targetMention: 'fixture' },
    },
  });
  const goal = createInvestigationGoal({
    goalId: 'p03b-routing-fixture',
    goal: 'fixture',
    mode: 'query',
    entityScope: 'single',
    domains: ['catalog'],
    originalTarget: 'fixture',
    requirements: [requirement],
  });
  return {
    goal,
    state: createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements }),
  };
}

test.afterEach(async () => {
  await observability.resetObservabilityForTesting();
});

test('disabled P03B wrappers are synchronous no-ops and preserve result and errors', () => {
  observability.initializeObservability({ env: {}, logger: { warn() {} } });
  const marker = { unchanged: true };
  assert.equal(observability.withVerificationSpan({}, () => marker), marker);
  const original = new Error('unchanged error');
  assert.throws(
    () => observability.withRoutingSpan({}, () => { throw original; }),
    error => error === original
  );
});

test('real normalization boundary records structural deltas without entity content', () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const secret = 'P03B_SECRET_ENTITY_SENTINEL-9';
  const probes = buildSearchProbes(secret, { entityType: 'recipe' });
  assert.equal(probes[0], secret);
  const span = runtime.spans[0];
  assert.equal(span.name, 'pump.ai.entity.normalize');
  assert.equal(span.attributes['pump.ai.entity.type'], 'recipe');
  assert.equal(span.attributes['pump.ai.entity.changed'], true);
  assert.ok(span.attributes['pump.ai.entity.punctuation_delta'] < 0);
  assert.doesNotMatch(JSON.stringify(span), /P03B_SECRET_ENTITY_SENTINEL/);
});

test('real resolver records candidate and match metadata without entity value or raw id', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const secret = 'P03B_SECRET_ENTITY_SENTINEL';
  const result = await resolveAiToolTargetV3({
    toolName: 'preview_recipe_cost',
    args: { recipeName: secret },
    executeToolCall: async () => ({
      success: true,
      data: [{ id: 918273, name: secret }],
      count: 1,
      executionEvidence: { verified: true },
    }),
  });
  assert.equal(result.status, 'exact');
  assert.equal(result.args.recipeId, 918273);
  const resolution = runtime.spans.find(span => span.name === 'pump.ai.entity.resolve');
  assert.equal(resolution.attributes['pump.ai.entity.candidate_count'], 1);
  assert.equal(resolution.attributes['pump.ai.entity.match_type'], 'exact');
  assert.equal(resolution.attributes['pump.ai.entity.resolved'], true);
  assert.equal(resolution.attributes['pump.ai.entity.exact_match'], true);
  assert.match(resolution.attributes['pump.ai.entity.resolved_id_hash'], /^[a-f0-9]{24}$/);
  assert.doesNotMatch(JSON.stringify(runtime.spans), /P03B_SECRET_ENTITY_SENTINEL|918273/);
});

test('real V4 broker emits routing decision without tool argument values', () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const fixture = partRoutingFixture();
  const decision = selectNextCapability({ ...fixture, planHints: ['search_parts'] });
  assert.equal(decision.status, 'selected');
  const span = runtime.spans[0];
  assert.equal(span.name, 'pump.ai.route');
  assert.equal(span.attributes['pump.ai.route.selected_tool_name'], decision.capabilityName);
  assert.equal(span.attributes['pump.ai.route.read_write_classification'], 'read');
  assert.equal(span.attributes['pump.ai.route.success'], true);
  assert.doesNotMatch(JSON.stringify(span), /fixture/);
});

test('verification records evidence counts and normal post-tool signal', () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const result = observability.withVerificationSpan({
    status: 'completed',
    requiredCount: 1,
    observedCount: 1,
    missingCount: 0,
    toolExecutionCount: 1,
  }, () => true);
  assert.equal(result, true);
  const span = runtime.spans[0];
  assert.equal(span.attributes['pump.ai.verification.decision'], true);
  assert.equal(span.attributes['pump.ai.verification.required_count'], 1);
  assert.equal(span.attributes['pump.ai.verification.observed_count'], 1);
  assert.equal(span.attributes['pump.ai.verification.before_any_tool_execution'], false);
});

test('premature verification is observable without changing its false decision', () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const result = observability.withVerificationSpan({
    status: 'failed_unverified',
    requiredCount: 1,
    observedCount: 0,
    missingCount: 1,
    earlyExit: true,
    toolExecutionCount: 0,
  }, () => false);
  assert.equal(result, false);
  const span = runtime.spans[0];
  assert.equal(span.attributes['pump.ai.verification.before_any_tool_execution'], true);
  assert.equal(span.attributes['pump.ai.verification.tool_execution_count_before_verify'], 0);
  assert.equal(span.attributes['pump.ai.verification.missing_count'], 1);
});

test('real V4 failed_unverified transition records the pre-execution signal', () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const controller = createReadInvestigationController({ goal: partRoutingFixture().goal });
  const state = controller.failUnverified('synthetic_transport_failure');
  assert.equal(state.status, 'failed_unverified');
  const span = runtime.spans[0];
  assert.equal(span.name, 'pump.ai.verify');
  assert.equal(span.attributes['pump.ai.verification.status'], 'failed_unverified');
  assert.equal(span.attributes['pump.ai.verification.before_any_tool_execution'], true);
  assert.equal(span.attributes['pump.ai.verification.tool_execution_count_before_verify'], 0);
});

test('entity resolution wrapper preserves thrown error identity', async () => {
  const runtime = fakeTracingRuntime();
  enableTracing(runtime);
  const original = new TypeError('resolver-private-error');
  await assert.rejects(observability.withEntityResolutionSpan({ entityType: 'recipe' }, async () => {
    throw original;
  }), error => error === original);
  assert.equal(runtime.spans[0].status.code, 2);
  assert.doesNotMatch(JSON.stringify(runtime.spans[0]), /resolver-private-error/);
});

test('P03B metadata stays content-free in every configured content mode', () => {
  const values = [
    'P03B_SECRET_ENTITY_SENTINEL',
    'P03B_SECRET_TOOL_ARG_SENTINEL',
    'P03B_SECRET_RESULT_SENTINEL',
  ];
  for (const mode of ['off', 'metadata', 'diagnostic']) {
    const runtime = fakeTracingRuntime();
    observability.initializeObservability({
      env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: mode },
      phoenixModule: runtime.phoenixModule,
      logger: { warn() {} },
    });
    observability.withEntityNormalizationSpan({ input: values[0], output: values[0].toLowerCase() }, () => values[2]);
    observability.withRoutingSpan({}, () => ({ status: 'selected', capabilityName: 'test_tool', args: values[1] }));
    observability.withVerificationSpan({ toolExecutionCount: 1 }, () => false);
    const serialized = JSON.stringify(runtime.spans);
    values.forEach(value => assert.doesNotMatch(serialized, new RegExp(value)));
    observability.resetObservabilityForTesting();
  }
});
