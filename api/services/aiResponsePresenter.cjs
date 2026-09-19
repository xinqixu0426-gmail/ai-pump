function text(value) {
    return String(value ?? '').trim();
}

function amount(value) {
    return Number(value).toFixed(2);
}

function requestedPackingModels(task) {
    return task.requiredOutputs
        .filter(item => item.key === 'packingModel')
        .map(item => text(item.value))
        .filter(Boolean);
}

function resolvePackingModels(task, evidence) {
    const requested = requestedPackingModels(task);
    if (!requested.length) return [];
    return requested.map(query => (
        evidence.packingModels.find(model => model.toLocaleLowerCase().includes(query.toLocaleLowerCase())) || query
    ));
}

function presentConfiguredBom(task, bundle) {
    const evidence = bundle.configuredBom;
    if (!evidence || !evidence.templateModel || !evidence.coilModel || evidence.totalCost == null) return '';
    const configuration = [`${evidence.coilModel}线圈`];
    const floatRequirement = task.requiredOutputs.find(item => item.key === 'hasFloat');
    if (floatRequirement) configuration.push(floatRequirement.value ? '带浮球' : '不带浮球');
    const packing = resolvePackingModels(task, evidence);
    if (packing.length) configuration.push(`包装包含${packing.join('、')}`);
    const costs = [`当前${evidence.pricingComplete ? '完整' : '已定价'}成本约 ¥${amount(evidence.totalCost)}`];
    if (evidence.partsCost != null) costs.push(`零件 ¥${amount(evidence.partsCost)}`);
    if (evidence.laborCost != null) costs.push(`人工 ¥${amount(evidence.laborCost)}`);
    const basis = evidence.configurationBasis?.source === 'recipe' && text(evidence.configurationBasis.recipeName)
        ? `未明确的配套项沿用配方基准「${text(evidence.configurationBasis.recipeName)}」。`
        : '';
    return `${evidence.templateModel}：${configuration.join('，')}；${costs.join('，')}。${basis}`;
}

function splitKnowledgeStatements(statements) {
    return statements.flatMap(statement => text(statement).split(/[\n。；]+/u))
        .map(text)
        .filter(Boolean);
}

function presentKnowledgeRule(task, bundle) {
    const evidence = bundle.knowledge[0];
    if (!evidence) return '';
    const asksMoney = /价|金额|成本|费/u.test(task.userGoal);
    const query = text(evidence.query);
    const terms = [query, ...['成品电缆', '线材', '长度', '插头', '规格', '整体', '拆分']
        .filter(term => task.userGoal.includes(term))];
    const candidates = splitKnowledgeStatements(evidence.statements)
        .filter(statement => !/[{}]/u.test(statement))
        .filter(statement => asksMoney || !/[¥￥]|-?\d+(?:\.\d+)?\s*元|差价/u.test(statement))
        .map((statement, index) => ({
            statement,
            index,
            score: terms.reduce((score, term) => score + (term && statement.includes(term) ? 1 : 0), 0),
        }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 3)
        .sort((left, right) => left.index - right.index)
        .map(item => item.statement);
    const selected = candidates.length ? candidates : splitKnowledgeStatements(evidence.statements).slice(0, 1);
    return selected.length ? `正式业务规则：${selected.join('；')}。` : '';
}

function presentTaskAnswer(task, bundle) {
    if (task.presentation === 'configured_bom_cost') return presentConfiguredBom(task, bundle);
    if (task.presentation === 'knowledge_rule') return presentKnowledgeRule(task, bundle);
    return '';
}

function includesAmount(answer, value) {
    if (!Number.isFinite(Number(value))) return false;
    const raw = String(Number(value));
    const fixed = amount(value);
    return text(answer).includes(raw) || text(answer).includes(fixed);
}

function answerSatisfiesTask(task, bundle, answer) {
    const content = text(answer);
    if (!content) return false;
    if (/无法核对的金额|已停止展示|没有可验证的结论/u.test(content)) return false;
    if (task.presentation === 'configured_bom_cost') {
        const evidence = bundle.configuredBom;
        if (!evidence || !includesAmount(content, evidence.totalCost)) return false;
        for (const requirement of task.requiredOutputs) {
            if (requirement.key === 'templateModel' && !content.includes(evidence.templateModel || text(requirement.value))) return false;
            if (requirement.key === 'coilModel' && !content.includes(evidence.coilModel || text(requirement.value))) return false;
            if (requirement.key === 'hasFloat' && requirement.value === true && !content.includes('浮球')) return false;
            if (requirement.key === 'hasFloat' && requirement.value === false && !/不带浮球|无浮球/u.test(content)) return false;
            if (requirement.key === 'packingModel' && !content.includes(text(requirement.value))) return false;
        }
    }
    if (task.presentation === 'knowledge_rule') {
        if (!bundle.knowledge.length) return false;
        if (task.requiredOutputs.some(item => item.key === 'completeCable') && !content.includes('成品电缆')) return false;
        if (task.requiredOutputs.some(item => item.key === 'splitConclusion')
            && !/(不应该|不宜|不能|不得|不应|不拆|无需拆分|不需要拆分|不把[^\n。！？]{0,48}拆)/u.test(content)) return false;
    }
    return true;
}

function ensureTaskAnswer(task, bundle, answer) {
    if (answerSatisfiesTask(task, bundle, answer)) return answer;
    return presentTaskAnswer(task, bundle) || answer;
}

module.exports = {
    answerSatisfiesTask,
    ensureTaskAnswer,
    presentConfiguredBom,
    presentKnowledgeRule,
    presentTaskAnswer,
};
