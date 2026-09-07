'use strict';

// P16-H supervision adapter only. No business logic, model settings tuning or
// legacy startup imports. Secrets are read from the existing authority in memory.
const fs = require('node:fs');
const path = require('node:path');

function multiReadEnvironment(config) {
    return { AI_V5_MULTI_READ_ENABLED: config.multiReadEnabled === true ? 'true' : 'false' };
}

function createMetadataProcessor(state, save) {
    const traces = new Map();
    return {
        onStart(s) {
            const trace = s.spanContext().traceId;
            const parent = s.parentSpanContext?.spanId || s.parentSpanId;
            if (!traces.has(trace)) traces.set(trace, { ids: new Set(), tasks: new Set() });
            const t = traces.get(trace);
            if (parent && !t.ids.has(parent)) state.orphans++;
            t.ids.add(s.spanContext().spanId);
            if (!parent) state.roots++;
        },
        onEnd(s) {
            state.spans++;
            const t = traces.get(s.spanContext().traceId);
            const task = s.attributes['pump.ai.v5.shadow_task_id'];
            if (task) t?.tasks.add(task);
            if (!s.parentSpanContext?.spanId && !s.parentSpanId) {
                // Read completed root attributes: SDK onStart can precede their
                // initialization. Compare opaque ownership only, never values.
                for (const childTask of t?.tasks || []) {
                    if (childTask !== s.attributes['pump.request.id']) state.crossRequest++;
                }
                traces.delete(s.spanContext().traceId); save();
            }
        },
        async forceFlush() {}, async shutdown() {},
    };
}

async function start(config, role) {
    if (process.getuid?.() === 0 || !['candidate', 'gateway'].includes(role) || config.enabled !== true) {
        throw Error('OWNER_RUNTIME_DISABLED');
    }
    const env = require(path.join(config.legacyDirectory, 'node_modules/dotenv')).parse(
        fs.readFileSync(path.join(config.legacyDirectory, '.env')));
    if (!env.INTERNAL_SECRET) throw Error('OWNER_RUNTIME_AUTH_MISSING');
    const file = path.join(config.stateDirectory, role + '-metadata.json');
    const state = { role, pid: process.pid, startedAt: new Date().toISOString(), events: [],
        completedRequests: 0, spans: 0, roots: 0, orphans: 0, crossRequest: 0 };
    const save = event => {
        if (event) { state.events.push(event); if (state.events.length > 100) state.events.shift(); }
        state.memory = { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed };
        fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    };
    // Never persist generic library logs, exception text, bodies or attributes.
    for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = () => {};
    let runtime;
    if (role === 'candidate') {
        Object.assign(process.env, env, {
            ...multiReadEnvironment(config),
            PUMP_V5_CANDIDATE_RUNTIME: 'true', PUMP_V5_CANDIDATE_PORT: '3102',
            PUMP_V5_CANDIDATE_DATABASE: path.join(config.legacyDirectory, 'pump.db'),
            AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true',
            AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-v4-flash',
            AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata',
        });
        const phoenix = require('@arizeai/phoenix-otel');
        const processor = createMetadataProcessor(state, () => save());
        runtime = await require(path.join(config.candidateDirectory, 'scripts/start-v5-candidate.cjs')).startCandidate({
            observability: { phoenixModule: { ...phoenix, register: p => phoenix.register({ ...p, spanProcessors: [processor] }) }, logger: { warn() {} } },
            onOutcome: o => {
                state.completedRequests++;
                save({ time: new Date().toISOString(), eligible: o.risk?.eligible === true,
                    riskClass: ['READ_SAFE','WRITE_OR_MUTATION','UNAVAILABLE_OR_UNKNOWN'].includes(o.risk?.riskClass) ? o.risk.riskClass : 'UNAVAILABLE_OR_UNKNOWN',
                    ordinalControl: o.ordinalControl === true, riskInvoked: o.risk?.invoked === true,
                    collectionSemanticCalls: Number.isInteger(o.semanticModelCalls) ? o.semanticModelCalls : null,
                    investigationType: ['customer.orders','order.customer','order.lines','recipe.parts','part.recipes','parts.stock','part.facts'].includes(o.investigationType) ? o.investigationType : null,
                    plannedSteps: Number.isInteger(o.plannedSteps) && o.plannedSteps <= 4 ? o.plannedSteps : null,
                    attempted: o.attempted === true, validated: o.validationPass === true, delivered: o.delivered === true,
                    failureClass: /^[A-Z_]{1,80}$/.test(o.failureClass) ? o.failureClass : 'UNKNOWN',
                    durationMs: o.durationMs, toolCalls: o.toolCalls || 0,
                    factKey: ['price.current','inventory.quantity','coil.inventory','recipe.cost.preview'].includes(o.derivedFactKey) ? o.derivedFactKey : null,
                    factDerivationCalls: o.factDerivationCalls || 0, answerCalls: o.modelCalls || 0,
                    numericValid: o.numericValid === true, entityValid: o.entityValid === true,
                    evidenceVerified: o.evidenceVerification === 'PASS' });
            },
        });
    } else {
        const server = require(path.join(config.gatewayDirectory, 'ownerReadCanaryGateway.cjs')).createOwnerReadCanaryServer({
            env: { INTERNAL_SECRET: env.INTERNAL_SECRET, AI_V5_OWNER_CANARY_ENABLED: 'true' },
            readConfig: () => {
                const authority = require(path.join(config.legacyDirectory, 'node_modules/dotenv')).parse(
                    fs.readFileSync(path.join(config.legacyDirectory, '.env')));
                const gateFile = path.join(config.stateDirectory, 'owner-default.json');
                const gate = fs.existsSync(gateFile) ? JSON.parse(fs.readFileSync(gateFile, 'utf8')) : {};
                return { ...authority, AI_V5_OWNER_READ_DEFAULT_ENABLED: gate.AI_V5_OWNER_READ_DEFAULT_ENABLED === true ? 'true' : 'false' };
            },
            onOutcome: o => { state.completedRequests++; save(o); },
        });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3103, '127.0.0.1', resolve); });
        runtime = { close: () => new Promise(resolve => server.close(resolve)) };
    }
    state.ready = true; save();
    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true; await runtime.close(); state.ready = false; save();
    };
    process.once('SIGTERM', () => close().catch(() => { process.exitCode = 1; }));
    process.once('SIGINT', () => close().catch(() => { process.exitCode = 1; }));
    return { close };
}

if (require.main === module) {
    start(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv[3]).catch(() => { process.exitCode = 1; });
}
module.exports = { start, createMetadataProcessor, multiReadEnvironment };
