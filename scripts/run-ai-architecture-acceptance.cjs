const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const testDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-r4a-tests-'));
const testFiles = [
    'tests/aiEvidenceArchitecture.test.cjs',
    'tests/aiExecutionEvidence.test.cjs',
    'tests/aiReadInvestigationV4.test.cjs',
    'tests/aiReadInvestigationDriverV4.test.cjs',
    'tests/aiReadInvestigationRuntimeV4Integration.test.cjs',
    'tests/aiEntityBindingReuseV4.test.cjs',
    'tests/aiClaimGroundingV4.test.cjs',
    'tests/aiClaimGroundingRuntimeV4Integration.test.cjs',
    'tests/aiArchitectureAcceptanceV4.test.cjs',
    'tests/aiArchitectureAcceptanceHttpV4Integration.test.cjs',
];
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
