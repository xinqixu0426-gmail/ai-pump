'use strict';
// Read-only readiness evidence. This does not substitute for frozen real AI OFF/ON runs.
const fs = require('node:fs'), path = require('node:path');
async function main() {
    const root = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(root, '.env'))) };
    const Database = require('better-sqlite3');
    const db = new Database(path.join(root, 'pump.db'), { readonly: true, fileMustExist: true });
    const config = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = config.effectiveValues({ env, dbAccessors: { db } });
        for (const [field, value] of Object.entries(snapshot.values)) env[config.DEFINITIONS[field].env] = value;
    } finally { db.close(); }
    const provider = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig('local', env);
    const url = new URL(`${provider.baseUrl.replace(/\/$/u, '')}/models`);
    const transport = require(url.protocol === 'https:' ? 'node:https' : 'node:http');
    const result = await new Promise(resolve => {
        let settled = false;
        const finish = record => { if (!settled) { settled = true; resolve(record); } };
        const request = transport.get(url, { timeout: 8000 }, response => {
            response.resume(); finish({ reachable: true, httpStatus: response.statusCode });
        });
        request.on('timeout', () => { finish({ reachable: false, error: 'LOCAL_PROVIDER_TIMEOUT' }); request.destroy(); });
        request.on('error', error => finish({ reachable: false, error: /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'LOCAL_PROVIDER_UNAVAILABLE' }));
    });
    const report = { version: 1, provider: 'local', configuredModel: provider.model, ...result,
        realAiAbCompleted: false, status: result.reachable && result.httpStatus === 200 ? 'READY_FOR_REAL_AI_AB' : 'BLOCKED',
        deepSeekIsLegacyBaseline: false, configWrites: 0, databaseWrites: 0 };
    const target = path.resolve('logs/ont-p6r-local-provider-readiness.json');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
}
main().catch(() => { console.error('LOCAL_PROVIDER_READINESS_CHECK_FAILED'); process.exitCode = 1; });
