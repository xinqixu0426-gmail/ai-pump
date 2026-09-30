'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contextProfiles, validateBusinessContract, validateSemanticContract } = require('../scripts/ai-experiments/three-agent-isolation/contracts.cjs');
const { messagesForBusiness } = require('../scripts/ai-experiments/three-agent-isolation/businessAgent.cjs');
const { messagesForSemantic } = require('../scripts/ai-experiments/three-agent-isolation/semanticAgent.cjs');
const { runOntologyAgent } = require('../scripts/ai-experiments/three-agent-isolation/ontologyAgent.cjs');

test('three-agent prototype: context profiles exclude policy and business tools', () => {
    assert.deepEqual(contextProfiles(), {
        business: { companyBusinessModelIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 },
        semantic: { companyBusinessModelIncluded: false, businessContractIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 },
        ontology: { companyBusinessModelIncluded: false, semanticContractIncluded: true, domainPolicyIncluded: false, ontologyIncluded: true, identityToolsOnly: true },
    });
});
test('three-agent prototype: first two prompts remain isolated', () => {
    const business = validateBusinessContract({ concepts: ['RECIPE'], businessMeanings: ['V750 是 Recipe 配置基础。'], businessRelations: [], unknownBusinessTerms: [] });
    const businessMessages = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'MODEL_ONLY' });
    const semanticMessages = messagesForSemantic({ userInput: 'V750成本多少？', businessContract: business });
    assert.match(businessMessages[0].content, /MODEL_ONLY/);
    assert.doesNotMatch(businessMessages[0].content, /POLICY_ONLY|ONTOLOGY_ONLY|TOOL_DEFINITION/);
    assert.match(semanticMessages[0].content, /Business Meaning Contract/);
    assert.doesNotMatch(semanticMessages[0].content, /MODEL_ONLY|POLICY_ONLY|ONTOLOGY_ONLY|TOOL_DEFINITION/);
});
test('three-agent prototype: ontology fixture preserves ambiguity and never chooses first coil', () => {
    const semantic = validateSemanticContract({ mentions: ['12-120'], requestedChanges: [], requestedInformation: ['成本'], explicitPersistenceSignal: 'NONE', references: [], missingSemanticInformation: [] });
    const grounding = runOntologyAgent({ semanticContract: semantic, businessContract: { concepts: ['COIL_COMMON_DESIGNATION'] } });
    assert.equal(grounding.bindings[0].status, 'AMBIGUOUS');
    assert.equal(grounding.bindings[0].canonicalEntity, null);
    assert.equal(grounding.bindings[0].candidates.length, 2);
});
test('three-agent prototype: production runtime does not import the prototype', () => {
    const root = path.resolve(__dirname, '..');
    const productionEntrypoints = [
        'api/services/ai-assistant/runtime.cjs',
        'api/services/ai-assistant/judge.cjs',
        'api/services/ai-assistant/mainAgent.cjs',
        'api/services/ai-assistant/capabilityBroker.cjs',
    ];
    for (const relativePath of productionEntrypoints) {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        assert.doesNotMatch(source, /ai-experiments\/three-agent-isolation/);
    }
});
