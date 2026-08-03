const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    RecipeQueryError,
    createRecipeQueries,
} = require('../api/services/recipeQueries.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            parts_json TEXT,
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
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
            '12',
            160,
            '冷轧',
            '国标眼',
            NULL
        );
        INSERT INTO parts VALUES
            (10, '6201', '甲', '轴承', 5, NULL, NULL),
            (11, '6201', '乙', '轴承', 0, NULL, NULL),
            (12, 'SHELL-1', '', '泵壳', 0, '{"barrelLength":150}', NULL);
        INSERT INTO coils VALUES
            (20, '12', 160, '冷轧', '国标眼', 'official', 3);
        INSERT INTO pump_shell_templates VALUES
            (30, 'SHELL-1', 4, 2, 3, 'painting', 3);
        INSERT INTO pump_model_variants VALUES
            (40, 30, 'QDX10-A', '常用配置', '12', 160, '冷轧', '国标眼',
             150, 5, '叶轮A', 2, 100, 6, NULL);
    `);
    const listedRecipes = [{ id: 1, name: 'QDX10' }];
    const listedParts = [{ id: 10, model: '6201' }];
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
        queries,
    };
}

test('配方 Query 返回列表、详情及零件和正式线圈库存状态', () => {
    const fixture = createFixture();
    try {
        assert.equal(
            fixture.queries.getAllRecipes(),
            fixture.listedRecipes
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
                partId: 10,
                inventoryType: 'part',
                status: 'in_stock',
            },
            {
                name: '线圈转子',
                model: '12-160',
                supplier: '',
                currentStock: 3,
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
        assert.deepEqual(
            fixture.queries.getBomDraft({ modelVariantId: 40 }),
            { parts: [], contextLoaded: true }
        );
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
                && error.message === '型号变体不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});
