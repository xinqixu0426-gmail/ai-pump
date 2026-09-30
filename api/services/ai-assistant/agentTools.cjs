'use strict';

const { executeToolCall } = require('../../routes/ai/executor.cjs');
const { prepareProtectedPartStockProposal } = require('./protectedPartStock.cjs');
const { resolveAgentEntity, resolvePageContextEntity } = require('../../ontology/agentResolver.cjs');
const {
    RESOLVE_ENTITY_TOOL,
    executeBrokeredCapability,
} = require('./capabilityBroker.cjs');

class AgentToolError extends Error {
    constructor(code, message) { super(message); this.name = 'AgentToolError'; this.code = code; }
}

function tool(name, description, properties, required = []) {
    return Object.freeze({ type: 'function', function: Object.freeze({ name, description,
        parameters: Object.freeze({ type: 'object', additionalProperties: false, properties, required }),
    }) });
}

const AGENT_TOOLS = Object.freeze([
    tool('find_recipe', '按用户给出的型号查询正式配方候选。仅返回正式配方身份；多个候选不会替用户选择。', { keyword: { type: 'string', minLength: 1, maxLength: 80 } }, ['keyword']),
    tool('list_recipes', '列出正式配方目录的有界身份列表。', {}),
    tool('recipe_current_cost', '读取一个已由本轮正式配方身份结果确认的当前成本。', { recipeId: { type: 'integer', minimum: 1 } }, ['recipeId']),
    tool('compare_recipe_costs', '比较两个已由本轮正式配方身份结果确认的当前成本。', {
        leftRecipeId: { type: 'integer', minimum: 1 }, rightRecipeId: { type: 'integer', minimum: 1 },
    }, ['leftRecipeId', 'rightRecipeId']),
    tool('find_coils', '按规格、片数或方案编码查询正式线圈候选。多个方案会保持分开，不会默认选择。', {
        spec: { type: 'string', minLength: 1, maxLength: 40 }, sheets: { type: 'integer', minimum: 1 }, schemeCode: { type: 'string', minLength: 1, maxLength: 80 },
    }, ['spec']),
    tool('coil_inventory', '读取一个已由本轮 find_coils 唯一确认的正式线圈方案库存。', { coilId: { type: 'integer', minimum: 1 } }, ['coilId']),
    tool('coil_cost', '读取一个已由本轮 find_coils 唯一确认的正式线圈方案成本。', { coilId: { type: 'integer', minimum: 1 } }, ['coilId']),
    tool('find_part', '按用户给出的完整型号查询正式零件候选。多个候选不会替用户选择。', { keyword: { type: 'string', minLength: 1, maxLength: 120 } }, ['keyword']),
    tool('part_inventory', '读取一个已由本轮 find_part 唯一确认的正式零件当前库存。', { partRef: { type: 'string', minLength: 1, maxLength: 40 } }, ['partRef']),
    tool('preview_part_stock_change', '按已确认零件的当前正式库存，预览一个不保存的库存增减结果。', { partRef: { type: 'string', minLength: 1, maxLength: 40 }, delta: { type: 'integer', minimum: -1000000, maximum: 1000000 } }, ['partRef', 'delta']),
    tool('preview_profitability', '对已确认配方按售价执行正式毛利试算；未提供配置覆盖时使用当前正式配置。只读，不保存。', {
        recipeId: { type: 'integer', minimum: 1 }, cableLength: { type: 'number', minimum: 0 }, unitPrice: { type: 'number', minimum: 0 },
    }, ['recipeId', 'unitPrice']),
    tool('preview_virtual_readiness', '按当前库存和活动订单占用，预览已确认配方生产指定数量时的齐料和缺料。只读。', {
        recipeId: { type: 'integer', minimum: 1 }, quantity: { type: 'integer', minimum: 1, maximum: 100000 },
    }, ['recipeId', 'quantity']),
]);
const PROTECTED_PROPOSAL_TOOLS = Object.freeze([
    RESOLVE_ENTITY_TOOL,
    tool('prepare_part_stock_adjustment', '为本轮唯一确认的正式零件准备库存增减的受保护预览。不会执行写入；Owner 必须在模型之外确认。partId 必须来自本轮 resolve_entity 的唯一正式结果。', { partId: { type: 'integer', minimum: 1 }, delta: { type: 'integer', minimum: -1000000, maximum: 1000000 } }, ['partId', 'delta']),
]);

function strictObject(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', `${label} 参数必须是对象`);
    if (Object.keys(value).some(key => !fields.includes(key))) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', `${label} 包含未声明字段`);
}
function requiredText(value, field, max = 80) {
    const text = String(value || '').trim();
    if (!text || text.length > max) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', `${field} 无效`);
    return text;
}
function boundId(value, field, ids) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || !ids.has(id)) throw new AgentToolError('AGENT_TOOL_IDENTITY_UNVERIFIED', `${field} 必须来自本轮唯一正式身份结果`);
    return id;
}
function boundPart(value, field, bindings) {
    const partRef = requiredText(value, field, 40);
    const part = bindings.get(partRef);
    if (!part) throw new AgentToolError('AGENT_TOOL_IDENTITY_UNVERIFIED', `${field} 必须来自本轮唯一正式身份结果`);
    return part;
}
function safeProjection(agentToolName, result, data) {
    if (result?.success !== false) return { success: true, agentToolName, verified: result?.executionEvidence?.verified === true, data };
    return { success: false, agentToolName, verified: false, data: null, code: 'FORMAL_TOOL_FAILED', message: '正式业务工具暂不可用，无法完成本次查询。' };
}
function rawRecipes(result) {
    return (Array.isArray(result?.data) ? result.data : []).flatMap(recipe => {
        const id = Number(recipe?.id ?? recipe?.Id); const name = String(recipe?.name || '').trim();
        return Number.isSafeInteger(id) && id > 0 && name ? [{ id, name }] : [];
    });
}
function recipeProjection(recipes, limit = 50) { return recipes.slice(0, limit).map(recipe => ({ id: recipe.id, name: recipe.name })); }
function rawCoils(result) {
    return (Array.isArray(result?.data) ? result.data : []).flatMap(coil => {
        const id = Number(coil?.id ?? coil?.Id); const spec = String(coil?.spec || '').trim(); const sheets = Number(coil?.sheets);
        if (!Number.isSafeInteger(id) || id <= 0 || !spec || !Number.isFinite(sheets)) return [];
        return [{ id, spec, sheets, schemeCode: String(coil?.schemeCode || '').trim() || null, schemeName: String(coil?.schemeName || '').trim() || null,
            material: String(coil?.material || '').trim() || null, slotType: String(coil?.slotType || '').trim() || null }];
    });
}
function rawParts(result) {
    return (Array.isArray(result?.parts) ? result.parts : Array.isArray(result?.data) ? result.data : []).flatMap(part => {
        const id = Number(part?.id ?? part?.Id); const model = String(part?.model || '').trim();
        return Number.isSafeInteger(id) && id > 0 && model ? [{ id, model, category: String(part.category || '').trim() || null, supplier: String(part.supplier || '').trim() || null, stock: Number.isFinite(Number(part.stock)) ? Number(part.stock) : null }] : [];
    });
}
function coilProjection(coils) { return coils.slice(0, 30).map(coil => ({ id: coil.id, commonDesignation: `${coil.spec}-${coil.sheets}`, schemeCode: coil.schemeCode, schemeName: coil.schemeName, material: coil.material, slotType: coil.slotType })); }
function recipeCostProjection(data) {
    if (!data || typeof data !== 'object') return null;
    return { recipeId: data.recipeId ?? null, recipeName: data.recipeName || null, unitCost: data.currentTotalCost ?? data.unitCost ?? null, currency: 'CNY', costBasis: data.costBasis || null, costComplete: data.costComplete === true };
}
function recipeComparisonProjection(result) {
    const left = result?.recipe1 || {}; const right = result?.recipe2 || {};
    return { left: { name: left.name || null, unitCost: left.cost ?? null }, right: { name: right.name || null, unitCost: right.cost ?? null }, costDifference: result?.costDiff ?? null, currency: 'CNY', costBasis: result?.costBasis || null };
}
function coilCostProjection(data) {
    if (!data || typeof data !== 'object') return null;
    return { coilId: data.coilId ?? null, commonDesignation: data.spec && data.sheets ? `${data.spec}-${data.sheets}` : null, schemeCode: data.schemeCode || null, schemeName: data.schemeName || null, unitCost: data.totalCost ?? null, currency: 'CNY' };
}
function coilInventoryProjection(raw, coilId) {
    const coil = (Array.isArray(raw?.data) ? raw.data : []).find(item => Number(item?.id ?? item?.Id) === coilId);
    if (!coil) return [];
    return [{ coilId, commonDesignation: `${coil.spec}-${coil.sheets}`, schemeCode: coil.schemeCode || null, schemeName: coil.schemeName || null, quantity: coil.stock ?? null, inventoryBasis: '当前在库' }];
}
function profitabilityProjection(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return { costComplete: data.costComplete === true, currency: data.currency || null, costBasis: data.costBasis || null, scenarioKey: data.scenarioKey || null, unitPrice: data.unitPrice ?? null, unitCost: data.unitCost ?? null, grossProfitPerUnit: data.grossProfitPerUnit ?? null, grossMarginOnSales: data.grossMarginOnSales ?? null, markupOnCost: data.markupOnCost ?? null };
}
function readinessProjection(data) {
    if (!data || typeof data !== 'object') return null;
    return { recipeName: data.recipe?.displayName || null, quantity: data.quantity ?? null, status: data.status || null, inventoryBasis: data.inventoryBasis || '扣除活动订单占用后的虚拟齐料', shortageItems: (Array.isArray(data.shortages) ? data.shortages : []).slice(0, 30).map(item => ({ model: item.model || null, supplier: item.supplier || null, requiredQuantity: item.virtualRequiredQty ?? null, availableQuantity: item.availableForVirtualQty ?? null, shortageQuantity: item.shortageQty ?? null, unit: item.inventoryUnit || null })) };
}
function formalProfitabilityArgs({ recipeId, cableLength, unitPrice }) {
    const hasOverride = cableLength !== undefined && cableLength !== null;
    const scenarioKey = hasOverride ? 'candidate' : 'current';
    return {
        version: 1,
        basisRef: {
            kind: 'SCENARIO_COMPARISON',
            recipeId,
            comparisonInput: {
                version: 1,
                baselinePolicy: 'CURRENT_REBUILT',
                scenarios: hasOverride
                    ? [{ scenarioKey, label: '临时方案', overrides: { cableLength } }]
                    : [{ scenarioKey, label: '当前正式配置', overrides: {} }],
            },
            scenarioKey,
        },
        unitPrice,
        quantity: null,
        currency: 'CNY',
    };
}
function normalizePartIdentity(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase()
        .replace(/[‐‑‒–—−]/g, '-').replace(/[×x＊*]/g, '*').replace(/\s+/g, '').trim();
}
function partRefFor(part, bindings) {
    for (const [partRef, bound] of bindings.entries()) if (bound.id === part.id) return partRef;
    const partRef = `part_${bindings.size + 1}`;
    bindings.set(partRef, part);
    return partRef;
}
function partProjection(parts, bindings, boundPartId = null) {
    return parts.slice(0, 20).map(part => ({
        ...(part.id === boundPartId ? { partRef: partRefFor(part, bindings) } : {}),
        model: part.model, category: part.category, supplier: part.supplier, stock: part.stock,
    }));
}
function partInventoryProjection(part) { return part ? { model: part.model, quantity: part.stock, inventoryBasis: '当前在库' } : null; }
function formalReadinessArgs(recipeId, quantity) {
    return { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] }, scenarioKey: 'base' }, quantity };
}
function bindingMap(context, field) { return context[field] instanceof Map ? context[field] : new Map(); }

function bindOntologyResolution(resolution, context, recipeIds, recipeBindings, coilBindings, partBindings) {
    if (resolution.status !== 'RESOLVED') return;
    const bindings = context.entityBindings instanceof Map ? context.entityBindings : new Map();
    bindings.set(`${resolution.entityType}:${Number(resolution.canonicalId)}`, resolution);
    context.entityBindings = bindings;
    if (resolution.entityType === 'recipe') {
        recipeIds.add(Number(resolution.canonicalId));
        recipeBindings.set(Number(resolution.canonicalId), { id: Number(resolution.canonicalId), name: resolution.canonicalName });
    }
    if (resolution.entityType === 'coil') {
        const attributes = resolution.identityAttributes || {};
        coilBindings.set(Number(resolution.canonicalId), {
            id: Number(resolution.canonicalId), spec: attributes.spec, sheets: attributes.sheets,
            schemeCode: attributes.schemeCode, schemeName: resolution.canonicalName,
            material: attributes.material, slotType: attributes.slotType,
        });
    }
    if (resolution.entityType === 'part') {
        partBindings.set(`ontology_part_${Number(resolution.canonicalId)}`, {
            id: Number(resolution.canonicalId), model: resolution.canonicalName, stock: null,
        });
    }
}

async function executeAgentTool(name, args, context = {}, dependencies = {}) {
    const runFormalTool = dependencies.executeToolCall || executeToolCall;
    const recipeIds = context.resolvedRecipeIds instanceof Set ? context.resolvedRecipeIds : new Set();
    const recipeBindings = bindingMap(context, 'resolvedRecipeBindings');
    const coilBindings = bindingMap(context, 'resolvedCoilBindings');
    const partBindings = bindingMap(context, 'resolvedPartBindings');
    const formal = (toolName, toolArgs) => runFormalTool(toolName, toolArgs, { allowWrite: false, signal: context.signal });

    if (name === 'resolve_entity') {
        strictObject(args, ['entityType', 'mention'], name);
        const resolver = dependencies.resolveAgentEntity || resolveAgentEntity;
        const resolution = await resolver({ entityType: args.entityType, mention: args.mention, signal: context.signal }, {
            internalFetch: dependencies.internalFetch,
            lookupEntities: dependencies.lookupEntities,
        });
        bindOntologyResolution(resolution, context, recipeIds, recipeBindings, coilBindings, partBindings);
        return { success: resolution.status === 'RESOLVED', agentToolName: name,
            verified: resolution.verified === true, data: resolution,
            ...(resolution.status === 'RESOLVED' ? {} : { code: `ENTITY_${resolution.status}`, message: '正式实体未能唯一确认。' }) };
    }

    if (name === 'resolve_page_context_entity') {
        strictObject(args, ['entityType'], name);
        const resolver = dependencies.resolvePageContextEntity || resolvePageContextEntity;
        const resolution = await resolver({ entityType: args.entityType, pageContext: context.pageContext, signal: context.signal }, {
            executeToolCall: runFormalTool,
        });
        bindOntologyResolution(resolution, context, recipeIds, recipeBindings, coilBindings, partBindings);
        return { success: resolution.status === 'RESOLVED', agentToolName: name,
            verified: resolution.verified === true, data: resolution,
            ...(resolution.status === 'RESOLVED' ? {} : { code: `ENTITY_${resolution.status}`, message: '页面候选未能通过正式身份验证。' }) };
    }

    if (context.selectedToolNames instanceof Set && context.selectedToolNames.has(name)
        && !['preview_profitability', 'preview_virtual_readiness'].includes(name)) {
        return executeBrokeredCapability(name, args, context, { executeToolCall: runFormalTool });
    }

    if (name === 'find_recipe' || name === 'list_recipes') {
        strictObject(args, name === 'find_recipe' ? ['keyword'] : [], name);
        const keyword = name === 'find_recipe' ? requiredText(args.keyword, 'find_recipe.keyword') : '';
        const result = await formal('get_all_recipes', keyword ? { keyword } : {}); const recipes = rawRecipes(result);
        if (result?.success !== false && recipes.length === 1) { recipeIds.add(recipes[0].id); recipeBindings.set(recipes[0].id, recipes[0]); }
        return safeProjection(name, result, recipeProjection(recipes));
    }
    if (name === 'find_part') {
        strictObject(args, ['keyword'], name); const keyword = requiredText(args.keyword, 'find_part.keyword', 120);
        let result = await formal('search_parts', { keyword }); let parts = rawParts(result);
        const normalizedKeyword = normalizePartIdentity(keyword);
        let exact = parts.filter(part => normalizePartIdentity(part.model) === normalizedKeyword);
        if (result?.success !== false && exact.length !== 1) {
            const catalogue = await formal('search_parts', {}); const candidates = rawParts(catalogue);
            const normalized = candidates.filter(part => normalizePartIdentity(part.model) === normalizedKeyword);
            if (normalized.length) { result = catalogue; parts = normalized; exact = normalized; }
        }
        return safeProjection(name, result, partProjection(parts, partBindings, result?.success !== false && exact.length === 1 ? exact[0].id : null));
    }
    if (name === 'prepare_part_stock_adjustment') {
        const fields = Object.keys(args || {});
        const usesCanonicalId = fields.includes('partId');
        strictObject(args, usesCanonicalId ? ['partId', 'delta'] : ['partRef', 'delta'], name);
        const part = usesCanonicalId
            ? (() => {
                const bindings = context.entityBindings instanceof Map ? context.entityBindings : new Map();
                const id = Number(args.partId); const entity = bindings.get(`part:${id}`);
                if (!Number.isSafeInteger(id) || id <= 0 || !entity?.verified || !entity.canonicalName) {
                    throw new AgentToolError('AGENT_TOOL_IDENTITY_UNVERIFIED', 'partId 必须来自本轮唯一正式 Ontology 身份结果');
                }
                return { id, model: entity.canonicalName };
            })()
            : boundPart(args.partRef, 'partRef', partBindings);
        const prepared = await prepareProtectedPartStockProposal({ part, delta: args.delta, confirmationSubject: context.confirmationSubject, signal: context.signal }, { executeToolCall: runFormalTool, writeAllowed: context.writeAllowed });
        if (typeof context.setProtectedProposal === 'function') context.setProtectedProposal(prepared);
        return { success: true, agentToolName: name, verified: true, data: { model: prepared.proposal.part.model, currentStock: prepared.proposal.currentStock, delta: prepared.proposal.delta, nextStock: prepared.proposal.nextStock, clampedToZero: prepared.proposal.clampedToZero, confirmationRequired: true } };
    }
    if (name === 'part_inventory' || name === 'preview_part_stock_change') {
        strictObject(args, name === 'part_inventory' ? ['partRef'] : ['partRef', 'delta'], name);
        const part = boundPart(args.partRef, 'partRef', partBindings);
        if (!part || !Number.isFinite(part.stock)) return { success: false, agentToolName: name, verified: false, data: null, code: 'FORMAL_TOOL_FAILED', message: '正式零件库存暂不可用。' };
        if (name === 'part_inventory') return { success: true, agentToolName: name, verified: true, data: partInventoryProjection(part) };
        const delta = Number(args.delta); if (!Number.isSafeInteger(delta)) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', '库存调整量必须是整数');
        return { success: true, agentToolName: name, verified: true, data: { model: part.model, currentStock: part.stock, delta, nextStock: Math.max(0, part.stock + delta), clampedToZero: part.stock + delta < 0, preview: true } };
    }
    if (name === 'recipe_current_cost') {
        strictObject(args, ['recipeId'], name); const recipeId = boundId(args.recipeId, 'recipeId', recipeIds);
        const result = await formal('preview_recipe_cost', { recipeId }); return safeProjection(name, result, recipeCostProjection(result?.data));
    }
    if (name === 'compare_recipe_costs') {
        strictObject(args, ['leftRecipeId', 'rightRecipeId'], name); const leftRecipeId = boundId(args.leftRecipeId, 'leftRecipeId', recipeIds); const rightRecipeId = boundId(args.rightRecipeId, 'rightRecipeId', recipeIds);
        if (leftRecipeId === rightRecipeId) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', '需要两个不同的正式配方');
        const result = await formal('compare_recipes', { recipe1: String(leftRecipeId), recipe2: String(rightRecipeId) }); return safeProjection(name, result, recipeComparisonProjection(result));
    }
    if (name === 'find_coils') {
        strictObject(args, ['spec', 'sheets', 'schemeCode'], name); const formalArgs = { spec: requiredText(args.spec, 'find_coils.spec', 40) };
        if (args.sheets !== undefined) { const sheets = Number(args.sheets); if (!Number.isSafeInteger(sheets) || sheets <= 0) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', 'find_coils.sheets 无效'); formalArgs.sheets = sheets; }
        if (args.schemeCode !== undefined) formalArgs.schemeCode = requiredText(args.schemeCode, 'find_coils.schemeCode');
        const result = await formal('search_coils', formalArgs); const coils = rawCoils(result);
        const ambiguousCoilKeys = context.ambiguousCoilKeys instanceof Set ? context.ambiguousCoilKeys : new Set();
        const coilKey = coils[0] ? `${coils[0].spec}-${coils[0].sheets}` : null;
        let broadCandidates = coils;
        if (result?.success !== false && coils.length === 1 && formalArgs.schemeCode) {
            const broad = await formal('search_coils', { spec: coils[0].spec, sheets: coils[0].sheets });
            if (broad?.success !== false) broadCandidates = rawCoils(broad);
        }
        if (result?.success !== false && broadCandidates.length > 1 && coilKey) ambiguousCoilKeys.add(coilKey);
        const userText = String(context.userMessage || '').normalize('NFKC').toLocaleLowerCase();
        const selectionGroundedInUser = coils.length === 1 && [coils[0].schemeCode, coils[0].schemeName, coils[0].material, coils[0].slotType]
            .filter(Boolean).some(value => userText.includes(String(value).normalize('NFKC').toLocaleLowerCase()));
        if (result?.success !== false && coils.length === 1 && coilKey && (!ambiguousCoilKeys.has(coilKey) || selectionGroundedInUser)) coilBindings.set(coils[0].id, coils[0]);
        return safeProjection(name, result, coilProjection(coils));
    }
    if (name === 'coil_inventory' || name === 'coil_cost') {
        strictObject(args, ['coilId'], name); const coilId = boundId(args.coilId, 'coilId', new Set(coilBindings.keys())); const coil = coilBindings.get(coilId);
        if (!coil) throw new AgentToolError('AGENT_TOOL_IDENTITY_UNVERIFIED', 'coilId 缺少本轮正式线圈绑定');
        if (name === 'coil_inventory') {
            const formalArgs = coil.schemeCode ? { spec: coil.spec, sheets: coil.sheets, schemeCode: coil.schemeCode } : { spec: coil.spec, sheets: coil.sheets };
            const result = await formal('search_coils', formalArgs); return safeProjection(name, result, coilInventoryProjection(result, coilId));
        }
        const result = await formal('calculate_coil_cost', { coilId, spec: coil.spec, sheets: coil.sheets, ...(coil.schemeCode ? { schemeCode: coil.schemeCode } : {}) });
        return safeProjection(name, result, coilCostProjection(result?.data));
    }
    if (name === 'preview_profitability') {
        strictObject(args, ['recipeId', 'cableLength', 'unitPrice'], name); const recipeId = boundId(args.recipeId, 'recipeId', recipeIds); const cableLength = args.cableLength === undefined ? undefined : Number(args.cableLength); const unitPrice = Number(args.unitPrice);
        if ((cableLength !== undefined && (!Number.isFinite(cableLength) || cableLength < 0)) || !Number.isFinite(unitPrice) || unitPrice < 0) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', '电缆长度或售价无效');
        const result = await formal('preview_profitability', formalProfitabilityArgs({ recipeId, cableLength, unitPrice })); return safeProjection(name, result, profitabilityProjection(result?.data));
    }
    if (name === 'preview_virtual_readiness') {
        strictObject(args, ['recipeId', 'quantity'], name); const recipeId = boundId(args.recipeId, 'recipeId', recipeIds); const quantity = Number(args.quantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', 'quantity 无效');
        const result = await formal('preview_virtual_readiness', formalReadinessArgs(recipeId, quantity)); return safeProjection(name, result, readinessProjection(result?.data));
    }
    throw new AgentToolError('AGENT_TOOL_NOT_ALLOWED', `M2-A 不允许调用工具：${String(name || '')}`);
}

module.exports = { AGENT_TOOLS, PROTECTED_PROPOSAL_TOOLS, AgentToolError, bindOntologyResolution, coilCostProjection, coilInventoryProjection, executeAgentTool, formalProfitabilityArgs, formalReadinessArgs, normalizePartIdentity, profitabilityProjection, rawParts, readinessProjection, recipeComparisonProjection, recipeCostProjection };
