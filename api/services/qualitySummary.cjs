function loadDbAccessors() {
    return require('../db.cjs');
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return null;
    }
}

function normalize(value) {
    return String(value || '').trim();
}

function isMissingSupplier(value) {
    const supplier = normalize(value);
    return !supplier || supplier === '-' || supplier === '未指定供应商';
}

function row(kind, id, title, desc, path, meta = {}) {
    return { kind, id: String(id || title), title, desc, path, meta };
}

function issue(key, title, severity, items, suggestion) {
    return {
        key,
        title,
        severity,
        count: items.length,
        suggestion,
        items: items.slice(0, 50),
    };
}

function isCoilCalculatedPart(part) {
    return normalize(part?.name) === '线圈转子';
}

function isCableAccessoryCalculatedPart(part) {
    const model = normalize(part?.model);
    const name = normalize(part?.name);
    return model === '电缆配件费'
        || name.includes('电缆接头配件')
        || name.includes('电缆配件费');
}

function shouldRequirePartCatalogMatch(part) {
    if (!part) return false;
    if (part.dynamicRule || part.costSource) return false;
    if (isCoilCalculatedPart(part)) return false;
    if (isCableAccessoryCalculatedPart(part)) return false;
    return true;
}

function severityWeight(severity) {
    if (severity === 'danger') return 8;
    if (severity === 'warning') return 4;
    return 1;
}

function buildDataQualitySummary(options = {}) {
    let db = options.dbAccessors || null;
    const getDb = () => {
        if (!db) db = loadDbAccessors();
        return db;
    };
    const parts = options.parts || getDb().dbGetAllParts();
    const recipes = options.recipes || getDb().dbGetAllRecipes();
    const templates = options.templates || getDb().dbGetAllTemplates();
    const variants = options.variants || getDb().dbGetAllModelVariants();
    const coils = options.coils || getDb().dbGetAllCoils();
    const customers = options.customers || getDb().dbGetAllCustomers();
    const quotations = options.quotations || getDb().dbGetAllQuotations();

    const partByModel = new Map(parts.map(part => [normalize(part.model), part]));
    const shellComponentModels = new Set(parts.filter(part => part.category === '泵壳搭配').map(part => normalize(part.model)).filter(Boolean));
    const partModelCategoryCount = new Map();
    for (const part of parts) {
        const key = `${normalize(part.category)}||${normalize(part.model)}`;
        partModelCategoryCount.set(key, (partModelCategoryCount.get(key) || 0) + 1);
    }
    const coilKeySet = new Set(coils
        .filter(coil => (coil.schemeStatus || 'official') === 'official')
        .map(coil => `${Number(coil.diameterMm || (String(coil.spec).trim() === '12' ? 120 : coil.spec))}||${Number(coil.sheets || 0)}||${normalize(coil.material || '钢带')}||${normalize(coil.slotType || '小眼')}`));
    const templateIdSet = new Set(templates.map(template => Number(template.id ?? template.Id)));

    const missingPriceParts = parts
        .filter(part => Number(part.price || 0) <= 0)
        .map(part => row('part', part.id, part.model || `零件 #${part.id}`, '目录成本价为 0 或未填写，会影响成本和报价。', '/parts', { category: part.category, supplier: part.supplier }));

    const missingSupplierParts = parts
        .filter(part => isMissingSupplier(part.supplier))
        .map(part => row('part', part.id, part.model || `零件 #${part.id}`, '缺少供应商，采购计划无法可靠分组。', '/parts', { category: part.category, price: part.price }));

    const outOfStockParts = parts
        .filter(part => Number(part.stock || 0) <= 0)
        .map(part => row('part', part.id, part.model || `零件 #${part.id}`, '库存为 0，生产或采购计划需要关注。', '/parts', { category: part.category, supplier: part.supplier }));

    const duplicateParts = parts
        .filter(part => partModelCategoryCount.get(`${normalize(part.category)}||${normalize(part.model)}`) > 1)
        .map(part => row('part', part.id, part.model || `零件 #${part.id}`, '同分类下存在重复型号，AI 检索和取价可能不稳定。', '/parts', { category: part.category, supplier: part.supplier, price: part.price }));

    const recipeIssues = [];
    for (const recipe of recipes) {
        const partsJson = parseJsonArray(recipe.partsJson);
        if (!partsJson) {
            recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, 'BOM 快照解析失败，无法可靠计算成本。', '/recipes', { reason: 'bad_parts_json' }));
            continue;
        }
        if (partsJson.length === 0) {
            recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, '配方没有 BOM 零件。', '/recipes', { reason: 'empty_bom' }));
        }
        if (Number(recipe.savedTotalCost || 0) <= 0) {
            recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, '保存成本为 0 或缺失，报价和订单锁价会失真。', '/recipes', { reason: 'missing_saved_cost' }));
        }
        if (recipe.templateId && !templateIdSet.has(Number(recipe.templateId))) {
            recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, '引用的泵壳模板不存在。', '/recipes', { reason: 'missing_template', templateId: recipe.templateId }));
        }
        if (recipe.coilSpec && recipe.coilSheets) {
            const diameterMm = String(recipe.coilSpec).trim() === '12' ? 120 : Number(recipe.coilSpec);
            const key = `${diameterMm}||${Number(recipe.coilSheets || 0)}||${normalize(recipe.coilMaterial || '钢带')}||${normalize(recipe.coilSlotType || '小眼')}`;
            if (!coilKeySet.has(key)) {
                recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, '配方线圈直径/片数/材质/槽眼没有精确匹配的正式方案。', '/recipes', { reason: 'missing_coil', coilSpec: recipe.coilSpec, coilSheets: recipe.coilSheets, coilMaterial: recipe.coilMaterial, coilSlotType: recipe.coilSlotType || '小眼' }));
            }
        }
        for (const part of partsJson || []) {
            const model = normalize(part.model || part.name);
            if (model && shouldRequirePartCatalogMatch(part) && !partByModel.has(model)) {
                recipeIssues.push(row('recipe', recipe.id, recipe.name || `配方 #${recipe.id}`, `BOM 中的「${model}」未在零件库找到。`, '/recipes', { reason: 'missing_part', model }));
            }
        }
    }

    const templateIssues = [];
    for (const template of templates) {
        const shellPart = parts.find(part => part.category === '泵壳' && normalize(part.model) === normalize(template.shellModel));
        if (template.costMode === 'bundle' && !shellPart) {
            templateIssues.push(row('template', template.id, template.shellModel || `模板 #${template.id}`, '模板引用的泵壳型号不在零件库泵壳分类中。', '/recipes', { reason: 'missing_shell_part' }));
        }
        if (template.costMode === 'bundle' && Number(template.bundleCost || 0) <= 0) {
            templateIssues.push(row('template', template.id, template.shellModel || `模板 #${template.id}`, '整体计价模板缺少套件价格。', '/recipes', { reason: 'missing_bundle_cost' }));
        }
        if (template.costMode === 'components') {
            const components = parseJsonArray(template.shellComponentsJson);
            for (const component of components || []) {
                if (component?.included === false) continue;
                const componentModel = normalize(component?.model);
                if (!componentModel) {
                    templateIssues.push(row('template', template.id, template.shellModel || `模板 #${template.id}`, `自由组合组件「${component?.name || '未命名组件'}」未绑定零件型号。`, '/recipes', { reason: 'missing_component_model', componentName: component?.name }));
                } else if (!shellComponentModels.has(componentModel)) {
                    templateIssues.push(row('template', template.id, template.shellModel || `模板 #${template.id}`, `自由组合组件「${component?.name || componentModel}」的型号「${componentModel}」不在“泵壳搭配”类别中。`, '/recipes', { reason: 'missing_component_part', componentName: component?.name, model: componentModel }));
                }
            }
        }
    }

    const variantIssues = variants
        .filter(variant => variant.templateId && !templateIdSet.has(Number(variant.templateId)))
        .map(variant => row('variant', variant.id, variant.modelName || `常用配置预设 #${variant.id}`, '常用配置预设引用的模板不存在。', '/recipes', { templateId: variant.templateId }));

    const coilIssues = [];
    for (const coil of coils) {
        if (Number(coil.cost || 0) <= 0) {
            coilIssues.push(row('coil', coil.id, `${coil.spec}-${coil.sheets}`, '线圈成本为 0 或缺失。', '/coils', { reason: 'missing_cost', material: coil.material }));
        }
        if (!normalize(coil.defaultCapacitor)) {
            coilIssues.push(row('coil', coil.id, `${coil.spec}-${coil.sheets}`, '缺少默认电容，AI 自动匹配电容时信息不足。', '/coils', { reason: 'missing_capacitor', material: coil.material }));
        }
        if (!normalize(coil.defaultWireGauge)) {
            coilIssues.push(row('coil', coil.id, `${coil.spec}-${coil.sheets}`, '缺少默认搭配导线规格，浮球规格和电缆横截面积推荐不稳定。', '/coils', { reason: 'missing_wire_gauge', material: coil.material }));
        }
    }

    const customerIssues = customers
        .filter(customer => Number(customer.defaultMargin || 0) <= 0)
        .map(customer => row('customer', customer.id, customer.name || `客户 #${customer.id}`, '客户默认利润率未设置，AI 报价会回退通用默认值。', '/customers', { defaultMargin: customer.defaultMargin }));

    const quotationIssues = quotations
        .filter(quotation => Number(quotation.totalCost || 0) <= 0 || Number(quotation.totalPrice || 0) <= 0)
        .map(quotation => row('quotation', quotation.id, `报价 #${quotation.id}`, '报价总成本或总价为 0，历史报价参考价值较低。', '/quotations', { totalCost: quotation.totalCost, totalPrice: quotation.totalPrice }));

    const issues = [
        issue('missing_price_parts', '零件缺少目录成本价', 'danger', missingPriceParts, '补齐零件目录成本价，避免成本和报价失真。'),
        issue('missing_supplier_parts', '零件缺少供应商', 'warning', missingSupplierParts, '补齐供应商，采购计划才能稳定分组。'),
        issue('out_of_stock_parts', '零件库存为 0', 'warning', outOfStockParts, '优先处理常用件库存，避免生产计划中断。'),
        issue('duplicate_parts', '同分类重复零件', 'warning', duplicateParts, '合并重复型号或明确供应商差异，避免 AI 取价歧义。'),
        issue('recipe_integrity', '配方完整性问题', 'danger', recipeIssues, '修复 BOM、保存成本、模板和线圈引用。'),
        issue('template_integrity', '泵壳模板问题', 'danger', templateIssues, '整体报价模板需引用零件库泵壳；自由组合模板需为每个计入组件绑定真实零件。'),
        issue('variant_integrity', '常用配置预设问题', 'warning', variantIssues, '修正常用配置预设的模板引用。'),
        issue('coil_defaults', '线圈默认参数缺失', 'warning', coilIssues, '补齐线圈成本、电容和线径，提升自动联动质量。'),
        issue('customer_defaults', '客户默认利润率缺失', 'info', customerIssues, '给常用客户设置默认利润率，报价更稳定。'),
        issue('quotation_integrity', '历史报价金额异常', 'warning', quotationIssues, '修正总成本或总价为 0 的报价。'),
    ];

    const weightedIssueCount = issues.reduce((sum, item) => sum + item.count * severityWeight(item.severity), 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - weightedIssueCount / Math.max(1, parts.length + recipes.length + coils.length) * 10)));

    return {
        generatedAt: new Date().toISOString(),
        score,
        totals: {
            parts: parts.length,
            recipes: recipes.length,
            templates: templates.length,
            variants: variants.length,
            coils: coils.length,
            customers: customers.length,
            quotations: quotations.length,
            issueCount: issues.reduce((sum, item) => sum + item.count, 0),
            dangerCount: issues.filter(item => item.severity === 'danger').reduce((sum, item) => sum + item.count, 0),
            warningCount: issues.filter(item => item.severity === 'warning').reduce((sum, item) => sum + item.count, 0),
        },
        issues,
        topIssues: issues.filter(item => item.count > 0).sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.count - a.count).slice(0, 5),
    };
}

module.exports = { buildDataQualitySummary };
