const crypto = require('crypto');
const { buildDataQualitySummary } = require('./qualitySummary.cjs');
const { getAutoKnowledgeSyncStatus } = require('./knowledgeAutoSync.cjs');
const { listConfirmedOrderRequirementsForKnowledge } = require('./orderRequirements.cjs');
const { listConfirmedOrderExecutionRecordsForKnowledge } = require('./orderExecutionRecords.cjs');
const { parsePositiveId } = require('./validation.cjs');
const {
    buildRuleGovernanceMetadata,
    summarizeRuleGovernance,
} = require('./aiRuleGovernance.cjs');

const ENTRY_TYPES = new Set([
    'part',
    'template',
    'recipe',
    'coil',
    'customer',
    'quotation',
    'order',
    'quality_issue',
    'business_rule',
    'document',
]);

function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function compact(values) {
    return values.map(normalizeText).filter(Boolean);
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function json(value) {
    return JSON.stringify(value ?? null);
}

function hashEntry(entry) {
    return crypto
        .createHash('sha256')
        .update(json({
            entryType: entry.entryType,
            sourceTable: entry.sourceTable,
            sourceId: entry.sourceId,
            title: entry.title,
            summary: entry.summary,
            content: entry.content,
            tags: entry.tags,
            metadata: entry.metadata,
        }))
        .digest('hex');
}

function createEntry(input) {
    const tags = compact(input.tags || []);
    const metadata = input.metadata || {};
    const content = compact(Array.isArray(input.content) ? input.content : [input.content]).join('\n');
    const summary = normalizeText(input.summary);
    const title = normalizeText(input.title);
    const searchText = compact([title, summary, content, tags.join(' ')]).join('\n');
    const entry = {
        entryType: input.entryType,
        sourceTable: input.sourceTable,
        sourceId: String(input.sourceId),
        sourceUpdatedAt: input.sourceUpdatedAt || null,
        title,
        summary,
        content,
        tags,
        metadata,
        searchText,
    };
    return { ...entry, contentHash: hashEntry(entry) };
}

function partEntry(part) {
    return createEntry({
        entryType: 'part',
        sourceTable: 'parts',
        sourceId: part.id,
        sourceUpdatedAt: part.updatedAt,
        title: `零件：${part.model || part.id}`,
        summary: `${part.category || '其他'}${part.subcategory ? ` / ${part.subcategory}` : ''}，单价 ${Number(part.price || 0)} 元，库存 ${Number(part.stock || 0)}`,
        content: [
            `型号：${part.model || ''}`,
            `分类：${part.category || '其他'}${part.subcategory ? ` / ${part.subcategory}` : ''}`,
            `供应商：${part.supplier || '-'}`,
            `单价：${Number(part.price || 0)} 元`,
            `库存：${Number(part.stock || 0)}`,
            part.notes ? `备注：${part.notes}` : '',
        ],
        tags: ['零件', part.category, part.subcategory, part.model, part.supplier],
        metadata: { price: Number(part.price || 0), stock: Number(part.stock || 0), supplier: part.supplier || '-' },
    });
}

function templateEntry(template) {
    const parts = parseJsonArray(template.partsJson);
    const components = parseJsonArray(template.shellComponentsJson);
    return createEntry({
        entryType: 'template',
        sourceTable: 'pump_shell_templates',
        sourceId: template.id,
        sourceUpdatedAt: template.updatedAt,
        title: `泵壳模板：${template.shellModel || template.id}`,
        summary: `${template.costMode === 'bundle' ? '泵壳套件' : '自由搭配'}，安装工资 ${Number(template.assemblyWage || 0)}，打包工资 ${Number(template.packingWage || 0)}`,
        content: [
            `型号：${template.shellModel || ''}`,
            `说明：${template.description || ''}`,
            `计价方式：${template.costMode || 'components'}`,
            `套件价：${Number(template.bundleCost || 0)} 元`,
            `套件备注：${template.bundleNote || ''}`,
            `固定配件：${parts.map(item => `${item.model || item.name || '项目'} x ${item.qty || 1}`).join('；')}`,
            `壳体组件：${components.map(item => `${item.model || item.name || '项目'} x ${item.qty || 1}`).join('；')}`,
            `人工：安装 ${Number(template.assemblyWage || 0)}，打包 ${Number(template.packingWage || 0)}，表面处理 ${template.surfaceTreatmentMode || 'none'} ${Number(template.surfaceTreatmentCost || 0)}`,
            `转子参数：${template.rotorParamsJson || '{}'}`,
        ],
        tags: ['模板', '泵壳', template.shellModel, template.costMode, template.surfaceTreatmentMode],
        metadata: {
            costMode: template.costMode,
            bundleCost: Number(template.bundleCost || 0),
            partsCount: parts.length,
            componentsCount: components.length,
        },
    });
}

function recipeEntry(recipe, technicalFiles = []) {
    const parts = parseJsonArray(recipe.partsJson);
    const packing = parseJsonArray(recipe.packingPartsJson);
    const fileContent = technicalFiles
        .map(file => {
            const searchableReportText = normalizeText(file.extractedText)
                .split(/\r?\n/)
                .filter(line => !/^(规定点|实测点|偏差)[：:]/.test(line.trim()))
                .filter(line => {
                    const point = line.trim().match(/^测试点\d+[：:].*流量\s+([^，]+)m3\/h，扬程\s+([^，]+)m/);
                    return !point || (Number.isFinite(Number(point[1])) && Number.isFinite(Number(point[2])));
                })
                .join('\n');
            return `性能测试报告附件（不是图纸）：${file.originalName || ''}\n${searchableReportText}`;
        })
        .join('\n');
    const testReports = technicalFiles.map(file => ({
        id: Number(file.id || 0) || null,
        kind: file.reportType || 'pump_performance_test',
        label: '性能测试报告',
        fileName: file.originalName || '',
    }));
    const latestFileUpdatedAt = technicalFiles
        .map(file => file.updatedAt || file.createdAt)
        .filter(Boolean)
        .sort()
        .at(-1);
    return createEntry({
        entryType: 'recipe',
        sourceTable: 'recipes',
        sourceId: recipe.id,
        sourceUpdatedAt: [recipe.updatedAt, latestFileUpdatedAt].filter(Boolean).sort().at(-1),
        title: `配方：${recipe.name || recipe.id}`,
        summary: `${recipe.spec || '未填写规格'}，保存成本 ${Number(recipe.savedTotalCost || 0)} 元，线圈 ${recipe.coilSpec || '-'}-${recipe.coilSheets || '-'}`,
        content: [
            `名称：${recipe.name || ''}`,
            `规格：${recipe.spec || ''}`,
            `保存成本：${Number(recipe.savedTotalCost || 0)} 元`,
            `泵壳模板ID：${recipe.templateId || ''}`,
            `线圈：${recipe.coilMaterial || '钢带'} ${recipe.coilSlotType || '小眼'} ${recipe.coilSpec || ''}-${recipe.coilSheets || ''}，客户指定线重 ${recipe.coilWireWeight ?? ''}`,
            `浮球：${recipe.hasFloat ? '是' : '否'}，线径 ${recipe.floatWire || ''}，铜套 ${recipe.floatAccessoryType || 'standard'}`,
            `成品电缆：${recipe.hasCable ? '是' : '否'}，长度 ${Number(recipe.cableLength || 0)}，线径 ${recipe.cableWire || ''}，插头/规格 ${recipe.cableAccessoryType || 'standard'}`,
            `包装：${packing.map(item => `${item.model || item.name || '包材'} x ${item.qty || 1}`).join('；')}`,
            `人工和管理费：安装 ${Number(recipe.assemblyWage || 0)}，打包 ${Number(recipe.packingWage || 0)}，表面处理 ${recipe.surfaceTreatmentMode || 'none'} ${Number(recipe.surfaceTreatmentCost || 0)}，管理费 ${Number(recipe.managementFee || 0)}`,
            `BOM：${parts.map(item => `${item.model || item.name || '项目'} x ${item.qty || 1}`).join('；')}`,
            `技术档案：${recipe.technicalDataJson || '{}'}`,
            fileContent,
        ],
        tags: ['配方', recipe.name, recipe.spec, recipe.coilSpec, recipe.coilMaterial, technicalFiles.length ? '性能测试报告' : '', ...technicalFiles.map(file => file.originalName)],
        metadata: {
            savedTotalCost: Number(recipe.savedTotalCost || 0),
            templateId: recipe.templateId || null,
            partsCount: parts.length,
            coilSpec: recipe.coilSpec || '',
            coilSheets: Number(recipe.coilSheets || 0),
            technicalFileCount: technicalFiles.length,
            testReports,
        },
    });
}

const DOCUMENT_TYPE_LABELS = {
    technical_note: '技术说明',
    pump_performance_test: '性能测试报告',
    drawing: '图纸',
    spreadsheet: 'Excel 资料',
    other: '其他资料',
};

function documentEntry(document) {
    const tags = parseJsonArray(document.tagsJson);
    const metadata = parseJsonObject(document.metadataJson);
    const typeLabel = DOCUMENT_TYPE_LABELS[document.documentType] || '工厂资料';
    const metadataOnly = document.parserStatus === 'metadata_only';
    return createEntry({
        entryType: 'document',
        sourceTable: 'knowledge_documents',
        sourceId: document.id,
        sourceUpdatedAt: document.updatedAt,
        title: `${typeLabel}：${document.title || document.originalName || document.id}`,
        summary: compact([
            document.description,
            document.originalName,
            metadataOnly ? '文件正文尚未解析，仅可检索资料说明' : '',
        ]).join('；'),
        content: [
            `资料类型：${typeLabel}`,
            `标题：${document.title || ''}`,
            document.description ? `说明：${document.description}` : '',
            document.contentText ? `技术内容：\n${document.contentText}` : '',
            document.originalName ? `原始文件：${document.originalName}` : '',
            document.extractedText ? `文件提取内容：\n${document.extractedText}` : '',
            metadataOnly ? '解析状态：文件正文尚未解析，不得据此推断图纸尺寸、材料或技术参数。' : '',
        ],
        tags: ['工厂资料', typeLabel, document.title, document.originalName, ...tags],
        metadata: {
            documentId: Number(document.id),
            documentType: document.documentType,
            parserStatus: document.parserStatus,
            fileName: document.originalName || '',
            fileSize: Number(document.fileSize || 0),
            downloadPath: document.originalName
                ? `/api/knowledge/documents/${Number(document.id)}/download`
                : '',
            extractionNote: metadata.extractionNote || '',
        },
    });
}

function coilEntry(coil) {
    const coilKey = `${coil.commonName || coil.spec}-${coil.sheets}`;
    const pairedCableWireGauge = coil.defaultWireGauge || '';
    return createEntry({
        entryType: 'coil',
        sourceTable: 'coils',
        sourceId: coil.id,
        sourceUpdatedAt: coil.updatedAt,
        title: `线圈：${coilKey} ${coil.material || '钢带'} ${coil.slotType || '小眼'}`,
        summary: `${coil.schemeStatus === 'testing' ? '测试' : coil.schemeStatus === 'disabled' ? '停用' : '正式'}方案，成本 ${Number(coil.cost || 0)} 元，线重 ${Number(coil.wireWeight || 0)}kg，默认搭配电缆线径 ${pairedCableWireGauge || '-'}`,
        content: [
            `规格片数：${coilKey}`,
            `规格俗称：${coil.commonName || coil.spec}`,
            `定子直径：${coil.diameterMm || ''}mm`,
            `片数：${coil.sheets}`,
            `材质：${coil.material || '钢带'}`,
            `槽眼：${coil.slotType || '小眼'}`,
            `方案：${coil.schemeName || ''}（${coil.schemeStatus || 'official'}）`,
            `铁芯单价：${Number(coil.unitPrice || 0)}`,
            `铜重：${Number(coil.wireWeight || 0)}`,
            `铜价基数：${Number(coil.copperBase || 0)}`,
            `绕线费：${Number(coil.coilFee || 0)}`,
            `转子加工费：${Number(coil.rotorFee || 0)}`,
            `成本：${Number(coil.cost || 0)}`,
            `默认搭配电缆线径：${pairedCableWireGauge}`,
            `默认电容：${coil.defaultCapacitor || ''}`,
            `主线漆包线线径：${coil.mainWireGauge || ''}`,
            `主线数据：${coil.mainWireData || ''}`,
            `副线漆包线线径：${coil.auxWireGauge || ''}`,
            `副线数据：${coil.auxWireData || ''}`,
        ],
        tags: [
            '线圈', coilKey, coil.spec, String(coil.diameterMm || ''), String(coil.sheets), coil.material, coil.slotType, coil.schemeName, coil.schemeStatus,
            pairedCableWireGauge, coil.defaultCapacitor,
            coil.mainWireGauge, coil.mainWireData, coil.auxWireGauge, coil.auxWireData,
        ],
        metadata: {
            coilKey,
            spec: coil.spec,
            diameterMm: Number(coil.diameterMm || 0),
            sheets: Number(coil.sheets || 0),
            material: coil.material || '钢带',
            slotType: coil.slotType || '小眼',
            schemeStatus: coil.schemeStatus || 'official',
            cost: Number(coil.cost || 0),
            pairedCableWireGauge,
            defaultCapacitor: coil.defaultCapacitor || '',
        },
    });
}

function customerEntry(customer) {
    const defaultMargin = Number(customer.defaultMargin || 0);
    const defaultMarginPercent = Math.round(defaultMargin * 10000) / 100;
    return createEntry({
        entryType: 'customer',
        sourceTable: 'customers',
        sourceId: customer.id,
        sourceUpdatedAt: customer.updatedAt,
        title: `客户：${customer.name || customer.id}`,
        summary: `默认利润率 ${defaultMarginPercent}%，联系方式 ${customer.contactInfo || '-'}`,
        content: [
            `客户名称：${customer.name || ''}`,
            `联系方式：${customer.contactInfo || ''}`,
            `默认利润率：${defaultMarginPercent}%`,
            `备注：${customer.remark || ''}`,
        ],
        tags: ['客户', customer.name],
        metadata: { defaultMargin, defaultMarginPercent },
    });
}

function quotationEntry(quotation, customerById) {
    const items = parseJsonArray(quotation.itemsJson);
    const customer = customerById.get(Number(quotation.customerId));
    const createdLabel = normalizeText(quotation.createdAt || quotation.updatedAt)
        .replace('T', ' ')
        .slice(0, 16);
    return createEntry({
        entryType: 'quotation',
        sourceTable: 'quotations',
        sourceId: quotation.id,
        sourceUpdatedAt: quotation.updatedAt,
        title: `报价：${customer?.name || '未命名客户'}${createdLabel ? ` ${createdLabel}` : ''}`,
        summary: `${quotation.status || '报价中'}，成本 ${Number(quotation.totalCost || 0)}，报价 ${Number(quotation.totalPrice || 0)}`,
        content: [
            `客户：${customer?.name || quotation.customerId || ''}`,
            `状态：${quotation.status || ''}`,
            `总成本：${Number(quotation.totalCost || 0)}`,
            `总报价：${Number(quotation.totalPrice || 0)}`,
            `明细：${items.map(item => `${item.baseRecipeName || item.recipeName || '产品'} x ${item.qty || 1}，成本 ${item.unitCost ?? ''}，报价 ${item.unitPrice ?? ''}`).join('；')}`,
            `备注：${quotation.remark || ''}`,
        ],
        tags: ['报价', quotation.status, customer?.name, ...items.map(item => item.baseRecipeName || item.recipeName)],
        metadata: { customerId: quotation.customerId, status: quotation.status, totalCost: Number(quotation.totalCost || 0), totalPrice: Number(quotation.totalPrice || 0) },
    });
}

function orderEntry(order, requirement = null, executionRecords = []) {
    const items = parseJsonArray(order.itemsJson);
    const todos = parseJsonArray(order.todosJson);
    const purchaseList = parseJsonArray(order.purchaseListJson);
    const confirmedRequirement = normalizeText(requirement?.confirmedText);
    const confirmedExecutionRecords = executionRecords.filter(item => normalizeText(item.confirmedText));
    const executionUpdatedAt = confirmedExecutionRecords
        .map(item => item.confirmedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
    const executionContent = confirmedExecutionRecords.map(item => {
        const occurredAt = normalizeText(item.occurredAt).replace('T', ' ').slice(0, 16);
        return `[${item.phaseLabel || item.phase}/${item.recordTypeLabel || item.recordType}]${occurredAt ? ` ${occurredAt}` : ''} ${item.title || ''}：${item.confirmedText}`;
    }).join('\n');
    return createEntry({
        entryType: 'order',
        sourceTable: 'orders',
        sourceId: order.id,
        sourceUpdatedAt: [order.updatedAt, requirement?.confirmedAt, executionUpdatedAt].filter(Boolean).sort().at(-1),
        title: `订单：#${order.id} ${order.customerName || ''}`,
        summary: `${order.status || '待采购'}，客户 ${order.customerName || '-'}，产品 ${items.length} 项${confirmedRequirement ? '，含人工确认客户要求' : ''}${confirmedExecutionRecords.length ? `，执行档案 ${confirmedExecutionRecords.length} 条` : ''}`,
        content: [
            `客户：${order.customerName || ''}`,
            `合同号：${order.contractNo || ''}`,
            `状态：${order.status || ''}`,
            confirmedRequirement ? `客户要求（人工确认）：\n${confirmedRequirement}` : '',
            executionContent ? `执行档案（人工确认事实）：\n${executionContent}` : '',
            `产品：${items.map(item => `${item.recipeName || item.baseRecipeName || '产品'} x ${item.qty || 1}，成本 ${item.unitCost ?? ''}，售价 ${item.unitPrice ?? ''}`).join('；')}`,
            `采购：${purchaseList.map(item => `${item.model || item.name || '物料'} x ${item.needQty || item.qty || 0}，供应商 ${item.supplier || '-'}`).join('；')}`,
            `待办：${todos.map(item => `${item.text || item.title || item.model || '待办'} ${item.done ? '已完成' : '未完成'}`).join('；')}`,
            `备注：${order.remark || ''}`,
        ],
        tags: [
            '订单',
            order.status,
            order.customerName,
            order.contractNo,
            confirmedRequirement ? '客户要求' : '',
            confirmedExecutionRecords.length ? '执行档案' : '',
            ...confirmedExecutionRecords.flatMap(item => [item.phaseLabel, item.recordTypeLabel]),
            ...items.map(item => item.recipeName || item.baseRecipeName),
        ],
        metadata: {
            status: order.status,
            itemCount: items.length,
            purchaseCount: purchaseList.length,
            todoCount: todos.length,
            requirementSummaryId: requirement?.id || null,
            requirementConfirmedAt: requirement?.confirmedAt || null,
            requirementSourceFileIds: requirement?.confirmedSourceFileIds || [],
            executionRecordCount: confirmedExecutionRecords.length,
            executionRecordIds: confirmedExecutionRecords.map(item => item.id),
            executionSourceFileIds: [...new Set(confirmedExecutionRecords.flatMap(item => item.confirmedSourceFileIds || []))],
        },
    });
}

function qualityEntries(qualitySummary) {
    const entries = [];
    for (const issue of qualitySummary.issues || []) {
        if (!issue.count) continue;
        entries.push(createEntry({
            entryType: 'quality_issue',
            sourceTable: 'quality_summary',
            sourceId: issue.key,
            sourceUpdatedAt: qualitySummary.generatedAt,
            title: `质量问题：${issue.title}`,
            summary: `${issue.severity}，共 ${issue.count} 条。${issue.suggestion || ''}`,
            content: [
                `问题：${issue.title}`,
                `严重级别：${issue.severity}`,
                `数量：${issue.count}`,
                `建议：${issue.suggestion || ''}`,
                `样例：${(issue.items || []).slice(0, 20).map(item => `${item.kind || ''}#${item.id || ''} ${item.title || ''} ${item.desc || ''}`).join('；')}`,
            ],
            tags: ['质量问题', issue.key, issue.severity],
            metadata: { key: issue.key, severity: issue.severity, count: issue.count },
        }));
    }
    return entries;
}

function businessRuleEntries(settings) {
    const settingMap = new Map((settings || []).map(row => [row.key, row.value]));
    const rules = [
        {
            id: 'cost_formula',
            title: '业务规则：完整成本公式',
            summary: '完整成本 = 配件 + 线圈 + 动态配置 + 人工工资 + 包装材料 + 管理费。',
            content: [
                '配件数组成本使用 POST /api/cost/parts。',
                '配方保存成本快照使用 POST /api/recipes/cost-draft。',
                '报价和订单覆盖试算使用 POST /api/recipes/:id/cost-preview。',
                `全局管理费默认值：${settingMap.get('management_fee') ?? ''}`,
            ],
            tags: ['业务规则', '成本', '管理费'],
            metadata: { managementFee: settingMap.get('management_fee') ?? null },
        },
        {
            id: 'coil_cost_formula',
            title: '业务规则：线圈成本公式',
            summary: '线圈成本 = 线圈记录单片价 × 片数 + 铜重 × 当前铜价 + 绕线加工费 + 转子加工费。',
            content: [
                `铝线价格基数：${settingMap.get('aluminum_wire_price_per_kg') ?? ''}`,
            ],
            tags: ['业务规则', '线圈', '铜价'],
            metadata: { aluminumWirePricePerKg: settingMap.get('aluminum_wire_price_per_kg') ?? null },
        },
        {
            id: 'dynamic_accessories',
            title: '业务规则：浮球、电缆和包装',
            summary: '线材、长度、插头和规格共同组成一个成品电缆业务项；包装材料按配方 standalone/grouped 配置。',
            content: [
                '成品电缆是一个整体业务项，不把线材和插头/规格拆成两个配件或两个独立收费项目。',
                '成品电缆总成本由线材每米价格 × 长度，再加所选插头/规格成本共同构成。',
                `电缆铜套配置：${settingMap.get('cable_accessories') ?? '{}'}`,
                `浮球新界式差价：${settingMap.get('float_accessory_delta') ?? ''}`,
                '包装材料明细存于配方 packingPartsJson，旧 boxType 仅兼容回退。',
            ],
            tags: ['业务规则', '浮球', '电缆', '成品电缆', '线材', '长度', '插头', '规格', '包装'],
            metadata: {
                cableAccessories: parseJsonObject(settingMap.get('cable_accessories')),
                floatAccessoryDelta: settingMap.get('float_accessory_delta') ?? null,
            },
        },
        {
            id: 'order_workflow',
            title: '业务规则：报价订单流程',
            summary: '报价转订单先生成订单草稿；订单保存采购清单和待办快照，采购完成后由订单动作 API 入库。',
            content: [
                '报价保存前使用 /api/quotations/save-payload-draft。',
                '报价转订单使用 /api/quotations/:id/order-draft。',
                '订单保存前使用 /api/orders/save-payload-draft。',
                '订单状态为 待确认/待采购/采购中/采购完成/已关闭/已取消；采购中和采购完成由数量进度自动推导。',
            ],
            tags: ['业务规则', '报价', '订单', '采购'],
            metadata: {},
        },
        {
            id: 'cutting_shell_semantics',
            title: '业务规则：切割泵壳与配件识别',
            summary: '明确用于切割杂草的泵壳是 800平刀切割泵壳；SPA 是清水泵壳，切边长螺丝是外六角螺丝；是否随泵壳附带刀片未明确，不得推断含刀。',
            content: [
                '零件名称“800平刀切割泵壳”明确标注切割用途，可用于回答切割杂草泵壳的查询。',
                'SPA 2叶和 SPA 3叶属于清水泵壳，没有切割刀片，不得称为切割泵壳或切割专用方案。',
                '“切边6mm长螺丝”中的“切边”是螺丝名称，该零件属于外六角螺丝，不是刀片，也不是切割杂草的专用配件。',
                '“v800平刀-不配刀”明确表示不配刀，不得作为带刀的完整切割方案推荐；只有用户明确询问不配刀泵壳本体时才作为备选说明。',
                '现有来源没有明确记录 800平刀切割泵壳是否随泵壳附带刀片，不得自行回答“全套含刀”。',
            ],
            tags: ['业务规则', '切割', '杂草', '泵壳', '刀片', 'SPA', '切边长螺丝', '外六角螺丝'],
            metadata: {
                confirmedCuttingShell: '800平刀切割泵壳',
                excludedShells: ['SPA 2叶', 'SPA 3叶'],
                excludedAccessory: '切边6mm长螺丝',
                bladeInclusionStatus: 'unconfirmed',
            },
        },
    ];
    return rules.map(rule => createEntry({
        entryType: 'business_rule',
        sourceTable: 'business_rules',
        sourceId: rule.id,
        sourceUpdatedAt: new Date().toISOString(),
        ...rule,
        metadata: {
            ...rule.metadata,
            ...buildRuleGovernanceMetadata('factory_fact', {
                statement: rule.summary,
                scopeType: 'global',
            }),
        },
    }));
}

function approvedFactoryRuleEntries(rows) {
    return (rows || []).filter(row => row.status === 'approved').map(row => createEntry({
        entryType: 'business_rule',
        sourceTable: 'factory_rule_candidates',
        sourceId: String(row.id),
        sourceUpdatedAt: row.updatedAt || row.updated_at || row.approvedAt || row.approved_at,
        title: `业务规则：${row.title}`,
        summary: row.content,
        content: [
            row.content,
            `适用范围：泵壳模板 #${row.scopeRef || row.scope_ref}`,
            `证据配方数：${Number(row.evidenceCount || row.evidence_count || 0)}`,
            `学习证据：确认 ${Number(row.supportCount ?? row.support_count ?? row.evidenceCount ?? row.evidence_count ?? 0)}，特殊情况 ${Number(row.specialCaseCount || row.special_case_count || 0)}，忽略 ${Number(row.ignoredCount || row.ignored_count || 0)}，置信度 ${Math.round(Number(row.confidenceScore || row.confidence_score || 0) * 100)}%`,
            row.reviewNote || row.review_note ? `审核说明：${row.reviewNote || row.review_note}` : '',
            '执行边界：本条知识仅用于检索和追溯；实际检查由配方智能检查服务执行，不得从知识副本重复扩展规则。',
        ],
        tags: ['业务规则', '人工审核', '配方检查', row.findingKey || row.finding_key],
        metadata: {
            candidateId: row.id,
            scopeType: row.scopeType || row.scope_type,
            scopeRef: row.scopeRef || row.scope_ref,
            findingKey: row.findingKey || row.finding_key,
            evidenceCount: Number(row.evidenceCount || row.evidence_count || 0),
            supportCount: Number(row.supportCount ?? row.support_count ?? row.evidenceCount ?? row.evidence_count ?? 0),
            specialCaseCount: Number(row.specialCaseCount || row.special_case_count || 0),
            ignoredCount: Number(row.ignoredCount || row.ignored_count || 0),
            confidenceScore: Number(row.confidenceScore || row.confidence_score || 0),
            approvedAt: row.approvedAt || row.approved_at || null,
            ...buildRuleGovernanceMetadata('approved_recipe_rule', {
                statement: row.content,
                scopeType: row.scopeType || row.scope_type || 'pump_shell_template',
                scopeRef: row.scopeRef || row.scope_ref,
            }),
        },
    }));
}

function activeFactoryAiRuleEntries(rows) {
    return (rows || []).filter(row => row.status === 'active').map(row => createEntry({
        entryType: 'business_rule',
        sourceTable: 'factory_ai_rules',
        sourceId: String(row.id),
        sourceUpdatedAt: row.updatedAt || row.updated_at,
        title: `AI 操作习惯：${row.title}`,
        summary: row.instruction,
        content: [
            row.instruction,
            row.triggerText || row.trigger_text ? `来源问题：${row.triggerText || row.trigger_text}` : '',
            '来源：用户通过 AI 回答反馈明确确认的长期纠正规则。',
            '执行边界：本条知识仅用于检索和追溯；实际生效内容由本轮相关纠错提示词注入，不得从知识副本重复执行。',
        ],
        tags: ['业务规则', 'AI纠错学习', '操作习惯'],
        metadata: {
            ruleId: row.id,
            sourceFeedbackId: row.sourceFeedbackId || row.source_feedback_id || null,
            scopeType: row.scopeType || row.scope_type || 'global',
            priority: Number(row.priority || 100),
            ...buildRuleGovernanceMetadata('answer_correction', {
                statement: row.instruction,
                scopeType: row.scopeType || row.scope_type || 'global',
            }),
        },
    }));
}

function buildKnowledgeEntries(options = {}) {
    let dbAccessors = options.dbAccessors || null;
    const getDb = () => {
        if (!dbAccessors) dbAccessors = loadDbAccessors();
        return dbAccessors;
    };
    const parts = options.parts || getDb().dbGetAllParts();
    const templates = options.templates || getDb().dbGetAllTemplates();
    const recipes = options.recipes || getDb().dbGetAllRecipes();
    const technicalFiles = options.technicalFiles || getDb().dbGetAllRecipeTechnicalFiles();
    const coils = options.coils || getDb().dbGetAllCoils();
    const documents = Object.prototype.hasOwnProperty.call(options, 'documents')
        ? options.documents
        : (getDb().dbGetAllKnowledgeDocuments?.() || []);
    const customers = options.customers || getDb().dbGetAllCustomers();
    const quotations = options.quotations || getDb().dbGetAllQuotations();
    const orders = options.orders || getDb().dbGetAllOrders();
    const orderRequirements = Object.prototype.hasOwnProperty.call(options, 'orderRequirements')
        ? options.orderRequirements
        : listConfirmedOrderRequirementsForKnowledge({ dbAccessors: getDb() });
    const orderExecutionRecords = Object.prototype.hasOwnProperty.call(options, 'orderExecutionRecords')
        ? options.orderExecutionRecords
        : listConfirmedOrderExecutionRecordsForKnowledge({ dbAccessors: getDb() });
    const settings = options.settings || getDb().db.prepare('SELECT key, value, updated_at FROM system_settings ORDER BY key').all();
    let ruleCandidates = options.ruleCandidates;
    if (!Object.prototype.hasOwnProperty.call(options, 'ruleCandidates')) {
        try {
            ruleCandidates = getDb().dbGetFactoryRuleCandidates('approved');
        } catch {
            ruleCandidates = [];
        }
    }
    let factoryAiRules = options.factoryAiRules;
    if (!Object.prototype.hasOwnProperty.call(options, 'factoryAiRules')) {
        try {
            factoryAiRules = require('./factoryAiRules.cjs')
                .listFactoryAiRules({ status: 'active', limit: 200 }, { dbAccessors: getDb() })
                .items;
        } catch {
            factoryAiRules = [];
        }
    }
    const qualitySummary = options.qualitySummary || buildDataQualitySummary({
        dbAccessors: getDb(),
        parts,
        recipes,
        templates,
        coils,
        customers,
        quotations,
    });
    const customerById = new Map(customers.map(customer => [Number(customer.id), customer]));
    const requirementByOrderId = new Map(orderRequirements.map(item => [Number(item.orderId), item]));
    const executionByOrderId = new Map();
    orderExecutionRecords.forEach(item => {
        const orderId = Number(item.orderId);
        if (!executionByOrderId.has(orderId)) executionByOrderId.set(orderId, []);
        executionByOrderId.get(orderId).push(item);
    });
    const technicalFilesByRecipe = new Map();
    technicalFiles.forEach(file => {
        const recipeId = Number(file.recipeId);
        if (!technicalFilesByRecipe.has(recipeId)) technicalFilesByRecipe.set(recipeId, []);
        technicalFilesByRecipe.get(recipeId).push(file);
    });

    return [
        ...parts.map(partEntry),
        ...templates.map(templateEntry),
        ...recipes.map(recipe => recipeEntry(recipe, technicalFilesByRecipe.get(Number(recipe.id)) || [])),
        ...coils.map(coilEntry),
        ...customers.map(customerEntry),
        ...quotations.map(quotation => quotationEntry(quotation, customerById)),
        ...orders.map(order => orderEntry(
            order,
            requirementByOrderId.get(Number(order.id)) || null,
            executionByOrderId.get(Number(order.id)) || []
        )),
        ...qualityEntries(qualitySummary),
        ...businessRuleEntries(settings),
        ...approvedFactoryRuleEntries(ruleCandidates),
        ...activeFactoryAiRuleEntries(factoryAiRules),
        ...documents.map(documentEntry),
    ].filter(entry => ENTRY_TYPES.has(entry.entryType) && entry.title);
}

function rebuildFts(db) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_entries_fts'").get();
    if (!exists) return false;

    db.prepare('DELETE FROM knowledge_entries_fts').run();
    const rows = db.prepare('SELECT id, title, summary, content, tags_json FROM knowledge_entries').all();
    const insert = db.prepare('INSERT INTO knowledge_entries_fts(entry_id, title, summary, content, tags) VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) {
        insert.run(row.id, row.title || '', row.summary || '', row.content || '', parseJsonArray(row.tags_json).join(' '));
    }
    return true;
}

function countKnowledgeEntryEmbeddings(db, entryId) {
    try {
        return Number(db.prepare(`
            SELECT COUNT(*) AS count
            FROM knowledge_embeddings
            WHERE entry_id = ?
        `).get(entryId)?.count || 0);
    } catch {
        return 0;
    }
}

function requestKnowledgeVectorRefresh(details = {}) {
    try {
        return require('./knowledgeVectorAutoSync.cjs')
            .requestKnowledgeVectorSync(details);
    } catch {
        return false;
    }
}

function syncFactoryRuleKnowledgeEntry(candidateIdValue, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, hardDelete } = dbAccessors;
    const candidateId = parsePositiveId(candidateIdValue);
    if (!candidateId) {
        const error = new Error('候选规则 ID 必须是正整数');
        error.statusCode = 400;
        throw error;
    }
    const candidate = db.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(candidateId);
    if (!candidate) {
        const error = new Error('候选规则不存在');
        error.statusCode = 404;
        throw error;
    }
    const existing = db.prepare(`
        SELECT * FROM knowledge_entries
        WHERE source_table = 'factory_rule_candidates' AND source_id = ?
    `).get(String(candidateId));
    const entry = approvedFactoryRuleEntries([candidate])[0] || null;
    const now = new Date().toISOString();
    let action = 'unchanged';
    let ftsEnabled = false;
    let deletedEmbeddings = 0;

    const sync = db.transaction(() => {
        if (!entry) {
            if (existing) {
                deletedEmbeddings = countKnowledgeEntryEmbeddings(db, existing.id);
                const write = hardDelete('knowledge_entries', existing.id, options.auditContext || {});
                options.onWrite?.(write);
                action = 'deleted';
            } else {
                action = 'absent';
            }
        } else {
            const values = {
                entry_type: entry.entryType,
                source_table: entry.sourceTable,
                source_id: entry.sourceId,
                source_updated_at: entry.sourceUpdatedAt,
                title: entry.title,
                summary: entry.summary,
                content: entry.content,
                tags_json: json(entry.tags),
                metadata_json: json(entry.metadata),
                search_text: entry.searchText,
                content_hash: entry.contentHash,
                synced_at: now,
            };
            if (!existing) {
                const write = safeInsert('knowledge_entries', {
                    ...values,
                    created_at: now,
                    updated_at: now,
                }, options.auditContext || {});
                options.onWrite?.(write);
                action = 'inserted';
            } else if (existing.content_hash !== entry.contentHash) {
                const write = safeUpdate(
                    'knowledge_entries',
                    existing.id,
                    values,
                    options.auditContext || {}
                );
                options.onWrite?.(write);
                action = 'updated';
            }
        }
        ftsEnabled = rebuildFts(db);
    });
    sync();
    const vectorSyncScheduled = ['inserted', 'updated', 'deleted'].includes(action)
        ? requestKnowledgeVectorRefresh({
            reason: `factory_rule:${candidateId}`,
            deletedCount: deletedEmbeddings,
        })
        : false;

    const knowledgeEntry = db.prepare(`
        SELECT id, entry_type, source_table, source_id, title, content_hash, synced_at
        FROM knowledge_entries
        WHERE source_table = 'factory_rule_candidates' AND source_id = ?
    `).get(String(candidateId));
    return {
        candidateId,
        candidateStatus: candidate.status,
        action,
        ftsEnabled,
        vectorSyncScheduled,
        knowledgeEntry: knowledgeEntry ? {
            id: Number(knowledgeEntry.id),
            entryType: knowledgeEntry.entry_type,
            sourceTable: knowledgeEntry.source_table,
            sourceId: knowledgeEntry.source_id,
            title: knowledgeEntry.title,
            contentHash: knowledgeEntry.content_hash,
            syncedAt: knowledgeEntry.synced_at,
        } : null,
    };
}

function syncKnowledgeEntries(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const {
        db,
        safeInsert,
        safeUpdate,
        hardDelete,
        knowledgeEntryRow,
    } = dbAccessors;
    const entries = buildKnowledgeEntries({ ...options, dbAccessors });
    const now = new Date().toISOString();
    const stats = { total: entries.length, inserted: 0, updated: 0, unchanged: 0, deleted: 0, byType: {} };
    let deletedEmbeddings = 0;
    let ftsEnabled = false;
    const auditIds = [];
    const sync = db.transaction((rows) => {
        const existingRows = db.prepare('SELECT * FROM knowledge_entries').all();
        const existingBySource = new Map(existingRows.map(row => [`${row.source_table}\u0000${row.source_id}`, row]));
        const retainedIds = new Set();

        for (const entry of rows) {
            const key = `${entry.sourceTable}\u0000${entry.sourceId}`;
            const existing = existingBySource.get(key);
            const values = {
                entry_type: entry.entryType,
                source_table: entry.sourceTable,
                source_id: entry.sourceId,
                source_updated_at: entry.sourceUpdatedAt,
                title: entry.title,
                summary: entry.summary,
                content: entry.content,
                tags_json: json(entry.tags),
                metadata_json: json(entry.metadata),
                search_text: entry.searchText,
                content_hash: entry.contentHash,
                synced_at: now,
            };

            if (!existing) {
                const info = safeInsert('knowledge_entries', {
                    ...values,
                    created_at: now,
                    updated_at: now,
                }, options.auditContext);
                if (info.auditId) auditIds.push(info.auditId);
                retainedIds.add(Number(info.lastInsertRowid));
                stats.inserted += 1;
            } else {
                retainedIds.add(existing.id);
                if (existing.content_hash === entry.contentHash) {
                    stats.unchanged += 1;
                } else {
                    const write = safeUpdate(
                        'knowledge_entries',
                        existing.id,
                        values,
                        options.auditContext
                    );
                    if (write.auditId) auditIds.push(write.auditId);
                    stats.updated += 1;
                }
            }
            stats.byType[entry.entryType] = (stats.byType[entry.entryType] || 0) + 1;
        }

        const remove = typeof hardDelete === 'function'
            ? null
            : db.prepare('DELETE FROM knowledge_entries WHERE id = ?');
        for (const existing of existingRows) {
            if (retainedIds.has(existing.id)) continue;
            deletedEmbeddings += countKnowledgeEntryEmbeddings(db, existing.id);
            if (typeof hardDelete === 'function') {
                const write = hardDelete(
                    'knowledge_entries',
                    existing.id,
                    options.auditContext
                );
                if (write.auditId) auditIds.push(write.auditId);
            } else {
                remove.run(existing.id);
            }
            stats.deleted += 1;
        }

        ftsEnabled = rebuildFts(db);
    });
    sync(entries);
    const vectorSyncScheduled = options.scheduleVectorSync === false
        ? false
        : requestKnowledgeVectorRefresh({
            reason: 'knowledge_sync',
            deletedCount: deletedEmbeddings,
        });
    return {
        syncedAt: now,
        ftsEnabled,
        vectorSyncScheduled,
        deletedEmbeddings,
        auditIds,
        stats,
        sample: db.prepare('SELECT * FROM knowledge_entries ORDER BY updated_at DESC, id DESC LIMIT 5').all().map(knowledgeEntryRow),
    };
}

function normalizeEntryType(value) {
    const type = normalizeText(value);
    if (!type) return '';
    if (!ENTRY_TYPES.has(type)) throw new Error('entryType 不在允许范围内');
    return type;
}

function ftsQuery(value) {
    const words = normalizeText(value).match(/[\p{L}\p{N}_-]+/gu) || [];
    return words.slice(0, 8).map(word => `"${word.replace(/"/g, '""')}"*`).join(' ');
}

function normalizeLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function likePattern(value) {
    return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
}

function searchKnowledgeEntries(params = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, knowledgeEntryRow } = dbAccessors;
    const query = normalizeText(params.query || params.keyword);
    const entryType = normalizeEntryType(params.entryType || params.type);
    const sourceTable = normalizeText(params.sourceTable);
    const limit = normalizeLimit(params.limit ?? 10);
    const values = [];
    const filters = [];
    if (entryType) {
        filters.push('entry_type = ?');
        values.push(entryType);
    }
    if (sourceTable) {
        filters.push('source_table = ?');
        values.push(sourceTable);
    }
    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    let rows = [];
    if (query) {
        const match = ftsQuery(query);
        if (match) {
            try {
                rows = db.prepare(`
                    SELECT ke.*, bm25(knowledge_entries_fts) AS rank
                    FROM knowledge_entries_fts
                    JOIN knowledge_entries ke ON ke.id = knowledge_entries_fts.entry_id
                    ${whereSql}
                    ${whereSql ? 'AND' : 'WHERE'} knowledge_entries_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                `).all(...values, match, limit);
            } catch {
                rows = [];
            }
        }
        if (rows.length === 0) {
            rows = db.prepare(`
                SELECT * FROM knowledge_entries
                ${whereSql}
                ${whereSql ? 'AND' : 'WHERE'} search_text LIKE ? ESCAPE '\\'
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
            `).all(...values, likePattern(query), limit);
        }
    } else {
        rows = db.prepare(`
            SELECT * FROM knowledge_entries
            ${whereSql}
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
        `).all(...values, limit);
    }

    return rows.map(knowledgeEntryRow).map(row => ({
        id: row.id,
        entryType: row.entryType,
        sourceTable: row.sourceTable,
        sourceId: row.sourceId,
        title: row.title,
        summary: row.summary,
        tags: parseJsonArray(row.tagsJson),
        metadata: parseJsonObject(row.metadataJson),
        syncedAt: row.syncedAt,
        updatedAt: row.updatedAt,
    }));
}

function getKnowledgeEntryDetail(id, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, knowledgeEntryRow } = dbAccessors;
    const row = db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id);
    if (!row) return null;
    const entry = knowledgeEntryRow(row);
    return {
        ...entry,
        tags: parseJsonArray(entry.tagsJson),
        metadata: parseJsonObject(entry.metadataJson),
    };
}

function inspectKnowledgeOverview(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, knowledgeEntryRow } = dbAccessors;
    const currentEntries = options.currentEntries || buildKnowledgeEntries({ ...options, dbAccessors });
    const storedEntries = db.prepare('SELECT * FROM knowledge_entries ORDER BY updated_at DESC, id DESC')
        .all()
        .map(knowledgeEntryRow);
    const currentBySource = new Map(currentEntries.map(entry => [`${entry.sourceTable}\u0000${entry.sourceId}`, entry]));
    const storedBySource = new Map(storedEntries.map(entry => [`${entry.sourceTable}\u0000${entry.sourceId}`, entry]));
    const byType = {};
    const changes = [];
    let fresh = 0;
    let pendingInsert = 0;
    let pendingUpdate = 0;
    let pendingDelete = 0;

    const typeStats = (entryType) => {
        if (!byType[entryType]) {
            byType[entryType] = { current: 0, stored: 0, fresh: 0, pending: 0 };
        }
        return byType[entryType];
    };

    for (const entry of currentEntries) {
        const key = `${entry.sourceTable}\u0000${entry.sourceId}`;
        const stored = storedBySource.get(key);
        const stats = typeStats(entry.entryType);
        stats.current += 1;
        if (!stored) {
            stats.pending += 1;
            pendingInsert += 1;
            changes.push({
                status: 'pending_insert',
                id: null,
                entryType: entry.entryType,
                sourceTable: entry.sourceTable,
                sourceId: entry.sourceId,
                title: entry.title,
                summary: entry.summary,
                sourceUpdatedAt: entry.sourceUpdatedAt,
                syncedAt: null,
            });
        } else if (stored.contentHash !== entry.contentHash) {
            stats.pending += 1;
            pendingUpdate += 1;
            changes.push({
                status: 'pending_update',
                id: stored.id,
                entryType: entry.entryType,
                sourceTable: entry.sourceTable,
                sourceId: entry.sourceId,
                title: entry.title,
                summary: entry.summary,
                sourceUpdatedAt: entry.sourceUpdatedAt,
                syncedAt: stored.syncedAt,
            });
        } else {
            stats.fresh += 1;
            fresh += 1;
        }
    }

    for (const stored of storedEntries) {
        const stats = typeStats(stored.entryType);
        stats.stored += 1;
        const key = `${stored.sourceTable}\u0000${stored.sourceId}`;
        if (currentBySource.has(key)) continue;
        stats.pending += 1;
        pendingDelete += 1;
        changes.push({
            status: 'pending_delete',
            id: stored.id,
            entryType: stored.entryType,
            sourceTable: stored.sourceTable,
            sourceId: stored.sourceId,
            title: stored.title,
            summary: stored.summary,
            sourceUpdatedAt: stored.sourceUpdatedAt,
            syncedAt: stored.syncedAt,
        });
    }

    const lastSyncedAt = storedEntries
        .map(entry => entry.syncedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    const ftsEnabled = Boolean(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_entries_fts'"
    ).get());
    const pendingTotal = pendingInsert + pendingUpdate + pendingDelete;

    return {
        generatedAt: new Date().toISOString(),
        lastSyncedAt,
        ftsEnabled,
        autoSync: options.autoSyncStatus || getAutoKnowledgeSyncStatus(),
        stats: {
            currentTotal: currentEntries.length,
            storedTotal: storedEntries.length,
            fresh,
            pendingTotal,
            pendingInsert,
            pendingUpdate,
            pendingDelete,
        },
        ruleGovernance: summarizeRuleGovernance(currentEntries),
        byType,
        changes: changes.sort((left, right) => {
            const priority = { pending_update: 0, pending_insert: 1, pending_delete: 2 };
            return priority[left.status] - priority[right.status]
                || left.entryType.localeCompare(right.entryType)
                || left.title.localeCompare(right.title, 'zh-CN');
        }),
    };
}

module.exports = {
    ENTRY_TYPES,
    buildKnowledgeEntries,
    activeFactoryAiRuleEntries,
    documentEntry,
    syncFactoryRuleKnowledgeEntry,
    syncKnowledgeEntries,
    searchKnowledgeEntries,
    getKnowledgeEntryDetail,
    inspectKnowledgeOverview,
};
