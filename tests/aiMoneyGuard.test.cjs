const test = require('node:test');
const assert = require('node:assert/strict');
const {
    moneyClaimValues,
    moneyGuardDecision,
} = require('../api/services/aiMoneyGuard.cjs');
const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });

// 生产会话 58 的原始形状：一次 build_recipe_bom_draft 得到整机 285.8、线圈 116.99。
function bomToolResults() {
    return [{
        name: 'build_recipe_bom_draft',
        result: verified({
            parts: [{ model: 'V750-大脚板-2寸' }, { model: '12-140' }],
            coilSnapshot: { schemeCode: 'COIL-0002', material: '钢带', slotType: '小眼', totalCost: 116.99 },
            costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
            configurationBasis: { source: 'recipe', recipeName: 'V550大脚板-2寸-经典款', note: '沿用此在售配方', configurationComplete: true },
        }),
    }];
}

test('金额守卫：正文已引用正式金额、只是没写货币单位时保留正文并追加明细', () => {
    const toolResults = bomToolResults();
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21，线圈 COIL-0002 是 116.99。';
    const guard = moneyGuardDecision(answer, toolResults);
    assert.equal(guard.action, 'append');
    assert.deepEqual(guard.unsupportedClaims, []);
    assert.match(guard.summary, /285\.8/);
    const finalContent = `${answer}\n\n${guard.summary}`;
    assert.ok(finalContent.startsWith('换成 12-140 后'));
    assert.match(finalContent, /本轮正式查询金额如下/);
});

test('金额守卫：正文写无依据金额时仍整段替换为正式明细', () => {
    for (const answer of [
        '换成 12-140 后整机成本 286。',
        '换成 12-140 后整机成本 285.8，另加运费 50。',
        '换成 12-140 后整机成本 199 元。',
    ]) {
        const guard = moneyGuardDecision(answer, bomToolResults());
        assert.equal(guard.action, 'replace', answer);
        assert.ok(guard.unsupportedClaims.length > 0, answer);
    }
});

test('金额守卫：正文没有引用任何本轮正式金额时仍然整段替换', () => {
    const guard = moneyGuardDecision('已核实：Shadow配方甲使用Shadow线圈甲（12-120）。', [{
        name: 'calculate_coil_cost',
        result: verified({ data: [], count: 0, totalCost: 100 }),
    }]);
    assert.equal(guard.action, 'replace');
});

test('金额守卫：空正文、泄漏的内部指令和未完成配置一律整段替换', () => {
    const toolResults = bomToolResults();
    assert.equal(moneyGuardDecision('   ', toolResults).action, 'replace');
    assert.equal(moneyGuardDecision('仅修正文案：把 285.8 改成元。', toolResults).action, 'replace');
    const incomplete = bomToolResults();
    incomplete[0].result.data.configurationBasis.configurationComplete = false;
    assert.equal(moneyGuardDecision('整机当前总成本 285.8。', incomplete).action, 'replace');
});

test('金额守卫：正文已经是正式明细时不再重复追加', () => {
    const toolResults = bomToolResults();
    const summary = formatMoneySummary(toolResults);
    const guard = moneyGuardDecision(summary, toolResults);
    assert.equal(guard.action, 'none');
});

test('金额守卫：金额声明识别不把型号、片数和规格当成金额', () => {
    assert.deepEqual(moneyClaimValues('换成 12-140 的成本是 285.8，12-140 片。'), [285.8]);
    assert.deepEqual(moneyClaimValues('12-120 换成 12-140 后整机成本 285.8 元。'), [285.8]);
});
