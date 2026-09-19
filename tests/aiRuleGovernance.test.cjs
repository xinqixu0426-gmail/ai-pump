const test = require('node:test');
const assert = require('node:assert/strict');
const {
    RULE_DEFINITIONS,
    buildRuleGovernanceMetadata,
    canonicalRuleKey,
    summarizeRuleGovernance,
} = require('../api/services/aiRuleGovernance.cjs');

test('规则治理：优先级和执行通道固定且互不混用', () => {
    assert.ok(RULE_DEFINITIONS.core_policy.precedence > RULE_DEFINITIONS.domain_policy.precedence);
    assert.ok(RULE_DEFINITIONS.domain_policy.precedence > RULE_DEFINITIONS.approved_recipe_rule.precedence);
    assert.ok(RULE_DEFINITIONS.approved_recipe_rule.precedence > RULE_DEFINITIONS.factory_fact.precedence);
    assert.ok(RULE_DEFINITIONS.factory_fact.precedence > RULE_DEFINITIONS.answer_correction.precedence);
    assert.ok(RULE_DEFINITIONS.answer_correction.precedence > RULE_DEFINITIONS.factory_profile.precedence);

    const approved = buildRuleGovernanceMetadata('approved_recipe_rule', {
        statement: '同类配方通常包含说明书',
        scopeType: 'pump_shell_template',
        scopeRef: '7',
    });
    assert.equal(approved.executionChannel, 'analyze_recipe_configuration');
    assert.equal(approved.knowledgeRole, 'reference_copy');
    assert.equal(approved.scopeRef, '7');
});

test('规则治理：标点和空格不同的相同规则具有同一规范键', () => {
    assert.equal(
        canonicalRuleKey('规格-片数表示线圈成品，必须调整线圈库存。'),
        canonicalRuleKey('规格 - 片数表示线圈成品；必须调整线圈库存')
    );
});

test('规则治理：概况区分正式事实、执行副本和重复陈述', () => {
    const factMetadata = buildRuleGovernanceMetadata('factory_fact', {
        statement: '成品电缆是一个整体业务项。',
    });
    const correctionMetadata = buildRuleGovernanceMetadata('answer_correction', {
        statement: '成品电缆是一个整体业务项',
    });
    const summary = summarizeRuleGovernance([
        {
            entryType: 'business_rule',
            sourceTable: 'business_rules',
            sourceId: 'cable',
            title: '成品电缆',
            metadata: factMetadata,
        },
        {
            entryType: 'business_rule',
            sourceTable: 'factory_ai_rules',
            sourceId: '12',
            title: '电缆纠错',
            metadata: correctionMetadata,
        },
    ]);

    assert.equal(summary.stats.total, 2);
    assert.equal(summary.stats.authoritativeFacts, 1);
    assert.equal(summary.stats.referenceCopies, 1);
    assert.equal(summary.stats.overlapGroups, 1);
    assert.equal(summary.overlaps[0].sources.length, 2);
});
