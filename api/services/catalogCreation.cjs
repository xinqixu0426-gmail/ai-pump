const { generateCatalogName } = require('./catalogNaming.cjs');
const { physicalSpecification } = require('./catalogPhysicalIdentity.cjs');
const { requestHash, CommandExecutionError } = require('./commandExecution.cjs');

const TYPES = { template: { rule: 'template', key: 'template_id' }, recipe: { rule: 'recipe', key: 'recipe_id' }, modelVariant: { rule: 'model-variant', key: 'model_variant_id' } };

function prepareCatalogCreation(type, row, input) {
    const descriptor = TYPES[type];
    if (!input.naming || input.naming.ruleId !== descriptor.rule) throw new CommandExecutionError('CATALOG_NAMING_REQUIRED', '新建时请填写系列和配置，名称由系统生成', 400);
    const naming = { ruleId: descriptor.rule, spec: { ...input.naming.spec } };
    if (type === 'recipe') {
        const actual = { statorCode: row.coil_spec, sheets: row.coil_sheets, ...(row.custom_barrel_length != null ? { barrelLengthMm: row.custom_barrel_length } : {}) };
        for (const field of ['statorCode', 'sheets', 'barrelLengthMm']) {
            if (naming.spec[field] !== undefined && String(naming.spec[field]).toUpperCase() !== String(actual[field]).toUpperCase()) throw new CommandExecutionError('CATALOG_NAMING_SPEC_MISMATCH', '命名中的定子、片数或机筒长度与保存参数不一致', 422);
            delete naming.spec[field];
        }
        Object.assign(naming.spec, actual);
    }
    const generated = generateCatalogName(naming);
    const externalModel = type === 'recipe' ? String(input.externalModel || input.name || generated.name).trim() : '';
    if (externalModel.length > 180 || /[\u0000-\u001f\u007f]/u.test(externalModel)) throw new CommandExecutionError('CATALOG_EXTERNAL_MODEL_INVALID', '对外型号不能超过180字或包含控制字符', 400);
    return { generated, naming: { ruleId: generated.ruleId, spec: generated.normalizedSpec }, externalModel };
}

function persistCatalogCreation(dependencies, type, row, creation, auditContext) {
    const { db, safeInsert } = dependencies;
    // Lightweight service fixtures may omit identity storage; the application
    // always installs it before exposing command routes.
    if (!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='catalog_identity_profiles'").get()) return [];
    const physical = physicalSpecification(type, row, creation.naming);
    const now = new Date().toISOString();
    const write = safeInsert('catalog_identity_profiles', {
        [TYPES[type].key]: row.id, naming_state: 'structured', rule_id: creation.generated.ruleId,
        rule_version: creation.generated.ruleVersion, spec_json: JSON.stringify({ naming: creation.naming, physical }),
        spec_fingerprint: requestHash(physical), spec_revision: 1, name_revision: 1,
        external_model: creation.externalModel, created_at: now, updated_at: now,
    }, auditContext);
    if (!write.auditId) throw new CommandExecutionError('command_audit_required', '命名身份档案缺少审计，保存已回滚', 500);
    return [write.auditId];
}

module.exports = { prepareCatalogCreation, persistCatalogCreation };
