const { z } = require('zod');
const { physicalSpecification } = require('./catalogPhysicalIdentity.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { RESOURCES, loadCatalogLiveContext, validBindingTarget } = require('./catalogLiveReferences.cjs');
const { readCatalogSource } = require('./catalogSources.cjs');
const { auditCatalogReferences } = require('./catalogReferenceAudit.cjs');
const { generateCatalogName } = require('./catalogNaming.cjs');
const { requestHash, CommandExecutionError, executePersistentCommand } = require('./commandExecution.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { assertExpectedUpdatedAt } = require('./resourceVersion.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const CAPABILITY_ID = requireBusinessCapability('catalog.rename').capabilityId;
const INPUT = z.object({ entityType: z.enum(['part', 'coil', 'template', 'recipe', 'modelVariant']), entityId: z.number().int().positive().safe(),
    naming: z.object({ ruleId: z.string(), spec: z.record(z.unknown()) }).strict(), samePhysicalItem: z.literal(true), expectedUpdatedAt: z.string().min(1) }).strict();
const APPLY = z.object({ confirmationToken: z.string().min(1), idempotencyKey: z.string().min(8).max(200) }).strict();
const fail = (code, message, status = 409) => { throw new CommandExecutionError(code, message, status); };
function inspectRename(db, input) {
    const descriptor = RESOURCES[input.entityType];
    const current = readCatalogSource(db, input.entityType, input.entityId);
    if (!current || current.deleted_at || (input.entityType === 'coil' && current.scheme_status !== 'official')) fail('CATALOG_RENAME_NOT_FOUND', '对象不存在或已停用', 404);
    assertExpectedUpdatedAt(current, input.expectedUpdatedAt, '命名对象');
    const generated = generateCatalogName(input.naming);
    if (generated.entityType !== input.entityType) fail('CATALOG_RENAME_CATEGORY_MISMATCH', '规则与对象分类不一致', 400);
    if (input.entityType === 'part') require('./partNaming.cjs').normalizePartNaming(input.naming, current.category);
    if (input.entityType === 'part' && current.naming_json) {
        const old = JSON.parse(current.naming_json);
        const oldSpec = { ...generateCatalogName({ ruleId: old.ruleId, spec: old.spec }).normalizedSpec }; delete oldSpec.variant;
        const newSpec = { ...generated.normalizedSpec }; delete newSpec.variant;
        if (old.ruleId !== generated.ruleId || requestHash(oldSpec) !== requestHash(newSpec)) fail('CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED', '物料的尺寸、材质等关键规格变化必须新建记录');
    }
    const context = loadCatalogLiveContext(db);
    const profile = context.profiles.find(row => row[descriptor.profile] === input.entityId) || null;
    const physical = physicalSpecification(input.entityType, current, { spec: generated.normalizedSpec });
    if (profile?.naming_state === 'structured') {
        const stored = JSON.parse(profile.spec_json);
        if (stored.physical && requestHash(stored.physical) !== requestHash(physical)) fail('CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED', '实物规格、供应商或业务配置变化需要新建/选择另一物料，不能原地改名');
    }
    const duplicate = context.catalogs.get(input.entityType).find(row => row.id !== current.id && (!row.deleted_at || ['template', 'modelVariant'].includes(input.entityType))
        && String(row[descriptor.name]).trim().toLowerCase() === generated.name.toLowerCase()
        && (input.entityType !== 'part' || String(row.supplier).trim().toLowerCase() === String(current.supplier).trim().toLowerCase()));
    if (duplicate) fail('CATALOG_RENAME_CONFLICT', `新名称已有对象 #${duplicate.id}，请补充真实区别`);
    const report = auditCatalogReferences(db);
    if (!report.complete) fail('CATALOG_RENAME_AUDIT_INCOMPLETE', '引用盘点不完整，不能改名');
    const entries = [];
    for (const ref of report.references) {
        const source = readCatalogSource(db, ref.sourceType, ref.sourceId);
        const binding = validBindingTarget(context, ref.sourceType, source, ref.path, ref.sourceHash);
        const isTarget = binding?.type === input.entityType && binding.id === input.entityId
            || ref.targetType === input.entityType && (Number(ref.targetId) === input.entityId || ref.candidateIds.includes(input.entityId));
        if (!isTarget) continue;
        if (!binding && (!['resolved_id', 'resolved_legacy', 'resolved_binding'].includes(ref.status) || ref.candidateIds.length !== 1)) fail('CATALOG_RENAME_REFERENCE_UNRESOLVED', `引用 ${ref.sourceType}#${ref.sourceId}${ref.path} 尚不能唯一核实`);
        entries.push({ sourceType: ref.sourceType, sourceId: ref.sourceId, path: ref.path, sourceHash: ref.sourceHash });
    }
    // Shell association is independent of the template's generated display name.
    const { findPumpShellPart, matchingPumpShellParts } = require('./pumpShellPartResolver.cjs');
    if (input.entityType === 'part' && current.category === '泵壳') {
        for (const template of context.catalogs.get('template')) {
            const matches = matchingPumpShellParts(context.catalogs.get('part'), template.shell_model);
            if (matches.some(part => part.id === current.id) && matches.length > 1 && !context.shells.some(row => row.template_id === template.id)) fail('CATALOG_SHELL_BINDING_AMBIGUOUS', '模板对应多个供应商泵壳，需先明确实物身份');
        }
    }
    const ownShell = input.entityType === 'template'
        ? context.shells.find(row => row.template_id === current.id)?.shell_part_id || (current.cost_mode === 'bundle' ? require('./pumpShellPartResolver.cjs').resolvePumpShellPart(context.catalogs.get('part'), current.shell_model)?.id : null) : null;
    if (input.entityType === 'template' && current.cost_mode === 'bundle' && !ownShell) fail('CATALOG_SHELL_BINDING_MISSING', '套件模板必须先核实对应泵壳');
    const shellTemplates = input.entityType === 'part' && current.category === '泵壳'
        ? context.catalogs.get('template').filter(template => context.shells.some(row => row.template_id === template.id && row.shell_part_id === current.id)
            || findPumpShellPart(context.catalogs.get('part'), template.shell_model)?.id === current.id).map(template => template.id) : [];
    const labels = { part: '零件默认配置', coil: '线圈', template: '模板', recipe: '配方', modelVariant: '常用配置', quotation: '报价', order: '订单', orderRevision: '订单历史', drawing: '图纸', fileLink: '关联文件' };
    const affected = new Map();
    for (const entry of entries) {
        const key = `${entry.sourceType}:${entry.sourceId}`;
        if (affected.has(key)) { affected.get(key).referenceCount += 1; continue; }
        const source = readCatalogSource(db, entry.sourceType, entry.sourceId);
        const name = source?.[RESOURCES[entry.sourceType]?.name] || source?.contract_no || source?.customer_name || `#${entry.sourceId}`;
        affected.set(key, { entityType: entry.sourceType, entityId: entry.sourceId, label: labels[entry.sourceType], name, referenceCount: 1 });
    }
    return { entityType: input.entityType, entityId: input.entityId, previousName: current[descriptor.name], currentName: generated.name,
        generated, physical, entries, affectedResources: [...affected.values()], shellTemplates, ownShell, sourceHash: requestHash({ current, profile, sources: report.sourceHashes, bindings: context.bindings, shells: context.shells }) };
}
function inspectCatalogRename(db, value) {
    const parsed = INPUT.safeParse(value);
    if (!parsed.success) fail('CATALOG_RENAME_INVALID', '请提供对象、规格、当前版本，并确认这是同一实物', 400);
    return inspectRename(db, parsed.data);
}
function previewCatalogRename(db, value, subject) {
    const parsed = INPUT.safeParse(value);
    if (!parsed.success) fail('CATALOG_RENAME_INVALID', '请提供对象、规格、当前版本，并确认这是同一实物', 400);
    return db.transaction(() => {
        const inspected = inspectRename(db, parsed.data);
        const frozen = { request: parsed.data, inspected };
        const confirmation = issueBusinessConfirmation({ capabilityId: CAPABILITY_ID, input: frozen, subject });
        return { preview: true, ...confirmation, ...inspected, capabilityId: CAPABILITY_ID,
            suggestedIdempotencyKey: `catalog-rename:${confirmation.operationId}`, changes: [{ field: 'name', from: inspected.previousName, to: inspected.currentName }],
            warnings: [{ code: 'SAME_PHYSICAL_ITEM_ONLY', message: '保留原 ID、库存、采购进度和锁定金额；实物变化必须新建物料' }] };
    }).deferred();
}
function executeCatalogRename(dependencies, value, context, subject) {
    const parsed = APPLY.safeParse(value);
    if (!parsed.success || context?.idempotencyKey !== parsed.data.idempotencyKey) fail('CATALOG_RENAME_INVALID', '改名必须提供确认凭证及明确的幂等键', 400);
    const confirmation = consumeBusinessConfirmation({ capabilityId: CAPABILITY_ID, subject, confirmationToken: parsed.data.confirmationToken, idempotencyKey: context.idempotencyKey });
    const { db, safeInsert, safeUpdate } = dependencies;
    return executePersistentCommand({ db, ...context, capabilityId: CAPABILITY_ID, operationId: confirmation.operationId, input: confirmation.input,
        businessChange: standardBusinessChange({ domain: confirmation.input.request.entityType === 'part' ? 'part' : 'settings', eventType: 'updated', reason: '规格直读名称规范化' }),
        execute: ({ auditContext }) => {
            const fresh = inspectRename(db, confirmation.input.request);
            if (requestHash(fresh) !== requestHash(confirmation.input.inspected)) fail('CATALOG_RENAME_PREVIEW_STALE', '目录或引用在预览后变化，请重新预览');
            const descriptor = RESOURCES[fresh.entityType]; const now = new Date().toISOString(); const auditIds = []; const bindingIds = [];
            const insert = (table, fields) => { const write = safeInsert(table, fields, auditContext); auditIds.push(write.auditId); return Number(write.lastInsertRowid); };
            const update = (table, id, fields) => {
                const write = safeUpdate(table, id, fields, auditContext);
                auditIds.push(write.auditId, ...(write.bindingAuditIds || []));
                bindingIds.push(...(write.bindingIds || []));
            };
            const oldProfile = db.prepare(`SELECT * FROM catalog_identity_profiles WHERE ${descriptor.profile} = ?`).get(fresh.entityId);
            const profileFields = { naming_state: 'structured', rule_id: fresh.generated.ruleId, rule_version: fresh.generated.ruleVersion,
                spec_json: JSON.stringify({ naming: { ruleId: fresh.generated.ruleId, spec: fresh.generated.normalizedSpec }, physical: fresh.physical }),
                ...(fresh.entityType === 'recipe' ? { external_model: oldProfile?.external_model || fresh.previousName } : {}),
                spec_fingerprint: requestHash(fresh.physical), name_revision: (oldProfile?.name_revision || 0) + 1 };
            let profileId = oldProfile?.id;
            if (profileId) update('catalog_identity_profiles', profileId, profileFields);
            else profileId = insert('catalog_identity_profiles', { ...profileFields, [descriptor.profile]: fresh.entityId, created_at: now, updated_at: now });
            for (const entry of fresh.entries) {
                if (db.prepare(`SELECT id FROM catalog_reference_bindings WHERE source_type = ? AND source_id = ? AND source_hash = ? AND source_path = ? AND deleted_at IS NULL`).get(entry.sourceType, entry.sourceId, entry.sourceHash, entry.path)) continue;
                bindingIds.push(insert('catalog_reference_bindings', { source_type: entry.sourceType, source_id: entry.sourceId, source_path: entry.path,
                    source_hash: entry.sourceHash, source_version: `sha256:${entry.sourceHash}`, target_profile_id: profileId, target_spec_revision: oldProfile?.spec_revision || 1, created_at: now, updated_at: now }));
            }
            for (const templateId of fresh.shellTemplates) {
                const existing = db.prepare('SELECT * FROM catalog_template_shell_bindings WHERE template_id = ?').get(templateId);
                if (existing && existing.shell_part_id !== fresh.entityId) fail('CATALOG_SHELL_BINDING_CONFLICT', '模板已有其他泵壳身份');
                if (!existing) insert('catalog_template_shell_bindings', { template_id: templateId, shell_part_id: fresh.entityId, created_at: now, updated_at: now });
            }
            if (fresh.ownShell && !db.prepare('SELECT id FROM catalog_template_shell_bindings WHERE template_id = ?').get(fresh.entityId)) insert('catalog_template_shell_bindings', { template_id: fresh.entityId, shell_part_id: fresh.ownShell, created_at: now, updated_at: now });
            const previousSource = readCatalogSource(db, fresh.entityType, fresh.entityId);
            update(descriptor.table, fresh.entityId, { [descriptor.name]: fresh.currentName,
                ...(fresh.entityType === 'part' ? { naming_json: JSON.stringify({ ruleId: fresh.generated.ruleId, ruleVersion: fresh.generated.ruleVersion, spec: fresh.generated.normalizedSpec }) } : {}) });
            const retained = require('./catalogBindingContinuity.cjs').retainCatalogBindings(dependencies, fresh.entityType, previousSource, auditContext);
            auditIds.push(...retained.auditIds);
            bindingIds.push(...retained.bindingIds);
            return { data: { entityType: fresh.entityType, entityId: fresh.entityId, currentName: fresh.currentName, bindingIds },
                resource: { type: fresh.entityType, ids: [fresh.entityId] }, changes: [{ resourceType: fresh.entityType, resourceId: fresh.entityId, field: 'name', from: fresh.previousName, to: fresh.currentName }],
                auditIds, requiredAuditCount: auditIds.length };
        } });
}
module.exports = { CAPABILITY_ID, physicalSpecification, inspectCatalogRename, previewCatalogRename, executeCatalogRename };
