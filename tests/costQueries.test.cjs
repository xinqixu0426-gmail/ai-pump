const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    CostQueryError,
    createCostQueries,
} = require('../api/services/costQueries.cjs');

function createFixture(options = {}) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            spec TEXT,
            parts_json TEXT,
            template_id INTEGER,
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
            coil_wire_weight REAL,
            has_float INTEGER,
            float_wire TEXT,
            float_accessory_type TEXT,
            has_cable INTEGER,
            cable_length REAL,
            cable_wire TEXT,
            cable_accessory_type TEXT,
            box_type TEXT,
            packing_parts_json TEXT,
            custom_barrel_length REAL,
            extra_parts_json TEXT,
            assembly_wage REAL,
            packing_wage REAL,
            painting_wage REAL,
            surface_treatment_mode TEXT,
            surface_treatment_cost REAL,
            management_fee REAL,
            saved_total_cost REAL,
            deleted_at TEXT
        );
        INSERT INTO recipes VALUES (
            1, 'PUMP-A', 'A规格',
            '[{"name":"轴承","model":"6201","qty":1,"snapshotPrice":10}]',
            NULL, '', 0, '钢带', '小眼', NULL,
            0, '', 'standard', 0, 0, '', 'standard',
            '', '[]', NULL, '[]',
            2, 3, NULL, 'none', 0, 1, 20, NULL
        );
        INSERT INTO recipes VALUES (
            2, 'PUMP-B', 'B规格',
            '[{"name":"轴承","model":"6202","qty":1,"snapshotPrice":15}]',
            NULL, '', 0, '钢带', '小眼', NULL,
            0, '', 'standard', 0, 0, '', 'standard',
            '', '[]', NULL, '[]',
            2, 3, NULL, 'none', 0, 1, 25, NULL
        );
        ALTER TABLE recipes ADD COLUMN configuration_policy_json TEXT;
        UPDATE recipes
        SET configuration_policy_json = '{"version":1,"fields":{"cableLength":[5]}}'
        WHERE id = 1;
    `);

    const recipeRow = row => row && ({
        id: row.id,
        Id: row.id,
        name: row.name,
        spec: row.spec,
        partsJson: row.parts_json,
        coilSpec: row.coil_spec,
        coilSheets: row.coil_sheets,
        coilMaterial: row.coil_material,
        coilSlotType: row.coil_slot_type,
        coilWireWeight: row.coil_wire_weight,
        assemblyWage: row.assembly_wage,
        packingWage: row.packing_wage,
        paintingWage: row.painting_wage,
        surfaceTreatmentMode: row.surface_treatment_mode,
        surfaceTreatmentCost: row.surface_treatment_cost,
        managementFee: row.management_fee,
        savedTotalCost: row.saved_total_cost,
        configurationPolicyJson: row.configuration_policy_json,
    });
    const listRecipes = () => db.prepare(
        'SELECT * FROM recipes WHERE deleted_at IS NULL ORDER BY id'
    ).all().map(recipeRow);
    const costCalls = [];
    const calculateRecipeCost = (parts) => {
        costCalls.push(parts);
        const details = (parts || []).map(part => ({
            ...part,
            qty: Number(part.qty || 1),
            subtotal: Number(part.snapshotPrice || 0)
                * Number(part.qty || 1),
        }));
        const totalCost = details.reduce(
            (sum, item) => sum + item.subtotal,
            0
        );
        return {
            totalCost: totalCost.toFixed(2),
            itemCount: details.length,
            missingParts: [],
            details,
        };
    };
    const queries = createCostQueries({
        db,
        calculateRecipeCost,
        getSetting: key => key === 'management_fee' ? 1 : undefined,
        listCoils: () => [],
        listRecipes,
        loadPartsData: () => ({
            partsCache: {},
            partsByModel: {},
        }),
        recipeRow,
        buildBomDraft: (_input, recipe) => {
            if (Number(recipe.id) === Number(options.unexpectedFailureRecipeId)) {
                throw new Error('模拟数据库或编程错误');
            }
            if (Number(recipe.id) === Number(options.failRecipeId)) {
                const error = new Error('当前配方必须选择线圈方案系列');
                error.code = 'COIL_SCHEME_FAMILY_REQUIRED';
                error.details = { candidates: [{ schemeFamilyCode: 'LEGACY-V1' }] };
                throw error;
            }
            return { parts: JSON.parse(recipe.partsJson || '[]') };
        },
    });
    return {
        costCalls,
        db,
        queries,
    };
}

test('成本 Query 的配件数组计算继续唯一委托正式成本函数', () => {
    const fixture = createFixture();
    try {
        const parts = [{
            model: '6201',
            qty: 2,
            snapshotPrice: 10,
        }];
        assert.deepEqual(
            fixture.queries.calculateParts({ parts }),
            {
                totalCost: '20.00',
                itemCount: 1,
                missingParts: [],
                details: [{
                    model: '6201',
                    qty: 2,
                    snapshotPrice: 10,
                    subtotal: 20,
                }],
            }
        );
        assert.equal(fixture.costCalls[0], parts);
        assert.throws(
            () => fixture.queries.calculateParts({ parts: [] }),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 400
                && error.message === '请求体必须包含 parts 数组'
            )
        );
    } finally {
        fixture.db.close();
    }
});

test('批量当日成本逐条隔离方案族错误并继续返回其他配方', () => {
    const fixture = createFixture({ failRecipeId: 1 });
    try {
        const current = fixture.queries.getCurrentRecipeCosts(
            new Date('2026-08-30T00:00:00.000Z')
        );
        assert.equal(current.items.length, 2);
        assert.deepEqual(current.items[0].calculationError, {
            code: 'COIL_SCHEME_FAMILY_REQUIRED',
            message: '当前配方必须选择线圈方案系列',
            details: { candidates: [{ schemeFamilyCode: 'LEGACY-V1' }] },
        });
        assert.equal(current.items[0].currentTotalCost, null);
        assert.equal(current.items[0].costComplete, false);
        assert.equal(current.items[1].currentTotalCost, 21);
        assert.equal(current.items[1].calculationError, undefined);
    } finally {
        fixture.db.close();
    }
});

test('批量当日成本不会把未知内部错误降级成 200 单条提示', () => {
    const fixture = createFixture({ unexpectedFailureRecipeId: 2 });
    try {
        assert.throws(
            () => fixture.queries.getCurrentRecipeCosts(
                new Date('2026-08-30T00:00:00.000Z')
            ),
            /模拟数据库或编程错误/
        );
    } finally {
        fixture.db.close();
    }
});

test('成本 Query 统一按名称、ID 和批量当日口径读取配方', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(
            fixture.queries.getRecipeCostByName('PUMP-A'),
            {
                recipeId: 1,
                recipeName: 'PUMP-A',
                recipeSpec: 'A规格',
                totalCost: '10.00',
                itemCount: 1,
                missingParts: [],
                details: [{
                    name: '轴承',
                    model: '6201',
                    qty: 1,
                    snapshotPrice: 10,
                    subtotal: 10,
                }],
            }
        );
        assert.equal(
            fixture.queries.getRecipeCostById('2').recipeId,
            '2'
        );
        const current = fixture.queries.getCurrentRecipeCosts(
            new Date('2026-08-03T00:00:00.000Z')
        );
        assert.equal(current.asOf, '2026-08-03T00:00:00.000Z');
        assert.equal(current.sourceOfTruth, 'costEngine');
        assert.equal(current.basis, 'currentTemplateAndRecipeParameters');
        assert.deepEqual(current.items.map(item => ({
            recipeId: item.recipeId,
            currentTotalCost: item.currentTotalCost,
            savedTotalCost: item.savedTotalCost,
        })), [
            {
                recipeId: 1,
                currentTotalCost: 16,
                savedTotalCost: 20,
            },
            {
                recipeId: 2,
                currentTotalCost: 21,
                savedTotalCost: 25,
            },
        ]);
    } finally {
        fixture.db.close();
    }
});

test('成本 Query 保持配方查询的 400/404 兼容错误', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.getRecipeCostByName(''),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 400
                && error.message === '请提供 name 查询参数'
            )
        );
        assert.throws(
            () => fixture.queries.getRecipeCostByName('不存在'),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 404
            )
        );
        assert.throws(
            () => fixture.queries.getRecipeCostById(999),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 404
                && error.message === '配方ID 999 不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});

test('成本 Query 统一承接线圈、动态项和完整估算编排', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.calculateCoil({}),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 400
                && error.message === '规格为必填项'
            )
        );
        assert.deepEqual(fixture.queries.calculateDynamic({}), {
            totalCost: '0.00',
            itemCount: 0,
            resolvedWire: '0.55',
            details: [],
        });
        const full = fixture.queries.calculateFullEstimate({
            recipeName: 'PUMP-A',
        });
        assert.equal(full.sourceOfTruth, 'costEngine');
        assert.equal(full.costBasis, 'currentFullCost');
        assert.equal(full.recipeCost.recipeId, 1);
        assert.equal(full.recipeCost.recipeName, 'PUMP-A');
        assert.equal(full.recipeCost.totalCost, '20.00');
        assert.equal(full.totalCost, '20.00');
        assert.equal(full.compatibility.managedRolesReplacedOnce, true);
        assert.equal(full.compatibility.replacement, 'preview_recipe_cost');
        assert.throws(
            () => fixture.queries.calculateFullEstimate({}),
            error => error.code === 'FULL_ESTIMATE_RECIPE_REQUIRED' && error.statusCode === 400
        );
        assert.throws(
            () => fixture.queries.calculateFullEstimate({ recipeName: 'PUMP' }),
            error => error.code === 'FULL_ESTIMATE_RECIPE_AMBIGUOUS' && error.statusCode === 409
        );
        assert.throws(
            () => fixture.queries.calculateFullEstimate({ recipeName: 'V750-大脚板-2寸' }),
            error => error.code === 'FULL_ESTIMATE_RECIPE_NOT_FOUND'
                && error.statusCode === 404
                && /泵壳模板名不能作为成品型号/.test(error.message)
        );
    } finally {
        fixture.db.close();
    }
});

test('兼容完整估算按角色替换已有浮球和包装，不把动态项重复叠加', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            UPDATE recipes
            SET parts_json = ?, saved_total_cost = 40,
                has_float = 1, float_wire = '0.55',
                packing_parts_json = ?, configuration_policy_json = NULL
            WHERE id = 1
        `).run(
            JSON.stringify([
                { name: '轴承', model: '6201', qty: 1, snapshotPrice: 10, costRole: 'fixed' },
                { name: '浮球', model: '浮球-线径0.55', qty: 1, snapshotPrice: 7, costRole: 'float' },
                { name: 'v550木箱', model: 'v550木箱', qty: 1, snapshotPrice: 13, costRole: 'packing', packingRole: 'container' },
            ]),
            JSON.stringify([{ model: 'v550木箱', qty: 1, snapshotPrice: 13, packingRole: 'container' }])
        );
        const full = fixture.queries.calculateFullEstimate({
            recipeId: 1,
            hasFloat: false,
            packingPartsJson: '[]',
        });
        assert.equal(full.costBasis, 'overridePreview');
        assert.equal(full.totalCost, '20.00');
        assert.equal(full.parts.some(part => part.costRole === 'float'), false);
        assert.equal(full.parts.some(part => part.costRole === 'packing'), false);
        assert.equal(full.compatibility.managedRolesReplacedOnce, true);
    } finally {
        fixture.db.close();
    }
});

test('成本 Query 的配方覆盖预览保持只读和原响应字段', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.previewRecipeCost(1, {});
        assert.equal(result.recipeName, 'PUMP-A');
        assert.equal(result.data.unitCost, 20);
        assert.ok(Array.isArray(result.data.parts));
        assert.equal(typeof result.data.costSnapshot, 'object');
        assert.equal(result.data.configurationPolicyMode, 'explicit');
        assert.deepEqual(result.data.configurationPolicy.fields.cableLength, [5]);
        assert.equal(result.data.configurationSnapshot.hasStainlessShaftJoint, false);
        assert.equal(result.data.configurationSnapshot.stainlessShaftJointCost, 0);
        assert.equal(result.data.configurationSnapshot.rotorShaftProcess, 'standard');
        const shaftJoint = fixture.queries.previewRecipeCost(1, {
            hasStainlessShaftJoint: true,
        });
        assert.equal(shaftJoint.data.unitCost, 26);
        assert.equal(shaftJoint.data.configurationSnapshot.hasStainlessShaftJoint, true);
        assert.equal(shaftJoint.data.configurationSnapshot.stainlessShaftJointCost, 6);
        assert.equal(shaftJoint.data.configurationSnapshot.rotorShaftProcess, 'stainless_friction_weld');
        assert.equal(shaftJoint.data.parts.some(part => (
            part.costRole === 'rotorProcess'
            && part.inventoryType === 'none'
            && part.snapshotPrice === 6
        )), true);
        assert.throws(
            () => fixture.queries.previewRecipeCost(1, { cableLength: 10 }),
            error => error.code === 'RECIPE_CONFIGURATION_NOT_ALLOWED'
                && error.statusCode === 422
        );
        assert.throws(
            () => fixture.queries.previewRecipeCost(999, {}),
            error => (
                error instanceof CostQueryError
                && error.statusCode === 404
                && error.message === 'Recipe not found'
            )
        );
    } finally {
        fixture.db.close();
    }
});

test('成本差异解释通过注入的正式配方和成本依赖完成', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.getRecipeDifference({
            leftRecipeId: 1,
            rightRecipeId: 2,
        });
        assert.equal(result.left.name, 'PUMP-A');
        assert.equal(result.right.name, 'PUMP-B');
        assert.equal(result.costBasis, 'currentFullCost');
        assert.equal(result.sourceOfTruth, 'costEngine');
        assert.equal(result.left.totalCost, 16);
        assert.equal(result.right.totalCost, 21);
        assert.equal(result.left.laborCost, 6);
        assert.equal(result.right.laborCost, 6);
        assert.equal(result.totalDiff, 5);
        assert.equal(result.direction, '增加');
    } finally {
        fixture.db.close();
    }
});
