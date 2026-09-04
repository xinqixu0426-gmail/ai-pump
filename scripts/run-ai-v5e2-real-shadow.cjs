'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..');

async function snapshotDatabase(source, destination) {
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try {
        await db.backup(destination);
    } finally {
        db.close();
    }
}

async function parentMain() {
    const source = path.join(projectRoot, 'pump.db');
    if (!fs.existsSync(source) || !process.env.DEEPSEEK_API_KEY) {
        process.stdout.write(`${JSON.stringify({ status: 'NOT_RUN', reason: !fs.existsSync(source) ? 'DATABASE_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE' })}\n`);
        process.exitCode = 2;
        return;
    }
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-v5e2-real-shadow-'));
    const snapshot = path.join(tempRoot, 'source.db');
    try {
        await snapshotDatabase(source, snapshot);
        const result = spawnSync(process.execPath, [__filename, '--worker'], {
            cwd: projectRoot,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                NODE_TEST_CONTEXT: 'v5e2-real-shadow',
                DB_BACKUP_DIR: path.join(tempRoot, 'backups'),
                PUMP_TEST_DATABASE_PATH: path.join(tempRoot, 'runtime-{pid}.db'),
                PUMP_V5E2_SOURCE_SNAPSHOT: snapshot,
                AI_OBSERVABILITY_ENABLED: 'true',
                AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e2-shadow',
                AI_TRACE_CONTENT: 'metadata',
                PHOENIX_COLLECTOR_ENDPOINT: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006',
                AI_V5_SHADOW_ENABLED: 'true',
                AI_V5_SHADOW_SAMPLE_RATE: '1',
            },
            stdio: 'inherit',
        });
        if (result.error) throw result.error;
        process.exitCode = result.status ?? 1;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

async function workerMain() {
    const isolatedPath = path.resolve(String(process.env.PUMP_TEST_DATABASE_PATH).replaceAll('{pid}', String(process.pid)));
    fs.copyFileSync(process.env.PUMP_V5E2_SOURCE_SNAPSHOT, isolatedPath);
    const express = require('express');
    const costRouter = require('../api/routes/cost.cjs');
    const coilsRouter = require('../api/routes/coils.cjs');
    const partsRouter = require('../api/routes/parts.cjs');
    const recipesRouter = require('../api/routes/recipes.cjs');
    const templatesRouter = require('../api/routes/templates.cjs');
    const { stopBackupScheduler } = require('../api/db.cjs');
    const observability = require('../api/services/observability.cjs');
    const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
    const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');

    const app = express();
    app.use(express.json());
    app.use('/api', costRouter);
    app.use('/api/coils', coilsRouter);
    app.use('/api/parts', partsRouter);
    app.use('/api/recipes', recipesRouter);
    app.use('/api/templates', templatesRouter);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    process.env.PORT = String(server.address().port);
    observability.initializeObservability();
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/parts`);
        const payload = await response.json();
        const part = payload?.data?.find(item => typeof item.model === 'string' && item.model.trim() && Number(item.stock) > 0);
        if (!part) throw Object.assign(new Error('Safe read fixture unavailable'), { code: 'FIXTURE_UNAVAILABLE' });

        const cases = [
            { id: 'p13-real-success', expected: 'PASS', question: `${part.model}当前库存是多少` },
            { id: 'p13-real-failure', expected: 'FAIL', question: 'v750-tokoy-现在的完整成本是多少' },
        ];
        const summaries = [];
        for (const item of cases) {
            const outcomes = [];
            const mirror = createV5ShadowMirror({
                env: process.env,
                maxConcurrency: 1,
                random: () => 0,
                onOutcome: outcome => outcomes.push(outcome),
            });
            let result;
            try {
                result = await runAiDispatcherV3({
                    messages: [{ role: 'user', content: item.question }],
                    allowWrite: false,
                    stream: false,
                    requestId: item.id,
                    env: {
                        ...process.env,
                        AI_READ_INVESTIGATION_V4_ENABLED: 'true',
                        AI_CLAIM_GROUNDING_V4_ENABLED: 'false',
                    },
                }, {
                    env: process.env,
                    scheduleV5ShadowMirror: facts => mirror.mirror(facts),
                });
                await mirror.waitForIdle(2000);
                const toolSteps = Array.isArray(result?.telemetry?.toolSteps) ? result.telemetry.toolSteps : [];
                const v4Pass = result?.telemetry?.outcome === 'completed'
                    && toolSteps.length > 0
                    && toolSteps.every(step => step.success === true);
                summaries.push({
                    id: item.id,
                    expected: item.expected,
                    v4Result: v4Pass ? 'PASS' : 'FAIL',
                    v4Status: result?.telemetry?.outcome || 'UNKNOWN',
                    v4ToolCount: toolSteps.length,
                    shadowComparison: outcomes[0]?.comparisonStatus || 'NOT_RUN',
                    shadowProjection: outcomes[0]?.projectionStatus || 'NOT_RUN',
                });
            } catch (error) {
                summaries.push({
                    id: item.id,
                    expected: item.expected,
                    v4Result: 'FAIL',
                    v4Status: error?.code || 'RUNTIME_ERROR',
                    v4ToolCount: 0,
                    shadowComparison: outcomes[0]?.comparisonStatus || 'NOT_RUN',
                    shadowProjection: outcomes[0]?.projectionStatus || 'NOT_RUN',
                });
            }
        }
        await observability.safeForceFlush();
        process.stdout.write(`${JSON.stringify({
            status: 'COMPLETE',
            realV4Executions: summaries.length,
            v5ModelCalls: 0,
            v5ToolCalls: 0,
            v5BusinessApiCalls: 0,
            v5Writes: 0,
            cases: summaries,
        }, null, 2)}\n`);
    } finally {
        await observability.safeShutdown();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
        stopBackupScheduler();
        costRouter.stopCopperPriceScheduler?.();
        partsRouter.stopCopperPriceScheduler?.();
    }
}

if (process.argv.includes('--worker')) {
    workerMain().catch(error => {
        process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorType: error?.name || 'Error', code: error?.code || 'UNKNOWN' })}\n`);
        process.exitCode = 1;
    });
} else {
    parentMain().catch(error => {
        process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorType: error?.name || 'Error' })}\n`);
        process.exitCode = 1;
    });
}
