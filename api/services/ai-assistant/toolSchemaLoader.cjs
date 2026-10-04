'use strict';

// Request-scoped control plane for a future Main Agent. This module only
// validates discovery choices and returns canonical tool definitions; it never
// selects a tool, invokes an executor, calls a business API, or produces facts.
const crypto = require('node:crypto');
const { AI_TOOLS } = require('../../routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../aiFormalToolDefinitions.cjs');
const { buildApiIndex } = require('./apiIndex.cjs');

// Domain coverage loads the formally eligible read/preview set for a
// Main-Agent-selected business domain. These remain bounded by the API Index,
// never include writes, and must fit in the frozen model context.
const MAX_LOAD_BATCH = 32;
const MAX_LOADED_TOOLS_PER_REQUEST = 32;
const MAX_LOADED_SCHEMA_CHARS = 64_000;

const LOAD_TOOLS_TOOL = Object.freeze({
    type: 'function',
    function: Object.freeze({
        name: 'load_tools',
        description: '从当前可发现的只读或预览工具目录中加载少量完整调用 schema。该控制操作不读取业务数据、不执行工具，也不产生业务事实。',
        parameters: Object.freeze({
            type: 'object',
            additionalProperties: false,
            properties: Object.freeze({
                toolNames: Object.freeze({
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_LOAD_BATCH,
                    uniqueItems: true,
                    items: Object.freeze({ type: 'string', minLength: 1 }),
                }),
            }),
            required: Object.freeze(['toolNames']),
        }),
    }),
});

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function toolSchemaFingerprint(definitions = []) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(stable(definitions)))
        .digest('hex');
}

function schemaChars(definitions = []) {
    return definitions.reduce((total, definition) => total + JSON.stringify(definition).length, 0);
}

function canonicalDefinitions(genericToolDefinitions = AI_TOOLS, privateToolDefinitions = AI_FORMAL_TOOLS) {
    const byName = new Map();
    for (const definition of [...genericToolDefinitions, ...privateToolDefinitions]) {
        const toolName = definition?.function?.name;
        if (!toolName || byName.has(toolName)) {
            throw new Error(`Canonical tool definition missing or duplicated: ${String(toolName || '')}`);
        }
        byName.set(toolName, definition);
    }
    return byName;
}

function controlFailure(code, details = {}) {
    return Object.freeze({
        success: false,
        controlPlane: true,
        code,
        ...details,
    });
}

function normalizeToolNames(toolNames) {
    if (!Array.isArray(toolNames)) return { error: 'INVALID_LOAD_TOOLS_INPUT' };
    if (toolNames.length < 1 || toolNames.length > MAX_LOAD_BATCH) {
        return { error: 'LOAD_BATCH_LIMIT_EXCEEDED' };
    }
    if (toolNames.some(toolName => typeof toolName !== 'string' || toolName.trim().length === 0)) {
        return { error: 'INVALID_LOAD_TOOLS_INPUT' };
    }
    const normalized = toolNames.map(toolName => toolName.trim());
    if (new Set(normalized).size !== normalized.length) return { error: 'DUPLICATE_TOOL_NAME' };
    return { toolNames: normalized };
}

function createToolSchemaSession(options = {}) {
    const genericToolDefinitions = options.genericToolDefinitions || AI_TOOLS;
    const privateToolDefinitions = options.privateToolDefinitions || AI_FORMAL_TOOLS;
    const definitionsByName = canonicalDefinitions(genericToolDefinitions, privateToolDefinitions);
    const indexFactory = options.indexFactory || buildApiIndex;
    const initialIndex = options.index || indexFactory();
    const indexFingerprint = String(initialIndex?.fingerprint || '');
    if (!indexFingerprint || !Array.isArray(initialIndex?.modelIndexV1)) {
        throw new Error('API Index is missing a valid discovery fingerprint');
    }
    const orderedToolNames = initialIndex.modelIndexV1.map(entry => entry.toolName);
    const discoverableToolNames = new Set(orderedToolNames);
    const loaded = new Set();

    function currentIndexMatches() {
        const current = indexFactory();
        return String(current?.fingerprint || '') === indexFingerprint;
    }

    function orderedLoadedDefinitions() {
        return orderedToolNames.filter(toolName => loaded.has(toolName)).map(toolName => definitionsByName.get(toolName));
    }

    function snapshot() {
        const definitions = orderedLoadedDefinitions();
        return Object.freeze({
            controlPlane: true,
            indexFingerprint,
            loadedToolNames: Object.freeze(definitions.map(definition => definition.function.name)),
            loadedToolCount: definitions.length,
            loadedSchemaChars: schemaChars(definitions),
            remainingToolCapacity: MAX_LOADED_TOOLS_PER_REQUEST - definitions.length,
            schemaFingerprint: toolSchemaFingerprint(definitions),
        });
    }

    function load(toolNames) {
        if (!currentIndexMatches()) return controlFailure('INDEX_FINGERPRINT_CHANGED', { indexFingerprint });
        const normalized = normalizeToolNames(toolNames);
        if (normalized.error) return controlFailure(normalized.error);
        const notDiscoverableToolNames = normalized.toolNames.filter(toolName => !discoverableToolNames.has(toolName));
        if (notDiscoverableToolNames.length > 0) {
            return controlFailure('TOOL_SCHEMA_NOT_DISCOVERABLE', {
                notDiscoverableToolNames: Object.freeze(notDiscoverableToolNames),
            });
        }
        const missingCanonicalDefinitions = normalized.toolNames.filter(toolName => !definitionsByName.has(toolName));
        if (missingCanonicalDefinitions.length > 0) {
            return controlFailure('CANONICAL_TOOL_DEFINITION_UNAVAILABLE', {
                missingCanonicalDefinitions: Object.freeze(missingCanonicalDefinitions),
            });
        }
        const newlyLoadedToolNames = normalized.toolNames.filter(toolName => !loaded.has(toolName));
        if (loaded.size + newlyLoadedToolNames.length > MAX_LOADED_TOOLS_PER_REQUEST) {
            return controlFailure('LOADED_TOOL_LIMIT_EXCEEDED', {
                requestedNewToolCount: newlyLoadedToolNames.length,
                loadedToolCount: loaded.size,
                maxLoadedToolsPerRequest: MAX_LOADED_TOOLS_PER_REQUEST,
            });
        }
        const candidateDefinitions = [...orderedLoadedDefinitions(), ...newlyLoadedToolNames.map(toolName => definitionsByName.get(toolName))];
        const candidateSchemaChars = schemaChars(candidateDefinitions);
        if (candidateSchemaChars > MAX_LOADED_SCHEMA_CHARS) {
            return controlFailure('LOADED_SCHEMA_CONTEXT_LIMIT_EXCEEDED', {
                candidateSchemaChars,
                maxLoadedSchemaChars: MAX_LOADED_SCHEMA_CHARS,
            });
        }
        newlyLoadedToolNames.forEach(toolName => loaded.add(toolName));
        const next = snapshot();
        const loadedToolNames = next.loadedToolNames;
        return Object.freeze({
            success: true,
            controlPlane: true,
            loadedToolNames,
            newlyLoadedToolNames: Object.freeze(loadedToolNames.filter(toolName => newlyLoadedToolNames.includes(toolName))),
            alreadyLoadedToolNames: Object.freeze(loadedToolNames.filter(toolName => normalized.toolNames.includes(toolName) && !newlyLoadedToolNames.includes(toolName))),
            loadedToolCount: next.loadedToolCount,
            remainingToolCapacity: next.remainingToolCapacity,
            schemaFingerprint: next.schemaFingerprint,
        });
    }

    function exposedTools() {
        return Object.freeze([LOAD_TOOLS_TOOL, ...orderedLoadedDefinitions()]);
    }

    return Object.freeze({
        load,
        loadedToolNames: () => snapshot().loadedToolNames,
        loadedDefinitions: () => Object.freeze([...orderedLoadedDefinitions()]),
        exposedTools,
        snapshot,
    });
}

function loadToolSchemas(toolNames, options = {}) {
    const session = options.session || createToolSchemaSession(options);
    return session.load(toolNames);
}

module.exports = {
    LOAD_TOOLS_TOOL,
    MAX_LOAD_BATCH,
    MAX_LOADED_SCHEMA_CHARS,
    MAX_LOADED_TOOLS_PER_REQUEST,
    canonicalDefinitions,
    createToolSchemaSession,
    loadToolSchemas,
    schemaChars,
    toolSchemaFingerprint,
};
