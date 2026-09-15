const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-creation-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(dir, 'pump-{pid}.db');
const deps = require('../api/db.cjs');
const { executeTemplateCreate, executeTemplateUpdate, executeTemplateDelete } = require('../api/services/templateCommands.cjs');
const { executeRecipeCreate } = require('../api/services/recipeCommands.cjs');
const { executeModelVariantCreate } = require('../api/services/modelVariantCommands.cjs');
const { normalizePartCatalogReferences } = require('../api/services/partCatalogReferences.cjs');
const { longScrewPriceByModel } = require('../api/services/costEngine.cjs');
const { executeCoilDelete } = require('../api/services/coilCommands.cjs');
const { assertCoilCanBeDeleted } = require('../api/services/coilInventory.cjs');
const { resolveCatalogReferences } = require('../api/services/catalogReferences.cjs');
const { buildTemplateRotorDraft } = require('../api/services/rotorQueries.cjs');
const { previewCatalogRename, executeCatalogRename } = require('../api/services/catalogRename.cjs');
const { executePartUpdate } = require('../api/services/partCommands.cjs');
test.after(() => { deps.stopBackupScheduler(); deps.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const context = suffix => ({ actorKey: 'test:catalog-creation', idempotencyKey: `creation:${suffix}` });
const insert = (table, row) => Number(deps.safeInsert(table, row).lastInsertRowid);
const shellId = insert('parts', { model: '泵壳源型号', category: '泵壳', price: 10, supplier: '甲', stock: 0 });
const partId = insert('parts', { model: '普通配件', category: '配件', price: 5, supplier: '甲', stock: 0 });
const coilId = insert('coils', { spec: '12', sheets: 140, material: '钢带', slot_type: '小眼', scheme_status: 'official' });
const templateInput = { naming: { ruleId: 'template', spec: { series: 'V750', configuration: '整套' } }, shellModel: '任意输入名', shellPartId: shellId, costMode: 'bundle', bundleCost: 10, partsJson: '[]', shellComponentsJson: '[]', assemblyWage: 1, packingWage: 1 };

test('三类新建统一生成规范名称、身份档案和强审计；模板泵壳身份独立于名称', () => {
    const template = executeTemplateCreate(deps, templateInput, context('template'));
    assert.equal(template.template.shellModel, '模板-V750-整套');
    assert.equal(template.template.shellPartId, shellId);
    assert.equal(template.auditIds.length, 3);
    assert.equal(executeTemplateCreate(deps, templateInput, context('template')).template.id, template.template.id);
    const variant = executeModelVariantCreate(deps, { naming: { ruleId: 'model-variant', spec: { series: 'V750', configuration: '普通' } }, modelName: '任意名称', templateId: template.template.id }, context('variant'));
    assert.equal(variant.variant.modelName, '配置-V750-普通');
    const recipe = executeRecipeCreate(deps, { naming: { ruleId: 'recipe', spec: { series: 'V750', configuration: '普通' } }, name: '原厂750', externalModel: '原厂-QDX750', coilSpec: '12', coilSheets: 140, coilId, customBarrelLength: 180, partsJson: JSON.stringify([{ partId, model: '普通配件', supplier: '甲', qty: 1, snapshotPrice: 5 }]) }, { ...context('recipe'), capabilityId: 'recipes.create' });
    assert.equal(recipe.recipe.name, '水泵-V750-12-140片-筒180mm-普通');
    assert.equal(recipe.recipe.externalModel, '原厂-QDX750');
    assert.equal(deps.db.prepare("SELECT COUNT(*) n FROM catalog_identity_profiles WHERE naming_state='structured'").get().n, 3);
    assert.throws(() => executeTemplateUpdate(deps, template.template.id, { shellModel: '绕过改名', expectedUpdatedAt: template.template.updatedAt }, context('rename-bypass')), error => error.code === 'CATALOG_RENAME_COMMAND_REQUIRED');
});

test('缺命名、错误规则、虚构机筒规格与身份档案写入失败均不留下部分记录', () => {
    const counts = () => ['pump_shell_templates', 'catalog_identity_profiles', 'catalog_template_shell_bindings', 'api_operations', 'audit_log'].map(table => deps.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
    const before = counts();
    assert.throws(() => executeTemplateCreate(deps, { ...templateInput, naming: undefined }, context('missing')), error => error.code === 'CATALOG_NAMING_REQUIRED');
    assert.throws(() => executeRecipeCreate(deps, { naming: { ruleId: 'recipe', spec: { series: 'V750', configuration: '普通', barrelLengthMm: 180 } }, coilSpec: '12', coilSheets: 140, partsJson: '[]' }, context('wrong-length')), error => error.code === 'CATALOG_NAMING_SPEC_MISMATCH');
    assert.throws(() => executeModelVariantCreate(deps, { naming: templateInput.naming }, context('wrong-rule')), error => error.code === 'CATALOG_NAMING_REQUIRED');
    assert.throws(() => executeTemplateCreate({ ...deps, safeInsert: (table, ...args) => { if (table === 'catalog_identity_profiles') throw new Error('档案写入故障'); return deps.safeInsert(table, ...args); } }, { ...templateInput, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '回滚' } } }, context('rollback')), /档案写入故障/);
    assert.deepEqual(counts(), before);
    for (const table of ['catalog_identity_profiles', 'catalog_template_shell_bindings']) {
        const brokenDeps = { ...deps, safeInsert: (target, ...args) => {
            const write = deps.safeInsert(target, ...args);
            return target === table ? { ...write, auditId: undefined } : write;
        } };
        assert.throws(() => executeTemplateCreate(brokenDeps, { ...templateInput, naming: { ruleId: 'template', spec: { series: 'V750', configuration: `缺审计${table}` } } }, context(`audit:${table}`)), error => error.code === 'command_audit_required');
        assert.deepEqual(counts(), before);
    }
});

test('默认轴承按具体ID存储，歧义/停用/类别及型号冲突拒绝', () => {
    const first = insert('parts', { model: '轴承-202', category: '轴承', supplier: '甲' });
    assert.equal(JSON.parse(normalizePartCatalogReferences(deps.db, '{"defaultUpperBearing":"6202"}')).defaultUpperBearingPartId, first);
    insert('parts', { model: '轴承-202', category: '轴承', supplier: '乙' });
    assert.throws(() => normalizePartCatalogReferences(deps.db, '{"defaultUpperBearing":"202"}'), error => error.code === 'DEFAULT_PART_AMBIGUOUS');
    const selected = JSON.parse(normalizePartCatalogReferences(deps.db, JSON.stringify({ defaultUpperBearingPartId: first, defaultUpperBearing: '202' })));
    assert.equal(selected.defaultUpperBearing, '轴承-202');
    assert.throws(() => normalizePartCatalogReferences(deps.db, JSON.stringify({ defaultUpperBearingPartId: first, defaultUpperBearing: '203' })), error => error.code === 'DEFAULT_PART_SPEC_MISMATCH');
    deps.safeUpdate('parts', first, { deleted_at: new Date().toISOString() });
    assert.throws(() => normalizePartCatalogReferences(deps.db, JSON.stringify({ defaultUpperBearingPartId: first })), error => error.code === 'DEFAULT_PART_NOT_FOUND');
    assert.throws(() => normalizePartCatalogReferences(deps.db, JSON.stringify({ defaultUpperBearingPartId: partId })), error => error.code === 'DEFAULT_PART_NOT_FOUND');
});

test('长螺丝明确基础ID后不随名称/同供应商多候选漂移；无效来源不得回退公式', () => {
    const catalog = [{ id: 1, model: '4*180-201-内六', category: '螺丝', supplier: '甲', notes: '{"screwPricing":{"enabled":true,"diameter":4}}' }, { id: 2, model: '4*200-201-内六', category: '螺丝', supplier: '甲', notes: '{"screwPricing":{"enabled":true,"diameter":4}}' }];
    assert.throws(() => longScrewPriceByModel(catalog, '4*220-201-内六', '甲'), error => error.code === 'SCREW_PRICING_AMBIGUOUS');
    assert.equal(longScrewPriceByModel(catalog, '4*220-201-内六', '甲', 1).pricingPartId, 1);
    catalog[0].model = '内六角螺丝-4*180-201';
    assert.equal(longScrewPriceByModel(catalog, '4*220-201-内六', '甲', 1).pricingPartModel, catalog[0].model);
    catalog[0].deletedAt = new Date().toISOString();
    assert.throws(() => longScrewPriceByModel(catalog, '4*220-201-内六', '甲', 1), error => error.code === 'SCREW_PRICING_ID_UNAVAILABLE');
});

test('规范模板与线圈停用保留身份档案，读取报告停用且禁止新业务引用', () => {
    const template = executeTemplateCreate(deps, { ...templateInput, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '停用验收' } } }, context('delete-template-create')).template;
    const result = executeTemplateDelete(deps, template.id, { expectedUpdatedAt: template.updatedAt }, context('delete-template'));
    assert.equal(result.deleted, 1);
    assert.ok(deps.db.prepare('SELECT deleted_at FROM pump_shell_templates WHERE id=?').get(template.id).deleted_at);
    assert.ok(deps.db.prepare('SELECT id FROM catalog_identity_profiles WHERE template_id=?').get(template.id));
    assert.ok(deps.db.prepare('SELECT id FROM catalog_template_shell_bindings WHERE template_id=?').get(template.id));
    assert.equal(deps.dbGetAllTemplates().some(row => row.id === template.id), false);
    assert.throws(() => executeTemplateCreate(deps, { ...templateInput, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '停用验收' } } }, context('reuse-deleted-template-name')), error => error.code === 'template_shell_model_conflict');
    assert.equal(resolveCatalogReferences(deps.db, { references: [{ entityType: 'template', entityId: template.id }] }).items[0].referenceStatus, 'inactive');
    assert.throws(() => buildTemplateRotorDraft(deps.db, template.id), error => error.code === 'template_not_found');
    assert.throws(() => executeModelVariantCreate(deps, { naming: { ruleId: 'model-variant', spec: { series: 'V750', configuration: '停用模板' } }, templateId: template.id }, context('inactive-template')), error => error.code === 'model_variant_template_not_found');
    const id = insert('coils', { spec: '55', sheets: 100, material: '钢带', slot_type: '小眼', scheme_status: 'official', scheme_name: '停用测试线圈', scheme_family_code: 'QA55', scheme_code: 'QA55-100' });
    insert('catalog_identity_profiles', { coil_id: id, naming_state: 'legacy', created_at: 'now', updated_at: 'now' });
    executeCoilDelete({ ...deps, assertCoilCanBeDeleted }, id, {}, context('delete-coil'));
    assert.equal(deps.db.prepare('SELECT scheme_status FROM coils WHERE id=?').get(id).scheme_status, 'disabled');
    assert.ok(deps.db.prepare('SELECT id FROM catalog_identity_profiles WHERE coil_id=?').get(id));
    assert.equal(resolveCatalogReferences(deps.db, { references: [{ entityType: 'coil', entityId: id }] }).items[0].referenceStatus, 'inactive');
    assert.deepEqual(deps.db.pragma('foreign_key_check'), []);
});

test('默认轴承改名后泵壳仍可正常保存价格和现名备注；切换物料ID必须新建', () => {
    const bearing = insert('parts', { model: '6277', category: '轴承', supplier: '甲', updated_at: new Date().toISOString() });
    const shell = insert('parts', { model: '命名验收壳', category: '泵壳', supplier: '甲', remark: JSON.stringify({ defaultUpperBearingPartId: bearing, defaultUpperBearing: '6277' }), updated_at: new Date().toISOString() });
    const rename = (id, naming, key) => {
        const subject = 'test:catalog-creation';
        const preview = previewCatalogRename(deps.db, { entityType: 'part', entityId: id, naming, samePhysicalItem: true, expectedUpdatedAt: deps.db.prepare('SELECT updated_at FROM parts WHERE id=?').get(id).updated_at }, subject);
        return executeCatalogRename(deps, { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey }, { ...context(key), idempotencyKey: preview.suggestedIdempotencyKey }, subject);
    };
    rename(shell, { ruleId: 'shell', spec: { series: 'QA', specification: '2寸' } }, 'shell-profile');
    rename(bearing, { ruleId: 'bearing', spec: { code: '6277' } }, 'bearing-name');
    const row = deps.dbGetAllParts().find(part => part.id === shell);
    const remark = row.notes;
    assert.equal(JSON.parse(remark).defaultUpperBearing, '轴承-277');
    const updated = executePartUpdate(deps, shell, { price: 123, notes: remark, expectedUpdatedAt: row.updatedAt }, context('shell-price'));
    assert.equal(updated.part.price, 123);
    const other = insert('parts', { model: '轴承-277', category: '轴承', supplier: '乙' });
    assert.throws(() => executePartUpdate(deps, shell, { notes: JSON.stringify({ defaultUpperBearingPartId: other, defaultUpperBearing: '轴承-277' }) }, context('shell-replace')), error => error.code === 'CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED');
});
