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
        ALTER TABLE pump_shell_templates ADD COLUMN configuration_policy_json TEXT;
        UPDATE pump_shell_templates
        SET configuration_policy_json = '{"version":1,"fields":{"cableLength":[5,10]}}'
        WHERE id = 1;
    `);

    const costCalls = [];
    const listedTemplates = [
        { id: 1, shellModel: 'SHELL-1', description: '常用泵壳' },
        { id: 2, shellModel: 'SHELL-2', description: '套件泵壳' },
    ];
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
        configurationPolicyJson: row.configuration_policy_json,
    });
    const queries = createTemplateQueries({
        db,
        calculateRecipeCost: (parts, receivedCache, receivedByModel) => {
            assert.equal(db.inTransaction, true);
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
        assert.deepEqual(
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
            configurationPolicyJson: '{"version":1,"fields":{"cableLength":[5,10]}}',
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

test('泵壳模板列表 Query 按型号、描述和数量字段筛选', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(
            fixture.queries.getAllTemplates({ shellModel: 'shell-2' }).map(item => item.id),
            [2]
        );
        assert.deepEqual(
            fixture.queries.getAllTemplates({ description: '泵壳', limit: 1 }).map(item => item.id),
            [1]
        );
        assert.throws(
            () => fixture.queries.getAllTemplates({ limit: '2abc' }),
            /1 到 100/
        );
    } finally {
        fixture.db.close();
    }
});

test('模板多关键词全部匹配且保留完整候选、标点与筛选后 limit', () => {
    const fixture = createFixture();
    try {
        fixture.listedTemplates.push(
            { id: 3, shellModel: 'V750-大脚板-2寸', description: '不锈钢 常用泵壳' },
            { id: 4, shellModel: 'V750-大脚板-3寸', description: '常用不锈钢泵壳' },
            { id: 5, shellModel: 'V750-小脚板-2寸', description: '常用泵壳' }
        );
        const before = JSON.stringify(fixture.listedTemplates);
        const ids = options => fixture.queries.getAllTemplates(options).map(row => row.id);
        assert.deepEqual(ids({ shellModel: ' v750  大脚板 ' }), [3, 4]);
        assert.deepEqual(ids({ shellModel: '大脚板\t2寸', description: '常用 不锈钢' }), [3]);
        assert.deepEqual(ids({ shellModel: '大脚板', limit: 1 }), [3]);
        assert.deepEqual(ids({ shellModel: 'V750-大脚板-2寸' }), [3]);
        assert.deepEqual(ids({ shellModel: 'V750-大脚板-2-寸' }), []);
        assert.deepEqual(ids({ shellModel: 'V750 不存在' }), []);
        assert.deepEqual(ids({ shellModel: '大脚板', description: '不存在' }), []);
        assert.deepEqual(ids({ shellModel: '  ', limit: 1 }), [1]);
        assert.equal(JSON.stringify(fixture.listedTemplates), before);
        assert.equal(fixture.costCalls.length, 0);
    } finally { fixture.db.close(); }
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
            configurationPolicyJson: '{"version":1,"fields":{"cableLength":[5,10]}}',
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
            configurationPolicyJson: undefined,
        });
        assert.deepEqual(result.recipeDraft, {
            name: '客户专用',
            assemblyWage: 9,
            surfaceTreatmentMode: 'powder_coating',
            surfaceTreatmentCost: 8,
            configurationPolicyJson: '{"version":1,"fields":{"cableLength":[5,10]}}',
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

test('模板保存 ID 改名后按同一 ID 读取现名现价，默认与应用草稿保留 ID 且不写快照', () => {
    const fixture = createFixture();
    try {
        const fixed = [{ partId: 7, model: '旧固定件', supplier: '甲', qty: 2 }];
        const components = [{ partId: 8, model: '旧组件', supplier: '甲', name: '机筒', qty: 1, unitCost: 999 }];
        fixture.db.prepare('UPDATE pump_shell_templates SET parts_json=?, shell_components_json=? WHERE id=1').run(JSON.stringify(fixed), JSON.stringify(components));
        fixture.partsByModel['现固定件'] = [{ id: 7, model: '现固定件', supplier: '甲', category: '配件', price: 6 }];
        fixture.partsByModel['现组件'] = [{ id: 9, model: '现组件', supplier: '乙', category: '泵壳搭配', price: 88 }, { id: 8, model: '现组件', supplier: '甲', category: '泵壳搭配', price: 65 }];
        fixture.partsByModel['旧组件'] = [{ id: 10, model: '旧组件', supplier: '甲', category: '泵壳搭配', price: 90 }];
        const before = fixture.db.prepare('SELECT total_changes() n').get().n;
        const cost = fixture.queries.getTemplateCost(1);
        assert.equal(cost.partsCost, 65);
        assert.equal(fixture.costCalls[0].parts[0].partId, 8);
        assert.equal(fixture.costCalls[0].parts[0].model, '现组件');
        assert.equal(fixture.costCalls[0].parts[1].model, '现固定件');
        const actual = require('../api/services/costEngine.cjs').calculateRecipeCost(fixture.costCalls[0].parts, fixture.partsCache, fixture.partsByModel);
        assert.equal(actual.totalCost, '77.00');
        assert.deepEqual(actual.missingParts, []);
        for (const result of [fixture.queries.getDefaultRecipe(1), fixture.queries.applyTemplate(1)]) {
            assert.equal(result.parts[0].model, '现固定件');
            assert.equal(result.parts[0].partId, 7);
            assert.equal(JSON.parse(result.template.partsJson)[0].model, '旧固定件');
        }
        assert.equal(fixture.db.prepare('SELECT total_changes() n').get().n, before);
        assert.equal(JSON.parse(fixture.db.prepare('SELECT parts_json FROM pump_shell_templates WHERE id=1').get().parts_json)[0].model, '旧固定件');
    } finally { fixture.db.close(); }
});

test('模板显式 ID 失效、供应商冲突和组件错分类不回退同名或手工价', () => {
    const fixture = createFixture();
    try {
        const reference = { partId: 8, model: 'BARREL-1', supplier: '甲', name: '机筒', qty: 1, unitCost: 999 };
        fixture.db.prepare('UPDATE pump_shell_templates SET parts_json=?, shell_components_json=? WHERE id=1').run('[]', JSON.stringify([reference]));
        for (const candidate of [null, { id: 8, model: '新名', supplier: '乙', category: '泵壳搭配' }, { id: 8, model: '新名', supplier: '甲', category: '配件' }, { id: 8, model: '新名', supplier: '甲', category: '泵壳搭配', deletedAt: '停用' }]) {
            fixture.partsByModel['新名'] = candidate ? [candidate] : [];
            assert.throws(() => fixture.queries.getTemplateCost(1), error => error.statusCode === 422);
        }
        assert.equal(fixture.costCalls.length, 0);
    } finally { fixture.db.close(); }
});

test('模板损坏物料 JSON 不被成本和草稿查询吞为零项', () => {
    const fixture = createFixture();
    try {
        for (const value of ['{bad', '{}', '[null]', JSON.stringify(Array.from({ length: 1001 }, () => ({})))]) {
            fixture.db.prepare('UPDATE pump_shell_templates SET parts_json=? WHERE id=1').run(value);
            for (const read of [fixture.queries.getTemplateCost, fixture.queries.getDefaultRecipe, fixture.queries.applyTemplate]) {
                assert.throws(() => read(1), error => error.statusCode === 422);
            }
        }
        assert.equal(fixture.costCalls.length, 0);
    } finally { fixture.db.close(); }
});
