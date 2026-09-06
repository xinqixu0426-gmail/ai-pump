'use strict';

// Installed separately from Legacy. Never imports API startup or business data.
const fs = require('node:fs');
const path = require('node:path');
const { createOwnerAuthenticationGateway } = require('../api/services/ownerAuthenticationGateway.cjs');
function start({ envPath, port = 3104 }) {
    function readConfig() {
        const st = fs.lstatSync(envPath);
        if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid()) {
            throw Error('OWNER_CONFIG_PERMISSION_INVALID');
        }
        return require('dotenv').parse(fs.readFileSync(envPath));
    }
    if (process.getuid?.() === 0) throw Error('OWNER_AUTH_ROOT_FORBIDDEN');
    readConfig();
    const server = createOwnerAuthenticationGateway({ readConfig });
    server.listen(port, '127.0.0.1');
    process.once('SIGTERM', () => server.close());
    process.once('SIGINT', () => server.close());
    return server;
}
if (require.main === module) {
    try { start({ envPath: path.resolve(process.argv[2]) }); }
    catch { process.exitCode = 1; }
}
module.exports = { start };
