const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');
const {
    executeCoilStockAdjustment,
} = require('../../../services/aiCoilStockExecution.cjs');
const {
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartStockAdjustment,
    executePartUpdate,
} = require('../../../services/aiPartExecution.cjs');
const {
    resolveUniqueRecipe,
    selectCurrentRecipeCost,
} = require('../../../services/aiRecipeResolution.cjs');
const { canonicalApiResource } = require('./formalResource.cjs');

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '{}'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function completeTemplateResource(template) {
    const canonical = canonicalApiResource(template);
    return {
        ...canonical,
        parts: parseJsonArray(canonical.partsJson),
        shellComponents: parseJsonArray(canonical.shellComponentsJson),
        rotorParams: parseJsonObject(canonical.rotorParamsJson),
    };
}

function buildQueryReceipt(filters, totalCount, returnedCount = totalCount) {
    const normalizedReturnedCount = Number(returnedCount ?? 0);
    const normalizedTotalCount = totalCount === null || totalCount === undefined
        ? null
        : Number(totalCount);
    const requestedLimit = Number(filters?.limit);
    return {
        appliedFilters: Object.fromEntries(
            Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined)
        ),
        totalCount: normalizedTotalCount,
        returnedCount: normalizedReturnedCount,
        truncated: normalizedTotalCount === null
            ? null
            : normalizedReturnedCount < normalizedTotalCount,
        possiblyTruncated: Number.isFinite(requestedLimit)
            && requestedLimit > 0
            && normalizedReturnedCount >= requestedLimit,
        authoritative: true,
    };
}

async function executeQueryTool(toolName, args, internalFetch, options = {}) {
    switch (toolName) {
        case 'search_business_changes': {
            const query = new URLSearchParams();
            for (const key of ['period', 'from', 'to', 'domain', 'entityType', 'entityId', 'eventType', 'keyword', 'semanticQuery', 'limit']) {
                if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== '') {
                    query.set(key, String(args[key]));
                }
            }
            const page = await getJson(
                internalFetch,
                `/api/business-changes${query.size ? `?${query.toString()}` : ''}`,
                '业务变更历史读取失败'
            );
            return {
                success: true,
                intent: 'business_change_history',
                summary: page.total > 0
                    ? `找到 ${page.total} 条符合条件的业务变更。`
                    : '没有找到符合当前筛选条件的业务变更。',
                data: page,
                receipt: buildQueryReceipt(page.appliedFilters, page.total, page.items?.length || 0),
                sources: [{
                    sourceTable: 'business_change_events',
                    evidenceLevel: 'authoritative_business_event',
                    asOf: page.asOf,
                }],
            };
        }
        case 'get_coil_specs': {
            const specs = await getJson(internalFetch, '/api/coils/specs', '线圈规格读取失败');
            return { success: true, data: specs };
        }

        case 'search_coils': {
            const filters = {
                spec: String(args.spec || '').trim(),
                sheets: args.sheets === undefined ? null : Number(args.sheets),
                material: String(args.material || '').trim(),
                slotType: String(args.slotType || '').trim(),
            };
            if (String(args.schemeCode || '').trim()) filters.schemeCode = String(args.schemeCode).trim();
            if (String(args.schemeStatus || '').trim()) filters.schemeStatus = String(args.schemeStatus).trim();
            if (args.isDefault !== undefined) filters.isDefault = Boolean(args.isDefault);
            if (args.ratedVoltageV !== undefined) filters.ratedVoltageV = Number(args.ratedVoltageV);
            if (args.ratedFrequencyHz !== undefined) filters.ratedFrequencyHz = Number(args.ratedFrequencyHz);
            if (String(args.market || '').trim()) filters.market = String(args.market).trim();
            if (String(args.schemeFamilyCode || '').trim()) filters.schemeFamilyCode = String(args.schemeFamilyCode).trim();
            // 用户常说"12-120"（规格俗称-片数）。模型可能把它整体传进 spec，
            // 这里确定性地拆分，避免漏匹配（adjust_coil_stock 遵循同一约定）。
            const shorthand = filters.spec.match(/^(\d+)\s*[-—~]\s*(\d+)$/);
            if (shorthand && filters.sheets === null) {
                filters.spec = shorthand[1];
                filters.sheets = Number(shorthand[2]);
            }
            const query = new URLSearchParams();
            for (const [field, value] of Object.entries(filters)) {
                if (value !== null && value !== '') query.set(field, String(value));
            }
            const coils = await getJson(
                internalFetch,
                `/api/coils${query.size ? `?${query.toString()}` : ''}`,
                '线圈库存读取失败'
            );
            return {
                success: true,
                count: coils.length,
                filters,
                queryReceipt: buildQueryReceipt(filters, coils.length),
                data: coils.map(canonicalApiResource),
                sources: coils.map(coil => ({
                    sourceTable: 'coils',
                    sourceId: coil.id ?? coil.Id,
                    title: `${coil.spec}-${coil.sheets} ${coil.material || ''} ${coil.slotType || ''}`.trim(),
                })),
            };
        }

        case 'get_all_recipes': {
            const query = new URLSearchParams();
            const keyword = String(args.keyword || '').trim();
            if (keyword) query.set('keyword', keyword);
            const hasTechnicalFiles = args.hasTechnicalFiles === undefined
                ? null
                : Boolean(args.hasTechnicalFiles);
            if (hasTechnicalFiles !== null) {
                query.set('hasTechnicalFiles', String(hasTechnicalFiles));
            }
            const recipes = await getJson(
                internalFetch,
                `/api/recipes${query.size ? `?${query.toString()}` : ''}`,
                '配方列表读取失败'
            );
            const data = recipes.map(canonicalApiResource);
            const filters = { keyword, hasTechnicalFiles };
            return {
                success: true,
                count: data.length,
                filters,
                queryReceipt: buildQueryReceipt(filters, data.length),
                data,
            };
        }

        case 'get_recipe_detail': {
            const recipes = await getJson(internalFetch, '/api/recipes', '配方列表读取失败');
            const resolved = resolveUniqueRecipe(recipes, args);
            if (resolved.error) return { success: false, ...resolved };
            const recipeId = resolved.recipe.id ?? resolved.recipe.Id;
            const recipe = await getJson(
                internalFetch,
                `/api/recipes/${recipeId}`,
                '配方明细读取失败'
            );
            const canonicalRecipe = canonicalApiResource(recipe);
            const parts = parseJsonArray(canonicalRecipe.partsJson);
            let currentCost = null;
            if (args.includeCurrentCost) {
                const currentCosts = await getJson(
                    internalFetch,
                    '/api/recipes/current-costs',
                    '配方当前成本读取失败'
                );
                currentCost = selectCurrentRecipeCost(currentCosts, recipeId);
            }
            return {
                success: true,
                recipe: {
                    ...canonicalRecipe,
                    parts,
                    partCount: parts.length,
                },
                ...(currentCost ? { currentCost } : {}),
                sources: [{
                    sourceTable: 'recipes',
                    sourceId: recipeId,
                    title: `${recipe.name} 配方明细`,
                }],
            };
        }

        case 'get_recipe_technical_files': {
            const recipes = await getJson(internalFetch, '/api/recipes', '配方列表读取失败');
            const resolved = resolveUniqueRecipe(recipes, args);
            if (resolved.error) return { success: false, ...resolved };
            const recipe = resolved.recipe;
            const id = recipe.id ?? recipe.Id;
            const files = await getJson(
                internalFetch,
                `/api/recipes/${id}/technical-files`,
                '配方技术档案读取失败'
            );
            return {
                success: true,
                recipe: { id, name: recipe.name, spec: recipe.spec },
                files,
                sources: [{
                    sourceTable: 'recipes',
                    sourceId: id,
                    title: `${recipe.name} 技术档案`,
                }],
            };
        }

        case 'get_recent_orders': {
            const query = new URLSearchParams();
            for (const field of ['limit', 'status', 'customerName', 'contractNo']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const recentOrders = await getJson(
                internalFetch,
                `/api/orders${query.size ? `?${query.toString()}` : ''}`,
                '订单列表读取失败'
            );
            const data = recentOrders.map(canonicalApiResource);
            return {
                success: true,
                count: data.length,
                filters: {
                    status: String(args.status || '').trim(),
                    customerName: String(args.customerName || '').trim(),
                    contractNo: String(args.contractNo || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                },
                queryReceipt: buildQueryReceipt({
                    status: String(args.status || '').trim(),
                    customerName: String(args.customerName || '').trim(),
                    contractNo: String(args.contractNo || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                }, args.limit === undefined ? data.length : null, data.length),
                selectionBoundary: 'data 已由正式订单 API 按 filters 筛选。回答订单数量时必须使用 count，并逐单简报客户和创建日期；不得改用采购任务、供应商或待采购数量回答。',
                data,
            };
        }

        case 'search_quotations': {
            const query = new URLSearchParams();
            for (const field of ['status', 'customerName', 'limit']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const quotations = await getJson(
                internalFetch,
                `/api/quotations${query.size ? `?${query.toString()}` : ''}`,
                '报价列表读取失败'
            );
            const data = quotations.map(quotation => {
                const canonical = canonicalApiResource(quotation);
                return {
                    ...canonical,
                    items: parseJsonArray(canonical.itemsJson),
                };
            });
            return {
                success: true,
                count: data.length,
                filters: {
                    status: String(args.status || '').trim(),
                    customerName: String(args.customerName || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                },
                queryReceipt: buildQueryReceipt({
                    status: String(args.status || '').trim(),
                    customerName: String(args.customerName || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                }, args.limit === undefined ? data.length : null, data.length),
                selectionBoundary: 'data 已由正式报价 API 按 filters 筛选；只能基于 data 回答，不能补充未返回的报价。id/sourceId 是内部关联字段，除非用户明确询问编号，否则不得展示为“报价 #N”。',
                data,
                sources: data.map(quotation => ({
                    sourceTable: 'quotations',
                    sourceId: quotation.id,
                    title: `报价：${quotation.customerName}（${quotation.status}）`,
                })),
            };
        }

        case 'get_quotation_detail': {
            const quotationId = Number.parseInt(args.quotationId, 10);
            let quotation;
            try {
                quotation = await getJson(
                    internalFetch,
                    `/api/quotations/${quotationId}`,
                    '报价详情读取失败'
                );
            } catch (error) {
                if (error.formalApiOutcome === 'not_found') {
                    return {
                        success: false,
                        code: 'AI_RESOURCE_NOT_FOUND',
                        error: `未找到报价ID: ${quotationId}`,
                    };
                }
                throw error;
            }
            const canonical = canonicalApiResource(quotation);
            return {
                success: true,
                quotation: {
                    ...canonical,
                    items: parseJsonArray(canonical.itemsJson),
                },
                sources: [{
                    sourceTable: 'quotations',
                    sourceId: canonical.id,
                    title: `报价：${canonical.customerName || canonical.id}`,
                }],
            };
        }

        case 'search_customers': {
            const query = new URLSearchParams();
            for (const field of ['name', 'limit']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const customers = await getJson(
                internalFetch,
                `/api/customers${query.size ? `?${query.toString()}` : ''}`,
                '客户列表读取失败'
            );
            const data = customers.map(canonicalApiResource);
            const filters = {
                name: String(args.name || '').trim(),
                limit: args.limit === undefined ? null : Number(args.limit),
            };
            return {
                success: true,
                count: data.length,
                filters,
                queryReceipt: buildQueryReceipt(
                    filters,
                    args.limit === undefined ? data.length : null,
                    data.length
                ),
                selectionBoundary: 'data 已由正式客户 API 按 filters 筛选。',
                data,
                sources: data.map(customer => ({
                    sourceTable: 'customers',
                    sourceId: customer.id,
                    title: customer.name,
                })),
            };
        }

        case 'search_templates': {
            const query = new URLSearchParams();
            for (const field of ['shellModel', 'description', 'limit']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const templates = await getJson(
                internalFetch,
                `/api/templates${query.size ? `?${query.toString()}` : ''}`,
                '泵壳模板列表读取失败'
            );
            const data = templates.map(completeTemplateResource);
            const filters = {
                shellModel: String(args.shellModel || '').trim(),
                description: String(args.description || '').trim(),
                limit: args.limit === undefined ? null : Number(args.limit),
            };
            return {
                success: true,
                count: data.length,
                filters,
                queryReceipt: buildQueryReceipt(
                    filters,
                    args.limit === undefined ? data.length : null,
                    data.length
                ),
                selectionBoundary: 'data 已由正式泵壳模板 API 按 filters 筛选。',
                data,
                sources: data.map(template => ({
                    sourceTable: 'pump_shell_templates',
                    sourceId: template.id,
                    title: template.shellModel,
                })),
            };
        }

        case 'get_template_detail': {
            let templateId = Number.parseInt(args.templateId, 10);
            if (!Number.isInteger(templateId) || templateId <= 0) {
                const shellModel = String(args.shellModel || '').trim();
                const query = new URLSearchParams({ shellModel });
                const matches = await getJson(
                    internalFetch,
                    `/api/templates?${query.toString()}`,
                    '泵壳模板列表读取失败'
                );
                const exactMatches = matches.filter(template => (
                    String(template.shellModel || '').trim().toLocaleLowerCase()
                    === shellModel.toLocaleLowerCase()
                ));
                const candidates = exactMatches.length > 0 ? exactMatches : matches;
                if (candidates.length === 0) {
                    return {
                        success: false,
                        code: 'AI_RESOURCE_NOT_FOUND',
                        error: `未找到泵壳模板：${shellModel}`,
                    };
                }
                if (candidates.length > 1) {
                    return {
                        success: false,
                        code: 'AI_RESOURCE_AMBIGUOUS',
                        error: '泵壳模板名称不明确，请指定完整型号或模板ID',
                        candidates: candidates.slice(0, 10).map(template => ({
                            id: template.id ?? template.Id,
                            shellModel: template.shellModel,
                            description: template.description || '',
                        })),
                    };
                }
                templateId = Number(candidates[0].id ?? candidates[0].Id);
            }
            let template;
            try {
                template = await getJson(
                    internalFetch,
                    `/api/templates/${templateId}`,
                    '泵壳模板详情读取失败'
                );
            } catch (error) {
                if (error.formalApiOutcome === 'not_found') {
                    return {
                        success: false,
                        code: 'AI_RESOURCE_NOT_FOUND',
                        error: `未找到泵壳模板ID: ${templateId}`,
                    };
                }
                throw error;
            }
            const data = completeTemplateResource(template);
            return {
                success: true,
                template: data,
                sources: [{
                    sourceTable: 'pump_shell_templates',
                    sourceId: data.id,
                    title: data.shellModel,
                }],
            };
        }

        case 'create_part': {
            return executePartCreate(args, {
                internalFetch,
                postJson,
            });
        }

        case 'batch_create_parts': {
            return executePartBatchCreate(args, {
                internalFetch,
                postJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'update_part': {
            return executePartUpdate(args, {
                internalFetch,
                getJson,
                postJson,
                patchJson,
            });
        }

        case 'adjust_part_stock': {
            return executePartStockAdjustment(args, {
                internalFetch,
                getJson,
                postJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'adjust_coil_stock': {
            return executeCoilStockAdjustment(args, {
                internalFetch,
                getJson,
                postJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'search_parts': {
            const query = new URLSearchParams();
            for (const field of [
                'keyword', 'category', 'supplier', 'stockStatus',
                'limit',
                'minPrice', 'maxPrice', 'priceBelow', 'priceAbove',
                'minStock', 'maxStock', 'stockBelow', 'stockAbove',
                'sortBy', 'sortOrder',
            ]) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const queryString = query.toString();
            const results = await getJson(
                internalFetch,
                `/api/parts${queryString ? `?${queryString}` : ''}`,
                '零件列表读取失败'
            );
            const supplierCounts = new Map();
            const categoryCounts = new Map();
            for (const part of results) {
                const supplier = String(part.supplier || '').trim();
                if (supplier) {
                    supplierCounts.set(supplier, (supplierCounts.get(supplier) || 0) + 1);
                }
                const category = String(part.category || '').trim() || '未分类';
                categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
            }
            const parts = results.map(canonicalApiResource);
            return {
                success: true,
                count: results.length,
                returnedCount: parts.length,
                truncated: parts.length < results.length,
                filters: {
                    keyword: String(args.keyword || '').trim(),
                    category: String(args.category || '').trim(),
                    supplier: String(args.supplier || '').trim(),
                    stockStatus: String(args.stockStatus || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                    minPrice: args.minPrice ?? null,
                    maxPrice: args.maxPrice ?? null,
                    priceBelow: args.priceBelow ?? null,
                    priceAbove: args.priceAbove ?? null,
                    minStock: args.minStock ?? null,
                    maxStock: args.maxStock ?? null,
                    stockBelow: args.stockBelow ?? null,
                    stockAbove: args.stockAbove ?? null,
                    sortBy: args.sortBy ?? null,
                    sortOrder: args.sortOrder ?? null,
                },
                queryReceipt: buildQueryReceipt({
                    keyword: String(args.keyword || '').trim(),
                    category: String(args.category || '').trim(),
                    supplier: String(args.supplier || '').trim(),
                    stockStatus: String(args.stockStatus || '').trim(),
                    limit: args.limit === undefined ? null : Number(args.limit),
                    minPrice: args.minPrice ?? null,
                    maxPrice: args.maxPrice ?? null,
                    priceBelow: args.priceBelow ?? null,
                    priceAbove: args.priceAbove ?? null,
                    minStock: args.minStock ?? null,
                    maxStock: args.maxStock ?? null,
                    stockBelow: args.stockBelow ?? null,
                    stockAbove: args.stockAbove ?? null,
                    sortBy: args.sortBy ?? null,
                    sortOrder: args.sortOrder ?? null,
                }, args.limit === undefined ? results.length : null, parts.length),
                stockStatusDefinition: {
                    low: '库存大于0且不超过5',
                    out: '库存不大于0',
                    attention: '库存不超过5（含缺货）',
                    ok: '库存大于5',
                },
                suppliers: [...supplierCounts.entries()].map(([name, partCount]) => ({ name, partCount })),
                categorySummary: [...categoryCounts.entries()].map(([category, partCount]) => ({ category, partCount })),
                aggregationNote: 'count、suppliers、categorySummary 均为服务端统计的权威数字；回答中引用数量或分类小计时必须使用这些值，不得自行逐条计数',
                parts,
            };
        }

        case 'delete_part': {
            return executePartDelete(args, {
                internalFetch,
                getJson,
                postJson,
                deleteJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'batch_update_prices': {
            return executePartPriceBatch(args, {
                internalFetch,
                getJson,
                postJson,
                patchJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'get_dashboard_summary': {
            const summary = await getJson(internalFetch, '/api/workbench/summary', '运营汇总读取失败');
            return { success: true, summary };
        }

        default:
            return null;
    }
}

module.exports = { executeQueryTool };
