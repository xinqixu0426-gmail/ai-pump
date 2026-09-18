const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p02-startup-'));
const port = 3192;
const child = spawn(process.execPath, ['api.cjs'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    NODE_TEST_CONTEXT: '1',
    PUMP_TEST_DATABASE_PATH: path.join(tempDirectory, 'pump-{pid}.db'),
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
      if (response.ok) return response.json();
    } catch {
      // Startup is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('API health timeout');
}

async function stopChild() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 12000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  try {
    const health = await waitForHealth();
    assert.equal(health.success, true);
    assert.equal(health.data.status, 'alive');
    process.stdout.write(`${JSON.stringify({
      startup: 'PASS',
      health: 'PASS',
      observabilityEnabled: process.env.AI_OBSERVABILITY_ENABLED === 'true',
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      startup: 'FAIL',
      errorType: error instanceof Error ? error.name : 'StartupError',
      childExitCode: child.exitCode,
      stdoutPresent: stdout.length > 0,
      stderrPresent: stderr.length > 0,
    })}\n`);
    process.exitCode = 1;
  } finally {
    await stopChild();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
})();
