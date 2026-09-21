'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessImpactFixture } = require('./helpers/businessImpactFixture.cjs');
const { impactEligibility } = require('../api/business-impact/eligibility.cjs');
const { buildImpactTrigger } = require('../api/business-impact/triggerBuilder.cjs');
const { createBusinessImpactProjection } = require('../api/business-impact/projection.cjs');
const { buildImpactEvidenceBundle } = require('../api/business-impact/evidenceBundle.cjs');
const { enforceImpactAnswerBoundary, costEvidence } = require('../api/business-impact/answerBoundary.cjs');

function project(fixture, trigger, slice = 'IP-01_CONFIGURATION_CHANGE') {
    const result = createBusinessImpactProjection({ db: fixture.db }).project(trigger);
    return buildImpactEvidenceBundle({ db: fixture.db, impactResult: result,
        impactEligibility: { slice } });
}

test('IR-01 blank-spec recipe exact current name remains a verified Impact root', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const recipe = fixture.db.prepare('SELECT id,name FROM recipes WHERE id=?')
            .get(fixture.ids['activeRecipe.v550']);
        fixture.db.prepare('UPDATE recipes SET spec=? WHERE id=?').run('', recipe.id);
        const userText = `把 ${recipe.name} 的线圈换成 12-140，还影响什么？`;
        const trigger = buildImpactTrigger({ db: fixture.db, userText,
            impactEligibility: impactEligibility({ userText, semanticEligible: true }) });
        assert.equal(trigger.entityType, 'recipe');
        assert.equal(trigger.canonicalId, String(recipe.id));
        assert.match(trigger.source.evidence.join(' '), /exact persisted business identity/u);
    } finally { fixture.close(); }
});

test('verified L1-L4 canonical subject receipt has priority over Impact text matching', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const recipeId = fixture.ids['activeRecipe.v550'];
        fixture.db.prepare('UPDATE recipes SET spec=? WHERE id=?').run('', recipeId);
        const userText = '把这个已确认配方换线圈后，还影响什么？';
        const trigger = buildImpactTrigger({ db: fixture.db, userText,
            impactEligibility: impactEligibility({ userText, semanticEligible: true }),
            canonicalSubject: { requestedType: 'recipe', canonicalType: 'recipe', canonicalId: recipeId,
                resolutionStatus: 'UNIQUE' } });
        assert.equal(trigger.canonicalId, String(recipeId));
        assert.match(trigger.source.evidence.join(' '), /verified canonical subject receipt/u);
    } finally { fixture.close(); }
});

test('a canonical receipt for a different requested entity type is not reused as the Impact root', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const userText = '把 12-220 换掉会影响什么？';
        const trigger = buildImpactTrigger({ db: fixture.db, userText,
            impactEligibility: impactEligibility({ userText, semanticEligible: true }),
            canonicalSubject: { requestedType: 'coil', canonicalType: 'recipe',
                canonicalId: fixture.ids['activeRecipe.v550'], resolutionStatus: 'UNIQUE' } });
        assert.equal(trigger.entityType, 'coil');
        assert.equal(trigger.canonicalId, null);
        assert.match(trigger.source.evidence.join(' '), /canonical identity unresolved/u);
    } finally { fixture.close(); }
});

test('IR-02 exact current template name roots the template impact without borrowing recipe.spec', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const template = fixture.db.prepare('SELECT id,shell_model FROM pump_shell_templates WHERE id=?')
            .get(fixture.ids['template.v550']);
        const userText = `${template.shell_model} 泵壳模板变更会影响哪些配方？`;
        const trigger = buildImpactTrigger({ db: fixture.db, userText,
            impactEligibility: impactEligibility({ userText, semanticEligible: true }) });
        assert.equal(trigger.entityType, 'template');
        assert.equal(trigger.canonicalId, String(template.id));
    } finally { fixture.close(); }
});

test('IR-03 saved recipe cost is labelled historical and never promoted to current recalculation', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const recipe = fixture.db.prepare('SELECT id,name,saved_total_cost FROM recipes WHERE id=?')
            .get(fixture.ids['activeRecipe.v550']);
        const trigger = {
            version: 1, mode: 'PROPOSED_CHANGE', entityType: 'recipe', canonicalId: String(recipe.id),
            changeType: 'RECIPE_CONFIGURATION_CHANGE', before: 'current', after: 'proposed',
            source: { authority: 'CANONICAL_DIRECT_IMPACT', evidence: ['fixture canonical identity'] },
        };
        const bundle = project(fixture, trigger);
        const toolResults = [{ name: 'get_all_recipes', result: { success: true,
            data: [{ id: recipe.id, name: recipe.name, savedTotalCost: recipe.saved_total_cost }] } }];
        const evidence = costEvidence(toolResults, recipe.id);
        const boundary = enforceImpactAnswerBoundary({ answer: `当前成本为 ${recipe.saved_total_cost} 元`, bundle,
            userText: '换线圈后还影响什么？', toolResults, impactEligibility: {} });
        assert.equal(evidence.state, 'SAVED_SNAPSHOT_ONLY');
        assert.equal(boundary.fallbackType, 'CURRENT_COST_NOT_VERIFIED');
        assert.match(boundary.answer, /历史保存成本快照/u);
        assert.match(boundary.answer, /不是.*当前成本/u);
        assert.doesNotMatch(boundary.answer, /已用正式成本能力重新计算当前成本/u);
    } finally { fixture.close(); }
});

test('IR-04 unresolved root plus empty projection requires canonical identity, never complete-empty wording', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const trigger = {
            version: 1, mode: 'VERIFIED_RECORDED_CHANGE', entityType: 'template', canonicalId: null,
            changeType: 'TEMPLATE_CHANGE', before: null, after: null,
            source: { authority: 'CANONICAL_DIRECT_IMPACT', evidence: ['canonical identity unresolved'] },
        };
        const bundle = project(fixture, trigger, 'IP-04_TEMPLATE_RECIPES');
        const boundary = enforceImpactAnswerBoundary({ answer: '没有受影响配方，集合完整。', bundle,
            userText: '模板变更影响哪些配方？', impactEligibility: {} });
        assert.equal(bundle.completeness, 'NEEDS_CANONICAL_IDENTITY');
        assert.equal(boundary.fallbackType, 'IMPACT_ROOT_UNRESOLVED');
        assert.match(boundary.answer, /无法唯一确定/u);
        assert.doesNotMatch(boundary.answer, /未找到|没有受影响|集合.*完整/u);
    } finally { fixture.close(); }
});

test('IR-05 verified canonical root plus complete empty relation may state no affected targets', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const templateId = Number(fixture.db.prepare(`INSERT INTO pump_shell_templates
            (shell_model,description,created_at,updated_at) VALUES(?,?,?,?)`)
            .run('IR-05-无配方模板', '脱敏回归形状', '2026-09-21', '2026-09-21').lastInsertRowid);
        const trigger = {
            version: 1, mode: 'VERIFIED_RECORDED_CHANGE', entityType: 'template', canonicalId: String(templateId),
            changeType: 'TEMPLATE_CHANGE', before: 'old', after: 'new',
            source: { authority: 'CANONICAL_DIRECT_IMPACT', evidence: ['exact persisted business identity'] },
        };
        const bundle = project(fixture, trigger, 'IP-04_TEMPLATE_RECIPES');
        const boundary = enforceImpactAnswerBoundary({ answer: '', bundle,
            userText: 'IR-05-无配方模板变更影响哪些配方？', impactEligibility: {} });
        assert.equal(bundle.completeness, 'COMPLETE');
        assert.equal(bundle.verifiedImpacts.length, 0);
        assert.match(boundary.answer, /当前正式受影响配方：无/u);
        assert.match(boundary.answer, /集合.*完整/u);
    } finally { fixture.close(); }
});

test('current cost is accepted only with explicit costEngine/current cost-basis authority', () => {
    const unlabelled = [{ name: 'preview_recipe_cost', result: { success: true,
        data: { currentTotalCost: 188.8 } } }];
    const formal = [{ name: 'preview_recipe_cost', result: { success: true,
        data: { currentTotalCost: 188.8, sourceOfTruth: 'costEngine', costBasis: 'currentFullCost' } } }];
    assert.equal(costEvidence(unlabelled).state, 'NO_CURRENT_COST_EVIDENCE');
    assert.deepEqual(costEvidence(formal), { state: 'CURRENT_RECALCULATION_VERIFIED', amount: '188.80' });
    assert.equal(costEvidence([{ name: 'preview_recipe_cost', result: { success: true,
        data: { recipeId: 99, currentTotalCost: 188.8, sourceOfTruth: 'costEngine',
            costBasis: 'currentFullCost' } } }], 12).state, 'NO_CURRENT_COST_EVIDENCE');
});
