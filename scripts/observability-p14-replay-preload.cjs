'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const projectRoot = path.resolve(__dirname, '..');
const shadowReportPath = path.join(projectRoot, 'output', 'ai-r4b-shadow-latest.json');
const redirectedReportPath = String(process.env.PUMP_P14_REPLAY_REPORT_PATH || '').trim();

if (redirectedReportPath) {
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    fs.writeFileSync = function writeP14Report(file, ...args) {
        if (path.resolve(String(file)) === shadowReportPath) {
            const safeTarget = path.resolve(redirectedReportPath);
            fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
            return originalWriteFileSync(safeTarget, ...args);
        }
        return originalWriteFileSync(file, ...args);
    };
}

if (process.argv.includes('--worker')) {
    const observability = require('../api/services/observability.cjs');
    const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
    const { collectV5ShadowFacts } = require('../api/services/ai-v5/shadowFacts.cjs');
    const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
    const { scheduleV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
    observability.initializeObservability();

    const originalLoad = Module._load;
    Module._load = function loadP14ObservedRuntime(request, parent, isMain) {
        const loaded = originalLoad.call(this, request, parent, isMain);
        const fromShadowRunner = parent?.filename
            && path.basename(parent.filename) === 'run-ai-shadow-evaluation.cjs';
        if (!fromShadowRunner || !String(request).endsWith('aiAgentRuntimeV3.cjs')) return loaded;

        const originalRuntime = loaded.runAiAgentRuntimeV3;
        return {
            ...loaded,
            async runAiAgentRuntimeV3(input = {}) {
                const env = input.env || {};
                const pathName = env.AI_READ_INVESTIGATION_V4_ENABLED !== 'true'
                    ? 'legacy' : env.AI_CLAIM_GROUNDING_V4_ENABLED === 'true' ? 'v4-r3' : 'v4-investigation';
                const caseKey = String(input.requestId || 'p14-case')
                    .replace(/^shadow:/, '').replace(/[^a-zA-Z0-9._-]/g, '-');
                const requestId = `p06-${caseKey}-${pathName}`.slice(0, 128);
                const provider = observability.traceModelProvider(input.fetchAiProvider || fetchAiProvider);
                try {
                    return await observability.withAgentSpan({
                        streaming: Boolean(input.stream), route: 'p14_real_replay', requestId,
                    }, async () => {
                        const collected = await collectV5ShadowFacts(() => originalRuntime({
                            ...input, requestId, fetchAiProvider: provider,
                        }));
                        const traceContext = observability.getActiveTraceContext();
                        const facts = captureSafeV4ShadowFacts(
                            { requestId, allowWrite: false }, collected.result, traceContext,
                            { shadowFacts: collected.shadowFacts }
                        );
                        const scheduled = scheduleV5ShadowMirror(facts, { env: process.env });
                        if (scheduled?.completion) await scheduled.completion;
                        return collected.result;
                    });
                } finally {
                    await observability.safeForceFlush();
                }
            },
        };
    };
}
