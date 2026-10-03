#!/usr/bin/env node
'use strict';

// Phase A3 is registry metadata only. This audit intentionally reads the
// authoritative registry rather than inferring business semantics from names.
const fs = require('node:fs');
const path = require('node:path');
const {
    getAiCapability,
    getBusinessCapability,
    listAiCapabilities,
    listBusinessCapabilities,
} = require('../../../api/capabilities/registry.cjs');

const root = path.resolve(__dirname, '../../..');
const START_HEAD = '39e3c4ec8db2433da1bd416d4163325d5df682d8';

const CORE_CAPABILITIES = Object.freeze([
    { capabilityId: 'orders.readiness.read', method: 'GET', path: '/api/orders/:id/readiness', access: 'query', operation: 'query' },
    { capabilityId: 'orders.knowledge_package.read', method: 'GET', path: '/api/orders/:id/knowledge-package', access: 'query', operation: 'query' },
    { capabilityId: 'recipes.technical_files.list', method: 'GET', path: '/api/recipes/:id/technical-files', access: 'query', operation: 'query' },
    { capabilityId: 'coils.cost_preview', method: 'POST', path: '/api/coils/calculate', access: 'preview', operation: 'preview' },
    { capabilityId: 'market.copper_price.read', method: 'GET', path: '/api/copper-price', access: 'query', operation: 'query' },
    { capabilityId: 'coils.spec_options.read', method: 'GET', path: '/api/coils/specs', access: 'query', operation: 'query' },
]);

const CORE_ACTION_LINKS = Object.freeze({
    compare_recipes: ['cost.recipe_difference'],
    explain_cost_change: ['cost.recipe_difference'],
    check_order_readiness: ['orders.readiness.read'],
    get_order_knowledge_package: ['orders.knowledge_package.read'],
    get_recipe_technical_files: ['recipes.list', 'recipes.technical_files.list'],
    calculate_coil_cost: ['coils.list', 'coils.cost_preview'],
    get_copper_price: ['market.copper_price.read'],
    get_coil_specs: ['coils.spec_options.read'],
});

function buildAudit() {
    const capabilities = CORE_CAPABILITIES.map(expected => {
        const capability = getBusinessCapability(expected.capabilityId);
        if (!capability) throw new Error(`Missing Phase A3 capability: ${expected.capabilityId}`);
        const routePrefix = `${expected.method} ${expected.path}`;
        if (!capability.inputSchema.startsWith(routePrefix)) {
            throw new Error(`Route contract mismatch: ${expected.capabilityId} expected ${routePrefix}`);
        }
        if (capability.access !== expected.access || capability.operation !== expected.operation) {
            throw new Error(`Access/operation mismatch: ${expected.capabilityId}`);
        }
        return {
            ...expected,
            domain: capability.domain,
            inputSchema: capability.inputSchema,
            outputSchema: capability.outputSchema,
            sourceOfTruth: capability.sourceOfTruth,
            riskLevel: capability.riskLevel,
            callers: capability.callers,
            requiresConfirmation: capability.requiresConfirmation,
        };
    });

    const links = Object.entries(CORE_ACTION_LINKS).map(([toolName, expectedIds]) => {
        const action = getAiCapability(toolName);
        if (!action) throw new Error(`Missing Phase A3 AI action: ${toolName}`);
        const formalCapabilityIds = [...action.formalCapabilityIds];
        if (JSON.stringify(formalCapabilityIds) !== JSON.stringify(expectedIds)) {
            throw new Error(`AI formal link mismatch: ${toolName}`);
        }
        return {
            toolName,
            executorKey: action.executorKey,
            access: action.access,
            operation: action.operation,
            formalCapabilityIds,
            formalCapabilities: formalCapabilityIds.map(capabilityId => {
                const capability = getBusinessCapability(capabilityId);
                if (!capability) throw new Error(`Broken declared formal link: ${toolName} -> ${capabilityId}`);
                return {
                    capabilityId,
                    access: capability.access,
                    operation: capability.operation,
                    inputSchema: capability.inputSchema,
                    sourceOfTruth: capability.sourceOfTruth,
                };
            }),
        };
    });

    const allActions = listAiCapabilities();
    const allCapabilities = listBusinessCapabilities();
    const brokenDeclaredFormalLinks = allActions.flatMap(action => action.formalCapabilityIds
        .filter(capabilityId => !getBusinessCapability(capabilityId))
        .map(capabilityId => ({ toolName: action.toolName, capabilityId })));
    const writeCapabilityCount = allCapabilities.filter(capability => capability.access === 'write').length;
    return {
        phase: 'M5-A3',
        startHead: START_HEAD,
        aiActionCount: allActions.length,
        formalCapabilityCount: allCapabilities.length,
        explicitFormalLinkedActions: allActions.filter(action => action.formalCapabilityIds.length > 0).length,
        remainingUnlinkedActions: allActions.filter(action => action.formalCapabilityIds.length === 0).length,
        brokenDeclaredFormalLinks,
        writeCapabilityCount,
        a3AddedWriteCapabilities: capabilities.filter(capability => capability.access === 'write').map(capability => capability.capabilityId),
        capabilities,
        actionLinks: links,
    };
}

function writeEvidence(audit) {
    const out = path.join(root, 'planning/ai-native-api');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'M5-A3-Formal-Registry-Snapshot.json'), JSON.stringify({
        phase: audit.phase,
        startHead: audit.startHead,
        formalCapabilityCount: audit.formalCapabilityCount,
        writeCapabilityCount: audit.writeCapabilityCount,
        a3AddedWriteCapabilities: audit.a3AddedWriteCapabilities,
        coreCapabilities: audit.capabilities,
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'M5-A3-AI-Action-Link-Matrix.json'), JSON.stringify({
        phase: audit.phase,
        aiActionCount: audit.aiActionCount,
        explicitFormalLinkedActions: audit.explicitFormalLinkedActions,
        remainingUnlinkedActions: audit.remainingUnlinkedActions,
        brokenDeclaredFormalLinks: audit.brokenDeclaredFormalLinks,
        actionLinks: audit.actionLinks,
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'M5-A3-Regression.json'), JSON.stringify({
        phase: audit.phase,
        checks: {
            newFormalCapabilities: audit.capabilities.length === 6,
            formalCapabilityCount: audit.formalCapabilityCount === 153,
            coreActionLinks: audit.actionLinks.length === 8,
            brokenDeclaredFormalLinks: audit.brokenDeclaredFormalLinks.length === 0,
            a3AddedWriteCapabilities: audit.a3AddedWriteCapabilities.length === 0,
        },
        deterministicAudit: audit,
    }, null, 2) + '\n');
}

if (require.main === module) {
    const audit = buildAudit();
    if (process.argv.includes('--write')) writeEvidence(audit);
    process.stdout.write(JSON.stringify({
        formalCapabilityCount: audit.formalCapabilityCount,
        aiActionCount: audit.aiActionCount,
        explicitFormalLinkedActions: audit.explicitFormalLinkedActions,
        remainingUnlinkedActions: audit.remainingUnlinkedActions,
        brokenDeclaredFormalLinks: audit.brokenDeclaredFormalLinks.length,
        writeCapabilityCount: audit.writeCapabilityCount,
    }) + '\n');
}

module.exports = { CORE_ACTION_LINKS, CORE_CAPABILITIES, buildAudit, writeEvidence };
