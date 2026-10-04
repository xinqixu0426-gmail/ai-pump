'use strict';

const { execFileSync } = require('node:child_process');

// R6 is the reviewed Candidate product baseline. Final V3 may change only
// harness/evidence files beyond this commit.
const PRODUCT_BASELINE_COMMIT = 'f68dbaf024f3f424d7052da88d0009f6b7dd8043';
const HARNESS_ALLOWLIST = Object.freeze([
    /^planning\/ai-native-api\/M5-D1-(?:FINAL|FH1)-/,
    /^scripts\/ai-experiments\/api-native-agent\/d1FinalAcceptance(?:Evaluator|Oracles|Evidence|Manifest)?\.cjs$/,
    /^scripts\/ai-experiments\/api-native-agent\/run-d1-final-(?:controlled|controlled-repetition|real-catalog)\.cjs$/,
    /^scripts\/ai-experiments\/api-native-agent\/d1FinalProductDriftGuard\.cjs$/,
    /^tests\/d1FinalAcceptance(?:Evaluator|Harness)\.test\.cjs$/,
]);

function evaluateProductDrift(paths, allowlist = HARNESS_ALLOWLIST) {
    const changedFiles = [...new Set(paths)].sort();
    const unexpectedChangedFiles = changedFiles.filter(file => !allowlist.some(pattern => pattern.test(file)));
    return Object.freeze({ productBaselineCommit: PRODUCT_BASELINE_COMMIT, changedFiles: Object.freeze(changedFiles), unexpectedChangedFiles: Object.freeze(unexpectedChangedFiles), pass: unexpectedChangedFiles.length === 0 });
}
function productDriftFromGit(options = {}) {
    const baseline = options.baseline || PRODUCT_BASELINE_COMMIT;
    const cwd = options.cwd || process.cwd();
    const output = execFileSync('git', ['diff', '--name-only', `${baseline}...HEAD`], { cwd, encoding: 'utf8' });
    return evaluateProductDrift(output.split(/\r?\n/).filter(Boolean));
}

module.exports = { HARNESS_ALLOWLIST, PRODUCT_BASELINE_COMMIT, evaluateProductDrift, productDriftFromGit };
