const { getJson, postJson } = require('../internalApiClient.cjs');

function normalizeText(value) {
    return String(value || '').trim();
}

function includesText(source, keyword) {
    const needle = normalizeText(keyword);
    if (!needle) return false;
    return normalizeText(source).includes(needle);
}

function findByNameOrId(rows, value, nameKeys = ['name']) {
    const text = normalizeText(value);
    const id = Number.parseInt(text, 10);
    return (rows || []).find((row) => {
        if (Number.isFinite(id) && (row.id === id || row.Id === id)) return true;
        return nameKeys.some((key) => normalizeText(row[key]) === text || includesText(row[key], text));
    });
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function roundMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

async function loadRecipes(internalFetch) {
    return getJson(internalFetch, '/api/recipes', '配方列表读取失败');
}

async function executeBusinessTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'build_recipe_bom_draft': {
            const data = await postJson(internalFetch, '/api/recipes/bom-draft', {
                templateId: args.templateId,
                modelVariantId: args.modelVariantId,
                customBarrelLength: args.customBarrelLength,
                longScrewExtraLength: args.longScrewExtraLength,
                coilSpec: args.coilSpec,
                coilSheets: args.coilSheets,
                coilMaterial: args.coilMaterial,
                coilSlotType: args.coilSlotType,
                coilWireWeight: args.coilWireWeight,
                hasFloat: args.hasFloat,
                floatWire: args.floatWire,
                floatAccessoryType: args.floatAccessoryType,
                hasCable: args.hasCable,
                cableLength: args.cableLength,
                cableWire: args.cableWire,
                cableAccessoryType: args.cableAccessoryType,
                packingParts: args.packingParts || [],
                optionalParts: args.optionalParts || [],
            }, '生成配方 BOM 草稿失败');
            return {
                success: true,
                intent: 'recipe_bom_draft',
                summary: `BOM 草稿已生成，共 ${Array.isArray(data.parts) ? data.parts.length : 0} 个项目。`,
                display: { mode: 'compact', title: 'BOM 草稿' },
                data,
            };
        }

        case 'preview_recipe_cost': {
            const matchedRecipe = args.recipeId ? null : findByNameOrId(await loadRecipes(internalFetch), args.recipeName);
            const recipeId = args.recipeId || matchedRecipe?.id || matchedRecipe?.Id;
            if (!recipeId) return { success: false, error: '缺少 recipeId，或未找到匹配配方' };
            const data = await postJson(internalFetch, `/api/recipes/${recipeId}/cost-preview`, {
                overrides: args.overrides || {
                    customBarrelLength: args.customBarrelLength,
                    coilSheets: args.coilSheets,
                    coilWireWeight: args.coilWireWeight,
                    hasFloat: args.hasFloat,
                    floatWire: args.floatWire,
                    floatAccessoryType: args.floatAccessoryType,
                    hasCable: args.hasCable,
                    cableLength: args.cableLength,
                    cableWire: args.cableWire,
                    cableAccessoryType: args.cableAccessoryType,
                },
            }, '配方成本试算失败');
            return {
                success: true,
                intent: 'recipe_cost_preview',
                summary: `配方成本试算完成，单位成本 ${roundMoney(data.unitCost).toFixed(2)} 元。`,
                display: { mode: 'compact', title: '成本试算' },
                data: { recipeId, recipeName: args.recipeName || '', ...data },
            };
        }

        case 'preview_pump_shell_cost': {
            const customBarrelLength = Number(args.customBarrelLength);
            if (!Number.isFinite(customBarrelLength) || customBarrelLength <= 0) {
                return { success: false, error: '缺少有效的机筒长度 customBarrelLength，单位 mm' };
            }

            if (!args.templateId && !args.shellModel) {
                return { success: false, error: '请先提供泵壳型号，例如 V750' };
            }

            const templates = await getJson(internalFetch, '/api/templates', '泵壳模板读取失败');
            const template = findByNameOrId(templates, args.templateId || args.shellModel, ['shellModel', 'description']);
            if (!template) return { success: false, error: `未找到泵壳模板：${args.shellModel || args.templateId || ''}` };

            const templateId = template.id ?? template.Id;
            const data = await postJson(internalFetch, '/api/recipes/bom-draft', {
                templateId,
                customBarrelLength,
            }, '泵壳成本试算失败');

            const parts = Array.isArray(data.parts) ? data.parts : [];
            const shellModel = template.shellModel || args.shellModel || '';
            const shellPart = parts.find((part) => part.dynamicRule === 'stainlessShellBundleByBarrelLength')
                || parts.find((part) => part.source === 'pump_shell_template' && part.name === '泵壳套件')
                || parts.find((part) => normalizeText(part.model) === normalizeText(shellModel) || normalizeText(part.name).includes('泵壳'));
            const shellPrice = roundMoney(data.shellPrice ?? shellPart?.snapshotPrice ?? shellPart?.price ?? 0);
            const barrelExtraCost = roundMoney(shellPart?.barrelExtraCost ?? Math.max(0, shellPrice - Number(shellPart?.baseSnapshotPrice || 0)));

            return {
                success: true,
                intent: 'pump_shell_cost_preview',
                summary: `${shellModel || '泵壳'} 在 ${customBarrelLength}mm 机筒下的泵壳成本 ${shellPrice.toFixed(2)} 元。`,
                display: { mode: 'compact', title: '泵壳成本试算' },
                data: {
                    templateId,
                    shellModel,
                    customBarrelLength,
                    shellPrice,
                    baseShellPrice: shellPart?.baseSnapshotPrice ?? null,
                    barrelExtraCost,
                    dynamicRule: shellPart?.dynamicRule || null,
                    formula: shellPart?.formula || '',
                    shellPart: shellPart || null,
                },
            };
        }

        case 'build_quotation_draft': {
            const customers = await getJson(internalFetch, '/api/customers', '客户列表读取失败');
            const recipes = await loadRecipes(internalFetch);
            const customer = findByNameOrId(customers, args.customerName || args.customerId, ['name']);
            if (!customer) return { success: false, error: `未找到客户：${args.customerName || args.customerId || ''}` };

            const items = [];
            for (const item of (Array.isArray(args.items) ? args.items : [])) {
                const recipe = findByNameOrId(recipes, item.recipeName || item.recipeId, ['name']);
                if (!recipe) return { success: false, error: `未找到配方：${item.recipeName || item.recipeId || ''}` };
                const recipeId = recipe.id ?? recipe.Id;
                let unitCost = Number(item.unitCost);
                if (!Number.isFinite(unitCost) || unitCost <= 0) {
                    if (item.overrides && Object.keys(item.overrides).length > 0) {
                        const preview = await postJson(internalFetch, `/api/recipes/${recipeId}/cost-preview`, { overrides: item.overrides }, '报价明细成本试算失败');
                        unitCost = Number(preview.unitCost);
                    } else {
                        unitCost = Number(recipe.savedTotalCost || 0);
                    }
                }
                const margin = Number(item.margin || args.margin || customer.defaultMargin || 1.1);
                items.push({
                    id: item.id || `ai-quotation-${Date.now()}-${items.length}`,
                    baseRecipeId: recipeId,
                    baseRecipeName: recipe.name,
                    spec: recipe.spec || '',
                    qty: Number(item.qty || 1),
                    unitCost: roundMoney(unitCost),
                    margin: Number.isFinite(margin) && margin > 0 ? margin : 1.1,
                    unitPrice: item.unitPrice == null ? undefined : roundMoney(item.unitPrice),
                });
            }
            const draft = await postJson(internalFetch, '/api/quotations/save-payload-draft', {
                customerId: customer.id ?? customer.Id,
                status: args.status || '报价中',
                items,
                remark: args.remark || '',
            }, '生成报价保存草稿失败');
            return {
                success: true,
                intent: 'quotation_draft',
                summary: `已生成 ${customer.name} 的报价草稿，合计报价 ${roundMoney(draft.totalPrice).toFixed(2)} 元。`,
                display: { mode: 'compact', title: '报价草稿' },
                data: { customer, items, draft },
            };
        }

        case 'build_order_draft': {
            const draft = await postJson(internalFetch, '/api/orders/save-payload-draft', {
                customerName: args.customerName,
                contractNo: args.contractNo || '',
                remark: args.remark || '',
                status: args.status || '待采购',
                items: args.items || [],
                purchaseList: args.purchaseList,
                todos: args.todos,
            }, '生成订单保存草稿失败');
            return {
                success: true,
                intent: 'order_draft',
                summary: `订单草稿已生成，客户 ${args.customerName || ''}。`,
                display: { mode: 'compact', title: '订单草稿' },
                data: draft,
            };
        }

        case 'search_customer_history': {
            const [customers, quotations, orders] = await Promise.all([
                getJson(internalFetch, '/api/customers', '客户列表读取失败'),
                getJson(internalFetch, '/api/quotations', '报价列表读取失败'),
                getJson(internalFetch, '/api/orders', '订单列表读取失败'),
            ]);
            const customer = findByNameOrId(customers, args.customerName || args.customerId, ['name']);
            if (!customer) return { success: false, error: `未找到客户：${args.customerName || args.customerId || ''}` };
            const customerId = customer.id ?? customer.Id;
            const keyword = normalizeText(args.keyword || args.recipeName || args.model);
            const quoteRows = (quotations || [])
                .filter((row) => (row.customerId ?? row.customer_id) === customerId)
                .map((row) => ({ ...row, items: parseJsonArray(row.itemsJson || row.items_json) }))
                .filter((row) => !keyword || row.items.some((item) => includesText(item.baseRecipeName || item.recipeName, keyword)));
            const orderRows = (orders || [])
                .filter((row) => normalizeText(row.customerName || row.customer_name) === normalizeText(customer.name))
                .map((row) => ({ ...row, items: parseJsonArray(row.itemsJson || row.items_json) }))
                .filter((row) => !keyword || row.items.some((item) => includesText(item.recipeName || item.baseRecipeName, keyword)));
            return {
                success: true,
                intent: 'customer_history',
                summary: `找到 ${customer.name} 的历史报价 ${quoteRows.length} 条、订单 ${orderRows.length} 条。`,
                display: { mode: 'compact', title: '客户历史' },
                data: {
                    customer,
                    quotations: quoteRows.slice(0, args.limit || 10),
                    orders: orderRows.slice(0, args.limit || 10),
                },
            };
        }

        case 'explain_cost_change': {
            const data = await postJson(internalFetch, '/api/cost/recipe-difference', {
                leftRecipeId: args.leftRecipeId,
                leftRecipeName: args.leftRecipeName || args.recipe1,
                rightRecipeId: args.rightRecipeId,
                rightRecipeName: args.rightRecipeName || args.recipe2,
                limit: args.limit || 12,
            }, '成本差异解释失败');
            return {
                success: true,
                intent: 'cost_change_explanation',
                summary: data.summary,
                display: { mode: 'compact', title: '成本差异解释' },
                data,
            };
        }

        case 'get_data_quality_summary': {
            const data = await getJson(internalFetch, '/api/quality/summary', '数据质量报告读取失败');
            return {
                success: true,
                intent: 'data_quality_summary',
                summary: `数据质量分 ${data.score}，共 ${data.totals?.issueCount || 0} 个问题。`,
                display: { mode: 'compact', title: '数据质量' },
                data,
            };
        }

        case 'get_business_alerts': {
            const data = await getJson(internalFetch, '/api/quality/business-alerts', '经营异常提醒读取失败');
            return {
                success: true,
                intent: 'business_alerts',
                summary: `经营异常提醒 ${data.totals?.all || 0} 条，其中高风险 ${data.totals?.high || 0} 条。`,
                display: { mode: 'compact', title: '经营异常' },
                data,
            };
        }

        case 'search_factory_knowledge': {
            const query = new URLSearchParams();
            const queryText = String(args.query || args.keyword || '').trim();
            const entryType = args.entryType || args.type;
            if (queryText) query.set('query', queryText);
            if (entryType) query.set('entryType', entryType);
            if (args.sourceTable) query.set('sourceTable', args.sourceTable);
            if (args.limit) query.set('limit', String(args.limit));
            const matches = await getJson(internalFetch, `/api/knowledge${query.toString() ? `?${query.toString()}` : ''}`, '工厂知识库搜索失败');
            const isExactCoilLookup = entryType === 'coil' && /^\d+\s*[-－]\s*\d+$/.test(queryText);
            const data = isExactCoilLookup && Array.isArray(matches)
                ? await Promise.all(matches.map(item => getJson(internalFetch, `/api/knowledge/${item.id}`, '线圈知识详情读取失败')))
                : matches;
            return {
                success: true,
                intent: 'factory_knowledge_search',
                summary: `工厂知识库找到 ${Array.isArray(data) ? data.length : 0} 条结果。`,
                display: { mode: 'compact', title: '工厂知识库' },
                data,
            };
        }

        case 'get_factory_knowledge_detail': {
            if (!args.id) return { success: false, error: '缺少知识条目ID' };
            const data = await getJson(internalFetch, `/api/knowledge/${args.id}`, '知识条目读取失败');
            return {
                success: true,
                intent: 'factory_knowledge_detail',
                summary: data.title || `知识条目 #${args.id}`,
                display: { mode: 'compact', title: '知识详情' },
                data,
            };
        }

        case 'sync_factory_knowledge': {
            const data = await postJson(internalFetch, '/api/knowledge/sync', {}, '工厂知识库同步失败');
            const total = data.stats?.total ?? data.stats?.inserted ?? 0;
            return {
                success: true,
                intent: 'factory_knowledge_sync',
                summary: `工厂知识库已同步 ${total} 条；新增 ${data.stats?.inserted || 0} 条，更新 ${data.stats?.updated || 0} 条，移除 ${data.stats?.deleted || 0} 条。FTS ${data.ftsEnabled ? '已启用' : '未启用，使用 LIKE 搜索'}。`,
                display: { mode: 'compact', title: '知识库同步' },
                data,
            };
        }

        default:
            return null;
    }
}

module.exports = { executeBusinessTool };
