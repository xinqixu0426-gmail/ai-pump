const { requireBusinessCapability } = require('../capabilities/registry.cjs');

function readBusinessChangeRevision(db) {
    const latest = db.prepare('SELECT id, operation_id FROM business_change_events ORDER BY id DESC LIMIT 1').get();
    return { revision: latest ? `${latest.id}:${latest.operation_id}` : 'empty',
        sourceOfTruth: requireBusinessCapability('business_changes.revision').capabilityId };
}

module.exports = { readBusinessChangeRevision };
