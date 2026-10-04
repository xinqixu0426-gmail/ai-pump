'use strict';

// Deterministic source manifest for a future, explicitly opted-in Final run.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildApiIndex, apiIndexFingerprint } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const { canonicalDefinitions, toolSchemaFingerprint } = require('../../../api/services/ai-assistant/toolSchemaLoader.cjs');
const candidate = require('./apiNativeAgentCandidate.cjs');
const { PRODUCT_BASELINE_COMMIT, productDriftFromGit } = require('./d1FinalProductDriftGuard.cjs');

const ROOT = path.resolve(__dirname, '../../..');
function sha256File(relativePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');
}
function gitHead(cwd = ROOT) { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(); }
function buildFinalAcceptanceManifest(options = {}) {
    const index = buildApiIndex();
    const definitions = [...canonicalDefinitions().values()];
    const scenario = definitions.find(tool => tool.function.name === 'compare_recipe_scenarios');
    const files = Object.freeze({
        candidate: 'scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs',
        controlledFixture: 'scripts/ai-experiments/api-native-agent/d1r1ControlledFixture.cjs',
        evaluator: 'scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvaluator.cjs',
        controlledRunner: 'scripts/ai-experiments/api-native-agent/run-d1-final-controlled.cjs',
        repetitionRunner: 'scripts/ai-experiments/api-native-agent/run-d1-final-controlled-repetition.cjs',
        realRunner: 'scripts/ai-experiments/api-native-agent/run-d1-final-real-catalog.cjs',
        businessAgent: 'scripts/ai-experiments/business-policy-intent/businessAgent.cjs',
        policyAgent: 'scripts/ai-experiments/business-policy-intent/policyAgent.cjs',
        businessModel: 'planning/business-understanding/company-business-model-v1.md',
        domainPolicy: 'api/services/ai-assistant/domain-policy.md',
        recipePolicy: 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md',
        ontology: 'api/ontology/contract.cjs',
    });
    const hashes = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, sha256File(relativePath)]));
    return Object.freeze({
        productBaselineCommit: PRODUCT_BASELINE_COMMIT,
        harnessCommit: options.harnessCommit || gitHead(options.cwd || ROOT),
        productDrift: productDriftFromGit({ cwd: options.cwd || ROOT }),
        candidateSourceHash: hashes.candidate,
        candidatePromptHash: crypto.createHash('sha256').update(String(candidate.candidateSystemPrompt)).digest('hex'),
        businessAgentPromptHash: hashes.businessAgent,
        policyAgentPromptHash: hashes.policyAgent,
        companyBusinessModelHash: hashes.businessModel,
        domainPolicyHash: crypto.createHash('sha256').update(`${hashes.domainPolicy}:${hashes.recipePolicy}`).digest('hex'),
        ontologyHash: hashes.ontology,
        apiIndexFingerprint: apiIndexFingerprint(index),
        apiIndexCount: index.modelIndexV1.length,
        canonicalToolDefinitionsFingerprint: toolSchemaFingerprint(definitions),
        scenarioToolSchemaFingerprint: toolSchemaFingerprint([scenario]),
        controlledFixtureHash: hashes.controlledFixture,
        controlledEvaluatorHash: hashes.evaluator,
        realCatalogEvaluatorHash: hashes.evaluator,
        controlledRunnerHash: hashes.controlledRunner,
        repetitionRunnerHash: hashes.repetitionRunner,
        realRunnerHash: hashes.realRunner,
        provider: 'DeepSeek', model: 'deepseek-chat', contextWindow: 65536,
        budgets: Object.freeze({ maxMainModelCalls: candidate.MAX_MAIN_MODEL_CALLS, maxBusinessToolCalls: candidate.MAX_BUSINESS_TOOL_CALLS, maxLoadToolsCalls: candidate.MAX_LOAD_TOOLS_CALLS, maxResolveCalls: candidate.MAX_RESOLVE_CALLS, maxFinalizationCalls: candidate.MAX_FINALIZATION_MODEL_CALLS }),
    });
}

module.exports = { buildFinalAcceptanceManifest, gitHead, sha256File };
