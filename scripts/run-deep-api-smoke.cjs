const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

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
    const converted = (await request(
        '报价转订单',
        'POST',
        `/api/quotations/${quotation.id}/convert`,
        {},
        [201]
    )).payload.data;
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
    assert(documentKnowledge.length === 1, '独立工厂资料没有生成唯一知识条目');
    const documentDetail = (await request(
        '工厂资料知识详情',
        'GET',
        `/api/knowledge/${documentKnowledge[0].id}`
    )).payload.data;
    assert(documentDetail.content.includes('泵壳材料 304'), '工厂资料提取文本没有进入知识详情');
    const downloaded = await requestDownload('下载工厂资料原件', document.downloadPath);
    assert(downloaded.equals(Buffer.from(documentText)), '工厂资料下载内容与上传内容不一致');
    await request('删除工厂资料', 'DELETE', `/api/knowledge/documents/${document.id}`);
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
