'use strict';

const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');
const {
    auditToolInventory,
    listV5Capabilities,
} = require('../api/services/ai-v5/capabilityRegistry.cjs');
const {
    analyzeP06R02Cases,
    evaluateP06CapabilityRouting,
} = require('../api/services/ai-v5/capabilityShadowEvaluation.cjs');

const inventory = auditToolInventory();
const r02 = analyzeP06R02Cases(p06Cases);
const corpus = evaluateP06CapabilityRouting(p06Cases);

process.stdout.write(`${JSON.stringify({
    capabilityRegistryVersion: 1,
    capabilityCount: listV5Capabilities().length,
    toolInventory: {
        total: inventory.total,
        assigned: inventory.assigned.length,
        shared: inventory.shared.length,
        intentionallyUnassigned: inventory.unassigned.length,
        stale: inventory.stale.length,
        unknown: inventory.unknown.length,
    },
    r02,
    r02Metrics: {
        analyzed: r02.length,
        blocked: r02.filter(item => item.classification === 'BLOCKED_BY_LIMITED_EXPOSURE').length,
        sameCapability: r02.filter(item => item.classification === 'NOT_BLOCKED_SAME_CAPABILITY').length,
        unknown: r02.filter(item => item.classification === 'UNKNOWN').length,
    },
    corpusMetrics: corpus.metrics,
    v5ToolExecutions: 0,
    v5Writes: 0,
}, null, 2)}\n`);
