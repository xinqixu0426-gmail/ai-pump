// A small financial-value check, independent of domains, plans and tool names.
// It prevents a resource ID or invented amount from being presented as money.
const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

function monetaryValues(toolResults = []) {
    const values = new Set();
    function add(number) {
        if (!Number.isFinite(number)) return;
        values.add(String(number));
        values.add(String(Number(number.toFixed(2))));
        values.add(String(Number(Math.abs(number).toFixed(2))));
    }
    function walk(value, key = '') {
        if (!value || typeof value !== 'object') {
            if (/cost|price|amount|fee|wage|subtotal|diff|^copperBase$/i.test(key) && (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))) add(Number(value));
            return;
        }
        if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
        for (const [childKey, child] of Object.entries(value)) {
            if (childKey === 'value' && /成本|金额|单价|工资|费用/.test(String(value.label || '')) && typeof child === 'number') add(child);
            else walk(child, childKey);
        }
    }
    for (const item of toolResults) if (item?.result?.success !== false && hasVerifiedExecution(item.result)) walk(item.result);
    return values;
}

function formatMoneySummary(toolResults = [], { includeQueries = false } = {}) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const labels = { currentTotalCost: '当前总成本', totalCost: '总成本', totalRevenue: '总收入', totalProfit: '总利润', cost: '档案成本', price: '目录单价', costDiff: '成本差额（后者减前者）', totalDiff: '成本差额（后者减前者）', partsCost: '零件成本', laborCost: '人工成本' };
    const rows = [];
    const seenRows = new Set();
    const configurations = [];
    const escape = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    function addRow(name, key, item) {
        const signature = JSON.stringify([name, labels[key], Number(item)]);
        if (seenRows.has(signature)) return;
        seenRows.add(signature);
        rows.push(`| ${escape(name)} | ${labels[key]} | ${escape(item)} |`);
    }
    function visit(value, label, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 3) return;
        const name = [value.name || value.recipeName || value.model || value.schemeCode, value.spec && value.sheets ? `${value.spec}-${value.sheets}` : '', value.material, value.slotType].filter(Boolean).join(' / ') || label;
        for (const [key, item] of Object.entries(value)) {
            if (labels[key] && /^-?\d+(?:\.\d+)?$/.test(String(item))) addRow(name, key, item);
            else if (item && typeof item === 'object' && !['executionEvidence', 'provenance', 'comparison'].includes(key)) visit(item, name, depth + 1);
        }
    }
    // A completed preview must remain visible even after a broad catalog query.
    const orderedResults = [...toolResults].sort((a, b) =>
        Number(getAiCapability(b.name)?.operation === 'preview') - Number(getAiCapability(a.name)?.operation === 'preview'));
    for (const item of orderedResults) {
        const capability = getAiCapability(item.name);
        if (item.result?.success !== false && hasVerifiedExecution(item.result) && !item.result?.data?.requiresVariantSelection && capability?.access === 'read' && (capability.operation === 'preview' || (includeQueries && capability.operation === 'query'))) {
            if (item.name === 'get_dashboard_summary') {
                const summary = item.result.summary || item.result.data?.summary || item.result.data;
                visit({
                    totalRevenue: summary?.financials?.totalRevenue,
                    totalCost: summary?.financials?.totalCost,
                    totalProfit: summary?.financials?.totalProfit,
                }, '订单总盘');
                if (Number(summary?.orders?.completed || 0) > 0) visit({
                    totalRevenue: summary?.financials?.completed?.totalRevenue,
                    totalCost: summary?.financials?.completed?.totalCost,
                    totalProfit: summary?.financials?.completed?.totalProfit,
                }, '已完成订单');
            } else {
                visit(item.result, capability.displayName);
            }
            const data = item.result.data;
            if (data?.costPreview && Array.isArray(data.parts)) {
                if (data.configurationBasis) configurations.push(data.configurationBasis.source === 'recipe' ? `配置基准：${escape(data.configurationBasis.recipeName)}；${escape(data.configurationBasis.note)}` : escape(data.configurationBasis.note));
                const names = data.parts.slice(0, 50).map(part => [part.model, part.name].filter(Boolean).join('（') + (part.model && part.name ? '）' : ''));
                configurations.push(`正式配置：${names.map(escape).join('、')}${data.parts.length > 50 ? '；其余配置见明细' : ''}。`);
                if (data.costPreview.pricingComplete === false) configurations.push('配置尚未全部定价，当前金额不是完整报价。');
            }
        }
    }
    if (!rows.length) return '';
    return `本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n${rows.slice(0, 12).join('\n')}\n\n${configurations.join('\n\n')}${configurations.length ? '\n\n' : ''}完整计算明细见本轮工具结果。`;
}

function formatDashboardOverview(userText, toolResults = []) {
    if (!/(?:经营|运营|系统).{0,6}(?:情况|概况|数据|摘要)|(?:今天|今日).{0,6}(?:经营|运营|情况|概况)|(?:系统|运营)看板/u.test(String(userText || ''))) return '';
    const verified = toolResults.filter(item => item?.result?.success !== false && hasVerifiedExecution(item.result));
    if (verified.length !== 1 || verified[0].name !== 'get_dashboard_summary') return '';
    const summary = verified[0].result.summary || verified[0].result.data?.summary || verified[0].result.data;
    if (!summary || typeof summary !== 'object') return '';
    if (!['orders', 'financials', 'parts', 'workbench'].some(key => summary[key] && typeof summary[key] === 'object')) return '';
    const orders = summary.orders || {};
    const financials = summary.financials || {};
    const parts = summary.parts || {};
    const workbench = new Map((summary.workbench?.items || []).map(item => [item.key, item]));
    const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '未提供';
    let generatedAt = '';
    if (summary.generatedAt) {
        const date = new Date(summary.generatedAt);
        if (!Number.isNaN(date.getTime())) generatedAt = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).format(date).replaceAll('/', '-');
    }
    const lines = [generatedAt ? `**今日经营概况（截至 ${generatedAt}）**` : '**当前经营概况**'];
    lines.push(`- 订单：共 ${number(orders.total)} 单，活动 ${number(orders.active)} 单，今日新增 ${number(orders.today)} 单，采购中 ${number(orders.purchasing)} 单，采购完成 ${number(orders['采购完成'] ?? orders.purchaseCompleted)} 单。`);
    lines.push(`- 财务：收入 ${number(financials.totalRevenue)} 元，成本 ${number(financials.totalCost)} 元，利润 ${number(financials.totalProfit)} 元，利润率 ${number(financials.profitRate)}%。`);
    lines.push(`- 库存：零件 ${number(parts.total)} 项，缺货 ${number(parts.outOfStock)} 项，低库存 ${number(parts.lowStock)} 项。`);
    if (workbench.size) {
        lines.push(`- 待处理：待采购 ${number(workbench.get('pending_purchase')?.count)} 项，待入库 ${number(workbench.get('ready_to_receive')?.count)} 项。`);
    }
    return lines.join('\n');
}

function formatCoilCostComparison(userText, toolResults = []) {
    const { coilCostComparisonPairs } = require('./aiToolShortlist.cjs');
    const pairs = coilCostComparisonPairs(userText);
    if (pairs.length !== 2) return '';
    const rows = pairs.map(pair => {
        const item = toolResults.find(result => (
            result?.name === 'calculate_coil_cost'
            && String(result.args?.spec || '') === pair.spec
            && Number(result.args?.sheets) === pair.sheets
        ));
        if (!item || item.result?.success === false || !hasVerifiedExecution(item.result)) return null;
        if (item.result?.data?.requiresVariantSelection || item.result?.requiresVariantSelection) return null;
        const data = item.result.data && typeof item.result.data === 'object' ? item.result.data : item.result;
        const cost = Number(data.totalCost ?? data.cost);
        return Number.isFinite(cost) ? { ...pair, cost } : null;
    });
    if (rows.some(row => !row)) return '';
    const money = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const difference = rows[1].cost - rows[0].cost;
    const higher = difference > 0 ? rows[1] : rows[0];
    const differenceText = difference === 0
        ? '两者成本相同'
        : `${higher.spec}-${higher.sheets} 高 ${money(Math.abs(difference))} 元`;
    return `**线圈成本对比**\n\n| 线圈 | 当前成本 |\n|---|---:|\n${rows.map(row => `| ${row.spec}-${row.sheets} | ${money(row.cost)} 元 |`).join('\n')}\n\n差额：${differenceText}。`;
}

function verifiedMissingTarget(result) {
    return Boolean(result?.success === false && result.code === 'AI_RESOURCE_NOT_FOUND'
        && result.query && result.entityType && hasVerifiedExecution(result)
        && result.executionEvidence.kind === 'formal_api_query_failure');
}

function appendMissingTechnicalFileConclusion(answer, userText, toolResults = []) {
    const missing = toolResults.find(item => (
        item?.name === 'get_recipe_technical_files' && verifiedMissingTarget(item.result)
    ));
    if (!missing) return answer;
    const text = String(answer || '');
    const subject = /(?:性能)?测试报告/u.test(String(userText || '')) ? '性能测试报告' : '技术档案';
    const explicitlyUnavailable = new RegExp(
        `(?:${subject}|技术档案|附件)[^\n。！？]{0,32}(?:不可用|无法提供|无法查看|未找到|没有找到|未归档|没有归档)`,
        'u'
    ).test(text);
    if (explicitlyUnavailable) return answer;
    const target = String(missing.result.query || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 160);
    return `${text}\n\n已核实：配方「${target}」的${subject}不可用。`.trim();
}

function verifiedEmptyQuery(result) {
    const receipt = result?.queryReceipt;
    return Boolean(result?.success === true && hasVerifiedExecution(result)
        && result.executionEvidence.kind === 'formal_api_query'
        && Array.isArray(result.data) && result.data.length === 0
        && receipt?.authoritative === true && receipt.totalCount === 0 && receipt.returnedCount === 0
        && receipt.truncated === false && receipt.possiblyTruncated === false);
}

function unfinishedReply(toolResults = [], reason = '本次查询预算已用完，尚未完成全部核实。') {
    const missing = [...new Set(toolResults.filter(item => verifiedMissingTarget(item.result))
        .map(item => String(item.result.error || `未找到目标：${item.result.query}`)))];
    const { getAiCapability } = require('../capabilities/registry.cjs');
    for (const item of toolResults.filter(item => verifiedEmptyQuery(item.result))) {
        const text = `${getAiCapability(item.name)?.displayName || item.name}：未找到匹配记录；查询条件 ${JSON.stringify(item.result.queryReceipt.appliedFilters || {})}。这只说明该查询范围没有记录。`;
        if (!missing.includes(text)) missing.push(text);
    }
    const evidence = missing.length ? `\n\n已核实：\n${missing.slice(0, 10).map(text => `- ${text}`).join('\n')}` : '';
    return `${reason}${evidence}\n\n已取得的正式结果保留在下方；其余问题可分批继续。`;
}

function missingPreviewTotals(answer, toolResults = []) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const numbers = new Set((String(answer).match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
    return toolResults.some(item => {
        if (!hasVerifiedExecution(item.result) || item.result.success === false || item.result.data?.requiresVariantSelection
            || getAiCapability(item.name)?.operation !== 'preview') return false;
        const data = item.result.data || item.result;
        const total = data.costPreview?.currentTotalCost ?? data.currentTotalCost ?? data.totalCost;
        if (total === undefined || total === null || !Number.isFinite(Number(total))) return false;
        return !numbers.has(Number(total)) && !numbers.has(Number(Number(total).toFixed(2)));
    });
}

function unsupportedMoneyInAnswer(answer, toolResults) {
    const values = monetaryValues(toolResults);
    const unsupported = new Set();
    const pattern = /[¥￥]\s*(-?\d[\d,]*(?:\.\d+)?)|(-?\d[\d,]*(?:\.\d+)?)\s*元/gu;
    for (const match of String(answer || '').matchAll(pattern)) {
        const value = Number((match[1] || match[2]).replaceAll(',', ''));
        if (!values.has(String(value))) unsupported.add(value);
    }
    // Markdown commonly puts the currency unit in a header, not in each cell.
    const lines = String(answer || '').split(/\r?\n/);
    const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.replace(/[*_`]/g, '').trim());
    for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i].includes('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
        const columns = cells(lines[i]).map(header => /金额|成本|单价|价格|费用|工资|[（(]元[）)]|[¥￥]/.test(header)
            && !/率|占比|比例|数量|编号/.test(header));
        for (let row = i + 2; row < lines.length && lines[row].includes('|'); row++) {
            cells(lines[row]).forEach((cell, column) => {
                if (!columns[column]) return;
                for (const match of cell.matchAll(/(?<![\w.-])-?\d[\d,]*(?:\.\d+)?(?![\w.-])/g)) {
                    const value = Number(match[0].replaceAll(',', ''));
                    if (!values.has(String(value))) unsupported.add(value);
                }
            });
        }
    }
    return [...unsupported];
}

function semanticOnlyKnowledgeRelationReply(userText, toolResults = []) {
    if (!/(?:用于|用途|专用|适配|兼容|用的)/u.test(String(userText || ''))) return '';
    const knowledgeResults = toolResults.filter(item => (
        item?.name === 'search_factory_knowledge'
        && item.result?.success !== false
        && hasVerifiedExecution(item.result)
    ));
    if (!knowledgeResults.length) return '';
    const rows = knowledgeResults.flatMap(item => Array.isArray(item.result?.data) ? item.result.data : []);
    const hasBusinessRule = rows.some(item => item?.sourceTable === 'business_rules' || item?.entryType === 'business_rule');
    const onlySemanticCandidates = knowledgeResults.every(item => (
        item.result?.retrievalGuidance?.semanticCandidatesAreEvidence === false
        && Number(item.result?.retrievalGuidance?.semanticCandidateCount || 0) > 0
    ));
    if (hasBusinessRule || !onlySemanticCandidates) return '';
    return '系统没有检索到明确的 business_rules 业务规则记录；当前命中仅为语义候选，不能据此确认用途、适配关系或专用配件。';
}

function guardedKnowledgeRelationReply(userText, toolResults = []) {
    const semanticOnly = semanticOnlyKnowledgeRelationReply(userText, toolResults);
    if (semanticOnly) return semanticOnly;
    if (!/(?:明确标注|明确记录|有哪些.*专用)/u.test(String(userText || ''))) return '';
    const statements = toolResults
        .filter(item => item?.name === 'search_factory_knowledge' && item.result?.success !== false && hasVerifiedExecution(item.result))
        .flatMap(item => item.result?.answerGuidance?.businessRuleStatements || []);
    if (!statements.length) return '';
    return `正式业务规则记录：${statements[0]}\n\n除上述明确肯定项外，系统没有其他明确标注；语义候选不能作为额外结论。`;
}

function appendMissingCoilIdentities(answer, userText, toolResults = []) {
    if (!/(?:绕组|主线|副线)/u.test(String(userText || ''))) return answer;
    const rows = toolResults
        .filter(item => item?.name === 'search_coils' && item.result?.success !== false && hasVerifiedExecution(item.result))
        .flatMap(item => Array.isArray(item.result?.data) ? item.result.data : []);
    const missing = rows
        .map(item => [item.material, item.slotType].filter(Boolean).join('/'))
        .filter(identity => identity && !String(answer || '').includes(identity));
    return missing.length ? `${answer}\n\n匹配方案身份：${[...new Set(missing)].join('、')}。` : answer;
}

function stabilizeLocalAnswer(answer, userText = '') {
    const source = String(answer || '').trim();
    if (!source) return source;
    const paragraphs = source.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
    const seen = new Set();
    const unique = paragraphs.filter(paragraph => {
        const signature = paragraph.replace(/[\s*_`#>\-—。，：；！？,.!:;?()[\]{}]/gu, '').toLocaleLowerCase('zh-CN');
        if (!signature || seen.has(signature)) return false;
        seen.add(signature);
        return true;
    });
    const deduplicated = unique.join('\n\n');
    if (/(?:完整|详细|全部|逐项|逐个|每一)/u.test(String(userText || '')) || [...deduplicated].length <= 600) {
        return deduplicated;
    }
    const selected = [];
    let used = 0;
    for (const paragraph of unique) {
        const length = [...paragraph].length + (selected.length ? 2 : 0);
        if (selected.length && used + length > 600) break;
        selected.push(paragraph);
        used += length;
        if (used >= 600) break;
    }
    return selected.join('\n\n') || [...deduplicated].slice(0, 600).join('');
}

module.exports = { monetaryValues, unsupportedMoneyInAnswer, formatMoneySummary, formatDashboardOverview, formatCoilCostComparison, verifiedMissingTarget, verifiedEmptyQuery, unfinishedReply, missingPreviewTotals, semanticOnlyKnowledgeRelationReply, guardedKnowledgeRelationReply, appendMissingCoilIdentities, appendMissingTechnicalFileConclusion, stabilizeLocalAnswer };
