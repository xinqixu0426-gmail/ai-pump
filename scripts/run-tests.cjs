const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');
const testFiles = fs.readdirSync(testsDir)
    .filter(name => name.endsWith('.test.cjs'))
    .sort()
    .map(name => path.join(testsDir, name));

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: projectRoot,
    env: {
        ...process.env,
        NODE_ENV: 'test',
    },
    stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
