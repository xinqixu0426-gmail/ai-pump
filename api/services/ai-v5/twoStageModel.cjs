'use strict';
const { configuredInterpreterModel, requestConfiguredInterpreterModel } = require('./taskInterpreter.cjs');

// Request-local configuration: never change the provider of V4 or another task.
async function callStage(messages, options = {}) {
    const env = { ...(options.env || process.env), AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-v4-flash' };
    const selected = configuredInterpreterModel(env);
    const timeoutMs = options.timeoutMs || 20000;
    const controller = new AbortController();
    let timer;
    const started = performance.now();
    try {
        const response = await Promise.race([
            Promise.resolve().then(() => (options.observeModelCall || ((meta, fn) => fn()))({
                provider: selected.provider, model: selected.model, toolDefinitionCount: 0,
                shadowTaskId: options.shadowTaskId,
            }, () => (options.modelRequest || requestConfiguredInterpreterModel)(messages, {
                env, selected, signal: controller.signal, timeoutMs,
            }))),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('STAGE_TIMEOUT')); }, timeoutMs);
            }),
        ]);
        return { status: 'OK', content: response?.content, usage: response?.usage || null, durationMs: performance.now() - started };
    } catch (error) {
        return { status: error.message === 'STAGE_TIMEOUT' ? 'TIMEOUT' : 'ERROR', durationMs: performance.now() - started };
    } finally { clearTimeout(timer); }
}
function parseStrict(content, keys) {
    let value;
    try { value = JSON.parse(content); } catch { throw new Error('INVALID_JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
        || value.version !== 1) throw new Error('INVALID_SCHEMA');
    return value;
}
module.exports = { callStage, parseStrict };
