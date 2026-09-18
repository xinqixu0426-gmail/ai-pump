const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildSearchProbes,
    candidateScore,
    normalizeExactIdentity,
    normalizeFuzzyIdentity,
    resolveFormalEntityResultV3,
    resolveAiToolTargetV3,
} = require('../api/services/aiEntityResolverV3.cjs');

function verified(data) {
    return {
        success: true,
        count: data.length,
        data,
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [] },
    };
}

test('AI V3 实体解析：中文错字名称会生成逐级前缀调查词', () => {
    assert.deepEqual(buildSearchProbes('邱欢'), ['邱欢', '邱']);
    assert.ok(candidateScore('邱欢', '邱焕') >= 0.6);
});

test('AI V3 实体解析：客户全名零结果后以正式姓氏查询唯一绑定客户', async () => {
    const calls = [];
    const result = await resolveAiToolTargetV3({
        toolName: 'get_recent_orders',
        args: { customerName: '邱欢' },
        executeToolCall: async (name, args) => {
            calls.push({ name, args });
            return verified(args.name === '邱' ? [{ id: 1, name: '邱焕' }] : []);
        },
    });

    assert.equal(result.status, 'unique_candidate');
    assert.deepEqual(result.args, { customerName: '邱焕' });
    assert.deepEqual(calls, [
        { name: 'search_customers', args: { name: '邱欢' } },
        { name: 'search_customers', args: { name: '邱' } },
    ]);
    assert.equal(result.receipt.originalMention, '邱欢');
    assert.equal(result.receipt.selected.name, '邱焕');
    assert.equal(Object.hasOwn(result.receipt.selected, 'raw'), false);
});

test('AI V3 实体解析：客户错字同样适用于报价与客户历史模块', async () => {
    for (const toolName of ['search_quotations', 'search_customer_history']) {
        const result = await resolveAiToolTargetV3({
            toolName,
            args: { customerName: '邱欢' },
            executeToolCall: async (_name, args) => verified(args.name === '邱'
                ? [{ id: 1, name: '邱焕' }]
                : []),
        });
        assert.equal(result.status, 'unique_candidate');
        assert.deepEqual(result.args, { customerName: '邱焕' });
    }
});

test('AI V3 实体解析：配方和泵壳模板错字由各自正式目录统一解析', async () => {
    const recipe = await resolveAiToolTargetV3({
        toolName: 'preview_recipe_cost',
        args: { recipeName: 'QDX1.5-17-0.37K' },
        executeToolCall: async (_name, args) => verified(String(args.keyword).startsWith('QDX1.5-17')
            ? [{ id: 7, name: 'QDX1.5-17-0.37KW', spec: 'QDX' }]
            : []),
    });
    assert.equal(recipe.status, 'unique_candidate');
    assert.deepEqual(recipe.args, { recipeId: 7 });

    const template = await resolveAiToolTargetV3({
        toolName: 'preview_pump_shell_cost',
        args: { shellModel: 'V75O', customBarrelLength: 180 },
        executeToolCall: async (_name, args) => verified(String(args.shellModel).toLowerCase() === 'v75'
            ? [{ id: 3, shellModel: 'V750', description: '不锈钢泵壳' }]
            : []),
    });
    assert.equal(template.status, 'unique_candidate');
    assert.deepEqual(template.args, { customBarrelLength: 180, templateId: 3 });
});

test('AI V3 实体解析：模板配置成本草稿绑定完整泵壳模板 ID', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'build_recipe_bom_draft',
        args: {
            shellModel: 'V750-大脚板-2寸',
            coilSpec: '12',
            coilSheets: 120,
            hasFloat: true,
            packingParts: [{ model: '木箱' }, { model: '珍珠棉' }],
        },
        executeToolCall: async () => verified([
            { id: 1, shellModel: 'V750-大脚板-2寸', description: '不锈钢泵壳' },
        ]),
    });
    assert.equal(result.status, 'exact');
    assert.equal(result.args.templateId, 1);
    assert.equal(Object.hasOwn(result.args, 'shellModel'), false);
    assert.equal(result.args.coilSheets, 120);
    assert.deepEqual(result.args.packingParts, [{ model: '木箱' }, { model: '珍珠棉' }]);
});

test('AI V3 实体解析：模型省略型号分隔符时仍绑定正式模板 ID', async () => {
    const calls = [];
    const result = await resolveAiToolTargetV3({
        toolName: 'build_recipe_bom_draft',
        args: {
            shellModel: 'V750大脚板2寸',
            coilSpec: '12',
            coilSheets: 120,
            hasFloat: true,
        },
        executeToolCall: async (_name, args) => {
            calls.push(args.shellModel);
            return verified(args.shellModel === 'V750'
                ? [{ id: 1, shellModel: 'V750-大脚板-2寸', description: '不锈钢泵壳' }]
                : []);
        },
    });
    assert.equal(result.status, 'unique_candidate');
    assert.equal(result.receipt.selected.matchKind, 'fuzzy');
    assert.equal(result.args.templateId, 1);
    assert.equal(Object.hasOwn(result.args, 'shellModel'), false);
    assert.deepEqual(calls, ['V750大脚板2寸', 'V750']);
});

test('trailing_hyphen_preserved_in_exact_identity', () => {
    assert.notEqual(normalizeExactIdentity('v750-tokoy'), normalizeExactIdentity('v750-tokoy-'));
    assert.equal(normalizeFuzzyIdentity('v750-tokoy'), normalizeFuzzyIdentity('v750-tokoy-'));
    assert.notEqual(candidateScore('v750-tokoy', 'v750-tokoy-'), 1);
});

test('internal_hyphen_preserved', () => {
    assert.notEqual(normalizeExactIdentity('V750-A'), normalizeExactIdentity('V750A'));
    assert.equal(normalizeFuzzyIdentity('V750-A'), normalizeFuzzyIdentity('V750A'));
});

test('underscore_preserved_for_exact_identity', () => {
    assert.notEqual(normalizeExactIdentity('ABC_1'), normalizeExactIdentity('ABC1'));
    assert.equal(normalizeFuzzyIdentity('ABC_1'), normalizeFuzzyIdentity('ABC1'));
});

test('slash_preserved_for_exact_identity', () => {
    assert.notEqual(normalizeExactIdentity('ABC/1'), normalizeExactIdentity('ABC1'));
    assert.equal(normalizeFuzzyIdentity('ABC/1'), normalizeFuzzyIdentity('ABC1'));
});

test('case_policy_preserved', () => {
    assert.equal(normalizeExactIdentity('V750-TOKOY'), normalizeExactIdentity('v750-tokoy'));
    assert.equal(candidateScore('V750-TOKOY', 'v750-tokoy'), 1);
});

test('whitespace_safe_normalization', () => {
    assert.equal(normalizeExactIdentity('  V750-A  '), normalizeExactIdentity('v750-a'));
    assert.notEqual(normalizeExactIdentity('V750 A'), normalizeExactIdentity('V750A'));
});

test('fuzzy_collision_returns_ambiguity', () => {
    const receipt = resolveFormalEntityResultV3({
        entityType: 'recipe',
        originalMention: 'V750_A',
        sourceCapability: 'get_all_recipes',
        result: verified([
            { id: 1, name: 'V750-A' },
            { id: 2, name: 'V750A' },
        ]),
    });
    assert.equal(receipt.status, 'ambiguous');
    assert.equal(receipt.selected, null);
    assert.deepEqual(receipt.candidates.map(item => item.id), [1, 2]);
    assert.ok(receipt.candidates.every(item => item.matchKind === 'fuzzy'));
});

test('probe_hit_is_not_exact_identity', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'preview_recipe_cost',
        args: { recipeName: 'V750-EXTRA' },
        executeToolCall: async (_name, args) => verified(args.keyword === 'V750'
            ? [{ id: 7, name: 'V750' }]
            : []),
    });
    assert.equal(result.status, 'unique_candidate');
    assert.equal(result.receipt.selected.matchKind, 'fuzzy');
    assert.equal(result.receipt.selected.probeUsed, 'V750');
    assert.equal(result.receipt.originalMention, 'V750-EXTRA');
});

test('candidate_dedup_uses_stable_id', () => {
    const receipt = resolveFormalEntityResultV3({
        entityType: 'recipe',
        originalMention: 'V750',
        sourceCapability: 'get_all_recipes',
        result: verified([
            { id: 2, name: 'V750' },
            { id: 3, name: 'V750' },
        ]),
    });
    assert.equal(receipt.status, 'ambiguous');
    assert.deepEqual(receipt.candidates.map(item => item.id), [2, 3]);
});

test('recipe_exact_resolution_regression', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'preview_recipe_cost',
        args: { recipeName: 'v750-tokoy' },
        executeToolCall: async () => verified([
            { id: 2, name: 'v750-tokoy' },
            { id: 8, name: 'v750-tokoy-' },
        ]),
    });
    assert.equal(result.status, 'exact');
    assert.deepEqual(result.args, { recipeId: 2 });
    assert.equal(result.receipt.selected.id, 2);
    assert.equal(result.receipt.selected.matchKind, 'exact');
    assert.equal(result.receipt.candidates.find(item => item.id === 8).matchKind, 'fuzzy');
});

test('part_template_coil_regression', async () => {
    for (const fixture of [
        { toolName: 'delete_part', args: { model: 'P-100' }, row: { id: 1, model: 'P-100' } },
        { toolName: 'preview_pump_shell_cost', args: { shellModel: 'T-100', customBarrelLength: 180 }, row: { id: 2, shellModel: 'T-100' } },
        { toolName: 'calculate_coil_cost', args: { spec: '12', sheets: 140 }, row: { id: 3, spec: '12', sheets: 140, material: '钢带', slotType: '小眼' } },
    ]) {
        const result = await resolveAiToolTargetV3({
            toolName: fixture.toolName,
            args: fixture.args,
            executeToolCall: async () => verified([fixture.row]),
        });
        assert.equal(result.status, 'exact', fixture.toolName);
    }
});

test('write_fuzzy_still_requires_confirmation', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'delete_recipe',
        args: { recipeName: 'V750A' },
        executeToolCall: async () => verified([{ id: 2, name: 'V750-A' }]),
    });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.receipt.selected, null);
    assert.equal(result.receipt.candidates[0].matchKind, 'fuzzy');
});

test('AI V3 实体解析：full_calculate 兼容入口也使用统一配方候选澄清', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'full_calculate',
        args: { recipeName: 'V750', stator: '12-120' },
        executeToolCall: async () => verified([
            { id: 2, name: 'v750-tokoy', spec: 'A' },
            { id: 8, name: 'v750-tokoy-', spec: 'B' },
        ]),
    });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.result.code, 'AI_RESOURCE_AMBIGUOUS');
    assert.equal(result.result.clarification.entityType, 'recipe');
    assert.equal(result.result.clarification.candidates.length, 2);
});

test('AI V3 实体解析：full_calculate 旧 pumphousing_model 字段也统一绑定配方', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'full_calculate',
        args: { pumphousing_model: 'V750-12-120', hasFloat: true },
        executeToolCall: async () => verified([
            { id: 9, name: 'V750-12-120', spec: '正式配方' },
        ]),
    });
    assert.equal(result.status, 'exact');
    assert.deepEqual(result.args, { recipeId: 9, hasFloat: true });
});

test('AI V3 实体评分：线圈规格与片数组合可作为统一候选身份', () => {
    assert.ok(candidateScore('12-140', '12-140') === 1);
    assert.ok(candidateScore('12-14O', '12-140') >= 0.6);
});

test('AI V3 实体解析：线圈规格错字按片数和正式方案唯一绑定', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'calculate_coil_cost',
        args: { spec: '1Z', sheets: 140 },
        executeToolCall: async () => verified([
            { id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼' },
            { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼' },
        ]),
    });
    assert.equal(result.status, 'unique_candidate');
    assert.deepEqual(result.args, {
        spec: '12',
        sheets: 140,
        material: '钢带',
        slotType: '小眼',
    });
});

test('AI V3 实体解析：多个相近客户必须澄清而不是猜选', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'get_recent_orders',
        args: { customerName: '邱欢' },
        executeToolCall: async (_name, args) => verified(args.name === '邱'
            ? [{ id: 1, name: '邱焕' }, { id: 2, name: '邱华' }]
            : []),
    });

    assert.equal(result.status, 'ambiguous');
    assert.equal(result.result.requiresClarification, true);
    assert.equal(result.result.clarification.entityType, 'customer');
    assert.equal(result.result.clarification.candidates.length, 2);
});

test('AI V3 实体解析：型号分词只命中低相关候选时返回未找到', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'get_recipe_technical_files',
        args: { recipeName: 'V1600-3”-12-180' },
        executeToolCall: async (_name, args) => verified(args.keyword === '12'
            ? [
                { id: 1, name: 'v550-tokoy', spec: '12-120' },
                { id: 2, name: 'v750-tokoy', spec: '12-140' },
                { id: 3, name: 'V1100-2寸', spec: '12-160' },
            ]
            : []),
    });

    assert.equal(result.status, 'not_found');
    assert.equal(result.receipt.status, 'not_found');
    assert.equal(result.receipt.originalMention, 'V1600-3”-12-180');
    assert.ok(result.receipt.candidates.every(candidate => candidate.score < 0.6));
});

test('AI V3 实体解析：订单客户简称通过正式订单候选绑定订单 ID', async () => {
    const result = await resolveAiToolTargetV3({
        toolName: 'get_order_detail',
        args: { orderQuery: '叶总' },
        executeToolCall: async (_name, args) => verified(args.customerName
            ? [{ id: 2, customerName: '台州叶总', contractNo: '20260100' }]
            : []),
    });

    assert.equal(result.status, 'unique_candidate');
    assert.deepEqual(result.args, { orderId: 2 });
    assert.equal(result.receipt.selected.name, '台州叶总');
});

test('AI V3 实体解析：订单合同号同时调查客户字段与合同字段', async () => {
    const calls = [];
    const result = await resolveAiToolTargetV3({
        toolName: 'get_order_detail',
        args: { orderQuery: '20260100' },
        executeToolCall: async (_name, args) => {
            calls.push(args);
            return verified(args.contractNo
                ? [{ id: 2, customerName: '台州叶总', contractNo: '20260100' }]
                : []);
        },
    });

    assert.deepEqual(calls.slice(0, 2), [
        { customerName: '20260100' },
        { contractNo: '20260100' },
    ]);
    assert.deepEqual(result.args, { orderId: 2 });
});

test('AI V3 实体解析：写能力只允许精确名称自动绑定', async () => {
    const fuzzy = await resolveAiToolTargetV3({
        toolName: 'delete_recipe',
        args: { recipeName: 'V75O' },
        executeToolCall: async (_name, args) => verified(String(args.keyword).toLowerCase() === 'v75'
            ? [{ id: 2, name: 'V750', spec: '12-140' }]
            : []),
    });
    assert.equal(fuzzy.status, 'ambiguous');

    const exact = await resolveAiToolTargetV3({
        toolName: 'delete_recipe',
        args: { recipeName: 'V750' },
        executeToolCall: async () => verified([{ id: 2, name: 'V750', spec: '12-140' }]),
    });
    assert.equal(exact.status, 'exact');
    assert.deepEqual(exact.args, { recipeName: 'V750' });

    const duplicateExact = await resolveAiToolTargetV3({
        toolName: 'delete_recipe',
        args: { recipeName: 'V750' },
        executeToolCall: async () => verified([
            { id: 2, name: 'V750', spec: '12-140' },
            { id: 3, name: 'V750', spec: '12-160' },
        ]),
    });
    assert.equal(duplicateExact.status, 'ambiguous');
});
