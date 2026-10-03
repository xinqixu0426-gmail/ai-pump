#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    API_INDEX_V1_REVIEWED_COMPOSITES,
    buildApiIndex,
    renderApiIndexForModel,
} = require('../../../api/services/ai-assistant/apiIndex.cjs');
const a2Eligibility = require('../../../planning/ai-native-api/M5-A2-Index-Eligibility.json');

const root = path.resolve(__dirname, '../../..');
const START_HEAD = '5e0503ebb97468e1246ab2dc275e6b5e54cb5870';

function buildAudit() {
    const index = buildApiIndex();
    const modelNames = new Set(index.modelIndexV1.map(entry => entry.toolName));
    const a2Expose = a2Eligibility.actions.filter(action => action.indexEligibility === 'EXPOSE_V1').map(action => action.toolName);
    const a2DeferredLeaks = a2Eligibility.actions
        .filter(action => action.indexEligibility === 'DEFER_V1' && modelNames.has(action.toolName))
        .map(action => action.toolName);
    const a2ExcludedLeaks = a2Eligibility.actions
        .filter(action => action.indexEligibility === 'EXCLUDE_V1' && modelNames.has(action.toolName))
        .map(action => action.toolName);
    const classifications = Object.fromEntries(['FORMAL_LINKED', 'REVIEWED_COMPOSITE', 'DEFERRED_UNLINKED', 'WRITE_PROTECTED']
        .map(type => [type, index.fullInventory.filter(entry => entry.backingType === type).length]));
    return {
        phase: 'M5-B',
        startHead: START_HEAD,
        fingerprint: index.fingerprint,
        fullInventoryCount: index.metrics.fullInventoryCount,
        fullInventoryUnclassified: index.fullInventory.filter(entry => !entry.backingType).length,
        modelIndexV1Count: index.metrics.modelIndexV1Count,
        formalLinkedModelEntries: index.modelIndexV1.filter(entry => entry.backingType === 'FORMAL_LINKED').length,
        reviewedCompositeModelEntries: index.modelIndexV1.filter(entry => entry.backingType === 'REVIEWED_COMPOSITE').length,
        reviewedComposites: API_INDEX_V1_REVIEWED_COMPOSITES,
        modelIndexQueryCount: index.modelIndexV1.filter(entry => entry.operation === 'query').length,
        modelIndexPreviewCount: index.modelIndexV1.filter(entry => entry.operation === 'preview').length,
        modelIndexWriteCount: index.modelIndexV1.filter(entry => entry.access === 'write').length,
        a2ExposeV1Total: a2Expose.length,
        a2ExposeV1Present: a2Expose.filter(toolName => modelNames.has(toolName)),
        a2ExposeV1Missing: a2Expose.filter(toolName => !modelNames.has(toolName)),
        deferredToolLeaks: a2DeferredLeaks,
        excludedToolLeaks: a2ExcludedLeaks,
        duplicateToolNames: index.modelIndexV1.length - modelNames.size,
        classifications,
        metrics: index.metrics,
        entries: index.modelIndexV1,
        fullInventory: index.fullInventory,
        renderedIndex: renderApiIndexForModel(index),
    };
}

function writeEvidence(audit) {
    const out = path.join(root, 'planning/ai-native-api');
    fs.mkdirSync(out, { recursive: true });
    const { fullInventory, ...snapshot } = audit;
    fs.writeFileSync(path.join(out, 'M5-B-API-Index-Snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'M5-B-API-Index-Regression.json'), JSON.stringify({
        phase: 'M5-B',
        checks: {
            fullInventoryCount: audit.fullInventoryCount === 84,
            fullInventoryUnclassified: audit.fullInventoryUnclassified === 0,
            modelIndexWriteCount: audit.modelIndexWriteCount === 0,
            reviewedCompositeCount: audit.reviewedCompositeModelEntries === 4,
            a2ExposeV1Missing: audit.a2ExposeV1Missing.length === 0,
            deferredToolLeaks: audit.deferredToolLeaks.length === 0,
            excludedToolLeaks: audit.excludedToolLeaks.length === 0,
            duplicateToolNames: audit.duplicateToolNames === 0,
            modelCalls: 0,
        },
        fullInventory,
    }, null, 2) + '\n');
}

if (require.main === module) {
    const audit = buildAudit();
    if (process.argv.includes('--write')) writeEvidence(audit);
    process.stdout.write(JSON.stringify({
        fullInventoryCount: audit.fullInventoryCount,
        modelIndexV1Count: audit.modelIndexV1Count,
        formalLinkedModelEntries: audit.formalLinkedModelEntries,
        reviewedCompositeModelEntries: audit.reviewedCompositeModelEntries,
        modelIndexWriteCount: audit.modelIndexWriteCount,
        fingerprint: audit.fingerprint,
    }) + '\n');
}

module.exports = { buildAudit, writeEvidence };
