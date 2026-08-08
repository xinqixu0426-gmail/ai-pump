const { getJson, postJson, patchJson } = require('../internalApiClient.cjs');
const { recordWorkflowRun } = require('./workflowRunRecorder.cjs');
const {
    executeFactoryWorkflowStep,
} = require('../../../services/aiFactoryWorkflowExecution.cjs');

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

function roundMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function customerMarginMultiplier(value) {
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 ? 1 + rate : 1.1;
}

const KNOWLEDGE_SOURCE_PATHS = {
    parts: '/parts',
    pump_shell_templates: '/parts',
    recipes: '/recipes',
    coils: '/coils',
    customers: '/customers',
    quotations: '/quotations',
    orders: '/orders',
    quality_summary: '/dashboard?view=quality',
    business_rules: '/dashboard?view=knowledge',
    factory_rule_candidates: '/dashboard?view=quality',
    knowledge_documents: '/dashboard?view=knowledge',
};

function knowledgeSourceKey(item) {
    return `${item?.sourceTable || ''}\u0000${item?.sourceId || ''}`;
}

function buildKnowledgeSources(items, overview) {
    const changes = new Map((overview?.changes || []).map(item => [knowledgeSourceKey(item), item]));
    return (Array.isArray(items) ? items : [items])
        .filter(item => item && item.id)
        .map(item => {
            const change = changes.get(knowledgeSourceKey(item));
            const freshness = change?.status || 'fresh';
            return {
                kind: 'knowledge_snapshot',
                knowledgeEntryId: Number(item.id),
                entryType: item.entryType || '',
                title: change?.title || item.title || `知识条目 #${item.id}`,
                sourceTable: item.sourceTable || '',
                sourceId: String(item.sourceId || ''),
                syncedAt: item.syncedAt || null,
                sourceUpdatedAt: change?.sourceUpdatedAt || item.sourceUpdatedAt || null,
                freshness,
                knowledgePath: `/dashboard?view=knowledge&entry=${Number(item.id)}`,
                sourcePath: item.metadata?.downloadPath || KNOWLEDGE_SOURCE_PATHS[item.sourceTable] || '',
            };
        });
}

function buildBusinessRuleAnswerGuidance(items) {
    const rules = (Array.isArray(items) ? items : [items]).filter(item => item?.entryType === 'business_rule');
    if (rules.length === 0) return null;

    const statements = [];
    for (const rule of rules) {
        const candidates = [
            rule.summary,
            ...(Array.isArray(rule.content) ? rule.content : [rule.content]),
        ];
        for (const candidate of candidates) {
            const statement = normalizeText(candidate);
            if (!statement || statements.includes(statement)) continue;
            statements.push(statement);
            if (statements.length >= 8) break;
        }
        if (statements.length >= 8) break;
    }

    if (statements.length === 0) return null;
    return {
        requiredEvidencePolicy: '回答必须同时说明业务规则里的明确肯定项和明确否定项；没有明确记录时使用“系统未明确记录”或“没有明确记录”，不得把语义候选当结论。',
        businessRuleStatements: statements,
    };
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

        case 'inspect_quotation_file': {
            const fileId = Number(args.fileId);
            if (!Number.isInteger(fileId) || fileId <= 0) {
                return { success: false, error: '请提供附件上下文中的有效统一文件ID' };
            }
            const draft = await postJson(
                internalFetch,
                `/api/files/${fileId}/quotation-draft`,
                { customerName: args.customerName || '' },
                '报价文件解析失败'
            );
            const summary = draft.summary || {};
            return {
                success: true,
                intent: 'quotation_file_draft',
                summary: summary.readyForSaveDraft
                    ? `报价文件已识别 ${summary.totalItems || 0} 项，客户和配方均精确匹配，可继续生成正式报价草稿。`
                    : `报价文件已识别 ${summary.totalItems || 0} 项，其中 ${summary.exactMatchedItems || 0} 项精确匹配，仍有待确认内容。`,
                display: { mode: 'compact', title: '报价文件识别草稿' },
                data: draft,
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
                const explicitMargin = item.margin ?? args.margin;
                const margin = explicitMargin == null
                    ? customerMarginMultiplier(customer.defaultMargin)
                    : Number(explicitMargin);
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
            const customerQuery = new URLSearchParams();
            if (args.customerId != null) customerQuery.set('id', String(args.customerId));
            else if (args.customerName) customerQuery.set('name', normalizeText(args.customerName));
            const customers = await getJson(
                internalFetch,
                `/api/customers${customerQuery.size ? `?${customerQuery.toString()}` : ''}`,
                '客户列表读取失败'
            );
            const target = normalizeText(args.customerName || args.customerId);
            const exact = customers.filter(customer => (
                String(customer.id ?? customer.Id) === target
                || normalizeText(customer.name) === target
            ));
            const candidates = exact.length > 0 ? exact : customers;
            if (candidates.length === 0) {
                return { success: false, error: `未找到客户：${target}` };
            }
            if (candidates.length > 1) {
                return {
                    success: false,
                    error: '客户名称不明确，请指定完整客户名称',
                    queryReceipt: {
                        appliedFilters: args.customerId != null
                            ? { id: Number(args.customerId) }
                            : { name: normalizeText(args.customerName) },
                        totalCount: candidates.length,
                        returnedCount: Math.min(candidates.length, 10),
                        truncated: candidates.length > 10,
                        possiblyTruncated: false,
                        authoritative: true,
                    },
                    candidates: candidates.slice(0, 10).map(customer => ({
                        id: customer.id ?? customer.Id,
                        name: customer.name,
                    })),
                };
            }
            const customer = candidates[0];
            const customerId = customer.id ?? customer.Id;
            const query = new URLSearchParams();
            const keyword = normalizeText(args.keyword || args.recipeName || args.model);
            if (keyword) query.set('keyword', keyword);
            if (args.limit != null) query.set('limit', String(args.limit));
            const suffix = query.size > 0 ? `?${query.toString()}` : '';
            const context = await getJson(
                internalFetch,
                `/api/customers/${customerId}/context${suffix}`,
                '客户历史读取失败'
            );
            const quotations = Array.isArray(context.quotations) ? context.quotations : [];
            const orders = Array.isArray(context.orders) ? context.orders : [];
            const returnedCount = quotations.length + orders.length;
            return {
                success: true,
                intent: 'customer_history',
                summary: context.summary,
                display: { mode: 'compact', title: '客户历史' },
                data: {
                    customer: context.customer,
                    quotations,
                    orders,
                },
                queryReceipt: {
                    appliedFilters: {
                        customerId: Number(customerId),
                        ...(keyword ? { keyword } : {}),
                        ...(args.limit != null ? { limit: Number(args.limit) } : {}),
                    },
                    totalCount: args.limit == null ? returnedCount : null,
                    returnedCount,
                    truncated: args.limit == null ? false : null,
                    possiblyTruncated: args.limit != null
                        && (quotations.length >= Number(args.limit) || orders.length >= Number(args.limit)),
                    authoritative: true,
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

        case 'analyze_recipe_configuration': {
            if (!args.recipeId && !normalizeText(args.recipeName)) {
                return { success: false, error: '请提供配方ID或完整配方名称' };
            }
            const data = await postJson(internalFetch, '/api/quality/recipe-analysis', {
                recipeId: args.recipeId,
                recipeName: args.recipeName,
                limit: args.limit,
            }, '配方智能分析失败');
            return {
                success: true,
                intent: 'recipe_configuration_analysis',
                summary: `配方检查完成：确定问题 ${data.summary?.definiteIssueCount || 0} 项，工厂规则提醒 ${data.summary?.factoryRuleAlertCount || 0} 项，复核建议 ${data.summary?.reviewSuggestionCount || 0} 项，价格提醒 ${data.summary?.priceAlertCount || 0} 项。`,
                display: { mode: 'compact', title: '配方智能检查' },
                data,
            };
        }

        case 'set_recipe_analysis_feedback': {
            if (!args.recipeId || !normalizeText(args.findingKey) || !normalizeText(args.findingType)) {
                return { success: false, error: '请提供配方ID、findingKey 和 findingType' };
            }
            const data = await postJson(
                internalFetch,
                `/api/quality/recipes/${Number(args.recipeId)}/feedback`,
                {
                    findingKey: args.findingKey,
                    findingType: args.findingType,
                    decision: args.decision,
                    note: args.note,
                    findingSnapshot: args.findingSnapshot || {},
                    expectedUpdatedAt: args.expectedUpdatedAt,
                },
                '配方检查反馈保存失败'
            );
            return {
                success: true,
                intent: 'recipe_analysis_feedback',
                summary: data.ruleLearning?.refreshed
                    ? '配方检查反馈已保存，候选业务规则已自动重新归纳。'
                    : '配方检查反馈已保存，后续智能检查会应用这条判断。',
                display: { mode: 'compact', title: '检查反馈' },
                data,
            };
        }

        case 'get_factory_learning_health': {
            const query = new URLSearchParams();
            if (args.limit) query.set('limit', String(Number(args.limit)));
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const data = await getJson(
                internalFetch,
                `/api/quality/rule-learning-health${suffix}`,
                '学习证据健康状态读取失败'
            );
            return {
                success: true,
                intent: 'factory_learning_health',
                summary: `当前有 ${data.summary?.affectedRecipeCount || 0} 个配方、${data.summary?.recheckEvidenceCount || 0} 条学习反馈需要重新检查。`,
                display: { mode: 'compact', title: '学习证据健康' },
                data,
            };
        }

        case 'get_factory_rule_candidates': {
            const query = new URLSearchParams();
            if (normalizeText(args.status)) query.set('status', args.status);
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const data = await getJson(
                internalFetch,
                `/api/quality/rule-candidates${suffix}`,
                '候选业务规则读取失败'
            );
            return {
                success: true,
                intent: 'factory_rule_candidates',
                summary: `共读取 ${data.length || 0} 条候选业务规则。`,
                display: { mode: 'compact', title: '候选业务规则' },
                data,
            };
        }

        case 'get_factory_rule_impact': {
            if (!args.candidateId) {
                return { success: false, error: '请提供候选规则ID' };
            }
            const data = await getJson(
                internalFetch,
                `/api/quality/rule-candidates/${Number(args.candidateId)}/impact`,
                '规则影响分析失败'
            );
            return {
                success: true,
                intent: 'factory_rule_impact',
                summary: `该规则覆盖 ${data.summary?.totalRecipes || 0} 个同模板配方，其中 ${data.summary?.needsReviewCount || 0} 个需要复核。`,
                display: { mode: 'compact', title: '规则影响分析' },
                data,
            };
        }

        case 'get_factory_rule_compliance': {
            const data = await getJson(
                internalFetch,
                '/api/quality/rule-compliance',
                '规则执行情况读取失败'
            );
            return {
                success: true,
                intent: 'factory_rule_compliance',
                summary: `当前有 ${data.summary?.approvedRuleCount || 0} 条已批准规则，${data.summary?.affectedRecipeCount || 0} 个配方需要复核。`,
                display: { mode: 'compact', title: '规则执行情况' },
                data,
            };
        }

        case 'get_factory_rule_history': {
            const query = new URLSearchParams();
            if (args.candidateId) query.set('candidateId', String(Number(args.candidateId)));
            if (args.limit) query.set('limit', String(Number(args.limit)));
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const data = await getJson(
                internalFetch,
                `/api/quality/rule-events${suffix}`,
                '规则变更记录读取失败'
            );
            return {
                success: true,
                intent: 'factory_rule_history',
                summary: `共读取 ${data.length || 0} 条规则变更记录。`,
                display: { mode: 'compact', title: '规则变更记录' },
                data,
            };
        }

        case 'restore_factory_rule_event': {
            if (!args.eventId) {
                return { success: false, error: '请提供要恢复的规则历史事件ID' };
            }
            const data = await postJson(
                internalFetch,
                `/api/quality/rule-events/${Number(args.eventId)}/restore`,
                {
                    restoreNote: args.restoreNote,
                    expectedUpdatedAt: args.expectedUpdatedAt,
                },
                '规则审核状态恢复失败'
            );
            return {
                success: true,
                intent: 'factory_rule_event_restore',
                summary: `规则已恢复为 ${data.candidate?.status || '历史审核'} 状态；当前学习证据保持不变，规则知识已同步。`,
                display: { mode: 'compact', title: '规则状态恢复' },
                data,
            };
        }

        case 'refresh_factory_rule_candidates': {
            const data = await postJson(
                internalFetch,
                '/api/quality/rule-candidates/refresh',
                {},
                '候选业务规则归纳失败'
            );
            return {
                success: true,
                intent: 'factory_rule_candidates_refresh',
                summary: `候选规则归纳完成：新增 ${data.stats?.created || 0} 条，当前有效 ${data.stats?.active || 0} 条，自动撤回批准 ${data.stats?.suspended || 0} 条，排除范围漂移证据 ${data.stats?.driftedEvidence || 0} 条、内容过期证据 ${data.stats?.outdatedEvidence || 0} 条。`,
                display: { mode: 'compact', title: '候选规则归纳' },
                data,
            };
        }

        case 'review_factory_rule_candidate': {
            if (!args.candidateId || !normalizeText(args.status)) {
                return { success: false, error: '请提供候选规则ID和目标审核状态' };
            }
            const data = await patchJson(
                internalFetch,
                `/api/quality/rule-candidates/${Number(args.candidateId)}`,
                {
                    status: args.status,
                    reviewNote: args.reviewNote,
                    expectedUpdatedAt: args.expectedUpdatedAt,
                },
                '候选业务规则审核失败'
            );
            return {
                success: true,
                intent: 'factory_rule_candidate_review',
                summary: args.status === 'approved'
                    ? '候选规则已批准，对应规则知识已自动更新并立即生效。'
                    : '候选规则审核状态已更新。',
                display: { mode: 'compact', title: '候选规则审核' },
                data,
            };
        }

        case 'get_management_action_center': {
            const data = await getJson(internalFetch, '/api/workbench/action-center', '管理待办读取失败');
            const progressSummary = String(data.progress?.summary || '').trim();
            const queueSummary = String(data.executionQueue?.summary || '').trim();
            return {
                success: true,
                intent: 'management_action_center',
                summary: [progressSummary, queueSummary].filter(Boolean).join(' ') || (
                    data.metrics?.total
                        ? `当前有 ${data.metrics.total} 项管理待办，其中 ${data.metrics.critical || 0} 项紧急、${data.metrics.high || 0} 项高优先级。`
                        : '当前没有需要处理的管理待办。'
                ),
                display: { mode: 'compact', title: '管理待办' },
                data,
            };
        }

        case 'plan_factory_workflow': {
            const data = await postJson(internalFetch, '/api/workbench/execution-plan', {
                workflowType: args.workflowType,
                goal: args.goal,
                orderId: args.orderId,
                quotationId: args.quotationId,
                actionId: args.actionId,
            }, '工厂执行计划生成失败');
            return {
                success: true,
                intent: 'factory_execution_plan',
                summary: data.summary || `已生成 ${data.metrics?.totalSteps || 0} 个执行步骤。`,
                display: { mode: 'compact', title: '工厂执行计划' },
                provenance: {
                    kind: 'live_business',
                    label: '实时业务执行计划',
                    checkedAt: data.generatedAt || null,
                },
                data,
            };
        }

        case 'execute_factory_workflow_step': {
            return executeFactoryWorkflowStep(args, {
                internalFetch,
                getJson,
                postJson,
                recordWorkflowRun,
            });
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

        case 'search_factory_file_archive_targets': {
            const query = new URLSearchParams();
            query.set('targetType', String(args.targetType || ''));
            if (args.query) query.set('query', String(args.query));
            if (args.limit) query.set('limit', String(args.limit));
            const data = await getJson(
                internalFetch,
                `/api/files/archive-targets?${query.toString()}`,
                '文件归档目标读取失败'
            );
            return {
                success: true,
                intent: 'factory_file_archive_targets',
                summary: `找到 ${Array.isArray(data) ? data.length : 0} 个可归档目标。`,
                display: { mode: 'compact', title: '文件归档目标' },
                data,
            };
        }

        case 'archive_factory_file': {
            if (!args.fileId) return { success: false, error: '缺少附件文件ID' };
            const preview = await postJson(
                internalFetch,
                `/api/files/${args.fileId}/archive-preview`,
                {
                    targetType: args.targetType,
                    targetId: args.targetId,
                    title: args.title,
                    note: args.note,
                    documentType: args.documentType,
                    tags: args.tags,
                    source: 'ai_chat',
                },
                '工厂文件归档预览失败'
            );
            const data = await postJson(
                internalFetch,
                `/api/files/${args.fileId}/archive`,
                {
                    confirmationToken: preview.confirmationToken,
                    idempotencyKey: preview.suggestedIdempotencyKey,
                },
                '工厂文件归档失败'
            );
            return {
                success: true,
                intent: 'factory_file_archived',
                summary: `文件已归档到${data.link?.target?.label || '指定业务对象'}。`,
                display: { mode: 'compact', title: '文件归档结果' },
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
            const textEvidenceMatches = Array.isArray(matches)
                ? matches.filter(item => item?.evidenceLevel !== 'semantic_candidate' && item?.matchMode !== 'vector')
                : [];
            const omittedSemanticCandidateCount = textEvidenceMatches.length > 0 && Array.isArray(matches)
                ? matches.length - textEvidenceMatches.length
                : 0;
            const safeMatches = textEvidenceMatches.length > 0 ? textEvidenceMatches : matches;
            const isExactCoilLookup = entryType === 'coil' && /^\d+\s*[-－]\s*\d+$/.test(queryText);
            const data = Array.isArray(safeMatches)
                ? await Promise.all(safeMatches.map(async item => {
                    if (!isExactCoilLookup && item?.entryType !== 'business_rule') return item;
                    const detail = await getJson(
                        internalFetch,
                        `/api/knowledge/${item.id}`,
                        item?.entryType === 'business_rule' ? '业务规则知识详情读取失败' : '线圈知识详情读取失败'
                    );
                    return {
                        ...detail,
                        matchMode: item.matchMode,
                        evidenceLevel: item.evidenceLevel,
                        exactMatch: item.exactMatch,
                        keywordRank: item.keywordRank,
                        vectorDistance: item.vectorDistance,
                        finalScore: item.finalScore,
                    };
                }))
                : safeMatches;
            const overview = await getJson(internalFetch, '/api/knowledge/overview', '知识库新鲜度读取失败');
            const sources = buildKnowledgeSources(data, overview);
            const semanticCandidateCount = Array.isArray(data)
                ? data.filter(item => item?.evidenceLevel === 'semantic_candidate' || item?.matchMode === 'vector').length
                : 0;
            const answerGuidance = buildBusinessRuleAnswerGuidance(data);
            const businessRuleSummary = answerGuidance?.businessRuleStatements?.length
                ? ` 业务规则要点：${answerGuidance.businessRuleStatements.join('；')}`
                : '';
            return {
                success: true,
                intent: 'factory_knowledge_search',
                summary: `工厂知识库返回 ${Array.isArray(data) ? data.length : 0} 条可用结果${semanticCandidateCount > 0 ? `，其中 ${semanticCandidateCount} 条仅为语义候选，不能单独作为业务结论` : ''}${omittedSemanticCandidateCount > 0 ? `；另有 ${omittedSemanticCandidateCount} 条纯语义候选因已有文本证据而未提供给回答模型` : ''}。${businessRuleSummary}`,
                display: { mode: 'compact', title: '工厂知识库' },
                retrievalGuidance: {
                    semanticCandidatesAreEvidence: false,
                    semanticCandidateCount,
                    omittedSemanticCandidateCount,
                    message: '仅当标题、摘要、正文或 metadata 明确写出用途、兼容性或配件关系时才能据此下结论；纯向量候选只用于继续核对。',
                },
                answerGuidance,
                provenance: {
                    kind: 'knowledge_snapshot',
                    label: '知识库快照',
                    checkedAt: overview.generatedAt || null,
                    hasPendingSources: sources.some(source => source.freshness !== 'fresh'),
                },
                sources,
                data,
            };
        }

        case 'get_factory_knowledge_detail': {
            if (!args.id) return { success: false, error: '缺少知识条目ID' };
            const data = await getJson(internalFetch, `/api/knowledge/${args.id}`, '知识条目读取失败');
            const overview = await getJson(internalFetch, '/api/knowledge/overview', '知识库新鲜度读取失败');
            const sources = buildKnowledgeSources(data, overview);
            return {
                success: true,
                intent: 'factory_knowledge_detail',
                summary: data.title || `知识条目 #${args.id}`,
                display: { mode: 'compact', title: '知识详情' },
                provenance: {
                    kind: 'knowledge_snapshot',
                    label: '知识库快照',
                    checkedAt: overview.generatedAt || null,
                    hasPendingSources: sources.some(source => source.freshness !== 'fresh'),
                },
                sources,
                data,
            };
        }

        case 'get_factory_knowledge_health': {
            const data = await getJson(internalFetch, '/api/knowledge/health', '知识库健康状态读取失败');
            const statusLabel = data.status === 'healthy'
                ? '正常'
                : data.status === 'critical'
                    ? '异常'
                    : '需要关注';
            return {
                success: true,
                intent: 'factory_knowledge_health',
                summary: `知识库同步状态${statusLabel}：${data.summary || '状态已检查'}。待同步 ${data.pendingTotal || 0} 条。`,
                display: { mode: 'compact', title: '知识库健康状态' },
                data,
            };
        }

        case 'sync_factory_knowledge': {
            const preview = await postJson(
                internalFetch,
                '/api/knowledge/sync-preview',
                {},
                '工厂知识库同步预览失败'
            );
            const data = await postJson(
                internalFetch,
                '/api/knowledge/sync',
                {
                    confirmationToken: preview.confirmationToken,
                    idempotencyKey: preview.suggestedIdempotencyKey,
                },
                '工厂知识库同步失败'
            );
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
