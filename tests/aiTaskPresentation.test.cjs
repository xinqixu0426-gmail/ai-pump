const test = require('node:test');
const assert = require('node:assert/strict');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { addTaskStep, createTaskEnvelope } = require('../api/services/aiTaskEnvelope.cjs');
const { buildEvidenceBundle } = require('../api/services/aiEvidenceBundle.cjs');
const {
    answerSatisfiesTask,
    ensureTaskAnswer,
    presentTaskAnswer,
} = require('../api/services/aiResponsePresenter.cjs');

const verified = data => ({
    success: true,
    data,
    executionEvidence: { verified: true, kind: 'formal_api_query' },
});

function configuredBomFixture() {
    return verified({
        parts: [
            { model: 'V750-大脚板-2寸', name: '泵壳套件', source: 'pump_shell_template', costRole: 'stainlessShellBundle' },
            { model: '12-120', name: '线圈转子', costRole: 'coil' },
            { model: '浮球-线径0.55', name: '浮球-新界式', costRole: 'float' },
            { model: 'v550木箱', name: 'v550木箱（木箱）', costRole: 'packing' },
            { model: '珍珠棉', name: '珍珠棉（珍珠棉）', costRole: 'packing' },
        ],
        configurationBasis: { source: 'recipe', recipeName: 'v550-tokoy' },
        costPreview: {
            currentTotalCost: 272.17,
            partsCost: 251.17,
            laborCost: 21,
            pricingComplete: true,
        },
    });
}

test('task envelope reuses capability identity and records configured BOM answer requirements', () => {
    const task = addTaskStep(
        createTaskEnvelope('V750的壳，做12-120片，带浮球，木箱，需要珍珠棉，成本多少'),
        'build_recipe_bom_draft',
        {
            shellModel: 'V750-大脚板-2寸',
            coilSpec: '12',
            coilSheets: 120,
            hasFloat: true,
            packingParts: [{ model: '木箱' }, { model: '珍珠棉' }],
        },
        getAiCapability('build_recipe_bom_draft')
    );
    assert.equal(task.mode, 'business');
    assert.equal(task.presentation, 'configured_bom_cost');
    assert.equal(task.steps[0].capability, getAiCapability('build_recipe_bom_draft').capabilityId);
    assert.deepEqual(task.requiredOutputs.map(item => item.key), [
        'totalCost', 'templateModel', 'coilModel', 'hasFloat', 'packingModel', 'packingModel',
    ]);
});

test('configured BOM presenter keeps requested configuration before compact cost details', () => {
    const task = addTaskStep(createTaskEnvelope('试算成本'), 'build_recipe_bom_draft', {
        shellModel: 'V750-大脚板-2寸',
        coilSpec: '12',
        coilSheets: 120,
        hasFloat: true,
        packingParts: [{ model: '木箱' }, { model: '珍珠棉' }],
    }, getAiCapability('build_recipe_bom_draft'));
    const bundle = buildEvidenceBundle(task, [{ name: 'build_recipe_bom_draft', args: task.steps[0].arguments, result: configuredBomFixture() }]);
    const answer = presentTaskAnswer(task, bundle);
    assert.match(answer, /V750-大脚板-2寸/);
    assert.match(answer, /12-120/);
    assert.match(answer, /浮球/);
    assert.match(answer, /v550木箱/);
    assert.match(answer, /珍珠棉/);
    assert.match(answer, /272\.17/);
    assert.match(answer, /配方基准「v550-tokoy」/);
    assert.equal(answerSatisfiesTask(task, bundle, answer), true);
    assert.equal(answerSatisfiesTask(task, bundle, '当前总成本272.17元。'), false);
    assert.equal(ensureTaskAnswer(task, bundle, '当前总成本272.17元。'), answer);
});

test('knowledge presenter preserves authoritative cable conclusion and omits unrelated fees', () => {
    const question = '说明线材、长度、插头和规格费用如何共同组成成品电缆，是否应该拆成两个收费项目。';
    const task = addTaskStep(createTaskEnvelope(question), 'search_factory_knowledge', {
        query: '成品电缆', entryType: 'business_rule',
    }, getAiCapability('search_factory_knowledge'));
    const result = {
        ...verified([{ id: 203 }]),
        answerGuidance: {
            businessRuleStatements: [
                '线材、长度、插头和规格共同组成一个成品电缆业务项；包装材料按配方配置。',
                '成品电缆是一个整体业务项，不把线材和插头/规格拆成两个独立收费项目。\n浮球新界式差价：0.6元',
            ],
        },
        sources: [{ sourceTable: 'business_rules' }],
    };
    const bundle = buildEvidenceBundle(task, [{ name: 'search_factory_knowledge', args: task.steps[0].arguments, result }]);
    const answer = presentTaskAnswer(task, bundle);
    assert.match(answer, /成品电缆/);
    assert.match(answer, /整体/);
    assert.match(answer, /不把.*拆/);
    assert.doesNotMatch(answer, /0\.6|浮球新界式差价/);
    assert.equal(answerSatisfiesTask(task, bundle, answer), true);
    assert.equal(answerSatisfiesTask(task, bundle, '已取得明细，但无法核对金额。'), false);
});

test('unverified tool results never enter an evidence bundle or deterministic answer', () => {
    const task = addTaskStep(createTaskEnvelope('查成品电缆规则'), 'search_factory_knowledge', {
        query: '成品电缆',
    }, getAiCapability('search_factory_knowledge'));
    const bundle = buildEvidenceBundle(task, [{
        name: 'search_factory_knowledge',
        args: task.steps[0].arguments,
        result: { success: true, answerGuidance: { businessRuleStatements: ['不可信的规则'] } },
    }]);
    assert.deepEqual(bundle.verifiedToolNames, []);
    assert.equal(presentTaskAnswer(task, bundle), '');
});
