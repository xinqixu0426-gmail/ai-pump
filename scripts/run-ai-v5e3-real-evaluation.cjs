'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildDataset } = require('./run-ai-v5e3-shadow.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p14-replay-preload.cjs');
const analyzer = path.join(root, 'scripts', 'analyze-observability-p06-replay.cjs');
const officialDataset = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e3-shadow-evaluation.json');
const caseKeys = [
    'simple-current-1', 'current-cost-1', 'flat-knife-800-1',
    'part-current-stock-real-provider', 'coil-current-stock-real-provider',
];

function run(command, args, env, allowedStatuses = [0]) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!allowedStatuses.includes(result.status)) {
        throw new Error(`P14 child failed: ${path.basename(args[0] || command)} (${result.status})`);
    }
}

function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    const work = process.env.PUMP_P14_WORK_DIR
        ? path.resolve(process.env.PUMP_P14_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p14-real-'));
    const reports = path.join(work, 'reports');
    fs.mkdirSync(reports, { recursive: true });
    const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
    const nodeOptions = [existingNodeOptions, `--require=${preload}`].filter(Boolean).join(' ');
    const commonEnv = {
        ...process.env,
        AI_OBSERVABILITY_ENABLED: 'true',
        AI_TRACE_CONTENT: 'metadata',
        AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e3-shadow',
        AI_V5_SHADOW_ENABLED: 'true',
        AI_V5_SHADOW_SAMPLE_RATE: '1',
        PHOENIX_COLLECTOR_ENDPOINT: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006',
        NODE_OPTIONS: nodeOptions,
    };
    for (const caseKey of caseKeys) {
        const reportPath = path.join(reports, `${caseKey}-on.json`);
        if (fs.existsSync(reportPath)) continue;
        run(process.execPath, [runner, `--case-key=${caseKey}`], {
            ...commonEnv,
            PUMP_P14_REPLAY_REPORT_PATH: reportPath,
        }, [0, 1]);
        if (!fs.existsSync(reportPath)) throw new Error(`P14 report missing: ${caseKey}`);
    }
    const freshCorpus = path.join(work, 'p14-fresh-corpus.json');
    run(process.execPath, [analyzer,
        `--reports-dir=${reports}`,
        '--project=pump-ai-v5e3-shadow',
        `--database=${path.join(root, 'pump.db')}`,
        `--output=${freshCorpus}`,
    ], commonEnv);
    const cases = JSON.parse(fs.readFileSync(freshCorpus, 'utf8'));
    const frozenCases = JSON.parse(fs.readFileSync(path.join(
        root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json'
    ), 'utf8'));
    const dataset = buildDataset(cases, { frozenCases });
    fs.mkdirSync(path.dirname(officialDataset), { recursive: true });
    fs.writeFileSync(officialDataset, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed', paths: cases.length, metrics: dataset.metrics,
        work_directory: work, dataset: officialDataset,
    })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', error_type: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { caseKeys };
