const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-identity-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(dir, 'pump-{pid}.db');
const deps = require('../api/db.cjs');
const { executeTemplateCreate, executeTemplateUpdate, validateTemplatePartReferences } = require('../api/services/templateCommands.cjs');
test.after(() => { deps.stopBackupScheduler(); deps.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const partId = Number(deps.safeInsert('parts', { model: '身份组件', category: '泵壳搭配', supplier: '甲', price: 3, stock: 0 }).lastInsertRowid);
const component = { partId, name: '泵头', model: '身份组件', supplier: '甲', qty: 1, unitCost: 3, included: true };
const input = { naming: { ruleId: 'template', spec: { series: 'V750', configuration: '组合' } }, shellModel: '身份模板', costMode: 'components', partsJson: JSON.stringify([component]), shellComponentsJson: JSON.stringify([component]), assemblyWage: 1, packingWage: 1, surfaceTreatmentCost: 0 };

test('模板正式保存、回读、更新及幂等重放保留固定件和组件 ID', () => {
    const ctx = { actorKey: 'test:template', idempotencyKey: 'template-id-create' };
    const result = executeTemplateCreate(deps, input, ctx);
    const template = result.template;
    assert.equal(JSON.parse(template.partsJson)[0].partId, partId);
    assert.equal(JSON.parse(template.shellComponentsJson)[0].partId, partId);
    assert.equal(executeTemplateCreate(deps, input, ctx).template.id, template.id);
    const updated = executeTemplateUpdate(deps, template.id, { description: '仅改备注', expectedUpdatedAt: template.updatedAt }, { actorKey: 'test:template', idempotencyKey: 'template-id-update' });
    assert.equal(JSON.parse(updated.template.shellComponentsJson)[0].partId, partId);
});

test('模板 ID 冲突和无效引用拒绝且不留下模板、审计或 operation 部分写入', () => {
    const counts = () => ['pump_shell_templates', 'audit_log', 'api_operations'].filter(name => deps.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name)).map(name => deps.db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n);
    for (const patch of [{ model: '错误型号' }, { supplier: '乙' }, { partId: -1 }, { partId: true }, { partId: 999999 }, { partId: 1.5 }]) {
        const before = counts();
        assert.throws(() => executeTemplateCreate(deps, { ...input, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '无效模板' } }, shellModel: '无效模板', partsJson: JSON.stringify([{ ...component, ...patch }]) }, { actorKey: 'test:template', idempotencyKey: `invalid-${require('node:crypto').randomUUID()}` }), error => /BOM_PART_|template_part_/.test(error.code));
        assert.deepEqual(counts(), before);
    }
    deps.safeUpdate('parts', partId, { deleted_at: new Date().toISOString() });
    assert.throws(() => validateTemplatePartReferences(deps.db, '[]', JSON.stringify([{ ...component, included: false }])), /不存在|停用/);
    deps.safeUpdate('parts', partId, { deleted_at: null });
});

test('模板前端编辑和复用序列化保留 ID，旧记录不猜补 ID', () => {
    const ts = require('../apps/web-next/node_modules/typescript');
    const compiled = ts.transpileModule(fs.readFileSync('apps/web-next/components/recipe/pump-shell-template-form.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, () => ({ isBarrelComponentName: () => false, isStainlessStretchBarrelComponent: () => false, isSubassemblyComponent: () => false }));
    const template = { ...input, shellComponentsJson: JSON.stringify([component]), partsJson: JSON.stringify([component, { name: '旧记录', model: '手写型号', qty: 1 }]) };
    for (const form of [exports.templateFormFromTemplate(template), exports.templateFormForReuse(template, [])]) {
        const saved = exports.templateFormToInput(form);
        assert.equal(JSON.parse(saved.partsJson)[0].partId, partId);
        assert.equal(JSON.parse(saved.partsJson)[1].partId, undefined);
        assert.equal(JSON.parse(saved.shellComponentsJson)[0].partId, partId);
    }
});

test('模板更新冲突、组件错分类及写入后故障均整体回滚', () => {
    const saved = executeTemplateCreate(deps, { ...input, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '回滚模板' } }, shellModel: '回滚模板' }, { actorKey: 'test:template', idempotencyKey: 'template-rollback-create' }).template;
    const before = deps.db.prepare('SELECT * FROM pump_shell_templates WHERE id=?').get(saved.id);
    assert.throws(() => executeTemplateUpdate(deps, saved.id, {
        description: '不能保存', expectedUpdatedAt: saved.updatedAt,
        partsJson: JSON.stringify([{ ...component, supplier: '冲突供应商' }]),
    }, { actorKey: 'test:template', idempotencyKey: 'template-rollback-update' }), error => error.code === 'template_part_supplier_mismatch');
    assert.deepEqual(deps.db.prepare('SELECT * FROM pump_shell_templates WHERE id=?').get(saved.id), before);
    const wrongId = Number(deps.safeInsert('parts', { model: '其他分类', category: '配件', supplier: '甲', price: 1 }).lastInsertRowid);
    assert.throws(() => validateTemplatePartReferences(deps.db, '[]', JSON.stringify([{ partId: wrongId, model: '其他分类' }])), error => error.code === 'template_component_category_mismatch');
    const count = deps.db.prepare('SELECT COUNT(*) n FROM pump_shell_templates').get().n;
    assert.throws(() => executeTemplateCreate({ ...deps, safeInsert: (...args) => {
        deps.safeInsert(...args);
        throw new Error('模拟写后故障');
    } }, { ...input, naming: { ruleId: 'template', spec: { series: 'V750', configuration: '写后故障模板' } }, shellModel: '写后故障模板' }, { actorKey: 'test:template', idempotencyKey: 'template-write-failure' }), /模拟写后故障/);
    assert.equal(deps.db.prepare('SELECT COUNT(*) n FROM pump_shell_templates').get().n, count);
});
