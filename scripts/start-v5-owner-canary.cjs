'use strict';

const { createOwnerReadCanaryServer } = require('../api/services/ownerReadCanaryGateway.cjs');

async function startOwnerCanary(options = {}) {
    const port = Number(options.port || process.env.PUMP_V5_OWNER_CANARY_PORT || 3103);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 3002, 3102].includes(port)) {
        throw Error('OWNER_CANARY_PORT_INVALID');
    }
    const server = createOwnerReadCanaryServer(options);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return { server, close: () => new Promise(resolve => server.close(resolve)) };
}

if (require.main === module) startOwnerCanary().then(runtime => {
    process.once('SIGTERM', () => runtime.close());
    process.once('SIGINT', () => runtime.close());
}).catch(() => { console.error('OWNER_CANARY_START_FAILED'); process.exitCode = 1; });

module.exports = { startOwnerCanary };
