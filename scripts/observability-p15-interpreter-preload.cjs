'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const projectRoot = path.resolve(__dirname, '..');
const shadowReportPath = path.join(projectRoot, 'output', 'ai-r4b-shadow-latest.json');
const redirectedReportPath = String(process.env.PUMP_P15_REPLAY_REPORT_PATH || '').trim();
const interpreterReportPath = String(process.env.PUMP_P15_INTERPRETER_REPORT_PATH || '').trim();

function writeSafeInterpreterRecord(record) {
    if (!interpreterReportPath) return;
    let records = [];
    try { records = JSON.parse(fs.readFileSync(interpreterReportPath, 'utf8')); } catch { /* first record */ }
    const filtered = Array.isArray(records) ? records.filter(item => item.caseId !== record.caseId) : [];
    filtered.push(record);
    fs.mkdirSync(path.dirname(interpreterReportPath), { recursive: true });
    fs.writeFileSync(interpreterReportPath, `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
}

if (redirectedReportPath) {
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    fs.writeFileSync = function writeP15Report(file, ...args) {
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
    const { extractSourceUserRequest } = require('../api/services/ai-v5/independentShadow.cjs');
    const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
    observability.initializeObservability();

    const originalLoad = Module._load;
    Module._load = function loadP15ObservedRuntime(request, parent, isMain) {
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
                    ? 'LEGACY' : env.AI_CLAIM_GROUNDING_V4_ENABLED === 'true' ? 'V4R3' : 'V4I';
                const caseKey = String(input.requestId || 'p15-case')
                    .replace(/^shadow:/, '').replace(/[^a-zA-Z0-9._-]/g, '-');
                const requestId = `p15-${caseKey}-${pathName.toLowerCase()}`.slice(0, 128);
                const provider = observability.traceModelProvider(input.fetchAiProvider || fetchAiProvider);
                try {
                    return await observability.withAgentSpan({
                        streaming: Boolean(input.stream), route: 'p15_real_replay', requestId,
                    }, async () => {
                        const collected = await collectV5ShadowFacts(() => originalRuntime({
                            ...input, requestId, fetchAiProvider: provider,
                        }));
                        const traceContext = observability.getActiveTraceContext();
                        const facts = captureSafeV4ShadowFacts(
                            { requestId, allowWrite: false }, collected.result, traceContext,
                            { shadowFacts: collected.shadowFacts }
                        );
                        let interpreterEnvelope = null;
                        try {
                            interpreterEnvelope = createV5InterpreterInputEnvelope({
                                rawUserRequest: extractSourceUserRequest(input.messages),
                                pageContext: input.pageContext ?? null,
                            });
                        } catch { /* Shadow input cannot affect V4. */ }
                        let capturedOutcome = null;
                        const scheduled = scheduleV5ShadowMirror(facts, {
                            env: process.env,
                            interpreterEnvelope,
                            onOutcome: outcome => { capturedOutcome = outcome; },
                        });
                        if (scheduled?.completion) capturedOutcome = await scheduled.completion;
                        const independent = capturedOutcome?.independentShadow || null;
                        writeSafeInterpreterRecord({
                            caseId: `${caseKey}:${pathName}`,
                            sourceTraceId: facts.sourceTraceId,
                            shadowTaskId: facts.shadowTaskId,
                            independent,
                        });
                        return collected.result;
                    });
                } finally {
                    await observability.safeForceFlush();
                }
            },
        };
    };
}
