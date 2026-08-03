const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    TemplateQueryError,
    createTemplateQueries,
} = require('../api/services/templateQueries.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY,
            shell_model TEXT,
            description TEXT,
            parts_json TEXT,
            shell_components_json TEXT,
            rotor_params_json TEXT,
            assembly_wage REAL,
            packing_wage REAL,
            painting_wage REAL,
            surface_treatment_mode TEXT,
            surface_treatment_cost REAL,
            cost_mode TEXT,
            bundle_cost REAL
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            template_id INTEGER,
            name TEXT
        );
        INSERT INTO pump_shell_templates VALUES (
            1,
            'SHELL-1',
            '常用泵壳',
            '[{"name":"轴承","model":"6201","qty":2}]',
            '[
                {"name":"机筒","model":"BARREL-1","supplier":"甲","qty":1,"unitCost":80},
                {"name":"底座","model":"BASE-1","qty":1,"unitCost":12},
                {"name":"不计价项","model":"SKIP","included":false}
            ]',
            '{"barrelLength":150}',
            4,
            2,
            3,
            'painting',
            5,
            'components',
            0
        );
        INSERT INTO pump_shell_templates VALUES (
            2,
            'SHELL-2',
            '套件泵壳',
            '[]',
            '[]',
            '{}',
            6,
            3,
            NULL,
            'none',
            0,
            'bundle',
            200
        );
        INSERT INTO recipes VALUES
            (10, 1, 'QDX10'),
            (11, 1, 'QDX15');
    `);

    const costCalls = [];
    const listedTemplates = [{ id: 1, shellModel: 'SHELL-1' }];
    const partsCache = new Map([['6201', { price: 6 }]]);
    const partsByModel = {
        'BARREL-1': [
            {
                category: '泵壳搭配',
                supplier: '乙',
                price: 70,
            },
            {
                category: '泵壳搭配',
                supplier: '甲',
                price: 65,
            },
        ],
    };
    const templateRow = row => row && ({
        id: row.id,
        shellModel: row.shell_model,
        description: row.description || '',
        partsJson: row.parts_json || '[]',
        rotorParamsJson: row.rotor_params_json || '{}',
        assemblyWage: row.assembly_wage || 0,
        packingWage: row.packing_wage || 0,
        paintingWage: row.painting_wage,
        surfaceTreatmentMode: row.surface_treatment_mode,
        surfaceTreatmentCost: row.surface_treatment_cost,
    });
    const queries = createTemplateQueries({
        db,
        calculateRecipeCost: (parts, receivedCache, receivedByModel) => {
            costCalls.push({
                parts,
                partsCache: receivedCache,
                partsByModel: receivedByModel,
            });
            return {
                partsCost: parts.reduce(
                    (sum, part) => (
                        sum
                        + Number(part.snapshotPrice || 0)
                        * Number(part.qty || 0)
                    ),
                    0
                ),
            };
        },
        listTemplates: () => listedTemplates,
        loadPartsData: () => ({ partsCache, partsByModel }),
        normalizeSurfaceTreatmentMode: (mode, paintingWage) => (
            mode || (paintingWage == null ? 'none' : 'painting')
        ),
        recipeRow: row => row && ({
            id: row.id,
            templateId: row.template_id,
            name: row.name,
        }),
        shellComponentCategory: '泵壳搭配',
        templateRow,
    });
    return {
        costCalls,
        db,
        listedTemplates,
        partsByModel,
        partsCache,
        queries,
    };
}

test('泵壳模板 Query 统一返回列表、详情与关联配方', () => {
    const fixture = createFixture();
    try {
        assert.equal(
            fixture.queries.getAllTemplates(),
            fixture.listedTemplates
        );
        assert.deepEqual(fixture.queries.getTemplate(1), {
            id: 1,
            shellModel: 'SHELL-1',
            description: '常用泵壳',
            partsJson: '[{"name":"轴承","model":"6201","qty":2}]',
            rotorParamsJson: '{"barrelLength":150}',
            assemblyWage: 4,
            packingWage: 2,
            paintingWage: 3,
            surfaceTreatmentMode: 'painting',
            surfaceTreatmentCost: 5,
        });
        assert.deepEqual(fixture.queries.getTemplateRecipes(1), [
            { id: 10, templateId: 1, name: 'QDX10' },
            { id: 11, templateId: 1, name: 'QDX15' },
        ]);
        assert.deepEqual(
            fixture.queries.getTemplateRecipes(999),
            []
        );
    } finally {
        fixture.db.close();
    }
});

test('泵壳模板成本 Query 保持目录价优先和手工价回退', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(fixture.queries.getTemplateCost(1), {
            templateId: 1,
            shellModel: 'SHELL-1',
            partsCost: 77,
        });
        assert.equal(fixture.costCalls.length, 1);
        assert.deepEqual(fixture.costCalls[0].parts, [
            {
                model: 'BARREL-1',
                name: '机筒',
                supplier: '甲',
                qty: 1,
                snapshotPrice: 65,
                source: 'pump_shell_template',
                costSource: 'catalog',
            },
            {
                model: 'BASE-1',
                name: '底座',
                supplier: '',
                qty: 1,
                snapshotPrice: 12,
                source: 'pump_shell_template',
                costSource: 'manual',
            },
            {
                name: '轴承',
                model: '6201',
                qty: 2,
                supplier: '',
            },
        ]);
        assert.equal(
            fixture.costCalls[0].partsCache,
            fixture.partsCache
        );
        assert.equal(
            fixture.costCalls[0].partsByModel,
            fixture.partsByModel
        );

        assert.deepEqual(fixture.queries.getTemplateCost(2), {
            templateId: 2,
            shellModel: 'SHELL-2',
            partsCost: 200,
        });
        assert.deepEqual(fixture.costCalls[1].parts, [
            {
                model: 'SHELL-2',
                name: '泵壳套件',
                supplier: '',
                qty: 1,
                snapshotPrice: 200,
                source: 'pump_shell_template',
                costSource: 'manual',
            },
        ]);
    } finally {
        fixture.db.close();
    }
});

test('泵壳模板 Query 统一生成默认配方草稿和正式成本结果', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.getDefaultRecipe(1);
        assert.deepEqual(result.recipeDraft, {
            name: 'SHELL-1',
            spec: '常用泵壳',
            templateId: 1,
            partsJson: '[{"name":"轴承","model":"6201","qty":2}]',
            assemblyWage: 4,
            packingWage: 2,
            paintingWage: 3,
            surfaceTreatmentMode: 'painting',
            surfaceTreatmentCost: 5,
        });
        assert.deepEqual(result.parts, [
            { name: '轴承', model: '6201', qty: 2 },
        ]);
        assert.deepEqual(result.rotorParams, {
            barrelLength: 150,
        });
        assert.deepEqual(result.cost, {
            partsCost: 77,
        });
    } finally {
        fixture.db.close();
    }
});

test('泵壳模板应用 Query 保留调用方字段并只覆盖模板负责字段', () => {
    const fixture = createFixture();
    try {
        const result = fixture.queries.applyTemplate(1, {
            name: '客户专用',
            assemblyWage: 9,
            surfaceTreatmentMode: 'powder_coating',
            surfaceTreatmentCost: 8,
        });
        assert.deepEqual(result.recipeDraft, {
            name: '客户专用',
            assemblyWage: 9,
            surfaceTreatmentMode: 'powder_coating',
            surfaceTreatmentCost: 8,
            templateId: 1,
            partsJson: '[{"name":"轴承","model":"6201","qty":2}]',
            packingWage: 2,
            paintingWage: 3,
        });
        assert.deepEqual(result.rotorParams, {
            barrelLength: 150,
        });
    } finally {
        fixture.db.close();
    }
});

test('泵壳模板 Query 对非法 ID 和不存在资源返回稳定 400/404', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.getTemplate('bad'),
            error => (
                error instanceof TemplateQueryError
                && error.statusCode === 400
                && error.message === '非法模板ID'
            )
        );
        assert.throws(
            () => fixture.queries.getTemplate(999),
            error => (
                error instanceof TemplateQueryError
                && error.statusCode === 404
                && error.message === '模板不存在'
            )
        );
        assert.throws(
            () => fixture.queries.getTemplateRecipes(0),
            error => (
                error instanceof TemplateQueryError
                && error.statusCode === 400
                && error.message === '非法模板ID'
            )
        );
    } finally {
        fixture.db.close();
    }
});
