const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeDiagnostics } = require('../api/services/runtimeDiagnostics.cjs');

test('runtime diagnostics exposes bounded operational identity without environment secrets', () => {
    const diagnostics = runtimeDiagnostics();
    assert.equal(diagnostics.version, '1.0.0');
    assert.match(diagnostics.nodeVersion, /^v\d+/);
    assert.ok(Number.isInteger(diagnostics.pid));
    assert.ok(diagnostics.uptimeSeconds >= 0);
    assert.ok(diagnostics.memory.rssMb > 0);
    assert.ok(diagnostics.memory.heapUsedMb > 0);
    assert.equal('env' in diagnostics, false);
});
