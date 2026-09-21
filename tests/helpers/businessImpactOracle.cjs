'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRelationReadService } = require('../../api/services/relationReadService.cjs');
const { createCanonicalRelationQueries } = require('../../api/services/canonicalRelationQueries.cjs');

function sha256File(filename) {
    return crypto.createHash('sha256').update(fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function impact(impactType, targetType, canonicalTargetId, authority, status, reason, evidence, extra = {}) {
    return { impactType, targetType, canonicalTargetId: canonicalTargetId == null ? null : String(canonicalTargetId),
        authority, status, reason, evidence, ...extra };
}

function buildBusinessImpactOracle(fixture, definition) {
    const { db, ids } = fixture;
    const relations = createRelationReadService({ db, canonicalOnly: true });
    const canonical = createCanonicalRelationQueries({ db });
    const recipe = db.prepare('SELECT * FROM recipes WHERE id=?').get(ids['activeRecipe.v550']);
    const orderLine = JSON.parse(db.prepare('SELECT items_json value FROM orders WHERE id=?').get(ids['order.impact']).value)[0];
    const quotationLine = JSON.parse(db.prepare('SELECT items_json value FROM quotations WHERE id=?').get(ids['quotation.impact']).value)[0];
    const affectedRecipes = relations.read({ version: 1, relation: 'part.recipes', rootId: ids['part.bearing'], pageSize: 50 });
    const templateRoot = canonical.getEntity('template', ids['template.v550']);
    const templateRecipes = canonical.readSource({ sourceId: 'recipe_template', direction: 'INVERSE', toType: 'recipe' }, templateRoot,
        { pageSize: 50, afterId: undefined });
    const v550Parts = JSON.parse(recipe.parts_json);
    const bearingLine = v550Parts.find(line => Number(line.partId) === ids['part.bearing']);
    const capacitorLine = v550Parts.find(line => Number(line.partId) === ids['part.capacitor18']);
    const common = { version: 'ImpactResultV1-candidate', unresolved: [] };
    const perCase = {
        'IMP-01': { ...common, trigger: { entityType: 'recipe', canonicalId: String(recipe.id), fact: 'coilId', before: recipe.coil_id, after: ids['officialCoil.12-140-calculated'] }, impacts: [
            impact('CHANGED', 'recipe', recipe.id, 'CANONICAL_DIRECT_IMPACT', 'VERIFIED', '预览中线圈 canonical ID 与当前配方不同', ['recipes.coil_id','coils.id']),
            impact('RECALCULATE', 'recipeCost', recipe.id, 'DETERMINISTIC_DERIVED_IMPACT', 'AVAILABLE', '当前完整配置可交由正式 costEngine 重算', ['costEngine','canonical recipe configuration'])
        ] },
        'IMP-02': { ...common, trigger: { entityType: 'recipe', canonicalId: String(recipe.id), fact: 'coilId', before: recipe.coil_id, after: ids['officialCoil.12-140-calculated'] }, impacts: [
            impact('REVALIDATE', 'technicalFile', ids['technicalFile.v550'], 'UNSUPPORTED_UNKNOWN', 'APPLICABILITY_UNPROVEN', '报告只绑定 recipe_id，没有配置指纹或配方版本', ['recipe_technical_files.recipe_id'], { revalidation: 'BUSINESS_RULE_CANDIDATE' })
        ], unresolved: ['test report configuration fingerprint','recipe revision'] },
        'IMP-03': { ...common, trigger: { entityType: 'recipe', canonicalId: String(recipe.id), fact: 'configuration', before: orderLine.configurationSnapshot, after: { ...orderLine.configurationSnapshot, coilId: ids['officialCoil.12-140-calculated'] } }, impacts: [
            impact('AFFECTED', 'order', ids['order.impact'], 'CANONICAL_DIRECT_IMPACT', 'SAVED_SNAPSHOT_UNCHANGED', '订单 items_json 保存下单时配置快照，当前配方变化不会自动改写', ['orders.items_json.configurationSnapshot'])
        ] },
        'IMP-04': { ...common, trigger: { entityType: 'part', canonicalId: String(ids['part.bearing']), fact: 'price', before: 5, after: 6 }, impacts: affectedRecipes.items.map(item =>
            impact('RECALCULATE', 'recipeCost', item.canonicalId, 'DETERMINISTIC_DERIVED_IMPACT', 'AFFECTED', '配方 canonical BOM 含该零件；当前成本口径需重算', ['part.recipes','costEngine'])) },
        'IMP-05': { ...common, trigger: { entityType: 'part', canonicalId: String(ids['part.bearing']), fact: 'price', before: 5, after: 6 }, impacts: [
            impact('REVIEW', 'quotation', ids['quotation.impact'], 'UNSUPPORTED_UNKNOWN', 'FRESHNESS_UNPROVEN', '报价保存成本/配置快照，但无源配方 revision 及成本口径时间绑定', ['quotations.items_json.costSnapshot'], { snapshotAt: quotationLine.snapshotAt })
        ], unresolved: ['quotation source recipe revision','cost-basis timestamp'] },
        'IMP-06': { ...common, trigger: { entityType: 'part', canonicalId: String(ids['part.bearing']), fact: 'stock', before: 40, after: 0 }, impacts: [
            impact('AFFECTED', 'orderReadiness', ids['order.impact'], 'DETERMINISTIC_DERIVED_IMPACT', bearingLine ? 'SHORTAGE_RECALCULATION_AVAILABLE' : 'UNAVAILABLE', '订单 BOM 快照需要该零件，库存变化会改变正式 readiness 派生结果', ['orders.items_json.partsJson','parts.stock','activeOrderReadiness'])
        ] },
        'IMP-07': { ...common, trigger: { entityType: 'part', canonicalId: String(ids['part.capacitor18']), fact: 'stock', before: 22, after: 0 }, impacts: [
            impact('UNAFFECTED', 'orderReadiness', ids['order.impact'], 'DETERMINISTIC_DERIVED_IMPACT', capacitorLine ? 'AFFECTED' : 'VERIFIED_NO_MEMBERSHIP', '完整订单 BOM 快照不含该零件', ['orders.items_json.partsJson'])
        ] },
        'IMP-08': { ...common, trigger: { entityType: 'template', canonicalId: String(ids['template.v550']), fact: 'configuration', before: 'revision-a', after: 'revision-b' }, impacts: templateRecipes.rows.map(row =>
            impact('AFFECTED', 'recipe', row.id, 'CANONICAL_DIRECT_IMPACT', 'VERIFIED', 'recipes.template_id 直接引用该模板', ['recipes.template_id'])) },
        'IMP-09': { ...common, trigger: { entityType: 'coil', canonicalId: null, fact: 'identity', before: '12-220', after: null }, impacts: [], unresolved: ['MULTIPLE_OFFICIAL_VARIANTS','NEEDS_CLARIFICATION'] },
        'IMP-10': { ...common, trigger: { entityType: 'coil', canonicalId: String(ids['officialCoil.12-140-calculated']), fact: 'temperatureRise', before: null, after: null }, impacts: [
            impact('PREDICT', 'temperatureRise', null, 'ENGINEERING_HYPOTHESIS', 'NOT_CALCULABLE', '当前无该配置变更绑定的仿真或可比测试证据', [], { requiredAction: 'provide configuration-specific engineering evidence' })
        ] },
        'IMP-11': { ...common, trigger: { entityType: 'order', canonicalId: String(ids['order.impact']), fact: 'savedConfiguration', before: orderLine.configurationSnapshot, after: { coilId: recipe.coil_id, recipeUpdatedAt: recipe.updated_at } }, impacts: [
            impact('COMPARE', 'recipeConfiguration', recipe.id, 'DETERMINISTIC_DERIVED_IMPACT', 'COMPARABLE', '订单保存配置快照，当前配方可独立读取并按 canonical IDs 比较', ['orders.items_json.configurationSnapshot','recipes'])
        ] },
        'IMP-12': { ...common, trigger: { entityType: 'part', canonicalId: String(ids['part.bearing']), fact: 'price', before: 5, after: 6 }, impacts: [
            ...affectedRecipes.items.map(item => impact('RECALCULATE', 'recipeCost', item.canonicalId, 'DETERMINISTIC_DERIVED_IMPACT', 'AFFECTED', '零件→配方关系完整可证', ['part.recipes','costEngine'])),
            impact('REVIEW', 'quotation', ids['quotation.impact'], 'UNSUPPORTED_UNKNOWN', 'DOWNSTREAM_LINK_UNPROVEN', '无法把当前零件价格变化与历史报价 revision 确定绑定', ['quotations.items_json']),
            impact('REVIEW', 'order', ids['order.impact'], 'UNSUPPORTED_UNKNOWN', 'DOWNSTREAM_LINK_UNPROVEN', '订单使用保存 BOM/成本快照，当前价格变化不表示订单被改写', ['orders.items_json'])
        ] }
    };
    for (const item of definition.cases) if (!perCase[item.caseKey]) throw new Error(`IMPACT_ORACLE_MISSING:${item.caseKey}`);
    return { version: 'ImpactOracleV1', perCase };
}

function impactDefinitionHashes(casePath, fixturePath, oraclePath) {
    return { caseHash: sha256File(casePath), fixtureHash: sha256File(fixturePath), oracleHash: sha256File(oraclePath) };
}

module.exports = { buildBusinessImpactOracle, impactDefinitionHashes };
