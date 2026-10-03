#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildApiIndex } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const {
    LOAD_TOOLS_TOOL,
    MAX_LOAD_BATCH,
    MAX_LOADED_SCHEMA_CHARS,
    MAX_LOADED_TOOLS_PER_REQUEST,
    canonicalDefinitions,
    createToolSchemaSession,
} = require('../../../api/services/ai-assistant/toolSchemaLoader.cjs');

const root = path.resolve(__dirname, '../../..');
const START_HEAD = 'ed6984f680afdfa4c28cc6bb0c42ac7458805ea6';

function tokenEstimate(chars) {
    return Math.ceil(chars / 4);
}

function sampleSession(name, toolNames, index) {
    const session = createToolSchemaSession({ index, indexFactory: () => index });
    const result = session.load(toolNames);
    if (!result.success) throw new Error(`Sample ${name} did not load: ${result.code}`);
    const snapshot = session.snapshot();
    return {
        name,
        requestedToolNames: toolNames,
        loadedToolNames: snapshot.loadedToolNames,
        loadedSchemaChars: snapshot.loadedSchemaChars,
        loadedSchemaEstimatedTokens: tokenEstimate(snapshot.loadedSchemaChars),
        apiIndexEstimatedTokens: index.metrics.estimatedTokens,
        combinedEstimatedTokens: index.metrics.estimatedTokens + tokenEstimate(snapshot.loadedSchemaChars),
        schemaFingerprint: snapshot.schemaFingerprint,
    };
}

function buildAudit() {
    const index = buildApiIndex();
    const writeStatus = createToolSchemaSession({ index, indexFactory: () => index }).load(['update_recipe']);
    const deferredStatus = createToolSchemaSession({ index, indexFactory: () => index }).load(['preview_recipe_cost']);
    const unknownStatus = createToolSchemaSession({ index, indexFactory: () => index }).load(['made_up_tool']);
    const privateToolLoadStatus = Object.fromEntries([
        'get_recipe_technical_profile',
        'compare_recipe_scenarios',
        'preview_profitability',
        'preview_virtual_readiness',
    ].map(toolName => [toolName, createToolSchemaSession({ index, indexFactory: () => index }).load([toolName]).success]));
    return {
        phase: 'M5-C',
        startHead: START_HEAD,
        apiIndexFingerprint: index.fingerprint,
        modelIndexCount: index.modelIndexV1.length,
        maxLoadBatch: MAX_LOAD_BATCH,
        maxLoadedToolsPerRequest: MAX_LOADED_TOOLS_PER_REQUEST,
        maxLoadedSchemaChars: MAX_LOADED_SCHEMA_CHARS,
        loadToolsDefinition: LOAD_TOOLS_TOOL,
        canonicalDefinitionCount: canonicalDefinitions().size,
        privateToolLoadStatus,
        writeLoadStatus: writeStatus.code,
        deferredLoadStatus: deferredStatus.code,
        unknownLoadStatus: unknownStatus.code,
        sampleSessions: [
            sampleSession('recipe-comparison', ['get_all_recipes', 'compare_recipes'], index),
            sampleSession('coil-cost-investigation', ['search_coils', 'calculate_coil_cost', 'get_copper_price'], index),
            sampleSession('recipe-scenario-investigation', ['get_all_recipes', 'compare_recipe_scenarios', 'search_parts'], index),
        ],
        allModelSchemas: {
            chars: index.metrics.fullToolSchemaCharsForSameTools,
            estimatedTokens: index.metrics.fullToolSchemaEstimatedTokens,
        },
    };
}

function writeEvidence(audit) {
    const out = path.join(root, 'planning/ai-native-api');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'M5-C-Schema-Loader-Snapshot.json'), JSON.stringify(audit, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'M5-C-Schema-Loader-Regression.json'), JSON.stringify({
        phase: 'M5-C',
        checks: {
            modelIndexBinding: audit.modelIndexCount === 31,
            canonicalDefinitions: audit.canonicalDefinitionCount === 84,
            privateTools: Object.values(audit.privateToolLoadStatus).every(Boolean),
            writeRejected: audit.writeLoadStatus === 'TOOL_SCHEMA_NOT_DISCOVERABLE',
            deferredRejected: audit.deferredLoadStatus === 'TOOL_SCHEMA_NOT_DISCOVERABLE',
            unknownRejected: audit.unknownLoadStatus === 'TOOL_SCHEMA_NOT_DISCOVERABLE',
            modelCalls: 0,
            businessApiCalls: 0,
            executorCalls: 0,
        },
        audit,
    }, null, 2) + '\n');
}

if (require.main === module) {
    const audit = buildAudit();
    if (process.argv.includes('--write')) writeEvidence(audit);
    process.stdout.write(JSON.stringify({
        apiIndexFingerprint: audit.apiIndexFingerprint,
        modelIndexCount: audit.modelIndexCount,
        canonicalDefinitionCount: audit.canonicalDefinitionCount,
        sampleSessions: audit.sampleSessions.map(sample => ({ name: sample.name, combinedEstimatedTokens: sample.combinedEstimatedTokens })),
    }) + '\n');
}

module.exports = { buildAudit, writeEvidence };
