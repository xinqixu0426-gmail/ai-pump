const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');
const testFiles = fs.readdirSync(testsDir)
    .filter(name => name.endsWith('.test.cjs'))
    .sort()
    .map(name => path.join(testsDir, name));

const testDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-test-databases-'));
let result;
try {
    result = spawnSync(process.execPath, ['--test', ...testFiles], {
        cwd: projectRoot,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            PUMP_TEST_DATABASE_PATH: path.join(testDatabaseDir, 'pump-{pid}.db'),
        },
        stdio: 'inherit',
    });
} finally {
    fs.rmSync(testDatabaseDir, { recursive: true, force: true });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
