'use strict';
/**
 * E1-E — Release Gate Hardening
 *
 * 覆盖用户点名的测试 17–21：
 *   17 结构就绪 + 低覆盖 ≠ owner trial 就绪
 *   18 只有 SUPPORTED 问法族才具备 canary 资格
 *   19 node_modules 符号链接不制造 false dirty
 *   20 源码改动仍然必须 fail dirty gate
 *   21 env-file / provider 前置条件可重复执行且不持久化 secret
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    COVERAGE_STATUS,
    OWNER_TRIAL_COVERAGE,
    ownerTrialCoverageSummary,
    ownerTrialCoverageReadiness,
} = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const {
    isEnvironmentalArtifact,
    sourceDirtyFromStatus,
    parseArguments,
} = require('../scripts/run-ai-native-quality-gate.cjs');

const root = path.resolve(__dirname, '..');

test('E1-E-17 结构就绪不等于 owner trial 就绪；覆盖不足时必须给出范围而不是笼统 READY', () => {
    const summary = ownerTrialCoverageSummary();
    assert.equal(summary.total, OWNER_TRIAL_COVERAGE.length);
    assert.ok(summary.supported.length > 0 && summary.unsupported.length > 0, '真实数据下必然同时存在支持与不支持族');
    const scoped = ownerTrialCoverageReadiness({ structuralReady: true });
    assert.equal(scoped.status, 'READY_WITHIN_SUPPORTED_SCOPE');
    assert.equal(scoped.ready, true);
    assert.equal(scoped.canaryScope.length, summary.supported.length);
    assert.equal(scoped.excludedScope.length, summary.partial.length + summary.unsupported.length);
    // 结构全绿但没有可支持族 → 不得就绪
    assert.equal(ownerTrialCoverageReadiness({ structuralReady: false }).status, 'NOT_READY');
});

test('E1-E-18 canary 资格只能来自 SUPPORTED 问法族', () => {
    const summary = ownerTrialCoverageSummary();
    const supportedNames = summary.supported.map(entry => entry.questionFamily);
    const notSupported = [...summary.partial, ...summary.unsupported].map(entry => entry.questionFamily);
    assert.deepEqual(summary.canaryEligible, supportedNames);
    for (const name of notSupported) assert.equal(summary.canaryEligible.includes(name), false, `${name} 不得具备 canary 资格`);
    // 每条都必须是三态之一且带证据来源（不允许凭空声称支持）。
    for (const entry of OWNER_TRIAL_COVERAGE) {
        assert.ok(Object.values(COVERAGE_STATUS).includes(entry.nativeSupport));
        assert.ok(entry.evidence && entry.evidence.length > 10, `${entry.questionFamily} 缺少证据来源`);
        assert.ok(entry.expectedGoal && Array.isArray(entry.requiredCapabilities));
    }
});

test('E1-E-19 node_modules（含 worktree 符号链接形态）不得制造 false dirty', () => {
    assert.equal(isEnvironmentalArtifact('node_modules'), true);
    assert.equal(isEnvironmentalArtifact('apps/web-next/node_modules'), true);
    assert.equal(isEnvironmentalArtifact('logs/ai.json'), true);
    assert.equal(isEnvironmentalArtifact('.env'), true);
    assert.equal(sourceDirtyFromStatus('', ['node_modules', 'apps/web-next/node_modules']), false);
    assert.equal(sourceDirtyFromStatus('', ['node_modules/', 'logs/x.json', 'backups/y.db']), false);
});

test('E1-E-20 真正的源码 / 证据改动仍然必须 fail dirty gate', () => {
    assert.equal(sourceDirtyFromStatus(' M api/services/aiAssistantAnswer.cjs', []), true);
    assert.equal(sourceDirtyFromStatus('', ['api/services/brandNewContract.cjs']), true);
    assert.equal(sourceDirtyFromStatus('', ['tests/newRegression.test.cjs']), true);
    assert.equal(sourceDirtyFromStatus('', ['planning/ai-native-v1/release/newEvidence.json']), true);
    assert.equal(isEnvironmentalArtifact('api/services/x.cjs'), false);
});

test('E1-E-21 --env-file 可重复解析、不复制也不持久化 secret', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-env-'));
    const envFile = path.join(directory, 'phase-e1.env');
    fs.writeFileSync(envFile, 'DEEPSEEK_API_KEY=phase-e1-not-a-real-key\nAI_NATIVE_MODE=off\n');
    const parsed = parseArguments([`--env-file=${envFile}`]);
    assert.equal(parsed.envFile, path.resolve(envFile));
    assert.deepEqual(parseArguments([]), { envFile: null });
    // 幂等：重复解析得到同一路径，且不产生任何文件系统副作用。
    assert.deepEqual(parseArguments([`--env-file=${envFile}`]), parsed);
    assert.deepEqual(fs.readdirSync(directory), ['phase-e1.env'], '不得在 env 文件旁生成新文件');
    // 仓库内不得出现被复制进来的 .env（本 worktree 本来就没有）。
    assert.equal(fs.existsSync(path.join(root, '.env')), false, '不得把凭据复制进仓库');
    // 凭据文件本身必须被视为环境产物，绝不能被当成源码改动或证据提交。
    assert.equal(isEnvironmentalArtifact('.env'), true);
    fs.rmSync(directory, { recursive: true, force: true });
});
