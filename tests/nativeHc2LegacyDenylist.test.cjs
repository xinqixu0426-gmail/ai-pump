'use strict';
/**
 * NATIVE-HC2 §8 —— 退役 Legacy AI 编排的静态架构不变量。
 *
 * 本文件是**构建失败型**不变量：退役模块只要重新出现在磁盘、被生产代码 require、
 * 被生产 require 闭包可达、被测试/脚本重新实例化，或退役开关被重新读取，测试即失败。
 * 这是把 NATIVE-HC1「生产不可达」升级为 NATIVE-HC2「仓库实现层已物理移除」的守门人。
 *
 * 允许的历史记录：`planning/**` 与 `docs/**` 的发布/审计报告可以继续提到这些名字（历史事实），
 * 但不允许任何可执行代码重新引用它们。`api/services/legacyPartNaming.cjs` 是旧客户端零件命名
 * 适配器（非 AI 编排），不在名单内。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** 退役文件（物理移除清单）。 */
const RETIRED_MODULES = Object.freeze([
    "api/business-impact/answerBoundary.cjs",
    "api/business-impact/contract.cjs",
    "api/business-impact/eligibility.cjs",
    "api/business-impact/enforcementContract.cjs",
    "api/business-impact/evidenceBundle.cjs",
    "api/business-impact/projection.cjs",
    "api/business-impact/shadowObserver.cjs",
    "api/business-impact/triggerBuilder.cjs",
    "api/business-impact/validator.cjs",
    "api/business-semantics/answerBoundary.cjs",
    "api/business-semantics/answerProjection.cjs",
    "api/business-semantics/authoritativeCandidateScope.cjs",
    "api/business-semantics/completenessPolicy.cjs",
    "api/business-semantics/contract.cjs",
    "api/business-semantics/eligibilityBoundary.cjs",
    "api/business-semantics/evidencePlanContract.cjs",
    "api/business-semantics/evidencePlanValidator.cjs",
    "api/business-semantics/evidencePlanner.cjs",
    "api/business-semantics/factCapabilityRegistry.cjs",
    "api/business-semantics/formalRelationEvidence.cjs",
    "api/business-semantics/frameBuilder.cjs",
    "api/business-semantics/shadowObserver.cjs",
    "api/business-semantics/validator.cjs",
    "api/ontology/bindingContract.cjs",
    "api/ontology/bindingCurrentFacts.cjs",
    "api/ontology/bindingMetadata.cjs",
    "api/ontology/relationBinder.cjs",
    "api/ontology/relationRootCanonical.cjs",
    "api/ontology/relationRoutingCanary.cjs",
    "api/ontology/runtimeShadow.cjs",
    "api/ontology/shadowContract.cjs",
    "api/ontology/shadowEligibility.cjs",
    "api/ontology/shadowWorker.cjs",
    "api/ontology/traversal.cjs",
    "api/ontology/traversalBinder.cjs",
    "api/ontology/traversalContract.cjs",
    "api/ontology/traversalPolicy.cjs",
    "api/ontology/traversalShadow.cjs",
    "api/ontology/traversalWorker.cjs",
    "api/services/aiAgentRuntimeV3.cjs",
    "api/services/aiArchitectureAcceptanceV4.cjs",
    "api/services/aiAssistantAnswer.cjs",
    "api/services/aiAssistantContext.cjs",
    "api/services/aiAssistantRuntime.cjs",
    "api/services/aiAssistantSession.cjs",
    "api/services/aiBusinessRulebook.cjs",
    "api/services/aiCapabilityBrokerV4.cjs",
    "api/services/aiCapabilityCatalogV2.cjs",
    "api/services/aiCapabilityGraphV3.cjs",
    "api/services/aiClaimGroundingV4.cjs",
    "api/services/aiCoilVariantAnswer.cjs",
    "api/services/aiContext.cjs",
    "api/services/aiEntityResolverV3.cjs",
    "api/services/aiEvidenceBundle.cjs",
    "api/services/aiFactModelV4.cjs",
    "api/services/aiFactReducerV4.cjs",
    "api/services/aiGoalPlannerV3.cjs",
    "api/services/aiGroundedAnswerV4.cjs",
    "api/services/aiIntentPlannerV2.cjs",
    "api/services/aiIntentPlannerV3.cjs",
    "api/services/aiKnowledgeCompanionsV2.cjs",
    "api/services/aiMoneyGuard.cjs",
    "api/services/aiNumericScalarFactsV4.cjs",
    "api/services/aiObservationV3.cjs",
    "api/services/aiPageContext.cjs",
    "api/services/aiPresentationNormalizer.cjs",
    "api/services/aiPromptComposer.cjs",
    "api/services/aiProviderStream.cjs",
    "api/services/aiReadCapabilityProfilesV4.cjs",
    "api/services/aiReadInvestigationDriverV4.cjs",
    "api/services/aiReadInvestigationRuntimeV4.cjs",
    "api/services/aiResponsePresenter.cjs",
    "api/services/aiSafetyReplies.cjs",
    "api/services/aiShadowComparisonV4.cjs",
    "api/services/aiStableEntityIdentityV4.cjs",
    "api/services/aiTaskEnvelope.cjs",
    "api/services/aiToolIdentifierGrounding.cjs",
    "api/services/aiToolProtocol.cjs",
    "api/services/aiToolShortlist.cjs",
    "api/services/canonicalEntityIdentity.cjs",
    "api/services/criticalFactProjection.cjs",
    "api/services/l5OffCompatibility.cjs",
    "api/services/moneyFactProjection.cjs",
    "api/services/recipeCoilRelationAnswer.cjs",
    "api/services/recipePartRelationAnswer.cjs",
    "scripts/observability-p06-replay-preload.cjs",
    "scripts/phase-d/oracles.cjs",
    "scripts/phase-e2/run-wave1-live.cjs",
    "scripts/phase-e2/run-wave1-r1-live.cjs",
    "scripts/phase-s1/run-owner-stability-live.cjs",
    "scripts/run-ai-native-phase-d-live.cjs",
    "scripts/run-ai-shadow-evaluation.cjs",
    "scripts/run-business-impact-benchmark.cjs",
    "scripts/run-business-semantic-enforcement-acceptance.cjs",
    "scripts/run-business-semantic-production-validation.cjs",
    "scripts/run-business-semantic-shadow.cjs",
    "scripts/run-business-understanding-benchmark-v2.cjs",
    "scripts/run-observability-p03b-trace-harness.cjs",
    "scripts/run-observability-p06-replay.cjs",
    "scripts/run-ontology-binding-corpus.cjs",
    "scripts/run-ontology-routing-deepseek-ab.cjs",
    "scripts/run-ontology-routing-http-runtime.cjs",
    "scripts/run-ontology-routing-real-ab.cjs",
    "scripts/run-ontology-routing-real-local-ab.cjs",
    "scripts/run-ontology-shadow-corpus.cjs",
    "scripts/run-ontology-traversal-corpus.cjs",
    "scripts/run-relation-runtime-acceptance.cjs",
    "tests/aiAnswerPresentationDefectClosure.test.cjs",
    "tests/aiArchitectureAcceptanceHttpV4Integration.test.cjs",
    "tests/aiArchitectureAcceptanceV4.test.cjs",
    "tests/aiAssistantRuntime.test.cjs",
    "tests/aiBusinessRulebook.test.cjs",
    "tests/aiCapabilityCatalogV2.test.cjs",
    "tests/aiClaimGroundingRuntimeV4Integration.test.cjs",
    "tests/aiClaimGroundingV4.test.cjs",
    "tests/aiContext.test.cjs",
    "tests/aiEntityBindingReuseV4.test.cjs",
    "tests/aiEntityResolverV3.test.cjs",
    "tests/aiEvidenceArchitecture.test.cjs",
    "tests/aiIntentPlannerV2.test.cjs",
    "tests/aiKnowledgeCompanionsV2.test.cjs",
    "tests/aiModelViewBudget.test.cjs",
    "tests/aiMoneyGuard.test.cjs",
    "tests/aiNumericScalarFactsV4.test.cjs",
    "tests/aiPageContext.test.cjs",
    "tests/aiPhaseDRealAcceptanceDefects.test.cjs",
    "tests/aiPresentationNormalizer.test.cjs",
    "tests/aiPromptComposer.test.cjs",
    "tests/aiProviderStream.test.cjs",
    "tests/aiReadInvestigationDriverV4.test.cjs",
    "tests/aiReadInvestigationRuntimeV4Integration.test.cjs",
    "tests/aiReadInvestigationV4.test.cjs",
    "tests/aiShadowComparisonV4.test.cjs",
    "tests/aiStableEntityIdentityV4.test.cjs",
    "tests/aiStructuralRemediation.test.cjs",
    "tests/aiStructuralRemediationRuntime.test.cjs",
    "tests/aiTaskPresentation.test.cjs",
    "tests/aiToolIdentifierGrounding.test.cjs",
    "tests/aiToolProtocol.test.cjs",
    "tests/aiToolShortlist.test.cjs",
    "tests/businessImpactEnforcement.test.cjs",
    "tests/businessImpactProjection.test.cjs",
    "tests/businessSemanticEligibility.test.cjs",
    "tests/businessSemanticEnforcement.test.cjs",
    "tests/businessSemanticFrame.test.cjs",
    "tests/businessUnderstandingBenchmarkV2.test.cjs",
    "tests/canonicalEntityIdentity.test.cjs",
    "tests/coilVariantAmbiguity.test.cjs",
    "tests/criticalFactProjection.test.cjs",
    "tests/deterministicComparisonPlan.test.cjs",
    "tests/fixtures/l5-off-compatibility-v1.json",
    "tests/fixtures/ontology-coil-recipe-legacy-oracle-v3.json",
    "tests/fixtures/ontology-coil-recipe-legacy-oracle-v4.json",
    "tests/helpers/businessUnderstandingEvaluatorV2.cjs",
    "tests/helpers/legacyAiRuntime.cjs",
    "tests/helpers/legacyRedundancyHarness.cjs",
    "tests/helpers/ontologyRoutingCorpus.cjs",
    "tests/helpers/ontologyTraversalCorpus.cjs",
    "tests/helpers/runOntologyRoutingApiFixture.cjs",
    "tests/impactCanonicalAnswerSafety.test.cjs",
    "tests/l5OffCompatibility.test.cjs",
    "tests/legacyRedundancyAudit.test.cjs",
    "tests/observabilityEntityRoutingVerification.test.cjs",
    "tests/ontologyBoundedReverseRead.test.cjs",
    "tests/ontologyContract.test.cjs",
    "tests/ontologyCurrentFactsRepeatedRead.test.cjs",
    "tests/ontologyLegacyRelationRepair.test.cjs",
    "tests/ontologyRecipePartRouting.test.cjs",
    "tests/ontologyRelationBinding.test.cjs",
    "tests/ontologyRootCanonicalResolution.test.cjs",
    "tests/ontologyRoutingCanary.test.cjs",
    "tests/ontologyRoutingCompletion.test.cjs",
    "tests/ontologyRoutingMigrationPreflight.test.cjs",
    "tests/ontologyRoutingPromotion.test.cjs",
    "tests/ontologyRuntimeShadow.test.cjs",
    "tests/ontologyTraversal.test.cjs",
    "tests/productionAcceptanceHarness.test.cjs",
    "tests/productionShapeRegressionV1.test.cjs",
    "tests/relationRuntimeAcceptance.test.cjs",
    "tests/semanticCostEvidenceReconciliation.test.cjs",
    "tests/syntheticBusinessSemanticClosure.test.cjs",
]);

/** 退役导出符号：生产代码与发布链脚本中不得再出现。 */
const RETIRED_SYMBOLS = Object.freeze([
    "runAiAssistant",
    "runAiAgentRuntimeV3",
    "createReadInvestigationController",
    "selectNextCapability",
    "buildBusinessSemanticFrame",
    "enforceSemanticAnswerBoundary",
    "deterministicSemanticAnswer",
    "projectMoneyFacts",
    "composeAiSystemPrompt",
    "readAiProviderStream",
    "resolveRelationIdentity",
    "buildBusinessEvidencePlan",
    "validateBusinessSemanticFrame",
    "buildEvidenceBundle",
    "createTaskEnvelope",
    "addTaskStep",
    "selectLocalAssistantTools",
    "coilEllipticalFollowUp",
]);

/** 只为 Legacy 而存在的开关：不得再被任何生产代码读取。 */
const RETIRED_FLAGS = Object.freeze([
    "AI_ONTOLOGY_RELATION_SHADOW_ENABLED",
    "AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED",
    "AI_ONTOLOGY_2HOP_SHADOW_ENABLED",
    "AI_BUSINESS_IMPACT_SHADOW_ENABLED",
    "AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED",
    "AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED",
    "AI_LOCAL_TOOL_SHORTLIST_ENABLED",
    "AI_READ_INVESTIGATION_V4_ENABLED",
    "AI_READ_INVESTIGATION_V4_SHADOW_ENABLED",
    "AI_CLAIM_GROUNDING_V4_ENABLED",
    "AI_DYNAMIC_TOOL_ROUTING_ENABLED",
    "AI_BUSINESS_SEMANTIC_SHADOW_ENABLED",
    "AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED",
]);

/** 发布/部署链脚本：不得引用退役模块或退役符号。 */
const RELEASE_CHAIN_SCRIPTS = Object.freeze([
    "scripts/run-tests.cjs",
    "scripts/run-deep-api-smoke.cjs",
    "scripts/run-ai-native-quality-gate.cjs",
    "scripts/run-ai-native-rollout-live.cjs",
    "scripts/verify-production-env.cjs",
    "scripts/run-knowledge-evaluation.cjs",
    "scripts/manage-database-backups.cjs",
    "scripts/run-ai-architecture-acceptance.cjs",
    "scripts/n73-generate-release-evidence.cjs",
]);

function walk(dir, predicate, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (['node_modules', '.next', '.next-dev', '.next-preview', 'dist', 'build', '.git', '.dev-local'].includes(entry.name)) continue;
            walk(path.join(dir, entry.name), predicate, files);
        } else if (predicate(path.join(dir, entry.name))) files.push(path.join(dir, entry.name));
    }
    return files;
}

const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const codeFiles = walk(ROOT, file => /\.(cjs|js)$/u.test(file));
const productionFiles = codeFiles.filter(file => rel(file).startsWith('api/') || rel(file) === 'api.cjs');

function resolveRelative(fromFile, request) {
    const base = path.resolve(path.dirname(fromFile), request);
    for (const candidate of [base, `${base}.cjs`, `${base}.js`, path.join(base, 'index.cjs'), path.join(base, 'index.js')]) {
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* missing */ }
    }
    return null;
}

test('HC2-DENY-1 退役模块已从磁盘物理移除', () => {
    const stillPresent = RETIRED_MODULES.filter(entry => fs.existsSync(path.join(ROOT, entry)));
    assert.deepEqual(stillPresent, [], `退役文件仍然存在: ${stillPresent.join(', ')}`);
});

test('HC2-DENY-2 任何可执行代码都不得 require 退役模块', () => {
    const offenders = [];
    for (const file of codeFiles) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
            // 必须按**解析后的真实路径**比对：basename 会在不同目录间碰撞
            // （例如 api/ontology/contract.cjs 与已删除的 api/business-semantics/contract.cjs）。
            if (!match[1].startsWith('.')) continue;
            const target = resolveRelative(file, match[1]);
            if (target && RETIRED_MODULES.includes(rel(target))) {
                offenders.push(`${rel(file)} -> ${match[1]}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `仍有 require 指向退役模块: ${offenders.join('; ')}`);
});

test('HC2-DENY-3 生产 require 闭包（api.cjs 出发）不包含任何退役模块', () => {
    const seen = new Set();
    const queue = [path.join(ROOT, 'api.cjs')];
    while (queue.length) {
        const file = queue.pop();
        if (seen.has(file) || !fs.existsSync(file)) continue;
        seen.add(file);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/require\(\s*['"]([^.][^'"]*|\.[^'"]*)['"]\s*\)/gu)) {
            if (!match[1].startsWith('.')) continue;
            const target = resolveRelative(file, match[1]);
            if (target && !seen.has(target)) queue.push(target);
        }
    }
    const reachable = [...seen].map(rel).filter(entry => RETIRED_MODULES.includes(entry));
    assert.deepEqual(reachable, [], `生产闭包仍可达退役模块: ${reachable.join(', ')}`);
    assert.ok(seen.size > 200, `生产闭包异常（${seen.size} 个模块），闭包遍历可能失效`);
});

test('HC2-DENY-4 生产代码不得出现退役符号', () => {
    const offenders = [];
    for (const file of productionFiles) {
        const source = fs.readFileSync(file, 'utf8');
        for (const symbol of RETIRED_SYMBOLS) {
            if (new RegExp(`\\b${symbol}\\b`, 'u').test(source)) offenders.push(`${rel(file)} -> ${symbol}`);
        }
    }
    assert.deepEqual(offenders, [], `生产代码仍引用退役符号: ${offenders.join('; ')}`);
});

test('HC2-DENY-5 发布/部署链脚本不得引用退役模块或退役符号', () => {
    const offenders = [];
    for (const entry of RELEASE_CHAIN_SCRIPTS) {
        const file = path.join(ROOT, entry);
        assert.ok(fs.existsSync(file), `发布链脚本缺失: ${entry}`);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
            if (!match[1].startsWith('.')) continue;
            const target = resolveRelative(file, match[1]);
            if (target && RETIRED_MODULES.includes(rel(target))) offenders.push(`${entry} -> ${match[1]}`);
        }
        for (const symbol of RETIRED_SYMBOLS) {
            if (new RegExp(`\\b${symbol}\\b`, 'u').test(source)) offenders.push(`${entry} -> ${symbol}`);
        }
    }
    assert.deepEqual(offenders, [], `发布链仍引用退役实现: ${offenders.join('; ')}`);
});

test('HC2-DENY-6 退役 Legacy 开关不得再被生产代码读取或写进示例配置', () => {
    const offenders = [];
    for (const file of [...productionFiles, path.join(ROOT, '.env.example')]) {
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const flag of RETIRED_FLAGS) {
            if (new RegExp(`\\b${flag}\\b`, 'u').test(source)) offenders.push(`${rel(file)} -> ${flag}`);
        }
    }
    assert.deepEqual(offenders, [], `退役开关仍被引用: ${offenders.join('; ')}`);
});

test('HC2-DENY-7 当前架构文档声明 Native-only 且不再指示启用 Legacy 回退', () => {
    const handoff = fs.readFileSync(path.join(ROOT, 'docs/ai-native-v1-handoff.md'), 'utf8');
    const assistant = fs.readFileSync(path.join(ROOT, 'docs/ai-assistant.md'), 'utf8');
    assert.match(handoff, /Native-only/u, 'handoff 必须声明 Native-only');
    assert.match(assistant, /Native-only/u, 'ai-assistant 必须声明 Native-only');
    for (const file of ['README.md', 'docs/ai-assistant.md', 'docs/deployment-checklist.md']) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const flag of RETIRED_FLAGS) {
            assert.doesNotMatch(source, new RegExp(`\\b${flag}\\b`, 'u'), `${file} 仍在指示退役开关 ${flag}`);
        }
    }
});
