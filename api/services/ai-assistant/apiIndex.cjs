'use strict';

// A lightweight discovery catalogue for a future Main Agent. It is deliberately
// not a router and is not wired into the current runtime: it describes the
// executable AI tool surface without loading nested tool schemas into a model.
const crypto = require('node:crypto');
const { AI_TOOLS } = require('../../routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../aiFormalToolDefinitions.cjs');
const { listAiCapabilities, getBusinessCapability } = require('../../capabilities/registry.cjs');
const { semanticBoundaryFor } = require('./apiIndexSemanticProjection.cjs');

const API_INDEX_V1_REVIEWED_COMPOSITES = Object.freeze([
    'search_factory_knowledge',
    'get_factory_knowledge_detail',
    'get_order_detail',
    'get_recipe_detail',
]);

const BACKING_TYPES = Object.freeze([
    'FORMAL_LINKED',
    'REVIEWED_COMPOSITE',
    'DEFERRED_UNLINKED',
    'WRITE_PROTECTED',
]);

function normalizeText(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
}

function summaryFromDescription(description) {
    // Preserve the first complete sentence when a long legacy description is
    // present. This is mechanical compression only; the source remains the
    // registered tool description and no business wording is invented here.
    const normalized = normalizeText(description);
    if (normalized.length <= 280) return normalized;
    const cjkSentenceEnd = normalized.search(/[。！？]/u);
    const sentenceEnd = cjkSentenceEnd >= 0
        ? cjkSentenceEnd
        : normalized.search(/[.!?](?=\s|$)/u);
    return sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function toolDefinitionMap(genericToolDefinitions, privateToolDefinitions) {
    const definitions = [...genericToolDefinitions, ...privateToolDefinitions];
    const byName = new Map();
    for (const definition of definitions) {
        const name = definition?.function?.name;
        if (!name || byName.has(name)) throw new Error(`AI tool definition is missing or duplicated: ${String(name || '')}`);
        byName.set(name, definition);
    }
    return byName;
}

function topLevelInputHints(parameters = {}) {
    const directRequired = Array.isArray(parameters.required) ? [...parameters.required].sort() : [];
    const alternatives = ['oneOf', 'anyOf']
        .flatMap(key => Array.isArray(parameters[key]) ? parameters[key] : [])
        .map(option => Array.isArray(option?.required) ? [...option.required].sort() : [])
        .filter(group => group.length > 0);
    return Object.freeze({
        requiredInputs: Object.freeze(directRequired),
        alternativeRequiredInputGroups: Object.freeze(alternatives.map(group => Object.freeze(group))),
    });
}

function compareEntries(left, right) {
    return left.domains.join('|').localeCompare(right.domains.join('|'), 'en')
        || left.operation.localeCompare(right.operation, 'en')
        || left.toolName.localeCompare(right.toolName, 'en');
}

function classify(capability) {
    if (capability.access === 'write') return 'WRITE_PROTECTED';
    if (capability.formalCapabilityIds.length > 0) return 'FORMAL_LINKED';
    if (API_INDEX_V1_REVIEWED_COMPOSITES.includes(capability.toolName)) return 'REVIEWED_COMPOSITE';
    return 'DEFERRED_UNLINKED';
}

function buildApiIndex(options = {}) {
    const genericToolDefinitions = options.genericToolDefinitions || AI_TOOLS;
    const privateToolDefinitions = options.privateToolDefinitions || AI_FORMAL_TOOLS;
    const definitions = toolDefinitionMap(genericToolDefinitions, privateToolDefinitions);
    const capabilities = options.capabilities || listAiCapabilities();
    const reviewedComposites = new Set(API_INDEX_V1_REVIEWED_COMPOSITES);
    const fullInventory = capabilities.map(capability => {
        const definition = definitions.get(capability.toolName);
        if (!definition) throw new Error(`Registered AI capability has no tool definition: ${capability.toolName}`);
        const backingType = classify(capability);
        if (!BACKING_TYPES.includes(backingType)) throw new Error(`Unknown API Index backing type: ${backingType}`);
        const formalCapabilityIds = [...capability.formalCapabilityIds];
        const validFormalLinks = formalCapabilityIds.every(capabilityId => Boolean(getBusinessCapability(capabilityId)));
        const formalSources = formalCapabilityIds.map(capabilityId => getBusinessCapability(capabilityId)?.sourceOfTruth).filter(Boolean);
        const parameters = definition.function.parameters || {};
        const hints = topLevelInputHints(parameters);
        const modelIndexV1Eligible = capability.access !== 'write'
            && ['query', 'preview'].includes(capability.operation)
            && validFormalLinks
            && (formalCapabilityIds.length > 0 || reviewedComposites.has(capability.toolName));
        const entry = Object.freeze({
            toolName: capability.toolName,
            displayName: capability.displayName,
            access: capability.access,
            operation: capability.operation,
            domains: Object.freeze([...capability.domains]),
            summary: summaryFromDescription(definition.function.description),
            requiredInputs: hints.requiredInputs,
            alternativeRequiredInputGroups: hints.alternativeRequiredInputGroups,
            entityScopes: Object.freeze([...capability.entityScopes]),
            backingType,
            formalCapabilityIds: Object.freeze(formalCapabilityIds),
            formalLinksValid: validFormalLinks,
            semanticBoundary: modelIndexV1Eligible ? semanticBoundaryFor({
                toolName: capability.toolName, domains: capability.domains,
                sourceOfTruth: capability.sourceOfTruth, formalSources,
            }) : null,
            dataMode: capability.dataMode,
            riskLevel: capability.riskLevel,
            definitionFound: true,
            modelIndexV1Eligible,
            modelIndexV1Reason: backingType === 'FORMAL_LINKED'
                ? 'formal_linked_read_or_preview'
                : backingType === 'REVIEWED_COMPOSITE'
                    ? 'reviewed_composite_exception'
                    : backingType === 'WRITE_PROTECTED'
                        ? 'write_protected'
                        : 'unlinked_deferred',
        });
        return entry;
    }).sort(compareEntries);

    const modelIndexV1 = fullInventory.filter(entry => entry.modelIndexV1Eligible)
        .map(entry => Object.freeze({
            toolName: entry.toolName,
            displayName: entry.displayName,
            operation: entry.operation,
            domains: entry.domains,
            summary: entry.summary,
            requiredInputs: entry.requiredInputs,
            alternativeRequiredInputGroups: entry.alternativeRequiredInputGroups,
            entityScopes: entry.entityScopes,
            backingType: entry.backingType,
            formalCapabilityIds: entry.formalCapabilityIds,
            semanticBoundary: entry.semanticBoundary,
            dataMode: entry.dataMode,
            riskLevel: entry.riskLevel,
        }));
    const fullSchemas = modelIndexV1.map(entry => definitions.get(entry.toolName));
    const modelFingerprintPayload = modelIndexV1.map(entry => ({
        toolName: entry.toolName,
        displayName: entry.displayName,
        operation: entry.operation,
        domains: entry.domains,
        summary: entry.summary,
        requiredInputs: entry.requiredInputs,
        alternativeRequiredInputGroups: entry.alternativeRequiredInputGroups,
        entityScopes: entry.entityScopes,
        backingType: entry.backingType,
        formalCapabilityIds: entry.formalCapabilityIds,
        semanticBoundary: entry.semanticBoundary,
        dataMode: entry.dataMode,
        riskLevel: entry.riskLevel,
    }));
    const rendered = renderApiIndexForModel(modelIndexV1);
    const fullSchemaJson = JSON.stringify(fullSchemas);
    return Object.freeze({
        fullInventory: Object.freeze(fullInventory),
        modelIndexV1: Object.freeze(modelIndexV1),
        fingerprint: fingerprint(modelFingerprintPayload),
        metrics: Object.freeze({
            fullInventoryCount: fullInventory.length,
            modelIndexV1Count: modelIndexV1.length,
            renderedChars: rendered.length,
            estimatedTokens: Math.ceil(rendered.length / 4),
            fullToolSchemaCharsForSameTools: fullSchemaJson.length,
            fullToolSchemaEstimatedTokens: Math.ceil(fullSchemaJson.length / 4),
            reductionRatio: fullSchemaJson.length === 0 ? 0 : Number((1 - (rendered.length / fullSchemaJson.length)).toFixed(4)),
        }),
    });
}

function renderApiIndexForModel(index = buildApiIndex().modelIndexV1) {
    const entries = Array.isArray(index) ? index : index.modelIndexV1;
    return entries.map(entry => {
        const lines = [
            `[${entry.operation === 'preview' ? 'PREVIEW' : 'READ'}] ${entry.toolName} — ${entry.domains.join('/')}`,
            entry.summary,
        ];
        if (entry.requiredInputs.length > 0) lines.push(`Required: ${entry.requiredInputs.join(', ')}`);
        if (entry.alternativeRequiredInputGroups.length > 0) {
            lines.push(`Required one of: ${entry.alternativeRequiredInputGroups.map(group => group.join(', ')).join(' | ')}`);
        }
        if (entry.requiredInputs.length === 0 && entry.alternativeRequiredInputGroups.length === 0) lines.push('Required: none');
        lines.push(`Establishes: ${entry.semanticBoundary.formalFactsProduced.map(fact => `${fact} (${entry.semanticBoundary.factAuthorities[fact]})`).join(', ')}`);
        lines.push(`Authority: ${entry.semanticBoundary.sourceOfTruth}`);
        if (entry.semanticBoundary.overlappingBusinessDomains.length > entry.domains.length) {
            lines.push(`Overlaps: ${entry.semanticBoundary.overlappingBusinessDomains.join(', ')}`);
        }
        lines.push(`Does not establish: ${entry.semanticBoundary.factsItDoesNotEstablish.join(', ')}`);
        return lines.join('\n');
    }).join('\n\n');
}

function getApiIndexEntry(toolName, index = buildApiIndex()) {
    return index.modelIndexV1.find(entry => entry.toolName === toolName)
        || index.fullInventory.find(entry => entry.toolName === toolName)
        || null;
}

function apiIndexFingerprint(index = buildApiIndex()) {
    return index.fingerprint;
}

module.exports = {
    API_INDEX_V1_REVIEWED_COMPOSITES,
    BACKING_TYPES,
    apiIndexFingerprint,
    buildApiIndex,
    getApiIndexEntry,
    renderApiIndexForModel,
    summaryFromDescription,
};
