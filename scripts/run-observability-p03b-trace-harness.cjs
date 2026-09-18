const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p03b-trace-'));
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = '1';
process.env.PUMP_TEST_DATABASE_PATH = path.join(tempDirectory, 'pump-{pid}.db');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
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
const {
  initializeObservability,
  safeForceFlush,
  safeShutdown,
  withToolSpan,
  withVerificationSpan,
} = require('../api/services/observability.cjs');

const ENTITY_SENTINEL = 'P03B_SECRET_ENTITY_SENTINEL';
const TOOL_ARG_SENTINEL = 'P03B_SECRET_TOOL_ARG_SENTINEL';
const RESULT_SENTINEL = 'P03B_SECRET_RESULT_SENTINEL';

function routingFixture() {
  const requirement = createFactRequirement({
    identity: {
      entityType: 'part',
      entityId: null,
      predicate: 'currentScalar',
      temporalScope: 'current',
      scenario: 'catalog_current',
      qualifiers: { targetMention: ENTITY_SENTINEL },
    },
  });
  const goal = createInvestigationGoal({
    goalId: 'p03b-harness',
    goal: 'synthetic',
    mode: 'query',
    entityScope: 'single',
    domains: ['catalog'],
    originalTarget: ENTITY_SENTINEL,
    requirements: [requirement],
  });
  return {
    goal,
    state: createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements }),
  };
}

async function fakeModel(_messages, options = {}) {
  await new Promise(resolve => setTimeout(resolve, 2));
  options.onProvider?.({ provider: 'test', model: 'test-model' });
  return { ok: true, status: 200 };
}

async function normalRuntime(input) {
  buildSearchProbes(`${ENTITY_SENTINEL}-9`, { entityType: 'recipe' });
  await input.fetchAiProvider([], {
    tools: [{ type: 'function', function: { name: 'observability_test_tool' } }],
    stream: false,
    onProvider: input.onProvider,
  });
  const route = selectNextCapability({ ...routingFixture(), planHints: ['search_parts'] });
  const resolution = await resolveAiToolTargetV3({
    toolName: 'preview_recipe_cost',
    args: { recipeName: ENTITY_SENTINEL },
    executeToolCall: async () => ({
      success: true,
      data: [{ id: 314159, name: ENTITY_SENTINEL }],
      count: 1,
      executionEvidence: { verified: true },
    }),
  });
  const toolResult = await withToolSpan({
    toolName: 'observability_test_tool',
    executorType: 'test',
    access: 'read',
    args: { syntheticKey: TOOL_ARG_SENTINEL },
  }, async () => ({ success: true, syntheticResult: RESULT_SENTINEL }));
  await new Promise(resolve => setTimeout(resolve, 2));
  await input.fetchAiProvider([], { tools: [], stream: false, onProvider: input.onProvider });
  const verified = withVerificationSpan({
    status: 'completed',
    requiredCount: 1,
    observedCount: 1,
    missingCount: 0,
    toolExecutionCount: 1,
  }, () => true);
  await new Promise(resolve => setTimeout(resolve, 2));
  return {
    finalContent: 'p03b-normal-success',
    routeSelected: route.status === 'selected',
    resolved: resolution.status === 'exact',
    toolSuccess: toolResult.success,
    verified,
  };
}

async function prematureVerificationRuntime() {
  const verified = withVerificationSpan({
    status: 'failed_unverified',
    requiredCount: 1,
    observedCount: 0,
    missingCount: 1,
    earlyExit: true,
    toolExecutionCount: 0,
  }, () => false);
  await new Promise(resolve => setTimeout(resolve, 2));
  return { finalContent: 'p03b-premature-observed', verified };
}

async function main() {
  try {
    initializeObservability();
    const normal = await runAiDispatcherV3({
      fetchAiProvider: fakeModel,
      stream: false,
      onProvider() {},
    }, { runAiAgentRuntimeV3: normalRuntime });
    const premature = await runAiDispatcherV3({
      fetchAiProvider: fakeModel,
      stream: false,
    }, { runAiAgentRuntimeV3: prematureVerificationRuntime });
    const flushed = await safeForceFlush();
    const shutdown = await safeShutdown();
    const summary = {
      normal: {
        businessResult: normal.finalContent,
        routeSelected: normal.routeSelected,
        resolved: normal.resolved,
        toolSuccess: normal.toolSuccess,
        verified: normal.verified,
      },
      premature: {
        businessResult: premature.finalContent,
        verified: premature.verified,
      },
      flushed,
      shutdown,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (normal.finalContent !== 'p03b-normal-success'
      || !normal.routeSelected
      || !normal.resolved
      || !normal.toolSuccess
      || !normal.verified
      || premature.verified !== false) {
      process.exitCode = 1;
    }
  } finally {
    const { db, stopBackupScheduler, waitForBackupIdle } = require('../api/db.cjs');
    stopBackupScheduler();
    await waitForBackupIdle();
    if (db.open) db.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    status: 'failed',
    errorType: error instanceof Error ? error.name : 'HarnessError',
  })}\n`);
  process.exitCode = 1;
});
