const {
  emitSyntheticSmokeSpan,
  getObservabilityState,
  initializeObservability,
  safeForceFlush,
  safeShutdown,
} = require('../api/services/observability.cjs');

async function main() {
  initializeObservability();
  const span = emitSyntheticSmokeSpan();
  const flushed = await safeForceFlush();
  const shutdown = await safeShutdown();
  const state = getObservabilityState();

  process.stdout.write(`${JSON.stringify({
    state,
    span,
    flushed,
    shutdown,
  })}\n`);

  if (state.enabled && (!span || !flushed || !shutdown)) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    status: 'failed_open',
    errorType: error instanceof Error ? error.name : 'TelemetryError',
  })}\n`);
  process.exitCode = 1;
});
