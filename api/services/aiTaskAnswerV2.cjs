'use strict';

// Native Task V2 answer boundary.  It has no provider, tool, API, or database
// dependency: every visible business conclusion is projected from the already
// validated task envelope and its server-owned receipt context.
const crypto = require('node:crypto');
const { validateTaskEnvelopeV2 } = require('./aiTaskValidationV2.cjs');
const { validateSourceEvidenceClaimV1 } = require('./aiTaskDocumentsV2.cjs');

const SECTION_TYPES = new Set(['COST', 'COMPARISON', 'CATALOG', 'HISTORY', 'INVENTORY', 'READINESS', 'MANAGEMENT', 'BUSINESS_CHANGE', 'IMPACT', 'SOURCE', 'LIMITATION', 'CHANGE_PREVIEW']);
const exact = (value, keys, code) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
    const actual = Object.keys(value);
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(code);
};
const byId = task => new Map(task.facts.map(fact => [fact.factId, fact]));
const goalMap = task => new Map(task.goals.map(goal => [goal.goalKey, goal]));
const subjectName = (task, goal) => {
    const key = goal.subjectKeys[0];
    const subject = task.subjects.find(item => item.subjectKey === key);
    return subject?.selected?.displayName || subject?.mention || '该对象';
};
const money = value => `¥${Number(value).toFixed(2)}`;
const stableClaimId = (goalKey, suffix) => `${goalKey}:${suffix}`;
function renderAppliedOverride(field, value) {
    if (field !== 'packingParts' || !Array.isArray(value)) return `${field}=${String(value)}`;
    if (value.length === 0) return 'packingParts=清空全部包装';
    return value.map(item => {
        const name = typeof item?.model === 'string' && item.model ? item.model : `包装零件#${item?.partId ?? '?'}`;
        return Number(item?.qty) === 0 ? `packingParts=移除${name}` : `packingParts=${name}×${item?.qty ?? '?'}`;
    }).join('、');
}
function sourceExcerptPresentation(record) {
    if (record.evidenceKind !== 'SOURCE_TABLE') return record.excerpt ? `资料摘录：${record.excerpt}` : '正式接口仅返回资料元数据。';
    try {
        const table = JSON.parse(record.excerpt);
        const fields = [
            ['pointCount', '测试点'], ['maxHead', table.headUnit || '扬程'], ['maxFlow', table.flowUnit || '流量'],
            ['maxCurrent', table.currentUnit || '电流'], ['maxUnitEfficiency', table.unitEfficiencyUnit || '最高效率'],
        ].filter(([field]) => Number.isFinite(table[field])).map(([field, label]) => `${label} ${table[field]}`);
        return fields.length ? `资料中记录：${fields.join('；')}。` : '资料包含结构化测试数据，但没有可展示的确定性汇总字段。';
    } catch { return '资料包含结构化测试数据，但其展示投影未通过解析。'; }
}

function taskMode(task) {
    if (task.state === 'WAITING_INPUT') return 'CLARIFICATION';
    if (task.state === 'SUCCEEDED') return 'FINAL';
    if (task.state === 'PARTIAL') return 'PARTIAL';
    if (task.state === 'UNSUPPORTED') return 'UNSUPPORTED';
    if (task.state === 'CANCELLED') return 'CANCELLED';
    return 'FAILED';
}

function limitationFor(goal) {
    const code = goal.blockers[0]?.code || 'GOAL_NOT_COMPLETED';
    if (code === 'WRITE_EXECUTION_NOT_ENABLED') return '本次没有写入或保存正式业务数据。';
    if (goal.kind === 'PROFITABILITY') return '当前正式毛利试算未形成完整成本依据，因此这部分没有计算。';
    if (goal.kind === 'INVENTORY_QUERY' && goal.blockers.some(item => item.code === 'VIRTUAL_READINESS_QUANTITY_REQUIRED')) return '还需要明确本次虚拟需求的生产数量，才能按当前库存和活动订单占用进行齐料预览。';
    if (goal.state === 'NEEDS_INPUT') return '还需要你的确认后才能继续。';
    if (code === 'COST_PREVIEW_INCOMPLETE') return '当前正式成本不完整，因此没有给出整机总成本。';
    if (code === 'OVERRIDE_NOT_APPLIED') return '请求的配置没有被正式应用，因此没有给出该假设的正式成本差额。';
    if (code === 'RECIPE_NOT_FOUND') return '当前正式配方目录中没有找到可用于整机成本计算的匹配配方。';
    return '该目标当前未能形成可验证的正式结果。';
}

function buildTaskAnswerContractV1(task, context = {}) {
    validateTaskEnvelopeV2(task, context);
    const facts = byId(task);
    const allowedClaims = [];
    const goalOutcomes = task.goals.map(goal => ({ goalKey: goal.goalKey, goalType: goal.kind, state: goal.state, factIds: [...goal.factIds], blockerCode: goal.blockers[0]?.code || null }));
    for (const goal of task.goals) {
        for (const factId of goal.factIds) {
            const fact = facts.get(factId);
            if (!fact || fact.planRevision !== task.planRevision || fact.supersedesFactId !== null) continue;
            const kind = fact.evidenceState === 'VERIFIED_NEGATIVE' ? 'VERIFIED_NEGATIVE' : 'VERIFIED_FACT';
            if (kind === 'VERIFIED_NEGATIVE' && (!fact.complete || !fact.key.qualifiers.queryScopeHash)) continue;
            allowedClaims.push({
                claimId: stableClaimId(goal.goalKey, fact.factId), kind, goalKeys: [goal.goalKey], subjectKey: goal.subjectKeys[0] || null,
                predicate: fact.key.predicate, factIds: [fact.factId], value: fact.value, unit: fact.key.qualifiers.unit,
                currency: fact.key.qualifiers.currency, basis: fact.key.qualifiers.basis,
                scope: kind === 'VERIFIED_NEGATIVE' ? { type: fact.key.qualifiers.basis === 'RECIPE_CATALOGUE_QUERY' ? 'recipe_catalog' : 'bounded_query', queryScopeHash: fact.key.qualifiers.queryScopeHash } : null,
                serverTextHint: null,
            });
        }
        for (const evidenceId of goal.sourceEvidenceIds || []) {
            const record = task.sourceEvidence.find(item => item.evidenceId === evidenceId);
            if (!record) continue;
            const statement = sourceExcerptPresentation(record);
            const sourceLabel = record.candidate.title;
            validateSourceEvidenceClaimV1({ record, sourceLabel, statement });
            allowedClaims.push({
                claimId: stableClaimId(goal.goalKey, evidenceId), kind: record.coverage.complete ? 'SOURCE_EVIDENCE' : 'SOURCE_LIMITATION',
                goalKeys: [goal.goalKey], subjectKey: goal.subjectKeys[0] || null, predicate: 'source.content',
                factIds: [], evidenceIds: [evidenceId], sourceLabel, statement, location: record.location,
                freshness: record.candidate.freshness, authorityClass: record.sourceType === 'KNOWLEDGE_ENTRY' || record.sourceType === 'KNOWLEDGE_DOCUMENT' ? 'DERIVED_KNOWLEDGE' : 'DOCUMENT_SOURCE',
                value: null, unit: null, currency: null, basis: null, scope: null, serverTextHint: null,
            });
        }
        if (goal.state !== 'VERIFIED') {
            allowedClaims.push({ claimId: stableClaimId(goal.goalKey, 'limitation'), kind: 'LIMITATION', goalKeys: [goal.goalKey], subjectKey: goal.subjectKeys[0] || null, predicate: 'goal.limitation', factIds: [], value: null, unit: null, currency: null, basis: null, scope: null, serverTextHint: limitationFor(goal) });
        }
    }
    for (const conflict of task.sourceConflicts || []) {
        allowedClaims.push({ claimId: `source-conflict:${conflict.conflictId}`, kind: 'SOURCE_CONFLICT', goalKeys: [], subjectKey: conflict.subjectKey,
            predicate: 'source.conflict', factIds: [], evidenceIds: [conflict.leftEvidenceId, conflict.rightEvidenceId], value: null, unit: null, currency: null, basis: null, scope: null,
            sourceLabel: null, statement: `资料来源针对“${conflict.topic}”的记录不一致。`, location: null, freshness: null, authorityClass: conflict.resolution === 'LIVE_BUSINESS_PREVAILS' ? 'LIVE_BUSINESS' : 'DOCUMENT_SOURCE', serverTextHint: null });
    }
    const question = task.questions.find(item => item.answeredAt === null && item.planRevision === task.planRevision) || null;
    if (question) allowedClaims.push({ claimId: `clarification:${question.questionId}`, kind: 'CLARIFICATION', goalKeys: [...question.goalKeys], subjectKey: null, predicate: 'task.clarification', factIds: [], value: null, unit: null, currency: null, basis: null, scope: null, serverTextHint: question.prompt });
    return {
        version: 1, taskId: task.taskId, planRevision: task.planRevision, taskState: task.state, mode: taskMode(task), goalOutcomes,
        allowedClaims, clarification: question ? { questionId: question.questionId, prompt: question.prompt, choices: question.choices.map(choice => ({ choiceId: choice.choiceId, label: choice.label })) } : null,
        limitations: allowedClaims.filter(claim => claim.kind === 'LIMITATION').map(claim => ({ claimId: claim.claimId, text: claim.serverTextHint })),
        answerPolicy: { mustMentionIncompleteGoals: true, mustMentionUnsupportedGoals: true, mustPreserveNegativeScope: true, mustNotClaimWriteWithoutReceipt: true, mustNotComputeDerivedNumbers: true, mustNotExposeInternalEvidence: true },
    };
}

function templateFor(goal, facts) {
    if (goal.kind === 'FILE_INSPECT' && (goal.sourceEvidenceIds || []).length) return 'FILE_SOURCE_V1';
    if (goal.kind === 'KNOWLEDGE_QUERY' && (goal.sourceEvidenceIds || []).length) return 'KNOWLEDGE_SOURCE_V1';
    // 比较目标在所有状态下都由自己的模板渲染：澄清给问题、缺差额给限制，绝不落到别的业务模板上。
    if (goal.kind === 'RECIPE_COST_COMPARISON') return 'RECIPE_COST_COMPARISON_V1';
    if (goal.state !== 'VERIFIED') {
        if (facts.length > 0 && ['CUSTOMER_HISTORY', 'QUOTATION_QUERY', 'INVENTORY_QUERY', 'COIL_QUERY', 'COIL_COST', 'BUSINESS_CHANGES'].includes(goal.kind)) return 'STRUCTURED_PARTIAL_V1';
        if (facts.some(fact => fact.evidenceState === 'VERIFIED_NEGATIVE')) return 'RECIPE_CATALOG_NEGATIVE_V1';
        return 'LIMITATION_V1';
    }
    if (goal.kind === 'CURRENT_COST') return 'CURRENT_COST_V1';
    if (goal.kind === 'RECIPE_COST_COMPARISON') return 'RECIPE_COST_COMPARISON_V1';
    if (goal.kind === 'CONFIGURATION_COMPARE') return 'CONFIGURATION_COMPARE_V1';
    if (goal.kind === 'PREPARE_CHANGE') return 'CHANGE_PREVIEW_V1';
    if (goal.kind === 'PROFITABILITY') return 'PROFITABILITY_V1';
    if (goal.kind === 'INVENTORY_QUERY' && facts.some(fact => fact.key.predicate === 'inventory.virtual_readiness')) return 'VIRTUAL_READINESS_V1';
    const structured = {
        CUSTOMER_HISTORY: 'HISTORY_V1', QUOTATION_QUERY: 'CATALOG_V1',
        ORDER_READINESS: 'READINESS_V1', INVENTORY_QUERY: 'INVENTORY_V1',
        COIL_QUERY: 'CATALOG_V1', COIL_COST: 'CATALOG_V1', MANAGEMENT_OVERVIEW: 'MANAGEMENT_V1',
        BUSINESS_CHANGES: 'BUSINESS_CHANGE_V1', IMPACT_INVESTIGATION: 'IMPACT_V1',
    };
    return structured[goal.kind] || 'LIMITATION_V1';
}

function buildAnswerDraftV1(task) {
    const facts = byId(task);
    return { version: 1, sections: task.goals.map(goal => {
        const claimedFacts = goal.factIds.map(id => facts.get(id)).filter(Boolean);
        const templateKey = templateFor(goal, claimedFacts);
        const claimTypes = { CURRENT_COST_V1: 'COST', RECIPE_COST_COMPARISON_V1: 'COMPARISON', CONFIGURATION_COMPARE_V1: 'COMPARISON', RECIPE_CATALOG_NEGATIVE_V1: 'CATALOG', CHANGE_PREVIEW_V1: 'CHANGE_PREVIEW', PROFITABILITY_V1: 'COST', VIRTUAL_READINESS_V1: 'READINESS', HISTORY_V1: 'HISTORY', CATALOG_V1: 'CATALOG', INVENTORY_V1: 'INVENTORY', READINESS_V1: 'READINESS', MANAGEMENT_V1: 'MANAGEMENT', BUSINESS_CHANGE_V1: 'BUSINESS_CHANGE', IMPACT_V1: 'IMPACT', FILE_SOURCE_V1: 'SOURCE', KNOWLEDGE_SOURCE_V1: 'SOURCE', STRUCTURED_PARTIAL_V1: 'LIMITATION' };
        return { goalKey: goal.goalKey, claimType: claimTypes[templateKey] || 'LIMITATION', factIds: claimedFacts.map(fact => fact.factId), templateKey, analysisText: '' };
    }) };
}

function validateAnswerDraftV1(draft, contract, task) {
    exact(draft, ['version', 'sections'], 'ANSWER_DRAFT_FIELDS');
    if (draft.version !== 1 || !Array.isArray(draft.sections) || draft.sections.length < 1 || draft.sections.length > 16) throw new Error('ANSWER_DRAFT_STRUCTURE');
    const goals = goalMap(task); const facts = byId(task); const seen = new Set();
    for (const section of draft.sections) {
        exact(section, ['goalKey', 'claimType', 'factIds', 'templateKey', 'analysisText'], 'ANSWER_SECTION_FIELDS');
        if (!goals.has(section.goalKey) || seen.has(section.goalKey) || !SECTION_TYPES.has(section.claimType) || typeof section.templateKey !== 'string' || !section.templateKey || typeof section.analysisText !== 'string' || section.analysisText !== '') throw new Error('ANSWER_SECTION_INVALID');
        seen.add(section.goalKey);
        if (!Array.isArray(section.factIds) || section.factIds.length > 24 || section.factIds.some(id => !goals.get(section.goalKey).factIds.includes(id) || !facts.has(id) || facts.get(id).planRevision !== task.planRevision || facts.get(id).supersedesFactId !== null)) throw new Error('ANSWER_SECTION_FACTS');
        const expected = templateFor(goals.get(section.goalKey), section.factIds.map(id => facts.get(id)));
        if (section.templateKey !== expected) throw new Error('ANSWER_TEMPLATE_INVALID');
        if (expected === 'RECIPE_CATALOG_NEGATIVE_V1') {
            const negative = section.factIds.map(id => facts.get(id)).find(fact => fact.evidenceState === 'VERIFIED_NEGATIVE');
            if (!negative?.complete || !negative.key.qualifiers.queryScopeHash || negative.key.qualifiers.basis !== 'RECIPE_CATALOGUE_QUERY') throw new Error('ANSWER_NEGATIVE_SCOPE');
        }
        if (expected === 'CONFIGURATION_COMPARE_V1') {
            const values = section.factIds.map(id => facts.get(id));
            if (!values.some(fact => fact.key.predicate === 'scenario.cost_comparison') || !values.some(fact => fact.key.predicate === 'scenario.cost') || !values.some(fact => fact.key.predicate === 'recipe.current_cost') || !values.some(fact => fact.key.predicate === 'scenario.override_application')) throw new Error('ANSWER_COMPARE_FACTS');
        }
        if (expected === 'PROFITABILITY_V1') {
            const profitability = section.factIds.map(id => facts.get(id)).find(fact => fact.key.predicate === 'profitability.preview');
            if (!profitability?.complete || !profitability.value || profitability.value.costComplete !== true || !Number.isFinite(profitability.value.unitCost) || !Number.isFinite(profitability.value.unitPrice) || !Number.isFinite(profitability.value.grossProfitPerUnit)) throw new Error('ANSWER_PROFITABILITY_FACTS');
        }
        if (expected === 'VIRTUAL_READINESS_V1') {
            const readiness = section.factIds.map(id => facts.get(id)).find(fact => fact.key.predicate === 'inventory.virtual_readiness');
            const value = readiness?.value;
            if (!readiness?.complete || !value || value.preview !== true || !['READY', 'SHORTAGE'].includes(value.status)
                || value.inventoryBasis !== 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS' || value.coverage?.complete !== true
                || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || !Array.isArray(value.shortages)) throw new Error('ANSWER_VIRTUAL_READINESS_FACTS');
        }
    }
    if (seen.size !== goals.size || contract.goalOutcomes.length !== seen.size) throw new Error('ANSWER_GOAL_COVERAGE');
    return true;
}

function renderSection(task, section) {
    const goals = goalMap(task); const facts = byId(task); const goal = goals.get(section.goalKey); const values = section.factIds.map(id => facts.get(id)); const name = subjectName(task, goal);
    if (section.templateKey === 'CURRENT_COST_V1') {
        const fact = values.find(item => item.key.predicate === 'recipe.current_cost');
        return `${name}当前完整成本为 ${money(fact.value)}。本次只读查询，没有修改正式配方。`;
    }
    if (section.templateKey === 'RECIPE_COST_COMPARISON_V1') {
        if (goal.state === 'NEEDS_INPUT') {
            const question = task.questions.find(item => item.goalKeys.includes(goal.goalKey) && item.answeredAt === null);
            return question ? question.prompt : limitationFor(goal);
        }
        if (!values.length) return limitationFor(goal);
        // E2-R1 FAMILY-01：全部数字都来自 compare_recipes 正式回执（recipe1.cost / recipe2.cost / costDiff）。
        // 差额方向按能力契约 `costDiff = 配方2 − 配方1`（tools.cjs 描述：正数表示配方2更贵），
        // 这里只做**展示**：不重算、不相减、不在缺少正式差额时猜方向。
        const subjectOf = key => task.subjects.find(item => item.subjectKey === key);
        const nameOf = key => subjectOf(key)?.selected?.displayName || subjectOf(key)?.mention || null;
        const costs = values.filter(item => item.key.predicate === 'recipe.current_cost');
        const diff = values.find(item => item.key.predicate === 'recipe.cost_difference');
        const leftKey = goal.subjectKeys[0]; const rightKey = goal.subjectKeys[1];
        const costOf = key => {
            const subject = subjectOf(key);
            return costs.find(item => item.key.entityId === subject?.selected?.entityId);
        };
        const leftCost = costOf(leftKey); const rightCost = costOf(rightKey);
        const leftName = nameOf(leftKey) || '配方1'; const rightName = nameOf(rightKey) || '配方2';
        if (!leftCost || !rightCost) return `正式成本比较没有同时取得两个主体的完整成本回执，因此本次不给比较结论。`;
        const leftText = `${leftName}当前完整成本为 ${money(leftCost.value)}`;
        const rightText = `${rightName}当前完整成本为 ${money(rightCost.value)}`;
        const diffValue = Number(diff?.value);
        if (!diff || !Number.isFinite(diffValue)) return `${leftText}；${rightText}。本次正式比较回执没有给出可用的成本差额，因此不判断两者谁更高。本次只读对比，没有修改正式配方。`;
        if (diffValue === 0) return `${leftText}；${rightText}。按正式成本对比回执，两个方案的完整成本差额为 ¥0.00（持平）。本次只读对比，没有修改正式配方。`;
        const direction = diffValue > 0 ? `${rightName}比${leftName}高` : `${rightName}比${leftName}低`;
        return `${leftText}；${rightText}。按正式成本对比回执，${direction} ${money(Math.abs(diffValue))}（差额以 ${leftName} 为基准，正数表示后者更贵）。本次只读对比，没有修改正式配方。`;
    }
    if (section.templateKey === 'CONFIGURATION_COMPARE_V1' || section.templateKey === 'CHANGE_PREVIEW_V1') {
        const base = values.find(item => item.key.predicate === 'recipe.current_cost');
        const candidate = values.find(item => item.key.predicate === 'scenario.cost');
        const comparison = values.find(item => item.key.predicate === 'scenario.cost_comparison');
        const applied = values.find(item => item.key.predicate === 'scenario.override_application');
        const changes = Object.entries(applied?.value || {}).map(([field, value]) => renderAppliedOverride(field, value)).join('、');
        return `${name}当前完整成本为 ${money(base.value)}。临时方案完整成本为 ${money(candidate.value)}，较当前 ${Number(comparison.value.delta) >= 0 ? '增加' : '减少'} ${money(Math.abs(Number(comparison.value.delta)))}。已正式应用的临时配置：${changes || '无'}。本次只是试算，没有保存或修改正式配方。`;
    }
    if (section.templateKey === 'PROFITABILITY_V1') {
        const profitability = values.find(item => item.key.predicate === 'profitability.preview')?.value;
        const historicalPrice = values.find(item => item.key.predicate === 'quotation.historical_unit_price')?.value;
        const ratio = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '不适用';
        const totals = profitability.quantity === null ? '' : ` 数量 ${profitability.quantity} 台：总成本 ${money(profitability.totalCost)}，销售额 ${money(profitability.totalRevenue)}，总毛利 ${money(profitability.totalGrossProfit)}。`;
        const priceBasis = Number.isFinite(historicalPrice) ? `按该客户上次正式报价 ${money(historicalPrice)} 作为本次假设销售价，` : '';
        return `${name}${priceBasis}按当前正式成本 ${money(profitability.unitCost)} 与售价 ${money(profitability.unitPrice)} 试算：单台毛利 ${money(profitability.grossProfitPerUnit)}，销售毛利率 ${ratio(profitability.grossMarginOnSales)}，成本加价率 ${ratio(profitability.markupOnCost)}。${totals} 这是毛利试算，不包含运费、税费、汇率或财务费用；本次没有保存或修改正式业务数据。`;
    }
    if (section.templateKey === 'VIRTUAL_READINESS_V1') {
        const readiness = values.find(item => item.key.predicate === 'inventory.virtual_readiness')?.value;
        const prefix = `按当前库存并扣除现有活动订单占用，${readiness.quantity}台${name}的库存管理物料`;
        if (readiness.status === 'READY') return `${prefix}目前没有发现短缺。本结论只覆盖当前正式库存齐料口径，不代表产能或交期；本次没有创建订单或预留库存。`;
        const shortages = readiness.shortages.map(item => `${item.model || item.requirementKey}需要${item.virtualRequiredQty}${item.inventoryUnit === 'meter' ? 'm' : item.inventoryUnit === 'set' ? '套' : '件'}，现可用于这批需求${item.availableForVirtualQty}${item.inventoryUnit === 'meter' ? 'm' : item.inventoryUnit === 'set' ? '套' : '件'}，短缺${item.shortageQty}${item.inventoryUnit === 'meter' ? 'm' : item.inventoryUnit === 'set' ? '套' : '件'}`).join('；');
        return `${prefix}存在短缺：${shortages}。以上数值来自正式库存规划回执；本次没有创建订单或预留库存。`;
    }
    if (section.templateKey === 'RECIPE_CATALOG_NEGATIVE_V1') return `当前正式配方目录中没有找到可用于整机成本计算的“${name}”配方，因此现在无法给出正式整机成本。本次只覆盖配方目录，不能据此判断整个系统是否不存在该对象。`;
    if (section.templateKey === 'HISTORY_V1') {
        const quotations = values.find(item => item.key.predicate === 'customer.quotation_history')?.value || [];
        const orders = values.find(item => item.key.predicate === 'customer.order_history')?.value || [];
        const segments = [];
        if (Array.isArray(quotations)) segments.push(`报价记录 ${quotations.length} 条`);
        if (Array.isArray(orders)) segments.push(`订单记录 ${orders.length} 条`);
        return `${name}的正式历史查询结果：${segments.join('，') || '未返回可展示的历史记录'}。历史报价与当前成本属于不同时间和价格口径，本次未将它们混用。`;
    }
    if (section.templateKey === 'STRUCTURED_PARTIAL_V1') {
        const quotations = values.find(item => item.key.predicate === 'customer.quotation_history')?.value;
        const orders = values.find(item => item.key.predicate === 'customer.order_history')?.value;
        const returned = [];
        if (Array.isArray(quotations)) returned.push(`报价记录 ${quotations.length} 条`);
        if (Array.isArray(orders)) returned.push(`订单记录 ${orders.length} 条`);
        return `${name}的本次正式查询已返回${returned.length ? `：${returned.join('，')}` : '部分可用结果'}；但该集合未证明完整，因此不能据此称为全部历史或完整目录。`;
    }
    if (section.templateKey === 'READINESS_V1') {
        const readiness = values.find(item => item.key.predicate === 'order.readiness')?.value || {};
        const actions = values.find(item => item.key.predicate === 'order.readiness_actions')?.value || {};
        const state = readiness.status || readiness.state || readiness.readinessStatus || '已读取';
        const actionCount = Array.isArray(actions.steps) ? actions.steps.length : (Array.isArray(actions.actions) ? actions.actions.length : 0);
        return `${name}的正式生产准备状态为：${String(state)}。正式处理方案包含 ${actionCount} 项步骤。本结果只说明 readiness 服务返回的准备状态，不承诺产能、交期或工程性能。`;
    }
    // E2：**单一 canonical 线圈**的成本/库存事实必须说出数值本身。
    // 收据指针已经绑定到该候选自己的字段（cost / 库存行），因此这里只做展示，不做汇总或推断。
    const coilCostFact = values.find(item => item.key.predicate === 'coil.current_cost');
    if (coilCostFact) {
        return `${name}的当前线圈成本为 ${money(coilCostFact.value)}。该金额来自本次正式线圈目录回执中该方案自己的成本字段，未做覆盖、汇总或自行计算；本次没有保存或修改正式数据。`;
    }
    const coilInventoryFact = values.find(item => item.key.predicate === 'inventory.coil');
    if (coilInventoryFact) {
        const row = coilInventoryFact.value && typeof coilInventoryFact.value === 'object' ? coilInventoryFact.value : {};
        const stock = [row.stock, row.Stock].find(value => Number.isFinite(Number(value)) && value !== null && value !== undefined);
        const unit = row.inventoryUnit === 'set' ? '套' : row.inventoryUnit === 'meter' ? 'm' : row.inventoryUnit === 'piece' ? '件' : '';
        const identity = [row.schemeCode, row.schemeName].filter(Boolean).join(' / ') || name;
        if (stock === undefined) return `${identity}的正式库存回执没有返回可展示的库存数量，因此本次不给库存结论。`;
        return `${identity}当前正式库存为 ${Number(stock)}${unit}。该数量来自本次正式线圈库存回执中该方案自己的记录，未对多个候选方案汇总；本次没有预留或修改库存。`;
    }
    if (section.templateKey === 'CATALOG_V1' || section.templateKey === 'INVENTORY_V1') {
        const value = values[0]?.value;
        const rows = Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
        const count = Array.isArray(value) ? value.length : (Array.isArray(value?.items) ? value.items.length : null);
        const statuses = [...new Set(rows.map(item => item?.schemeStatus).filter(value => typeof value === 'string' && value))];
        return `${name === '该对象' ? '本次正式目录查询' : name}已取得正式${section.templateKey === 'INVENTORY_V1' ? '库存' : '目录'}结果${count === null ? '' : `，返回 ${count} 条记录`}${statuses.length ? `；方案状态：${statuses.join('、')}` : ''}。展示范围以本次正式查询回执为准，未对多个候选方案自行汇总。`;
    }
    if (section.templateKey === 'MANAGEMENT_V1') return '已读取正式管理行动中心。本次只呈现其返回的待办、风险与优先级口径，没有自行重排或推断经营结论。';
    if (section.templateKey === 'BUSINESS_CHANGE_V1') {
        const value = values[0]?.value;
        const count = Array.isArray(value) ? value.length : (Array.isArray(value?.items) ? value.items.length : null);
        return `已读取正式业务变更记录${count === null ? '' : `，本次返回 ${count} 条`}。变更记录只说明已记录的事件，不替代对象当前状态的正式读取。`;
    }
    if (section.templateKey === 'IMPACT_V1') return '已取得正式影响投影。它只说明系统标记的受影响对象和复核需要，不代表变更已经提交，也不构成工程性能结论。';
    if (section.templateKey === 'FILE_SOURCE_V1' || section.templateKey === 'KNOWLEDGE_SOURCE_V1') {
        const record = task.sourceEvidence.find(item => (goal.sourceEvidenceIds || []).includes(item.evidenceId));
        if (!record) return '正式资料读取未保留可验证的来源证据，因此不提供资料结论。';
        const isKnowledge = section.templateKey === 'KNOWLEDGE_SOURCE_V1';
        const location = record.location.type === 'LINE_RANGE' ? `第 ${record.location.start}-${record.location.end} 行` : record.location.type === 'JSON_POINTER' ? '已返回的结构化测试数据' : '资料记录';
        const freshness = record.candidate.freshness === 'CURRENT' ? '' : '该知识快照可能不是当前业务实时状态；';
        const excerpt = sourceExcerptPresentation(record);
        const limitation = record.coverage.complete ? '' : ' 当前内容不完整，不能把未出现的内容说成不存在。';
        const conflicts = (task.sourceConflicts || []).filter(item => (goal.sourceEvidenceIds || []).includes(item.leftEvidenceId) || (goal.sourceEvidenceIds || []).includes(item.rightEvidenceId));
        const conflictNotice = conflicts.length ? ` 资料针对“${conflicts.map(item => item.topic).join('、')}”的记录不一致，当前没有静默裁决。` : '';
        const comparisons = (task.sourceConfigComparisons || []).filter(item => item.evidenceId === record.evidenceId);
        const comparisonNotice = comparisons.length ? ` 与当前正式配置逐项核对：${comparisons.map(item => `${item.field}=${item.status}`).join('，')}。` : '';
        return `${isKnowledge ? '知识资料' : `${name}的技术档案`}“${record.candidate.title}”已按${location}读取。${freshness}${excerpt}${limitation}${isKnowledge ? ' 该资料来源不替代当前正式业务读取。' : ''}${comparisonNotice}${conflictNotice}`;
    }
    if (goal.state === 'NEEDS_INPUT') {
        const question = task.questions.find(item => item.goalKeys.includes(goal.goalKey) && item.answeredAt === null);
        return question ? question.prompt : limitationFor(goal);
    }
    return limitationFor(goal);
}

function composeTaskAnswerV2(task, context = {}) {
    const startedAt = Date.now();
    try {
        const contract = buildTaskAnswerContractV1(task, context);
        const draft = buildAnswerDraftV1(task);
        validateAnswerDraftV1(draft, contract, task);
        const content = draft.sections.map(section => renderSection(task, section)).join('\n\n');
        return { content, answerMode: 'DETERMINISTIC', answerModelCalls: 0, answerRepairCalls: 0, fallbackUsed: false, answerHash: crypto.createHash('sha256').update(`${task.taskId}:${task.planRevision}:${content}`).digest('hex'), durationMs: Date.now() - startedAt };
    } catch (error) {
        return { content: '当前任务的正式答案核验未完成，因此暂不提供未经验证的业务结论。', answerMode: 'DETERMINISTIC_FALLBACK', answerModelCalls: 0, answerRepairCalls: 0, fallbackUsed: true, answerHash: null, durationMs: Date.now() - startedAt, validationError: error.code || error.message };
    }
}

module.exports = { buildTaskAnswerContractV1, buildAnswerDraftV1, composeTaskAnswerV2, taskMode, validateAnswerDraftV1 };
