const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const XLSX = require('@e965/xlsx');
const {
    createCanvas,
    loadImage,
    PDFDocument,
} = require('@napi-rs/canvas');
const { buildPdfBuffer } = require('../tests/helpers/pdfFixture.cjs');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const root = process.cwd();
const results = [];
let child = null;
let cookie = '';
let baseUrl = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

async function waitForHealth() {
    for (let index = 0; index < 80; index += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) return;
        } catch {
            // The isolated API may still be starting.
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('隔离 API 启动超时');
}

async function request(label, method, pathname, body, expectedStatuses = [200]) {
    const startedAt = Date.now();
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!expectedStatuses.includes(response.status)) {
        throw new Error(
            `${label} ${method} ${pathname} -> ${response.status}: ${text.slice(0, 300)}`
        );
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return { response, payload };
}

async function requestForm(label, pathname, form, expectedStatuses = [200]) {
    const startedAt = Date.now();
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!expectedStatuses.includes(response.status)) {
        throw new Error(`${label} POST ${pathname} -> ${response.status}: ${text.slice(0, 300)}`);
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return { response, payload };
}

async function requestDownload(label, pathname) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}${pathname}`, {
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(20000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
        throw new Error(`${label} GET ${pathname} -> ${response.status}: ${bytes.toString('utf8').slice(0, 300)}`);
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return bytes;
}

async function waitForAutomaticKnowledgeUpdate(part, expectedPrice) {
    let lastStatus = null;
    for (let index = 0; index < 40; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const overviewResponse = await fetch(`${baseUrl}/api/knowledge/overview`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const overview = (await overviewResponse.json()).data;
        lastStatus = overview?.autoSync;
        if (
            !lastStatus?.enabled
            || lastStatus.running
            || lastStatus.pending
            || lastStatus.lastMode !== 'automatic'
            || !lastStatus.lastCompletedAt
        ) {
            continue;
        }

        const params = new URLSearchParams({
            query: part.model,
            sourceTable: 'parts',
            limit: '10',
        });
        const searchResponse = await fetch(`${baseUrl}/api/knowledge?${params}`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const entries = (await searchResponse.json()).data || [];
        const entry = entries.find(item => String(item.sourceId) === String(part.id));
        if (!entry) continue;

        const detailResponse = await fetch(`${baseUrl}/api/knowledge/${entry.id}`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const detail = (await detailResponse.json()).data;
        if (detail?.content?.includes(String(expectedPrice))) {
            results.push({ label: '业务变更自动刷新知识', status: 200, ms: 0 });
            return;
        }
    }
    throw new Error(`知识自动刷新超时: ${JSON.stringify(lastStatus)}`);
}

async function readCoreResources() {
    const paths = [
        ['零件列表', '/api/parts'],
        ['配方列表', '/api/recipes'],
        ['模板列表', '/api/templates'],
        ['型号配置列表', '/api/model-variants'],
        ['订单列表', '/api/orders'],
        ['线圈列表', '/api/coils'],
        ['定子组合列表', '/api/coils/variants'],
        ['线圈规格列表', '/api/coils/specs'],
        ['转子历史', '/api/rotor/history'],
        ['转子订单型号', '/api/rotor/order-pump-models'],
        ['转子关联目标', '/api/rotor/link-targets'],
        ['系统设置', '/api/settings'],
        ['系统初始化设置', '/api/settings/runtime'],
        ['客户列表', '/api/customers'],
        ['报价列表', '/api/quotations'],
        ['工作台汇总', '/api/workbench/summary'],
        ['管理待办', '/api/workbench/action-center'],
        ['数据质量', '/api/quality/summary'],
        ['经营提醒', '/api/quality/business-alerts'],
        ['规则执行', '/api/quality/rule-compliance'],
        ['学习证据健康', '/api/quality/rule-learning-health?limit=20'],
        ['规则候选', '/api/quality/rule-candidates'],
        ['规则历史', '/api/quality/rule-events'],
        ['知识概况', '/api/knowledge/overview'],
        ['知识向量能力', '/api/knowledge/vector-health'],
        ['知识向量同步记录', '/api/knowledge/vector-sync-runs?limit=5'],
        ['知识搜索', '/api/knowledge?query=V750&limit=5'],
        ['AI 会话列表', '/api/ai/conversations?limit=5'],
        ['AI 模型能力', '/api/ai/capabilities'],
        ['AI 问题反馈', '/api/ai/feedback?limit=5'],
        ['AI 回归概况', '/api/ai/evaluations/overview'],
    ];
    const resources = {};
    for (const [label, pathname] of paths) {
        resources[label] = (await request(label, 'GET', pathname)).payload;
    }
    return resources;
}

async function testResourceDetails(resources) {
    const parts = resources['零件列表'].data;
    const recipes = resources['配方列表'].data;
    const templates = resources['模板列表'].data;
    const orders = resources['订单列表'].data;
    const coils = resources['线圈列表'].data;
    const knowledge = resources['知识搜索'].data;
    assert(
        parts.length > 0 && recipes.length > 0 && templates.length > 0 && coils.length > 0,
        '核心基础资料为空'
    );

    const recipe = recipes[0];
    const template = templates[0];
    const coil = coils[0];
    await request('配方详情', 'GET', `/api/recipes/${recipe.id}`);
    const inventoryStatus = (await request(
        '配方库存状态',
        'GET',
        `/api/recipes/${recipe.id}/inventory-status`
    )).payload.data;
    const coilInventory = inventoryStatus.items.find(item => item.inventoryType === 'coil');
    if (JSON.parse(recipe.partsJson || '[]').some(item => item.name === '线圈转子')) {
        assert(coilInventory, '配方库存状态未识别线圈转子');
        assert(coilInventory.coilId, '配方库存状态未关联正式线圈方案');
        assert(coilInventory.status !== 'missing', '线圈转子被错误标记为零件缺失');
    }
    await request('配方技术文件', 'GET', `/api/recipes/${recipe.id}/technical-files`);
    await request('配方当前成本', 'GET', `/api/recipes/${recipe.id}/cost`);
    await request('配方成本预览', 'POST', `/api/recipes/${recipe.id}/cost-preview`, {});
    await request('配方智能检查', 'POST', '/api/quality/recipe-analysis', {
        recipeId: recipe.id,
    });
    await request('模板详情', 'GET', `/api/templates/${template.id}`);
    await request('模板成本', 'GET', `/api/templates/${template.id}/cost`);
    await request('模板默认配方', 'GET', `/api/templates/${template.id}/default-recipe`);
    await request('模板引用配方', 'GET', `/api/templates/${template.id}/recipes`);
    await request('模板应用草稿', 'POST', `/api/templates/${template.id}/apply`, {
        recipe: { name: '深度测试草稿' },
    });
    await request('线圈库存流水', 'GET', `/api/coils/${coil.id}/stock-movements`);
    await request('线圈规格草稿', 'POST', '/api/coils/spec-draft', {
        spec: coil.spec,
        material: coil.material,
        slotType: coil.slotType,
    });
    await request('线圈成本计算', 'POST', '/api/coils/calculate', {
        spec: coil.spec,
        sheets: coil.sheets,
        material: coil.material,
        slotType: coil.slotType,
    });
    await request('订单采购草稿', 'POST', '/api/orders/purchase-plan', {
        items: [{
            recipeId: recipe.id,
            recipeName: recipe.name,
            qty: 1,
            partsJson: recipe.partsJson,
        }],
    });
    await request(
        '历史订单价格',
        'GET',
        `/api/orders/history-price/${encodeURIComponent(recipe.name)}`
    );
    if (orders.length > 0) await request('订单详情', 'GET', `/api/orders/${orders[0].id}`);
    if (knowledge.length > 0) {
        await request('知识详情', 'GET', `/api/knowledge/${knowledge[0].id}`);
    }
    return { recipe, coil };
}

async function createBundleTemplate(unique, suffix = '') {
    return (await request(`新增模板${suffix}`, 'POST', '/api/templates', {
        shellModel: `${unique}-SHELL${suffix}`,
        description: '隔离验收模板',
        partsJson: '[]',
        shellComponentsJson: '[]',
        rotorParamsJson: '{}',
        assemblyWage: 1,
        packingWage: 1,
        paintingWage: null,
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 0,
        costMode: 'bundle',
        bundleCost: 100,
        bundleNote: '自动验收',
    })).payload.data;
}

async function testCrossModuleWriteFlow(baseResources) {
    const unique = `DEEP-${Date.now()}`;
    const baseRecipe = baseResources.recipe;
    const baseCoil = baseResources.coil;

    const part = (await request('新增零件', 'POST', '/api/parts', {
        model: unique,
        category: '测试件',
        price: 12.34,
        supplier: '自动验收',
        stock: 5,
        remark: '隔离数据库',
    })).payload.data;
    await request('修改零件', 'PATCH', `/api/parts/${part.id}`, {
        price: 13.21,
        remark: '已修改',
    });
    await request('批量调价', 'PATCH', '/api/parts/prices', {
        updates: [{ partId: part.id, price: 14.56 }],
    });
    await request('批量库存', 'POST', '/api/parts/batch-stock', {
        operations: [{ partId: part.id, delta: 2 }],
    });
    await waitForAutomaticKnowledgeUpdate(part, 14.56);
    const automaticHistory = (await request(
        '自动知识同步历史',
        'GET',
        '/api/knowledge/sync-runs?limit=10'
    )).payload.data;
    assert(
        automaticHistory.items.some(run => run.mode === 'automatic' && run.status === 'success'),
        '业务变更后没有生成自动知识同步历史'
    );
    const automaticHealth = (await request(
        '自动知识同步健康',
        'GET',
        '/api/knowledge/health'
    )).payload.data;
    assert(
        automaticHealth.status === 'healthy' && automaticHealth.issues.length === 0,
        `自动同步完成后健康状态异常: ${JSON.stringify(automaticHealth)}`
    );

    const template = await createBundleTemplate(unique);
    await request('修改模板', 'PATCH', `/api/templates/${template.id}`, {
        description: '隔离验收模板已修改',
    });
    const variantInput = {
        modelName: `${unique}-MODEL`,
        templateId: template.id,
        coilSpec: baseCoil.spec,
        coilSheets: baseCoil.sheets,
        coilMaterial: baseCoil.material,
        coilSlotType: baseCoil.slotType,
        longScrewExtraLength: 0,
        note: '自动验收',
        customFieldsJson: '[]',
    };
    const variant = (await request(
        '新增型号配置',
        'POST',
        '/api/model-variants',
        variantInput
    )).payload.data;
    await request('修改型号配置', 'PATCH', `/api/model-variants/${variant.id}`, {
        ...variantInput,
        longScrewExtraLength: 1,
        note: '自动验收已修改',
    });
    await request('型号配置配方草稿', 'POST', '/api/recipes/model-variant-draft', {
        modelVariantId: variant.id,
    });

    const recipeInput = {
        ...baseRecipe,
        id: undefined,
        name: `${unique}-RECIPE`,
        templateId: template.id,
        modelVariantId: variant.id,
    };
    const recipe = (await request(
        '新增配方',
        'POST',
        '/api/recipes',
        recipeInput
    )).payload.data;
    await request('修改配方', 'PATCH', `/api/recipes/${recipe.id}`, {
        ...recipeInput,
        name: recipe.name,
        spec: '深度验收已修改',
    });
    await request('新配方成本预览', 'POST', `/api/recipes/${recipe.id}/cost-preview`, {});
    const analysis = (await request(
        '新配方智能检查',
        'POST',
        '/api/quality/recipe-analysis',
        { recipeId: recipe.id }
    )).payload.data;
    const finding = [...(analysis.missingItems || []), ...(analysis.priceAlerts || [])][0];
    if (finding) {
        await request(
            '保存检查反馈',
            'POST',
            `/api/quality/recipes/${recipe.id}/feedback`,
            {
                findingKey: finding.key,
                findingType: finding.type,
                decision: 'review',
                findingSnapshot: finding,
            }
        );
    }
    const learningFeedback = (await request(
        '保存待复核学习反馈',
        'POST',
        `/api/quality/recipes/${recipe.id}/feedback`,
        {
            findingKey: `peer_pattern:deep-smoke:${unique}`,
            findingType: 'peer_pattern',
            decision: 'confirmed',
            findingSnapshot: { title: '深度验收待复核提醒' },
        }
    )).payload.data;
    await request('修改配方触发学习反馈过期', 'PATCH', `/api/recipes/${recipe.id}`, {
        ...recipeInput,
        name: recipe.name,
        spec: '深度验收触发待复核',
    });
    const healthBeforeResolve = (await request(
        '确认学习反馈进入待复核队列',
        'GET',
        '/api/quality/rule-learning-health?limit=200'
    )).payload.data;
    assert(
        healthBeforeResolve.items.some(item => item.feedbackId === learningFeedback.id && item.needsRecheck),
        '过期学习反馈没有进入待复核队列'
    );
    const resolvedFeedback = (await request(
        '确认已消失提醒解决',
        'POST',
        `/api/quality/recipe-feedback/${learningFeedback.id}/resolve`,
        {}
    )).payload.data;
    assert(resolvedFeedback.decision === 'review' && resolvedFeedback.resolved, '待复核反馈未正确解决');
    const healthAfterResolve = (await request(
        '确认已解决反馈退出队列',
        'GET',
        '/api/quality/rule-learning-health?limit=200'
    )).payload.data;
    assert(
        !healthAfterResolve.items.some(item => item.feedbackId === learningFeedback.id),
        '已解决学习反馈仍停留在待复核队列'
    );
    await request('转子模板草稿', 'POST', '/api/rotor/template-draft', {
        templateId: template.id,
    });
    await request('转子配方草稿', 'POST', '/api/rotor/recipe-draft', {
        recipeId: recipe.id,
    });

    const customer = (await request('新增客户', 'POST', '/api/customers', {
        name: `${unique}-CUSTOMER`,
        contactInfo: '自动验收',
        defaultMargin: 0.15,
        remark: '隔离数据库',
    })).payload.data;
    await request('修改客户', 'PATCH', `/api/customers/${customer.id}`, {
        remark: '隔离数据库已修改',
    });
    const quoteInput = {
        customerId: customer.id,
        status: '草稿',
        items: [{
            baseRecipeId: recipe.id,
            baseRecipeName: recipe.name,
            qty: 2,
            margin: 1.15,
        }],
        remark: '自动深度验收',
    };
    await request('报价保存草稿', 'POST', '/api/quotations/save-payload-draft', quoteInput);
    const quotation = (await request(
        '新增报价',
        'POST',
        '/api/quotations',
        quoteInput
    )).payload.data;
    await request(
        '报价转订单预览',
        'POST',
        `/api/quotations/${quotation.id}/order-draft`,
        {}
    );
    await request('报价进入报价中', 'POST', `/api/quotations/${quotation.id}/status`, {
        status: '报价中',
    });
    await request('报价接受', 'POST', `/api/quotations/${quotation.id}/status`, {
        status: '已接受',
    });
    const workflowBeforeConvert = (await request(
        'V8报价转单计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    const conversionStep = workflowBeforeConvert.steps.find(item => item.id === 'convert_quotation');
    assert(workflowBeforeConvert.status === 'ready', '已接受报价未进入可执行计划状态');
    assert(
        conversionStep?.status === 'available'
        && conversionStep?.canExecute === true
        && conversionStep?.confirmation?.toolName === 'execute_factory_workflow_step',
        '报价转单计划没有返回受保护的跨模块执行步骤'
    );
    const failedWorkflowRun = (await request(
        'V8.4记录失败执行',
        'POST',
        '/api/workbench/execution-runs',
        {
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: quotation.id,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'failed',
            plan: workflowBeforeConvert,
            recheck: workflowBeforeConvert,
            outcomeSummary: '隔离验收模拟失败',
            error: '隔离验收模拟错误',
        },
        [201]
    )).payload.data;
    assert(failedWorkflowRun.status === 'failed', '失败执行记录状态错误');
    const retryPlan = (await request(
        'V8.4失败后恢复计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(
        retryPlan.executionHistory?.recovery?.state === 'retry_available'
        && retryPlan.executionHistory.recovery.recoverableActionIds.includes('convert_quotation'),
        '失败步骤在当前计划仍可执行时没有提供安全恢复'
    );
    const converted = (await request(
        '报价转订单',
        'POST',
        `/api/quotations/${quotation.id}/convert`,
        {},
        [201]
    )).payload.data;
    const workflowAfterConvert = (await request(
        'V8转单后计划复查',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(workflowAfterConvert.status === 'complete', '报价转单后执行计划没有自动完成');
    assert(
        workflowAfterConvert.steps.some(item => item.id === 'quotation_already_converted' && item.status === 'complete'),
        '报价转单后计划缺少防重复完成状态'
    );
    const completedWorkflowRun = (await request(
        'V8.4记录成功执行',
        'POST',
        '/api/workbench/execution-runs',
        {
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: quotation.id,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan: workflowBeforeConvert,
            result: { orderId: converted.order.id },
            recheck: workflowAfterConvert,
            outcomeSummary: `报价已转为订单 #${converted.order.id}`,
        },
        [201]
    )).payload.data;
    assert(completedWorkflowRun.attemptNumber === 2, '执行历史尝试次数没有递增');
    const workflowHistory = (await request(
        'V8.4读取执行历史',
        'GET',
        `/api/workbench/execution-runs?workflowType=quotation_to_order&subjectId=${quotation.id}`
    )).payload.data;
    assert(
        workflowHistory.metrics.completedCount === 1
        && workflowHistory.metrics.failedCount === 1
        && workflowHistory.items[0].status === 'completed',
        '执行历史没有正确汇总成功和失败'
    );
    const completedRecoveryPlan = (await request(
        'V8.4完成后防重复计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(
        completedRecoveryPlan.executionHistory?.recovery?.state === 'complete'
        && completedRecoveryPlan.metrics.executableSteps === 0,
        '已完成写操作仍被计划标记为可重复执行'
    );
    const order = (await request(
        '新订单详情',
        'GET',
        `/api/orders/${converted.order.id}`
    )).payload.data;
    const readiness = (await request(
        '订单生产准备检查',
        'GET',
        `/api/orders/${order.id}/readiness`
    )).payload.data;
    assert(
        ['ready', 'waiting_materials', 'needs_review', 'blocked'].includes(readiness.verdict),
        `订单生产准备结论无效: ${readiness.verdict}`
    );
    assert(readiness.steps.length === 6, '订单生产准备检查没有返回完整六步结果');
    assert(readiness.steps.some(item => item.key === 'parts'), '订单生产准备检查缺少零件库存步骤');
    assert(readiness.steps.some(item => item.key === 'coils'), '订单生产准备检查缺少线圈库存步骤');
    const readinessPlan = (await request(
        '订单生产准备处理方案',
        'GET',
        `/api/orders/${order.id}/readiness-plan`
    )).payload.data;
    assert(
        ['complete', 'ready_for_confirmation', 'action_required', 'needs_resolution', 'waiting'].includes(readinessPlan.planStatus),
        `订单处理方案状态无效: ${readinessPlan.planStatus}`
    );
    assert(Array.isArray(readinessPlan.steps), '订单处理方案没有返回步骤数组');
    assert(
        readinessPlan.steps.every((item, index) => Number(item.sequence) === index + 1),
        '订单处理方案步骤顺序不连续'
    );
    const readinessOverview = (await request(
        '订单生产准备总览',
        'GET',
        '/api/orders/readiness-overview'
    )).payload.data;
    assert(
        readinessOverview.metrics.totalActiveOrders === readinessOverview.items.length,
        '订单准备总览汇总数量与明细不一致'
    );
    assert(
        readinessOverview.items.some(item => Number(item.order?.id) === Number(order.id)),
        '订单准备总览没有包含当前活动订单'
    );
    assert(
        readinessOverview.metrics.attentionRequired
            === readinessOverview.metrics.blocked
                + readinessOverview.metrics.waitingMaterials
                + readinessOverview.metrics.needsReview,
        '订单准备总览关注数量计算错误'
    );
    const lookupOrders = (await request(
        '订单只读查询',
        'GET',
        `/api/orders/lookup?query=${encodeURIComponent(order.customerName)}`
    )).payload.data;
    assert(lookupOrders.some(item => Number(item.id) === Number(order.id)), '订单只读查询未返回目标订单');
    const pendingOrder = (await request(
        '新增待确认订单用于方案执行',
        'POST',
        '/api/orders',
        {
            customerName: `${order.customerName}-方案执行`,
            contractNo: `${unique}-ACTION`,
            remark: '订单方案执行自动验收',
            items: [{
                recipeId: recipe.id,
                recipeName: recipe.name,
                qty: 1,
                unitCost: 14.56,
                unitPrice: 20,
                partsJson: JSON.stringify([{
                    name: '深度验收零件',
                    model: part.model,
                    supplier: part.supplier,
                    qty: 1,
                    price: 14.56,
                }]),
            }],
        }
    )).payload.data;
    const pendingPlan = (await request(
        '待确认订单处理方案',
        'GET',
        `/api/orders/${pendingOrder.id}/readiness-plan`
    )).payload.data;
    const confirmStep = pendingPlan.steps.find(item => item.id === 'confirm_order');
    assert(
        confirmStep?.mode === 'confirmable' && confirmStep?.status === 'available',
        `待确认订单没有可执行的确认步骤: ${JSON.stringify(confirmStep)}`
    );
    const actionResult = (await request(
        '执行订单确认步骤',
        'POST',
        `/api/orders/${pendingOrder.id}/readiness-actions/confirm_order`,
        {}
    )).payload.data;
    assert(actionResult.action?.id === 'confirm_order', '订单方案动作返回了错误的步骤');
    assert(
        ['待采购', '采购中', '采购完成'].includes(actionResult.order?.status),
        `订单确认步骤没有进入采购流程: ${actionResult.order?.status}`
    );
    assert(
        !actionResult.nextPlan?.steps?.some(item => item.id === 'confirm_order'),
        '订单确认后重新检查仍返回确认步骤'
    );
    await request(
        '重复执行已过期订单步骤',
        'POST',
        `/api/orders/${pendingOrder.id}/readiness-actions/confirm_order`,
        {},
        [409]
    );
    await request(
        '结束方案执行测试订单',
        'POST',
        `/api/orders/${pendingOrder.id}/status`,
        actionResult.order?.status === '采购完成'
            ? { status: '已关闭' }
            : { status: '已取消', reason: '隔离方案执行验收结束' }
    );
    const purchaseList = JSON.parse(order.purchaseListJson || '[]');
    const purchaseItem = purchaseList.find(
        item => Number(item.plannedQty || item.needToBuy || 0) > 0
    );
    if (purchaseItem) {
        const plannedQty = Number(purchaseItem.plannedQty || purchaseItem.needToBuy);
        await request(
            '登记采购进度',
            'POST',
            `/api/orders/${order.id}/purchase-items/progress`,
            {
                identityKey: purchaseItem.identityKey,
                model: purchaseItem.model,
                supplier: purchaseItem.supplier,
                orderedQty: plannedQty,
                receivedQty: 0,
                stockedQty: 0,
            }
        );
    }
    await request('取消测试订单', 'POST', `/api/orders/${order.id}/status`, {
        status: '已取消',
        reason: '隔离深度验收结束',
    });
    const cancelledReadiness = (await request(
        '已取消订单不再执行生产准备检查',
        'GET',
        `/api/orders/${order.id}/readiness`
    )).payload.data;
    assert(cancelledReadiness.verdict === 'not_applicable', '已取消订单仍被判定为可生产');
    const cancelledPlan = (await request(
        '已取消订单不生成处理方案',
        'GET',
        `/api/orders/${order.id}/readiness-plan`
    )).payload.data;
    assert(cancelledPlan.planStatus === 'not_applicable', '已取消订单仍生成了处理方案');

    const coilInput = {
        spec: baseCoil.spec,
        material: baseCoil.material,
        slotType: baseCoil.slotType,
        sheets: baseCoil.sheets,
        schemeStatus: 'testing',
        unitPrice: baseCoil.unitPrice,
        wireWeight: baseCoil.wireWeight,
        copperBase: baseCoil.copperBase,
        coilFee: baseCoil.coilFee,
        rotorFee: baseCoil.rotorFee,
        defaultWireGauge: baseCoil.defaultWireGauge,
        defaultCapacitor: baseCoil.defaultCapacitor,
    };
    const trackedCoil = (await request('新增线圈方案', 'POST', '/api/coils', {
        ...coilInput,
        schemeName: unique,
    })).payload.data;
    await request('修改线圈方案', 'PATCH', `/api/coils/${trackedCoil.id}`, {
        schemeName: `${unique}-UPDATED`,
    });
    await request('线圈库存入库', 'POST', `/api/coils/${trackedCoil.id}/stock-adjustment`, {
        changeQty: 3,
        note: '自动验收',
    });
    await request('线圈库存出库', 'POST', `/api/coils/${trackedCoil.id}/stock-adjustment`, {
        changeQty: -1,
        note: '自动验收',
    });
    await request('新线圈库存流水', 'GET', `/api/coils/${trackedCoil.id}/stock-movements`);
    const blockedDelete = await request(
        '阻止删除有库存流水的线圈',
        'DELETE',
        `/api/coils/${trackedCoil.id}`,
        undefined,
        [409]
    );
    assert(
        blockedDelete.payload.error.includes('已有库存或库存流水'),
        '线圈删除阻止说明不明确'
    );
    const cleanCoil = (await request('新增无库存线圈方案', 'POST', '/api/coils', {
        ...coilInput,
        schemeName: `${unique}-CLEAN`,
    })).payload.data;
    await request('删除无库存线圈方案', 'DELETE', `/api/coils/${cleanCoil.id}`);

    const conversation = (await request(
        '新增 AI 会话',
        'POST',
        '/api/ai/conversations',
        { title: '自动深度验收' },
        [201]
    )).payload.data;
    const message = (await request(
        '保存 AI 消息',
        'POST',
        `/api/ai/conversations/${conversation.id}/messages`,
        { role: 'user', content: '自动验收消息' },
        [201]
    )).payload.data;
    await request(
        '更新 AI 消息元数据',
        'PATCH',
        `/api/ai/conversations/${conversation.id}/messages/${message.id}`,
        { metadata: { test: true } }
    );
    await request('读取 AI 会话', 'GET', `/api/ai/conversations/${conversation.id}`);
    await request('删除 AI 会话', 'DELETE', `/api/ai/conversations/${conversation.id}`);

    const documentText = `型号 ${unique}\n泵壳材料 304\n叶轮直径 120mm`;
    const factoryFileForm = new FormData();
    factoryFileForm.set('file', new Blob([documentText], { type: 'text/markdown' }), `${unique}.md`);
    const factoryFile = (await requestForm(
        'V9.1统一文件上传',
        '/api/files',
        factoryFileForm,
        [201]
    )).payload.data;
    assert(factoryFile.detectedType === 'text', '统一文件没有识别为文本');
    assert(factoryFile.parserStatus === 'pending', '统一文件不应伪装成已解析');

    const duplicateFileForm = new FormData();
    duplicateFileForm.set('file', new Blob([documentText], { type: 'application/octet-stream' }), `${unique}-副本.md`);
    const duplicateFileResponse = (await requestForm(
        'V9.1统一文件哈希去重',
        '/api/files',
        duplicateFileForm,
        [200]
    )).payload;
    assert(
        duplicateFileResponse.deduplicated === true
            && duplicateFileResponse.data.id === factoryFile.id
            && duplicateFileResponse.data.duplicateCount === 2,
        '相同文件没有复用统一文件对象'
    );
    const factoryFiles = (await request(
        'V9.1统一文件列表',
        'GET',
        '/api/files?detectedType=text&limit=100'
    )).payload.data;
    assert(factoryFiles.some(item => item.id === factoryFile.id), '统一文件列表缺少上传文件');
    const unifiedDownload = await requestDownload(
        'V9.1下载统一原文件',
        `/api/files/${factoryFile.id}/download`
    );
    assert(unifiedDownload.equals(Buffer.from(documentText)), '统一文件下载内容不一致');

    const disguisedPdfForm = new FormData();
    disguisedPdfForm.set('file', new Blob(['not a pdf'], { type: 'application/pdf' }), `${unique}.pdf`);
    await requestForm('V9.1拒绝扩展名伪装', '/api/files', disguisedPdfForm, [400]);

    const pdfBuffer = buildPdfBuffer([
        [
            { text: `Pump ${unique}`, x: 72, y: 740 },
            { text: 'Flow', x: 72, y: 700 },
            { text: 'Head', x: 220, y: 700 },
            { text: '10', x: 72, y: 680 },
            { text: '35', x: 220, y: 680 },
        ],
        [
            { text: 'Result PASS', x: 72, y: 740 },
        ],
    ]);
    const pdfForm = new FormData();
    pdfForm.set('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `${unique}-report.pdf`);
    const pdfUploadResponse = (await requestForm(
        'V9.2 PDF上传自动解析',
        '/api/files',
        pdfForm,
        [201]
    )).payload;
    const pdfFile = pdfUploadResponse.data;
    assert(pdfFile.detectedType === 'pdf', 'PDF 没有识别为 PDF');
    assert(
        pdfFile.parserStatus === 'parsed',
        `PDF 上传后没有完成文字层解析: ${JSON.stringify({
            parserStatus: pdfFile.parserStatus,
            parserError: pdfFile.parserError,
            parseWarning: pdfUploadResponse.parseWarning,
        })}`
    );
    assert(pdfFile.parserSummary?.pageCount === 2, 'PDF 页数摘要不正确');
    const pdfContent = (await request(
        'V9.2 PDF按页读取解析结果',
        'GET',
        `/api/files/${pdfFile.id}/content`
    )).payload.data;
    assert(pdfContent.parsedText.includes('【第 1 页】'), 'PDF 全文缺少第 1 页定位');
    assert(pdfContent.parsedText.includes('【第 2 页】'), 'PDF 全文缺少第 2 页定位');
    assert(pdfContent.parsed.pages[0].tables[0].rows.length === 2, 'PDF 表格行没有保留');
    const reparsedPdf = (await request(
        'V9.2 PDF手动重试解析',
        'POST',
        `/api/files/${pdfFile.id}/parse`,
        {}
    )).payload.data;
    assert(reparsedPdf.parserStatus === 'parsed', 'PDF 手动重试后状态不正确');

    const orderRequirementArchive = (await request(
        'V10.2订单绑定客户要求文件',
        'POST',
        `/api/files/${pdfFile.id}/archive`,
        {
            targetType: 'order',
            targetId: order.id,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        orderRequirementArchive.link.relationRole === 'customer_requirement',
        '订单客户要求文件关联角色不正确'
    );
    const emptyRequirement = (await request(
        'V10.2读取空客户要求',
        'GET',
        `/api/orders/${order.id}/requirements`
    )).payload.data;
    assert(emptyRequirement.knowledgeStatus === 'not_confirmed', '空客户要求知识状态不正确');
    assert(
        emptyRequirement.availableFiles.some(file => file.id === pdfFile.id),
        '客户要求接口没有返回当前订单附件'
    );
    const firstRequirementText = `客户明确要求：${unique}-REQ-A 包装标签。`;
    const secondRequirementText = `客户明确要求：${unique}-REQ-B 包装标签。`;
    const requirementDraft = (await request(
        'V10.2保存客户要求草稿',
        'PUT',
        `/api/orders/${order.id}/requirements/draft`,
        {
            summaryText: firstRequirementText,
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(requirementDraft.knowledgeStatus === 'not_confirmed', '草稿被错误标记为正式知识');
    const confirmedRequirement = (await request(
        'V10.2人工确认客户要求',
        'POST',
        `/api/orders/${order.id}/requirements/confirm`,
        {}
    )).payload.data;
    assert(confirmedRequirement.knowledgeStatus === 'confirmed', '客户要求确认状态不正确');
    await request('V10.2同步确认客户要求知识', 'POST', '/api/knowledge/sync', {});
    const requirementKnowledge = (await request(
        'V10.2检索确认客户要求',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(`${unique}-REQ-A`)}&entryType=order&limit=10`
    )).payload.data;
    assert(requirementKnowledge.length === 1, '确认的客户要求没有进入订单知识');
    const requirementKnowledgeDetail = (await request(
        'V10.2读取客户要求知识详情',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        requirementKnowledgeDetail.content.includes(`${unique}-REQ-A`),
        '订单知识详情缺少人工确认客户要求'
    );
    const changedRequirement = (await request(
        'V10.2修改已确认后的草稿',
        'PUT',
        `/api/orders/${order.id}/requirements/draft`,
        {
            summaryText: secondRequirementText,
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(
        changedRequirement.knowledgeStatus === 'confirmed_with_draft',
        '修改草稿后没有保留上次确认状态'
    );
    await request('V10.2同步待确认草稿', 'POST', '/api/knowledge/sync', {});
    const knowledgeBeforeReconfirm = (await request(
        'V10.2复核待确认草稿未覆盖知识',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        knowledgeBeforeReconfirm.content.includes(`${unique}-REQ-A`)
            && !knowledgeBeforeReconfirm.content.includes(`${unique}-REQ-B`),
        '待确认草稿错误覆盖了上次确认知识'
    );
    await request(
        'V10.2重新确认客户要求',
        'POST',
        `/api/orders/${order.id}/requirements/confirm`,
        {}
    );
    await request('V10.2同步新确认客户要求', 'POST', '/api/knowledge/sync', {});
    const knowledgeAfterReconfirm = (await request(
        'V10.2复核新确认客户要求',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        knowledgeAfterReconfirm.content.includes(`${unique}-REQ-B`)
            && !knowledgeAfterReconfirm.content.includes(`${unique}-REQ-A`),
        '重新确认后订单知识没有替换旧客户要求'
    );
    await request(
        'V10.2阻止解除已确认来源文件',
        'DELETE',
        `/api/files/${pdfFile.id}/links/${orderRequirementArchive.link.id}`,
        undefined,
        [409]
    );
    const executionEvidenceArchive = (await request(
        'V10.3订单绑定执行依据文件',
        'POST',
        `/api/files/${pdfFile.id}/archive`,
        {
            targetType: 'order',
            targetId: order.id,
            relationRole: 'execution_evidence',
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        executionEvidenceArchive.link.relationRole === 'execution_evidence',
        '订单执行依据文件关联角色不正确'
    );
    const firstExecutionText = `已完成 ${unique}-EXEC-A 首批物料检查。`;
    const secondExecutionText = `因供应商延期，人工决定执行 ${unique}-EXEC-B 备用供应方案。`;
    const executionDraft = (await request(
        'V10.3新建订单执行事实草稿',
        'POST',
        `/api/orders/${order.id}/execution-records`,
        {
            phase: 'pre_production',
            recordType: 'material_preparation',
            title: '首批物料检查完成',
            summaryText: firstExecutionText,
            occurredAt: '2026-07-30T09:00:00.000Z',
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(executionDraft.knowledgeStatus === 'not_confirmed', '执行事实草稿被错误标记为正式知识');
    const confirmedExecution = (await request(
        'V10.3人工确认执行事实',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/confirm`,
        {}
    )).payload.data;
    assert(confirmedExecution.knowledgeStatus === 'confirmed', '执行事实确认状态不正确');
    await request('V10.3同步确认执行事实知识', 'POST', '/api/knowledge/sync', {});
    const executionKnowledge = (await request(
        'V10.3检索确认执行事实',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(`${unique}-EXEC-A`)}&entryType=order&limit=10`
    )).payload.data;
    assert(executionKnowledge.length === 1, '确认的执行事实没有进入订单知识');
    const changedExecution = (await request(
        'V10.3修改已确认执行事实草稿',
        'PUT',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/draft`,
        {
            phase: 'in_production',
            recordType: 'supplier_adjustment',
            title: '供应商临时调整',
            summaryText: secondExecutionText,
            occurredAt: '2026-07-30T10:00:00.000Z',
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(
        changedExecution.knowledgeStatus === 'confirmed_with_draft',
        '修改执行事实草稿后没有保留上次确认状态'
    );
    await request('V10.3同步待确认执行事实草稿', 'POST', '/api/knowledge/sync', {});
    const executionBeforeReconfirm = (await request(
        'V10.3复核待确认执行事实未覆盖知识',
        'GET',
        `/api/knowledge/${executionKnowledge[0].id}`
    )).payload.data;
    assert(
        executionBeforeReconfirm.content.includes(`${unique}-EXEC-A`)
            && !executionBeforeReconfirm.content.includes(`${unique}-EXEC-B`),
        '待确认执行事实草稿错误覆盖了上次确认知识'
    );
    await request(
        'V10.3重新确认执行事实',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/confirm`,
        {}
    );
    await request('V10.3同步新确认执行事实', 'POST', '/api/knowledge/sync', {});
    const executionAfterReconfirm = (await request(
        'V10.3复核新确认执行事实',
        'GET',
        `/api/knowledge/${executionKnowledge[0].id}`
    )).payload.data;
    assert(
        executionAfterReconfirm.content.includes(`${unique}-EXEC-B`)
            && !executionAfterReconfirm.content.includes(`${unique}-EXEC-A`),
        '重新确认后订单知识没有替换旧执行事实'
    );
    const orderKnowledgePackage = (await request(
        'V10.4读取订单知识包',
        'GET',
        `/api/orders/${order.id}/knowledge-package`
    )).payload.data;
    assert(orderKnowledgePackage.order.id === order.id, '订单知识包没有返回目标订单');
    assert(
        orderKnowledgePackage.confirmedKnowledge.customerRequirement.text.includes(`${unique}-REQ-B`),
        '订单知识包缺少人工确认客户要求'
    );
    assert(
        orderKnowledgePackage.confirmedKnowledge.executionRecords.some(item => (
            item.text.includes(`${unique}-EXEC-B`)
        )),
        '订单知识包缺少人工确认执行事实'
    );
    assert(
        orderKnowledgePackage.provenance.liveBusiness.kind === 'live_business'
            && orderKnowledgePackage.provenance.confirmedKnowledge.kind === 'human_confirmed'
            && orderKnowledgePackage.provenance.confirmedKnowledge.draftsExcluded === true,
        '订单知识包没有区分实时业务数据和人工确认事实'
    );
    assert(
        orderKnowledgePackage.sourceFiles.some(file => (
            file.id === pdfFile.id && file.relationRole === 'customer_requirement'
        ))
            && orderKnowledgePackage.sourceFiles.some(file => (
                file.id === pdfFile.id && file.relationRole === 'execution_evidence'
            )),
        '订单知识包来源文件角色不完整'
    );
    const revokedRequirement = (await request(
        'V10.2撤销客户要求知识确认',
        'POST',
        `/api/orders/${order.id}/requirements/revoke`,
        {}
    )).payload.data;
    assert(
        revokedRequirement.knowledgeStatus === 'not_confirmed'
            && revokedRequirement.draftText === secondRequirementText,
        '撤销确认后没有保留客户要求草稿'
    );
    await request('V10.2同步撤销客户要求知识', 'POST', '/api/knowledge/sync', {});
    const knowledgeAfterRevoke = (await request(
        'V10.2复核撤销后移除客户要求',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        !knowledgeAfterRevoke.content.includes(`${unique}-REQ-A`)
            && !knowledgeAfterRevoke.content.includes(`${unique}-REQ-B`),
        '撤销确认后订单知识仍保留客户要求'
    );
    await request(
        'V10.3阻止解除执行事实来源文件',
        'DELETE',
        `/api/files/${pdfFile.id}/links/${executionEvidenceArchive.link.id}`,
        undefined,
        [409]
    );
    const revokedExecution = (await request(
        'V10.3撤销执行事实知识确认',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/revoke`,
        {}
    )).payload.data;
    assert(
        revokedExecution.knowledgeStatus === 'not_confirmed'
            && revokedExecution.draftText === secondExecutionText,
        '撤销确认后没有保留执行事实草稿'
    );
    await request(
        'V10.3删除未确认执行事实草稿',
        'DELETE',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}`
    );
    const executionArchive = (await request(
        'V10.3复核执行事实时间线',
        'GET',
        `/api/orders/${order.id}/execution-records`
    )).payload.data;
    assert(executionArchive.records.length === 0, '已删除执行事实草稿仍出现在时间线');
    await request(
        'V10.3撤销后解除执行依据文件关联',
        'DELETE',
        `/api/files/${pdfFile.id}/links/${executionEvidenceArchive.link.id}`
    );
    await request(
        'V10.2撤销后解除订单文件关联',
        'DELETE',
        `/api/files/${pdfFile.id}/links/${orderRequirementArchive.link.id}`
    );

    const imageCanvas = createCanvas(1600, 600);
    const imageContext = imageCanvas.getContext('2d');
    imageContext.fillStyle = '#ffffff';
    imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageContext.fillStyle = '#111111';
    imageContext.font = 'bold 72px sans-serif';
    imageContext.fillText('PUMP DRAWING', 70, 120);
    imageContext.font = '60px sans-serif';
    imageContext.fillText('Voltage: 220V  Frequency: 60Hz', 70, 270);
    imageContext.fillText('Diameter: 35 mm', 70, 410);
    const imageBuffer = imageCanvas.toBuffer('image/png');
    const imageForm = new FormData();
    imageForm.set('file', new Blob([imageBuffer], { type: 'image/png' }), `${unique}-drawing.png`);
    const imageFile = (await requestForm(
        'V9.4 图片上传自动 OCR',
        '/api/files',
        imageForm,
        [201]
    )).payload.data;
    assert(imageFile.parserStatus === 'parsed', '图片上传后没有完成 OCR');
    assert(imageFile.parserSummary.ocrApplied === true, '图片没有记录 OCR 状态');
    assert(imageFile.parserSummary.drawingCandidateCount >= 2, '图片没有生成技术参数候选');
    const imageContent = (await request(
        'V9.4 图片读取 OCR 结果',
        'GET',
        `/api/files/${imageFile.id}/content`
    )).payload.data;
    assert(imageContent.parsedText.includes('220V'), '图片 OCR 缺少电压文字');
    assert(
        imageContent.parsed.drawingCandidates.some(
            candidate => candidate.type === 'diameter' && candidate.value === '35'
        ),
        '图片 OCR 没有保留直径候选'
    );

    const rasterImage = await loadImage(imageBuffer);
    const scannedDocument = new PDFDocument();
    const scannedPage = scannedDocument.beginPage(800, 300);
    scannedPage.drawImage(rasterImage, 0, 0, 800, 300);
    scannedDocument.endPage();
    const scannedPdfBuffer = scannedDocument.close();
    const scannedPdfForm = new FormData();
    scannedPdfForm.set(
        'file',
        new Blob([scannedPdfBuffer], { type: 'application/pdf' }),
        `${unique}-scanned.pdf`
    );
    const scannedPdfFile = (await requestForm(
        'V9.4 扫描 PDF 自动 OCR',
        '/api/files',
        scannedPdfForm,
        [201]
    )).payload.data;
    assert(scannedPdfFile.parserStatus === 'parsed', '扫描 PDF 上传后没有完成 OCR');
    assert(scannedPdfFile.parserSummary.ocrApplied === true, '扫描 PDF 没有记录 OCR 状态');
    const scannedPdfContent = (await request(
        'V9.4 扫描 PDF 按页读取 OCR',
        'GET',
        `/api/files/${scannedPdfFile.id}/content`
    )).payload.data;
    assert(scannedPdfContent.parsedText.includes('【第 1 页 OCR】'), '扫描 PDF 缺少 OCR 页码');
    assert(scannedPdfContent.parsedText.includes('60Hz'), '扫描 PDF OCR 缺少频率文字');

    const quotationWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
        quotationWorkbook,
        XLSX.utils.aoa_to_sheet([
            ['客户名称', customer.name],
            ['报价编号', `${unique}-QUOTE-FILE`],
            ['产品型号', '规格', '数量', '单价', '金额'],
            [recipe.name, recipe.spec || '', 30, 295, 8_850],
        ]),
        '客户报价'
    );
    const quotationWorkbookBuffer = XLSX.write(
        quotationWorkbook,
        { type: 'buffer', bookType: 'xlsx' }
    );
    const spreadsheetForm = new FormData();
    spreadsheetForm.set(
        'file',
        new Blob([quotationWorkbookBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${unique}-quotation.xlsx`
    );
    const spreadsheetFile = (await requestForm(
        'V9.3 Excel上传自动解析',
        '/api/files',
        spreadsheetForm,
        [201]
    )).payload.data;
    assert(spreadsheetFile.parserStatus === 'parsed', 'Excel 上传后没有完成表格解析');
    assert(spreadsheetFile.parserSummary.sheetCount === 1, 'Excel 工作表摘要不正确');
    assert(spreadsheetFile.parserSummary.rowCount === 4, 'Excel 行数摘要不正确');
    const spreadsheetContent = (await request(
        'V9.3 Excel读取解析结果',
        'GET',
        `/api/files/${spreadsheetFile.id}/content`
    )).payload.data;
    assert(spreadsheetContent.parsedText.includes('【工作表：客户报价】'), 'Excel 全文缺少工作表定位');
    assert(spreadsheetContent.parsedText.includes('[第 4 行]'), 'Excel 全文缺少行号定位');
    const quotationCountBeforeFileDraft = (await request(
        'V9.3 报价文件草稿前读取报价',
        'GET',
        '/api/quotations'
    )).payload.data.length;
    const quotationFileDraft = (await request(
        'V9.3 报价文件生成映射草稿',
        'POST',
        `/api/files/${spreadsheetFile.id}/quotation-draft`,
        {}
    )).payload.data;
    assert(quotationFileDraft.customerMatch.status === 'matched', '报价文件客户没有精确匹配');
    assert(quotationFileDraft.items[0].recipeMatch.status === 'matched', '报价文件配方没有精确匹配');
    assert(quotationFileDraft.items[0].source.rowNumber === 4, '报价文件没有保留原始行号');
    assert(quotationFileDraft.summary.readyForSaveDraft === true, '报价文件未生成可复核草稿输入');
    assert(quotationFileDraft.quotationDraftInput.items[0].qty === 30, '报价文件数量映射错误');
    const quotationCountAfterFileDraft = (await request(
        'V9.3 报价文件草稿后读取报价',
        'GET',
        '/api/quotations'
    )).payload.data.length;
    assert(
        quotationCountAfterFileDraft === quotationCountBeforeFileDraft,
        '报价文件草稿不应创建正式报价'
    );

    const archiveTargets = (await request(
        'V9.5查找配方归档目标',
        'GET',
        `/api/files/archive-targets?targetType=recipe&query=${encodeURIComponent(recipe.name)}`
    )).payload.data;
    assert(
        archiveTargets.length === 1 && archiveTargets[0].id === recipe.id,
        '文件归档没有找到唯一真实配方'
    );
    const recipeArchive = (await request(
        'V9.5归档报价文件到配方',
        'POST',
        `/api/files/${spreadsheetFile.id}/archive`,
        {
            targetType: 'recipe',
            targetId: recipe.id,
            note: '深度 API 归档验收',
            source: 'manual',
        },
        [201]
    )).payload.data;
    assert(recipeArchive.link.relationRole === 'technical_reference', '配方文件关联角色不正确');
    const recipeFileLinks = (await request(
        'V9.5按配方读取文件关联',
        'GET',
        `/api/files/links?targetType=recipe&targetId=${recipe.id}`
    )).payload.data;
    assert(
        recipeFileLinks.some(link => link.id === recipeArchive.link.id && link.file.id === spreadsheetFile.id),
        '配方没有返回归档文件'
    );
    const customerArchive = (await request(
        'V9业务页归档文件到客户',
        'POST',
        `/api/files/${spreadsheetFile.id}/archive`,
        {
            targetType: 'customer',
            targetId: customer.id,
            title: `${unique}-客户附件`,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        customerArchive.link.relationRole === 'attachment'
            && customerArchive.link.source === 'business_page',
        '客户业务页文件关联属性不正确'
    );
    const quotationArchive = (await request(
        'V9业务页归档文件到报价',
        'POST',
        `/api/files/${spreadsheetFile.id}/archive`,
        {
            targetType: 'quotation',
            targetId: quotation.id,
            title: `${unique}-报价附件`,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        quotationArchive.link.relationRole === 'quotation_source'
            && quotationArchive.link.source === 'business_page',
        '报价业务页文件关联属性不正确'
    );
    const customerFileLinks = (await request(
        'V9按客户读取业务附件',
        'GET',
        `/api/files/links?targetType=customer&targetId=${customer.id}`
    )).payload.data;
    assert(
        customerFileLinks.some(link => link.id === customerArchive.link.id && link.file.id === spreadsheetFile.id),
        '客户业务页没有返回归档文件'
    );
    const quotationFileLinks = (await request(
        'V9按报价读取业务附件',
        'GET',
        `/api/files/links?targetType=quotation&targetId=${quotation.id}`
    )).payload.data;
    assert(
        quotationFileLinks.some(link => link.id === quotationArchive.link.id && link.file.id === spreadsheetFile.id),
        '报价业务页没有返回归档文件'
    );
    await request(
        'V9.5阻止删除仍有关联的文件',
        'DELETE',
        `/api/files/${spreadsheetFile.id}`,
        undefined,
        [409]
    );

    const knowledgeArchiveTitle = `${unique}-归档PDF资料`;
    const knowledgeArchive = (await request(
        'V9.5归档 PDF 到知识库',
        'POST',
        `/api/files/${pdfFile.id}/archive`,
        {
            targetType: 'knowledge_document',
            title: knowledgeArchiveTitle,
            documentType: 'other',
            tags: [unique, '归档验收'],
            note: '统一文件归档生成',
            source: 'manual',
        },
        [201]
    )).payload.data;
    assert(knowledgeArchive.knowledgeDocument?.id > 0, '知识库归档没有创建知识资料');
    const duplicateKnowledgeArchive = (await request(
        'V9.5知识库归档去重',
        'POST',
        `/api/files/${pdfFile.id}/archive`,
        {
            targetType: 'knowledge_document',
            title: `${knowledgeArchiveTitle}-重复`,
            source: 'manual',
        },
        [200]
    )).payload;
    assert(
        duplicateKnowledgeArchive.deduplicated === true
            && duplicateKnowledgeArchive.data.knowledgeDocument.id === knowledgeArchive.knowledgeDocument.id,
        '同一文件重复归档没有复用知识资料'
    );

    const documentForm = new FormData();
    documentForm.set('documentType', 'technical_note');
    documentForm.set('title', `${unique} 技术资料`);
    documentForm.set('description', '深度 API 自动验收');
    documentForm.set('contentText', '技术参数由自动验收生成');
    documentForm.set('tags', JSON.stringify([unique, '技术资料']));
    documentForm.set('file', new Blob([documentText], { type: 'text/markdown' }), `${unique}.md`);
    const document = (await requestForm(
        '导入工厂资料',
        '/api/knowledge/documents',
        documentForm,
        [201]
    )).payload.data;
    assert(document.parserStatus === 'parsed', '文本资料没有完成解析');
    assert(document.downloadPath, '工厂资料没有下载地址');
    assert(document.fileId === factoryFile.id, '知识资料没有复用统一文件对象');
    const linkedFactoryFile = (await request(
        'V9.1统一文件解析状态升级',
        'GET',
        `/api/files/${factoryFile.id}`
    )).payload.data;
    assert(linkedFactoryFile.parserStatus === 'parsed', '统一文件没有同步已完成的解析状态');
    const documents = (await request(
        '工厂资料列表',
        'GET',
        '/api/knowledge/documents'
    )).payload.data;
    assert(documents.some(item => item.id === document.id), '工厂资料列表缺少新资料');

    await request('知识增量同步', 'POST', '/api/knowledge/sync', {});
    const syncHistory = (await request(
        '手动知识同步历史',
        'GET',
        '/api/knowledge/sync-runs?limit=10'
    )).payload.data;
    assert(
        syncHistory.items.some(run => run.mode === 'manual' && run.status === 'success'),
        '人工同步成功后没有生成同步历史'
    );
    const recoveredHealth = (await request(
        '人工恢复后知识健康',
        'GET',
        '/api/knowledge/health'
    )).payload.data;
    assert(
        recoveredHealth.status === 'healthy' && recoveredHealth.needsRecovery === false,
        `人工同步后健康状态未恢复: ${JSON.stringify(recoveredHealth)}`
    );
    const overview = (await request(
        '同步后知识概况',
        'GET',
        '/api/knowledge/overview'
    )).payload.data;
    assert(
        overview.stats.pendingTotal === 0,
        `同步后仍有 ${overview.stats.pendingTotal} 条知识待处理`
    );
    const documentKnowledge = (await request(
        '检索工厂资料知识',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(unique)}&entryType=document&limit=10`
    )).payload.data;
    assert(
        documentKnowledge.some(item => String(item.sourceId) === String(document.id)),
        '独立工厂资料没有生成知识条目'
    );
    const archivedFileKnowledge = (await request(
        'V9.5检索归档文件知识',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(knowledgeArchiveTitle)}&entryType=document&limit=10`
    )).payload.data;
    assert(
        archivedFileKnowledge.some(
            item => String(item.sourceId) === String(knowledgeArchive.knowledgeDocument.id)
        ),
        '归档文件没有进入知识检索'
    );
    const documentDetail = (await request(
        '工厂资料知识详情',
        'GET',
        `/api/knowledge/${documentKnowledge[0].id}`
    )).payload.data;
    assert(documentDetail.content.includes('泵壳材料 304'), '工厂资料提取文本没有进入知识详情');
    const downloaded = await requestDownload('下载工厂资料原件', document.downloadPath);
    assert(downloaded.equals(Buffer.from(documentText)), '工厂资料下载内容与上传内容不一致');
    await request(
        'V9.5解除配方文件关联',
        'DELETE',
        `/api/files/${spreadsheetFile.id}/links/${recipeArchive.link.id}`
    );
    await request(
        'V9解除客户文件关联',
        'DELETE',
        `/api/files/${spreadsheetFile.id}/links/${customerArchive.link.id}`
    );
    await request(
        'V9解除报价文件关联',
        'DELETE',
        `/api/files/${spreadsheetFile.id}/links/${quotationArchive.link.id}`
    );
    await request(
        'V9.5解除知识资料文件关联',
        'DELETE',
        `/api/files/${pdfFile.id}/links/${knowledgeArchive.link.id}`
    );
    await request(
        'V9.5删除归档知识资料',
        'DELETE',
        `/api/knowledge/documents/${knowledgeArchive.knowledgeDocument.id}`
    );
    await request('删除工厂资料', 'DELETE', `/api/knowledge/documents/${document.id}`);
    await request('删除未引用统一文件', 'DELETE', `/api/files/${factoryFile.id}`);
    await request('删除 PDF 验收文件', 'DELETE', `/api/files/${pdfFile.id}`);
    await request('删除图片 OCR 验收文件', 'DELETE', `/api/files/${imageFile.id}`);
    await request('删除扫描 PDF OCR 验收文件', 'DELETE', `/api/files/${scannedPdfFile.id}`);
    await request('删除 Excel 验收文件', 'DELETE', `/api/files/${spreadsheetFile.id}`);
    await request('删除资料后同步知识', 'POST', '/api/knowledge/sync', {});
    const removedDocumentKnowledge = (await request(
        '确认工厂资料知识移除',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(unique)}&entryType=document&limit=10`
    )).payload.data;
    assert(removedDocumentKnowledge.length === 0, '删除资料后对应知识仍然存在');

    await request('删除测试配方', 'DELETE', `/api/recipes/${recipe.id}`);
    await request('删除型号配置', 'DELETE', `/api/model-variants/${variant.id}`);
    await request(
        '阻止删除仍有历史配方引用的模板',
        'DELETE',
        `/api/templates/${template.id}`,
        undefined,
        [409]
    );
    const cleanTemplate = await createBundleTemplate(unique, '-CLEAN');
    await request('删除无引用模板', 'DELETE', `/api/templates/${cleanTemplate.id}`);
    await request('删除测试零件', 'DELETE', `/api/parts/${part.id}`);
    await request('删除测试客户', 'DELETE', `/api/customers/${customer.id}`);
}

async function run() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-deep-test-'));
    let childErrors = '';
    try {
        fs.cpSync(path.join(root, 'api'), path.join(temp, 'api'), { recursive: true });
        fs.copyFileSync(path.join(root, 'api.cjs'), path.join(temp, 'api.cjs'));
        fs.mkdirSync(path.join(temp, 'public', 'drawings'), { recursive: true });
        const sourceDb = new Database(path.join(root, 'pump.db'), { readonly: true });
        await sourceDb.backup(path.join(temp, 'pump.db'));
        sourceDb.close();

        const port = await getFreePort();
        baseUrl = `http://127.0.0.1:${port}`;
        child = spawn(process.execPath, ['api.cjs'], {
            cwd: temp,
            env: {
                ...process.env,
                NODE_ENV: 'development',
                PORT: String(port),
                NEXT_ORIGIN: '',
                KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
                KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
                NODE_PATH: path.join(root, 'node_modules'),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        child.stderr.on('data', chunk => {
            childErrors += chunk.toString();
        });
        await waitForHealth();

        await request('公开健康检查', 'GET', '/api/health');
        await request('未登录访问保护', 'GET', '/api/parts', undefined, [401]);
        const login = await request('登录', 'POST', '/api/auth/login', {
            password: process.env.ACCESS_PASSWORD,
        });
        cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
        assert(cookie.startsWith('token='), '登录未返回 token Cookie');
        await request('登录状态', 'GET', '/api/auth/check');

        const resources = await readCoreResources();
        const baseResources = await testResourceDetails(resources);
        await testCrossModuleWriteFlow(baseResources);

        await request('退出登录', 'POST', '/api/auth/logout', {});
        cookie = '';
        await request('退出后状态', 'GET', '/api/auth/check', undefined, [401]);

        const cloneDb = new Database(path.join(temp, 'pump.db'), { readonly: true });
        const integrity = cloneDb.prepare('PRAGMA integrity_check').get().integrity_check;
        const foreignKeys = cloneDb.prepare('PRAGMA foreign_key_check').all();
        cloneDb.close();
        assert(integrity === 'ok', `隔离数据库完整性失败: ${integrity}`);
        assert(foreignKeys.length === 0, `隔离数据库外键违规: ${foreignKeys.length}`);

        const slowest = [...results].sort((left, right) => right.ms - left.ms).slice(0, 8);
        console.log(JSON.stringify({
            passed: results.length,
            failed: 0,
            tempDatabaseIntegrity: integrity,
            tempDatabaseForeignKeyViolations: foreignKeys.length,
            slowest,
        }, null, 2));
        if (childErrors.trim()) {
            console.log(`隔离 API stderr: ${childErrors.trim().slice(0, 1000)}`);
        }
    } finally {
        if (child && !child.killed) child.kill();
        if (temp.startsWith(os.tmpdir()) && path.basename(temp).startsWith('pump-deep-test-')) {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                try {
                    fs.rmSync(temp, { recursive: true, force: true });
                    break;
                } catch {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
    }
}

run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
