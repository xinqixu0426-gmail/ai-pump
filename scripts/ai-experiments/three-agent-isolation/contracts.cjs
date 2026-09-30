'use strict';

const BUSINESS_CONCEPTS = Object.freeze([
    'COIL_COMMON_DESIGNATION', 'COIL_SCHEME', 'STATOR', 'TEMPLATE', 'RECIPE', 'BOM',
    'PART', 'PACKING_CONFIGURATION', 'ROTOR_PROCESS_CONFIGURATION', 'OEM_CONFIGURATION',
]);

function object(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
    return value;
}
function strings(value, code) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(code);
    return Object.freeze(value.map(item => item.trim()).filter(Boolean));
}
function parseJson(content, code) {
    try { return object(JSON.parse(String(content || '')), code); } catch { throw new Error(code); }
}
function exactKeys(value, keys, code) {
    const actual = Object.keys(value).sort(); const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
}
function validateBusinessContract(value) {
    object(value, 'BUSINESS_CONTRACT_INVALID');
    exactKeys(value, ['concepts', 'businessMeanings', 'businessRelations', 'unknownBusinessTerms'], 'BUSINESS_CONTRACT_INVALID');
    return Object.freeze({
        concepts: strings(value.concepts, 'BUSINESS_CONTRACT_INVALID').filter(item => BUSINESS_CONCEPTS.includes(item)),
        businessMeanings: strings(value.businessMeanings, 'BUSINESS_CONTRACT_INVALID'),
        businessRelations: strings(value.businessRelations, 'BUSINESS_CONTRACT_INVALID'),
        unknownBusinessTerms: strings(value.unknownBusinessTerms, 'BUSINESS_CONTRACT_INVALID'),
    });
}
function validateChanges(value) {
    if (!Array.isArray(value)) throw new Error('SEMANTIC_CONTRACT_INVALID');
    return Object.freeze(value.map(item => {
        object(item, 'SEMANTIC_CONTRACT_INVALID');
        exactKeys(item, ['subject', 'from', 'to', 'delta', 'rawText'], 'SEMANTIC_CONTRACT_INVALID');
        if (typeof item.subject !== 'string' || typeof item.rawText !== 'string') throw new Error('SEMANTIC_CONTRACT_INVALID');
        for (const key of ['from', 'to', 'delta']) if (item[key] !== null && typeof item[key] !== 'string') throw new Error('SEMANTIC_CONTRACT_INVALID');
        return Object.freeze({ subject: item.subject, from: item.from, to: item.to, delta: item.delta, rawText: item.rawText });
    }));
}
function validateReferences(value) {
    if (!Array.isArray(value)) throw new Error('SEMANTIC_CONTRACT_INVALID');
    return Object.freeze(value.map(item => {
        object(item, 'SEMANTIC_CONTRACT_INVALID');
        exactKeys(item, ['text', 'type'], 'SEMANTIC_CONTRACT_INVALID');
        if (!['EXPLICIT_MENTION', 'CONVERSATION_REFERENCE'].includes(item.type) || typeof item.text !== 'string') throw new Error('SEMANTIC_CONTRACT_INVALID');
        return Object.freeze({ text: item.text, type: item.type });
    }));
}
function validateSemanticContract(value) {
    object(value, 'SEMANTIC_CONTRACT_INVALID');
    exactKeys(value, ['mentions', 'requestedChanges', 'requestedInformation', 'explicitPersistenceSignal', 'references', 'missingSemanticInformation'], 'SEMANTIC_CONTRACT_INVALID');
    if (!['SAVE', 'DO_NOT_SAVE', 'NONE'].includes(value.explicitPersistenceSignal)) throw new Error('SEMANTIC_CONTRACT_INVALID');
    return Object.freeze({
        mentions: strings(value.mentions, 'SEMANTIC_CONTRACT_INVALID'),
        requestedChanges: validateChanges(value.requestedChanges),
        requestedInformation: strings(value.requestedInformation, 'SEMANTIC_CONTRACT_INVALID'),
        explicitPersistenceSignal: value.explicitPersistenceSignal,
        references: validateReferences(value.references),
        missingSemanticInformation: strings(value.missingSemanticInformation, 'SEMANTIC_CONTRACT_INVALID'),
    });
}
function validateGroundingContract(value) {
    object(value, 'GROUNDING_CONTRACT_INVALID');
    exactKeys(value, ['bindings', 'unresolvedMentions', 'relationBindings'], 'GROUNDING_CONTRACT_INVALID');
    if (!Array.isArray(value.bindings) || !Array.isArray(value.unresolvedMentions) || !Array.isArray(value.relationBindings)) throw new Error('GROUNDING_CONTRACT_INVALID');
    return Object.freeze(value);
}
function contextProfiles() {
    return Object.freeze({
        business: Object.freeze({ companyBusinessModelIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
        semantic: Object.freeze({ companyBusinessModelIncluded: false, businessContractIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
        ontology: Object.freeze({ companyBusinessModelIncluded: false, semanticContractIncluded: true, domainPolicyIncluded: false, ontologyIncluded: true, identityToolsOnly: true }),
    });
}

module.exports = { BUSINESS_CONCEPTS, contextProfiles, parseJson, validateBusinessContract, validateSemanticContract, validateGroundingContract };
