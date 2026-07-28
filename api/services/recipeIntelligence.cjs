function loadDbAccessors() {
    return require('../db.cjs');
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(Number(value || 0) * factor) / factor;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return null;
    }
}

function median(values) {
    const sorted = values
        .map(Number)
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
    if (sorted.length === 0) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function recipeId(recipe) {
    return Number(recipe?.id ?? recipe?.Id);
}

function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function recipeParts(recipe) {
    return parseJsonArray(recipe?.parts ?? recipe?.partsJson ?? recipe?.parts_json);
}

function partRole(part) {
    const name = normalize(part?.name || part?.model)
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/\s+/g, '');
    const model = normalize(part?.model).replace(/\s+/g, '');
    const packingRole = normalize(part?.packingRole || part?.packing_role);

    if (name.includes('泵壳') || model.includes('泵壳')) return '泵壳套件';
    if (name.includes('线圈转子')) return '线圈转子';
    if (part?.cableAssembly || name.includes('成品电缆') || name === '电缆线' || model.startsWith('电缆-线径')) return '成品电缆';
    if (name.includes('浮球')) return '浮球';
    if (name.includes('出水口') || model.includes('出水口')) return '出水口';
    if (packingRole) return `包装:${packingRole}`;
    return name || model;
}

function partModel(part) {
    return normalize(part?.model || part?.name);
}

function uniqueSet(values) {
    return new Set(values.filter(Boolean));
}

function jaccard(left, right) {
    if (left.size === 0 && right.size === 0) return 1;
    const intersection = [...left].filter(value => right.has(value)).length;
    const union = new Set([...left, ...right]).size;
    return union > 0 ? intersection / union : 0;
}

function boolValue(value) {
    return value === true || value === 1 || value === '1';
}

function similarity(target, candidate) {
    const targetParts = recipeParts(target) || [];
    const candidateParts = recipeParts(candidate) || [];
    const targetRoles = uniqueSet(targetParts.map(partRole));
    const candidateRoles = uniqueSet(candidateParts.map(partRole));
    const targetModels = uniqueSet(targetParts.map(partModel));
    const candidateModels = uniqueSet(candidateParts.map(partModel));
    const sameTemplate = Number(target.templateId || target.template_id || 0) > 0
        && Number(target.templateId || target.template_id) === Number(candidate.templateId || candidate.template_id);
    const targetCoilSpec = normalize(target.coilSpec || target.coil_spec);
    const candidateCoilSpec = normalize(candidate.coilSpec || candidate.coil_spec);
    const targetCoilSheets = Number(target.coilSheets || target.coil_sheets || 0);
    const candidateCoilSheets = Number(candidate.coilSheets || candidate.coil_sheets || 0);
    const sameCoilSpec = targetCoilSpec && targetCoilSpec === candidateCoilSpec;
    const sameCoilVariant = sameCoilSpec
        && normalize(target.coilMaterial || target.coil_material || '钢带') === normalize(candidate.coilMaterial || candidate.coil_material || '钢带')
        && normalize(target.coilSlotType || target.coil_slot_type || '小眼') === normalize(candidate.coilSlotType || candidate.coil_slot_type || '小眼');
    const sameCoilSheets = targetCoilSheets > 0
        && candidateCoilSheets > 0
        && targetCoilSheets === candidateCoilSheets;
    const sameCoilConfiguration = sameCoilVariant && sameCoilSheets;
    const featureMatches = [
        boolValue(target.hasFloat ?? target.has_float) === boolValue(candidate.hasFloat ?? candidate.has_float),
        boolValue(target.hasCable ?? target.has_cable) === boolValue(candidate.hasCable ?? candidate.has_cable),
    ].filter(Boolean).length;
    const roleScore = jaccard(targetRoles, candidateRoles);
    const modelScore = jaccard(targetModels, candidateModels);
    const score = (sameTemplate ? 0.35 : 0)
        + roleScore * 0.35
        + modelScore * 0.15
        + (sameCoilSpec ? 0.03 : 0)
        + (sameCoilVariant ? 0.03 : 0)
        + (sameCoilConfiguration ? 0.03 : 0)
        + featureMatches / 2 * 0.06;

    const reasons = [];
    if (sameTemplate) reasons.push('使用同一泵壳模板');
    if (roleScore >= 0.8) reasons.push(`BOM 角色重合 ${Math.round(roleScore * 100)}%`);
    else if (roleScore >= 0.5) reasons.push(`BOM 角色重合 ${Math.round(roleScore * 100)}%`);
    if (sameCoilConfiguration) {
        reasons.push('线圈规格、片数、材质和槽眼一致');
    } else if (sameCoilVariant && targetCoilSheets > 0 && candidateCoilSheets > 0) {
        reasons.push(`线圈定子规格、材质和槽眼一致，片数不同（${targetCoilSheets} / ${candidateCoilSheets}）`);
    } else if (sameCoilVariant) {
        reasons.push('线圈定子规格、材质和槽眼一致，片数信息不完整');
    } else if (sameCoilSpec) {
        reasons.push('线圈定子规格一致');
    }

    return {
        score: round(Math.min(1, score), 3),
        reasons,
        roleScore,
        sharedRoles: [...targetRoles].filter(value => candidateRoles.has(value)),
        targetOnlyRoles: [...targetRoles].filter(value => !candidateRoles.has(value)),
        candidateOnlyRoles: [...candidateRoles].filter(value => !targetRoles.has(value)),
    };
}

function resolveRecipe(input, recipes) {
    if (input.draft) {
        return {
            ...input.draft,
            id: input.draft.id || input.recipeId || null,
            name: input.draft.name || input.recipeName || '未保存配方草稿',
        };
    }

    const requestedId = Number(input.recipeId);
    if (Number.isInteger(requestedId) && requestedId > 0) {
        const match = recipes.find(recipe => recipeId(recipe) === requestedId);
        if (!match) throw inputError(`未找到配方 #${requestedId}`);
        return match;
    }

    const requestedName = normalize(input.recipeName);
    if (!requestedName) throw inputError('请提供 recipeId、recipeName 或 draft');
    const exact = recipes.find(recipe => normalize(recipe.name) === requestedName);
    if (exact) return exact;
    const matches = recipes.filter(recipe => normalize(recipe.name).includes(requestedName));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        throw inputError(`配方名称不明确，请从以下名称中选择：${matches.slice(0, 8).map(recipe => recipe.name).join('、')}`);
    }
    throw inputError(`未找到配方：${input.recipeName}`);
}

function isShellPart(part) {
    return partRole(part) === '泵壳套件';
}

function isCoilPart(part) {
    return partRole(part) === '线圈转子';
}

function isFloatPart(part) {
    return partRole(part) === '浮球';
}

function isCablePart(part) {
    return partRole(part) === '成品电缆';
}

function isComparableFixedPart(part) {
    if (!part || part.dynamicRule || part.costSource || part.source === 'manual') return false;
    if (isShellPart(part) || isCoilPart(part) || isFloatPart(part) || isCablePart(part)) return false;
    return Number(part.snapshotPrice ?? part.price) > 0 && Boolean(partModel(part));
}

function definiteMissingItems(target, parts) {
    const results = [];
    const add = (key, title, explanation, evidence) => {
        results.push({
            key,
            type: 'configuration_conflict',
            severity: 'danger',
            confidence: 'high',
            title,
            explanation,
            evidence,
        });
    };

    if (Number(target.templateId || target.template_id || 0) > 0 && !parts.some(isShellPart)) {
        add('missing_shell', '已选择泵壳模板，但 BOM 中没有泵壳套件', '模板配置与最终 BOM 不一致，保存前应重新生成 BOM。', [`泵壳模板 ID：${target.templateId || target.template_id}`]);
    }
    if (normalize(target.coilSpec || target.coil_spec) && Number(target.coilSheets || target.coil_sheets || 0) > 0 && !parts.some(isCoilPart)) {
        add('missing_coil', '已填写线圈参数，但 BOM 中没有线圈转子', '线圈成本和物料可能未进入配方。', [`线圈：${target.coilSpec || target.coil_spec}-${target.coilSheets || target.coil_sheets}`]);
    }
    if (boolValue(target.hasFloat ?? target.has_float) && !parts.some(isFloatPart)) {
        add('missing_float', '已启用浮球，但 BOM 中没有浮球', '浮球配置没有形成实际物料。', [`浮球线径：${target.floatWire || target.float_wire || '未填写'}`]);
    }
    if (boolValue(target.hasCable ?? target.has_cable) && !parts.some(isCablePart)) {
        add('missing_cable', '已启用电缆，但 BOM 中没有成品电缆', '电缆线材和插头/规格应作为一个成品电缆业务项进入 BOM。', [`电缆长度：${Number(target.cableLength || target.cable_length || 0)}m`]);
    }
    for (const part of parts) {
        const price = Number(part.snapshotPrice ?? part.price);
        if (!Number.isFinite(price) || price <= 0) {
            add(`missing_price:${partModel(part)}`, `BOM 项目「${part.name || part.model || '未命名项目'}」没有有效价格`, '价格缺失会导致保存成本和报价失真。', [`型号：${part.model || '-'}`]);
        }
    }
    return results;
}

function inferredMissingItems(targetParts, similarRecipes) {
    if (similarRecipes.length < 2) return [];
    const targetRoles = uniqueSet(targetParts.map(partRole));
    const roleEvidence = new Map();

    for (const item of similarRecipes) {
        const parts = recipeParts(item.recipe) || [];
        const roleToPart = new Map();
        for (const part of parts) {
            const role = partRole(part);
            if (role && !roleToPart.has(role)) roleToPart.set(role, part);
        }
        for (const [role, part] of roleToPart.entries()) {
            if (!roleEvidence.has(role)) roleEvidence.set(role, []);
            roleEvidence.get(role).push({
                recipeId: recipeId(item.recipe),
                recipeName: item.recipe.name,
                model: part.model || '',
                score: item.similarity.score,
            });
        }
    }

    const results = [];
    for (const [role, evidence] of roleEvidence.entries()) {
        if (!role || targetRoles.has(role) || role === '浮球' || role === '成品电缆') continue;
        const prevalence = evidence.length / similarRecipes.length;
        if (evidence.length < 2 || prevalence < 0.67) continue;
        const models = [...new Set(evidence.map(item => item.model).filter(Boolean))];
        results.push({
            key: `peer_pattern:${role}`,
            type: 'peer_pattern',
            severity: prevalence >= 0.9 && evidence.length >= 3 ? 'warning' : 'info',
            confidence: prevalence >= 0.9 && evidence.length >= 3 ? 'medium' : 'low',
            title: `同类配方通常包含「${role.replace(/^包装:/, '')}」`,
            explanation: '这是同类配方高频模式，不代表当前配方一定错误；请结合客户和产品要求复核。',
            role,
            suggestedModels: models.slice(0, 5),
            prevalence: round(prevalence, 3),
            evidence: evidence.slice(0, 5),
        });
    }
    return results.sort((left, right) => right.prevalence - left.prevalence || left.title.localeCompare(right.title, 'zh-CN'));
}

function approvedFactoryRuleAlerts(target, targetParts, rules) {
    const templateId = Number(target.templateId || target.template_id || 0);
    if (!templateId) return { appliedRules: [], alerts: [] };
    const targetRoles = uniqueSet(targetParts.map(partRole));
    const appliedRules = [];
    const alerts = [];

    for (const rule of rules || []) {
        const status = rule.status;
        const scopeType = rule.scopeType || rule.scope_type;
        const scopeRef = String(rule.scopeRef || rule.scope_ref || '');
        const findingKey = String(rule.findingKey || rule.finding_key || '');
        if (status !== 'approved'
            || scopeType !== 'pump_shell_template'
            || scopeRef !== String(templateId)
            || !findingKey.startsWith('peer_pattern:')) {
            continue;
        }
        const role = findingKey.slice('peer_pattern:'.length);
        if (!role) continue;
        const evidence = parseJsonArray(rule.evidence || rule.evidenceJson || rule.evidence_json) || [];
        const supportCount = Number(rule.supportCount ?? rule.support_count ?? rule.evidenceCount ?? rule.evidence_count ?? evidence.length ?? 0);
        const specialCaseCount = Number(rule.specialCaseCount || rule.special_case_count || 0);
        const ignoredCount = Number(rule.ignoredCount || rule.ignored_count || 0);
        const storedConfidenceScore = Number(rule.confidenceScore || rule.confidence_score || 0);
        const confidenceScore = storedConfidenceScore > 0
            ? storedConfidenceScore
            : supportCount > 0
                ? 1
                : 0;
        const confidenceLevel = rule.confidenceLevel || rule.confidence_level || (
            supportCount >= 3 && confidenceScore >= 0.8
                ? 'high'
                : supportCount >= 2 && confidenceScore >= 0.65
                    ? 'medium'
                    : 'low'
        );
        const normalizedRule = {
            id: Number(rule.id),
            ruleKey: rule.ruleKey || rule.rule_key || '',
            title: rule.title || `模板 ${templateId} 业务规则`,
            content: rule.content || '',
            findingKey,
            role,
            evidenceCount: Number(rule.evidenceCount || rule.evidence_count || evidence.length || 0),
            supportCount,
            specialCaseCount,
            ignoredCount,
            confidenceScore,
            confidenceLevel,
            approvedAt: rule.approvedAt || rule.approved_at || null,
            reviewNote: rule.reviewNote || rule.review_note || '',
            evidence,
        };
        appliedRules.push(normalizedRule);
        if (targetRoles.has(role)) continue;

        alerts.push({
            key: `factory_rule:${normalizedRule.id}`,
            type: 'factory_rule',
            severity: 'warning',
            confidence: normalizedRule.confidenceLevel === 'high' ? 'high' : 'medium',
            title: `已批准工厂规则要求复核「${role.replace(/^包装:/, '')}」`,
            explanation: normalizedRule.content || '该项已经过人工批准，保存前应确认是否遗漏；客户定制差异可以标记为特殊情况。',
            role,
            suggestedModels: [],
            evidence: [{
                source: 'approved_factory_rule',
                ruleId: normalizedRule.id,
                ruleTitle: normalizedRule.title,
                evidenceCount: normalizedRule.evidenceCount,
                supportCount: normalizedRule.supportCount,
                specialCaseCount: normalizedRule.specialCaseCount,
                ignoredCount: normalizedRule.ignoredCount,
                confidenceScore: normalizedRule.confidenceScore,
                approvedAt: normalizedRule.approvedAt,
                reviewNote: normalizedRule.reviewNote,
            }, ...evidence.slice(0, 5)],
            rule: normalizedRule,
        });
    }

    return { appliedRules, alerts };
}

function buildPartCatalog(parts) {
    const byModel = new Map();
    for (const part of parts || []) {
        const model = partModel(part);
        if (!model) continue;
        if (!byModel.has(model)) byModel.set(model, []);
        byModel.get(model).push(part);
    }
    return byModel;
}

function findCatalogReference(part, catalog) {
    const rows = catalog.get(partModel(part)) || [];
    if (rows.length === 0) return null;
    const supplier = normalize(part.supplier);
    const exactSupplier = supplier ? rows.find(row => normalize(row.supplier) === supplier) : null;
    return exactSupplier || rows.reduce((best, row) => (
        Number(row.price || 0) > 0 && (!best || Number(row.price) < Number(best.price)) ? row : best
    ), null);
}

function priceAlerts(targetParts, similarRecipes, catalogParts) {
    const results = [];
    const catalog = buildPartCatalog(catalogParts);

    for (const part of targetParts.filter(isComparableFixedPart)) {
        const currentPrice = Number(part.snapshotPrice ?? part.price);
        const model = partModel(part);
        const role = partRole(part);
        const catalogReference = findCatalogReference(part, catalog);
        const catalogPrice = Number(catalogReference?.price);

        if (catalogReference && catalogPrice > 0) {
            const delta = currentPrice - catalogPrice;
            const deltaPercent = Math.abs(delta) / catalogPrice;
            if (Math.abs(delta) >= Math.max(1, catalogPrice * 0.3)) {
                results.push({
                    key: `catalog:${model}`,
                    type: 'catalog_price_difference',
                    severity: deltaPercent >= 0.6 ? 'warning' : 'info',
                    confidence: 'high',
                    title: `${part.name || part.model}的配方快照价与当前零件价差异较大`,
                    model: part.model || part.name,
                    role,
                    currentPrice: round(currentPrice),
                    referenceMedian: round(catalogPrice),
                    referenceMin: round(catalogPrice),
                    referenceMax: round(catalogPrice),
                    difference: round(delta),
                    differencePercent: round(delta / catalogPrice * 100, 1),
                    explanation: '这可能是历史成本快照，也可能是录入错误。请先确认是否需要刷新配方成本，不应自动覆盖。',
                    evidence: [{
                        source: 'part_catalog',
                        partId: catalogReference.id,
                        model: catalogReference.model,
                        supplier: catalogReference.supplier || '',
                        price: round(catalogPrice),
                    }],
                });
            }
        }

        const peerEvidence = [];
        for (const item of similarRecipes) {
            const peerPart = (recipeParts(item.recipe) || [])
                .find(candidate => isComparableFixedPart(candidate) && partModel(candidate) === model);
            const peerPrice = Number(peerPart?.snapshotPrice ?? peerPart?.price);
            if (peerPart && peerPrice > 0) {
                peerEvidence.push({
                    recipeId: recipeId(item.recipe),
                    recipeName: item.recipe.name,
                    price: peerPrice,
                    score: item.similarity.score,
                });
            }
        }
        if (peerEvidence.length < 2) continue;
        const peerMedian = median(peerEvidence.map(item => item.price));
        if (!peerMedian || Math.abs(currentPrice - peerMedian) < Math.max(1, peerMedian * 0.35)) continue;
        if (results.some(item => item.model === (part.model || part.name))) continue;

        const peerPrices = peerEvidence.map(item => item.price);
        results.push({
            key: `peer_price:${model}`,
            type: 'peer_price_outlier',
            severity: Math.abs(currentPrice - peerMedian) >= peerMedian * 0.6 ? 'warning' : 'info',
            confidence: peerEvidence.length >= 3 ? 'medium' : 'low',
            title: `${part.name || part.model}的价格超出同类配方常见范围`,
            model: part.model || part.name,
            role,
            currentPrice: round(currentPrice),
            referenceMedian: round(peerMedian),
            referenceMin: round(Math.min(...peerPrices)),
            referenceMax: round(Math.max(...peerPrices)),
            difference: round(currentPrice - peerMedian),
            differencePercent: round((currentPrice - peerMedian) / peerMedian * 100, 1),
            explanation: '同型号在相似配方中的快照价格差异较大，请核对型号、供应商和录入价格。',
            evidence: peerEvidence.slice(0, 5),
        });
    }

    return results.sort((left, right) => {
        const severity = { warning: 2, info: 1 };
        return severity[right.severity] - severity[left.severity]
            || Math.abs(right.differencePercent) - Math.abs(left.differencePercent);
    });
}

function confidenceForScore(score) {
    if (score >= 0.78) return 'high';
    if (score >= 0.6) return 'medium';
    return 'low';
}

function applyFeedback(findings, feedbackRows) {
    const feedbackByKey = new Map((feedbackRows || []).map(item => [
        item.findingKey || item.finding_key,
        item,
    ]));
    const active = [];
    const suppressed = [];

    for (const finding of findings) {
        const saved = feedbackByKey.get(finding.key);
        const feedback = saved ? {
            id: saved.id,
            decision: saved.decision,
            note: saved.note || '',
            updatedAt: saved.updatedAt || saved.updated_at || null,
        } : null;
        const enriched = { ...finding, feedback };
        if (feedback && (feedback.decision === 'ignored' || feedback.decision === 'special_case')) {
            suppressed.push(enriched);
        } else {
            active.push(enriched);
        }
    }

    return { active, suppressed };
}

function analyzeRecipeConfiguration(input = {}, options = {}) {
    let dbAccessors = options.dbAccessors || null;
    const getDb = () => {
        if (!dbAccessors) dbAccessors = loadDbAccessors();
        return dbAccessors;
    };
    const recipes = options.recipes || getDb().dbGetAllRecipes();
    const catalogParts = options.parts || getDb().dbGetAllParts();
    const target = resolveRecipe(input, recipes);
    const targetParts = recipeParts(target);
    if (!targetParts) throw inputError('目标配方 partsJson 解析失败');

    const targetId = recipeId(target);
    const similar = recipes
        .filter(recipe => recipeId(recipe) !== targetId)
        .map(recipe => ({ recipe, similarity: similarity(target, recipe) }))
        .filter(item => item.similarity.score >= 0.45)
        .sort((left, right) => right.similarity.score - left.similarity.score)
        .slice(0, Math.min(8, Math.max(2, Number(input.limit) || 5)));

    const definite = definiteMissingItems(target, targetParts);
    const approvedRules = Object.prototype.hasOwnProperty.call(options, 'approvedRules')
        ? options.approvedRules
        : (!options.recipes ? getDb().dbGetFactoryRuleCandidates('approved') : []);
    const factoryRuleResult = approvedFactoryRuleAlerts(target, targetParts, approvedRules);
    const approvedFindingKeys = new Set(factoryRuleResult.appliedRules.map(rule => rule.findingKey));
    const inferred = inferredMissingItems(targetParts, similar)
        .filter(item => !approvedFindingKeys.has(item.key));
    const prices = priceAlerts(targetParts, similar, catalogParts);
    const feedbackRows = options.feedback || (
        !options.recipes && Number.isFinite(targetId) && targetId > 0
            ? getDb().dbGetRecipeAnalysisFeedback(targetId)
            : []
    );
    const missingFeedback = applyFeedback([...definite, ...inferred], feedbackRows);
    const factoryRuleFeedback = applyFeedback(factoryRuleResult.alerts, feedbackRows);
    const priceFeedback = applyFeedback(prices, feedbackRows);
    const activeDefiniteCount = missingFeedback.active.filter(item => item.type !== 'peer_pattern').length;
    const activeInferredCount = missingFeedback.active.filter(item => item.type === 'peer_pattern').length;
    const highConfidenceAlertCount = activeDefiniteCount
        + factoryRuleFeedback.active.length
        + priceFeedback.active.filter(item => item.confidence === 'high').length;
    const suppressedFindings = [
        ...missingFeedback.suppressed,
        ...factoryRuleFeedback.suppressed,
        ...priceFeedback.suppressed,
    ];

    return {
        version: 'knowledge-v3.0',
        generatedAt: new Date().toISOString(),
        mode: input.draft ? 'draft' : 'saved_recipe',
        advisoryOnly: true,
        recipe: {
            id: Number.isFinite(targetId) && targetId > 0 ? targetId : null,
            name: target.name || '未命名配方',
            spec: target.spec || '',
            templateId: Number(target.templateId || target.template_id || 0) || null,
            savedTotalCost: Number(target.savedTotalCost || target.saved_total_cost || 0),
            partCount: targetParts.length,
        },
        summary: {
            similarRecipeCount: similar.length,
            definiteIssueCount: activeDefiniteCount,
            reviewSuggestionCount: activeInferredCount,
            appliedFactoryRuleCount: factoryRuleResult.appliedRules.length,
            factoryRuleAlertCount: factoryRuleFeedback.active.length,
            priceAlertCount: priceFeedback.active.length,
            highConfidenceAlertCount,
            suppressedFindingCount: suppressedFindings.length,
        },
        similarRecipes: similar.map(item => ({
            id: recipeId(item.recipe),
            name: item.recipe.name || `配方 #${recipeId(item.recipe)}`,
            spec: item.recipe.spec || '',
            score: item.similarity.score,
            confidence: confidenceForScore(item.similarity.score),
            reasons: item.similarity.reasons,
            sharedRoles: item.similarity.sharedRoles,
            targetOnlyRoles: item.similarity.targetOnlyRoles,
            referenceOnlyRoles: item.similarity.candidateOnlyRoles,
            savedTotalCost: Number(item.recipe.savedTotalCost || item.recipe.saved_total_cost || 0),
        })),
        factoryRuleAlerts: factoryRuleFeedback.active,
        missingItems: missingFeedback.active,
        priceAlerts: priceFeedback.active,
        suppressedFindings,
        guidance: [
            '高置信度配置矛盾应在保存前处理。',
            '已批准工厂规则会参与保存前检查；客户定制差异可以标记为特殊情况。',
            '同类配方高频项只是复核建议，客户定制差异可以保留。',
            '价格提醒不会自动覆盖历史快照或当前零件价。',
        ],
    };
}

module.exports = {
    analyzeRecipeConfiguration,
    approvedFactoryRuleAlerts,
    partRole,
    similarity,
};
