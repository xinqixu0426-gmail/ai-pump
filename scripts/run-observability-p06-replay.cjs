require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preloadPath = path.join(projectRoot, 'scripts', 'observability-p06-replay-preload.cjs');
const allowedCases = new Set([
  'simple-current-1',
  'current-cost-1',
  'flat-knife-800-1',
  'part-current-stock-real-provider',
  'coil-current-stock-real-provider',
]);

function cliValue(name, fallback = '') {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

function safeCaseKey(value) {
  const caseKey = String(value || '').trim();
  if (!allowedCases.has(caseKey)) throw new Error('P06 case is not in the focused read-only allowlist');
  return caseKey;
}

function main() {
  if (!fs.existsSync(runnerPath)) throw new Error('Current R4-B runner is unavailable');
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
  const caseKey = safeCaseKey(cliValue('case-key'));
  const enabled = cliValue('observability', 'on') === 'on';
  const reportPath = path.join(
    os.tmpdir(),
    'pump-p06-real-replay',
    `${caseKey}-${enabled ? 'on' : 'off'}-${process.pid}.json`
  );
  const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
  const nodeOptions = [existingNodeOptions, `--require=${preloadPath}`].filter(Boolean).join(' ');
  const result = spawnSync(process.execPath, [runnerPath, `--case-key=${caseKey}`], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AI_OBSERVABILITY_ENABLED: enabled ? 'true' : 'false',
      AI_TRACE_CONTENT: 'metadata',
      AI_OBSERVABILITY_PROJECT: 'pump-ai-p06-real-replay',
      PHOENIX_COLLECTOR_ENDPOINT: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006',
      PUMP_P06_REPLAY_REPORT_PATH: reportPath,
      NODE_OPTIONS: nodeOptions,
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.stdout.write(`${JSON.stringify({
    case_id: caseKey,
    observability: enabled ? 'on' : 'off',
    runner_exit_code: result.status,
    report_path: reportPath,
  })}\n`);
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'failed', error_type: error.name })}\n`);
    process.exitCode = 2;
  }
}

module.exports = { allowedCases, safeCaseKey };
