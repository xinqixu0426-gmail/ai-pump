const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    RecipeQueryError,
    createRecipeQueries,
} = require('../api/services/recipeQueries.cjs');

test('配方库存只读查询拒绝损坏 BOM，空数组正常且不写数据库', () => {
    const fixture = createFixture();
    try {
        for (const value of ['broken', '{}', '[null]', '["型号"]', '[[]]']) {
            fixture.db.prepare('UPDATE recipes SET parts_json = ? WHERE id = 1').run(value);
            assert.throws(() => fixture.queries.getInventoryStatus(1), { code: 'RECIPE_BOM_INVALID', statusCode: 422 });
        }
        fixture.db.prepare('UPDATE recipes SET parts_json = ? WHERE id = 1').run('[]');
        const changes = fixture.db.prepare('SELECT total_changes() n').get().n;
        assert.deepEqual(fixture.queries.getInventoryStatus(1).items, []);
        assert.equal(fixture.queries.getInventoryStatus(1).sourceOfTruth, 'recipes.inventory_status');
        assert.equal(fixture.db.prepare('SELECT total_changes() n').get().n, changes);
    } finally { fixture.db.close(); }
});

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            parts_json TEXT,
            coil_id INTEGER,
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
            deleted_at TEXT
        );
        CREATE TABLE recipe_technical_files (
            id INTEGER PRIMARY KEY,
            recipe_id INTEGER NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY,
            model TEXT,
            supplier TEXT,
            category TEXT,
            stock REAL,
            remark TEXT,
            deleted_at TEXT
        );
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT,
            sheets INTEGER,
            material TEXT,
            slot_type TEXT,
            scheme_status TEXT,
            is_default INTEGER DEFAULT 0,
            stock REAL
        );
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY,
            shell_model TEXT,
            assembly_wage REAL,
            packing_wage REAL,
            painting_wage REAL,
            surface_treatment_mode TEXT,
            surface_treatment_cost REAL
        );
        CREATE TABLE pump_model_variants (
            id INTEGER PRIMARY KEY,
            template_id INTEGER,
            model_name TEXT,
            note TEXT,
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
            barrel_length REAL,
            long_screw_extra_length REAL,
            impeller_model TEXT,
            impeller_thickness REAL,
            impeller_diameter REAL,
            impeller_blade_count INTEGER,
            deleted_at TEXT
        );
        INSERT INTO recipes VALUES (
            1,
            'QDX10',
            '[{"name":"轴承","model":"6201","supplier":"甲"},{"name":"线圈转子","model":"12-160"}]',
            20,
            '12',
            160,
            '冷轧',
            '国标眼',
            NULL
        );
        INSERT INTO recipes VALUES (
            2,
            'DELETED-RECIPE',
            '[]',
            NULL,
            '',
            0,
            '冷轧',
            '国标眼',
            '2026-08-28T00:00:00.000Z'
        );
        INSERT INTO recipe_technical_files VALUES (1, 1, NULL);
        INSERT INTO parts VALUES
            (10, '6201', '甲', '轴承', 5, NULL, NULL),
            (11, '6201', '乙', '轴承', 0, NULL, NULL),
            (12, 'SHELL-DY款-圆底脚-12', '', '泵壳', 0, '{"barrelLength":150}', NULL);
        INSERT INTO coils VALUES
            (20, '12', 160, '冷轧', '国标眼', 'official', 1, 3);
        INSERT INTO pump_shell_templates VALUES
            (30, 'SHELL-DY款-圆底脚', 4, 2, 3, 'painting', 3);
        INSERT INTO pump_model_variants VALUES
            (40, 30, 'QDX10-A', '常用配置', '12', 160, '冷轧', '国标眼',
             150, 5, '叶轮A', 2, 100, 6, NULL);
    `);
    const listedRecipe = { id: 1, name: 'QDX10' };
    Object.defineProperties(listedRecipe, {
        templateId: { value: 30 },
        packingPartsJson: { value: '[{"model":"v550木箱"}]' },
    });
    const listedRecipes = [listedRecipe];
    const listedRecipesWithTechnicalCount = [{ id: 1, name: 'QDX10', technicalFileCount: 1 }];
    const listedParts = [
        { id: 10, model: '6201' },
        { id: 50, model: 'v550木箱', supplier: '甲', price: 13 },
        { id: 51, model: 'v1600木箱', supplier: '乙', price: 19 },
        { id: 52, model: '珍珠棉', supplier: '甲', price: 2 },
    ];
    const listedCoils = [{ id: 20, spec: '12' }];
    const bomCalls = [];
    const queries = createRecipeQueries({
        db,
        listCoils: () => listedCoils,
        listParts: () => listedParts,
        listRecipes: () => listedRecipes,
        recipeRow: row => row && ({
            id: row.id,
            name: row.name,
        }),
        templateRow: row => row && ({
            id: row.id,
            shellModel: row.shell_model,
            assemblyWage: row.assembly_wage,
            packingWage: row.packing_wage,
            paintingWage: row.painting_wage,
            surfaceTreatmentMode: row.surface_treatment_mode,
            surfaceTreatmentCost: row.surface_treatment_cost,
        }),
        modelVariantRow: row => row && ({
            id: row.id,
            templateId: row.template_id,
            modelName: row.model_name,
            note: row.note,
            coilSpec: row.coil_spec,
            coilSheets: row.coil_sheets,
            coilMaterial: row.coil_material,
            coilSlotType: row.coil_slot_type,
            barrelLength: row.barrel_length,
            longScrewExtraLength: row.long_screw_extra_length,
            impellerModel: row.impeller_model,
            impellerThickness: row.impeller_thickness,
            impellerDiameter: row.impeller_diameter,
            impellerBladeCount: row.impeller_blade_count,
        }),
        buildBomDraft: (input, context) => {
            bomCalls.push({ input, context });
            return { parts: [], contextLoaded: true };
        },
    });
    return {
        bomCalls,
        db,
        listedCoils,
        listedParts,
        listedRecipes,
        listedRecipesWithTechnicalCount,
        queries,
    };
}

test('配方 Query 返回列表、详情及零件和正式线圈库存状态', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(
            fixture.queries.getAllRecipes(),
            fixture.listedRecipesWithTechnicalCount
        );
        assert.deepEqual(
            fixture.queries.getAllRecipes({ keyword: 'QDX' }),
            fixture.listedRecipesWithTechnicalCount
        );
        assert.deepEqual(
            fixture.queries.getAllRecipes({ keyword: '不存在' }),
            []
        );
        assert.deepEqual(
            fixture.queries.getAllRecipes({ hasTechnicalFiles: true }),
            [{ id: 1, name: 'QDX10', technicalFileCount: 1 }]
        );
        assert.deepEqual(
            fixture.queries.getAllRecipes({ hasTechnicalFiles: false }),
            []
        );
        assert.throws(
            () => fixture.queries.getAllRecipes({ hasTechnicalFiles: 'yes' }),
            /hasTechnicalFiles 必须是 true 或 false/
        );
        assert.deepEqual(fixture.queries.getRecipe(1), {
            id: 1,
            name: 'QDX10',
        });
        const status = fixture.queries.getInventoryStatus(1);
        assert.deepEqual(status.recipe, { id: 1, name: 'QDX10' });
        assert.deepEqual(status.items, [
            {
                name: '轴承',
                model: '6201',
                supplier: '甲',
                currentStock: 5,
                currentName: '6201', snapshotName: '6201', referenceStatus: 'resolved_legacy', message: null,
                partId: 10,
                inventoryType: 'part',
                status: 'in_stock',
            },
            {
                name: '线圈转子',
                model: '12-160',
                supplier: '',
                currentStock: 3,
                currentName: null, snapshotName: '12-160', referenceStatus: 'resolved', message: null,
                coilId: 20,
                inventoryType: 'coil',
                status: 'in_stock',
            },
        ]);
    } finally {
        fixture.db.close();
    }
});

test('配方 Query 的 BOM 草稿复用正式引擎并带入变体、模板和泵壳元数据', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.getBomDraft({ modelVariantId: 40 });
        assert.equal(result.contextLoaded, true);
        assert.deepEqual(result.parts, []);
        assert.deepEqual(result.costPreview, {
            sourceOfTruth: 'costEngine',
            costBasis: 'configuredBomDraft',
            pricingComplete: true,
            currentTotalCost: 9,
            partsCost: 0,
            laborCost: 9,
            missingParts: [],
            details: '安装工资: ¥4.00\n打包工资: ¥2.00\n表面处理(喷漆): ¥3.00\n管理费用: ¥0.00',
        });
        assert.equal(fixture.bomCalls.length, 1);
        const call = fixture.bomCalls[0];
        assert.equal(call.context.variant.id, 40);
        assert.equal(call.context.template.id, 30);
        assert.deepEqual(call.context.shellMeta, {
            barrelLength: 150,
        });
        assert.equal(call.context.partsCatalog, fixture.listedParts);
        assert.equal(call.context.coils, fixture.listedCoils);
    } finally {
        fixture.db.close();
    }
});

test('配方 Query 的配置零件用模板既有配置唯一落地，不能唯一时返回正式候选', () => {
    const fixture = createFixture();
    try {
        fixture.queries.getBomDraft({
            templateId: 30,
            packingParts: [{ model: '木箱', qty: 1 }, { model: '珍珠棉', qty: 1 }],
        });
        const input = fixture.bomCalls[0].input;
        assert.deepEqual(input.packingParts, [
            {
                model: 'v550木箱', qty: 1, partId: 50, supplier: '甲',
                resolution: {
                    source: 'template_recipe_consensus',
                    query: '木箱',
                    recipes: [{ recipeId: 1, recipeName: 'QDX10', model: 'v550木箱' }],
                },
            },
            {
                model: '珍珠棉', qty: 1, partId: 52, supplier: '甲',
                resolution: { source: 'catalog_exact', query: '珍珠棉' },
            },
        ]);
        assert.throws(
            () => fixture.queries.getBomDraft({ packingParts: [{ model: '木箱' }] }),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 409
                && error.code === 'CONFIGURED_PART_AMBIGUOUS'
                && error.details.candidates.length === 2
            )
        );
        fixture.listedRecipes.push({
            id: 3,
            name: 'QDX10-另一包装',
            templateId: 30,
            packingPartsJson: '[{"model":"v1600木箱"}]',
        });
        assert.throws(
            () => fixture.queries.getBomDraft({
                templateId: 30,
                packingParts: [{ model: '木箱' }],
            }),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 409
                && error.code === 'CONFIGURED_PART_AMBIGUOUS'
                && error.details.candidates.length === 2
            )
        );
    } finally {
        fixture.db.close();
    }
});

test('配方 Query 的 BOM 草稿可正式解析 shellModel，并拒绝空配置和无效模板', () => {
    const fixture = createFixture();
    try {
        const byName = fixture.queries.getBomDraft({ shellModel: 'SHELL-DY款-圆底脚' });
        assert.equal(byName.contextLoaded, true);
        assert.equal(fixture.bomCalls[0].context.template.id, 30);
        assert.throws(
            () => fixture.queries.getBomDraft({}),
            error => error.code === 'RECIPE_BOM_CONFIGURATION_REQUIRED' && error.statusCode === 400
        );
        assert.throws(
            () => fixture.queries.getBomDraft({ templateId: 999 }),
            error => error.code === 'PUMP_SHELL_TEMPLATE_NOT_FOUND' && error.statusCode === 404
        );
        assert.throws(
            () => fixture.queries.getBomDraft({ shellModel: '不存在' }),
            error => error.code === 'PUMP_SHELL_TEMPLATE_NOT_FOUND' && error.statusCode === 404
        );
    } finally {
        fixture.db.close();
    }
});

test('配方 Query 的型号变体草稿统一带入工资、表面处理和技术参数', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.getModelVariantDraft(40);
        assert.equal(result.variant.id, 40);
        assert.equal(result.template.id, 30);
        assert.deepEqual(result.recipeDraft, {
            name: 'QDX10-A',
            spec: '常用配置',
            templateId: 30,
            modelVariantId: 40,
            coilId: null,
            coilSchemeFamilyCode: '',
            coilSpec: '12',
            coilSheets: 160,
            coilMaterial: '冷轧',
            coilSlotType: '国标眼',
            customBarrelLength: 150,
            longScrewExtraLength: 5,
            impellerModel: '叶轮A',
            impellerThickness: 2,
            impellerDiameter: 100,
            impellerBladeCount: 6,
            assemblyWage: 4,
            packingWage: 2,
            paintingWage: 3,
            surfaceTreatmentMode: 'painting',
            surfaceTreatmentCost: 3,
        });
    } finally {
        fixture.db.close();
    }
});

test('配方 Query 对非法 ID 和不存在资源返回稳定 400/404', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.getRecipe('bad'),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 400
                && error.message === '非法配方ID'
            )
        );
        assert.throws(
            () => fixture.queries.getRecipe(2),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 404
                && error.message === '配方不存在'
            )
        );
        assert.throws(
            () => fixture.queries.getInventoryStatus(999),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 404
                && error.message === '配方不存在'
            )
        );
        assert.throws(
            () => fixture.queries.getModelVariantDraft(999),
            error => (
                error instanceof RecipeQueryError
                && error.statusCode === 404
                && error.message === '常用配置预设不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});


test('BOM baseline is opt-in for API callers, inherits recipe wages and returns scope without writes', () => {
    const f = createFixture();
    try {
        const before = f.db.prepare('SELECT total_changes() AS count').get().count;
        const recipe = { id: 1, name: '在售A', templateId: 30, coilSpec: '12', coilSheets: 120, hasFloat: 1, hasCable: 1, cableLength: 8, packingPartsJson: '[{"model":"v550木箱","qty":1}]', assemblyWage: 9, packingWage: 4, surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0, managementFee: 0 };
        f.listedRecipes.splice(0, f.listedRecipes.length, recipe);
        const result = f.queries.getBomDraft({ baseRecipeId: 1, hasFloat: false });
        assert.equal(result.configurationBasis.recipeId, 1);
        assert.equal(result.costPreview.laborCost, 13);
        assert.equal(f.bomCalls.at(-1).input.hasFloat, false);
        assert.equal(f.bomCalls.at(-1).input.cableLength, 8);
        assert.equal(f.queries.getBomDraft({ templateId: 30 }).configurationBasis, undefined);
        assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, before);
        f.listedRecipes.length = 0;
        const missing = f.queries.getBomDraft({ templateId: 30, useRecipeBaseline: true });
        assert.equal(missing.configurationBasis.configurationComplete, false);
        assert.throws(() => f.queries.getBomDraft({ baseRecipeId: 999 }), e => e.code === 'RECIPE_BASELINE_NOT_FOUND');
    } finally { f.db.close(); }
});

test('BOM 查询明确 ID 不被同名目录覆盖，失效或冲突 ID 不回退名称猜选', () => {
    const fixture = createFixture();
    try {
        fixture.listedParts.push({ id: 60, model: '6201', supplier: '乙', category: '配件' });
        fixture.queries.getBomDraft({ optionalParts: [{ partId: 60, model: '6201', qty: 1 }] });
        assert.equal(fixture.bomCalls.at(-1).input.optionalParts[0].partId, 60);
        for (const selection of [
            { partId: 999, model: '6201' }, { partId: true, model: '6201' },
            { partId: 60, model: '旧称' }, { partId: 60, model: '6201', supplier: '甲' },
        ]) assert.throws(() => fixture.queries.getBomDraft({ optionalParts: [selection] }));
        assert.throws(() => fixture.queries.getBomDraft({ packingParts: [{ partId: 60, model: '6201' }] }), { code: 'BOM_PART_CATEGORY_MISMATCH' });
    } finally { fixture.db.close(); }
});

test('BOM 查询泵壳多供应商歧义明确失败，不带入第一条默认参数且只读', () => {
    const fixture = createFixture();
    try {
        const shell = fixture.db.prepare("SELECT * FROM parts WHERE category='泵壳' LIMIT 1").get();
        fixture.db.prepare('INSERT INTO parts (id, model, supplier, category, stock, remark) VALUES (?, ?, ?, ?, ?, ?)')
            .run(999, shell.model, '另一个供应商', '泵壳', 0, '{}');
        const changes = fixture.db.prepare('SELECT total_changes() n').get().n;
        assert.throws(() => fixture.queries.getBomDraft({ templateId: 30 }), { code: 'PUMP_SHELL_PART_AMBIGUOUS', statusCode: 409 });
        assert.equal(fixture.bomCalls.length, 0);
        assert.equal(fixture.db.prepare('SELECT total_changes() n').get().n, changes);
    } finally { fixture.db.close(); }
});
