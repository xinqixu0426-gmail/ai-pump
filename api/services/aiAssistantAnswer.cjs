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

// ── 金额展示契约（LEGACY-AI-ANSWER-004）─────────────────────────────────────
// 项目权威约定是「金额两位小数」：后端 api/services/costEngine.cjs 的 roundMoney()
// 金额展示格式。
//
// 原实现一律 toFixed(2)：这会把「同一 canonical fact 只能有一种展示表示」这条不变式
// 变成「所有金额都必须两位小数」，于是正式来源里本身带高精度、且**精度承载候选身份**
// 的金额被截断 —— 实例：search_coils 返回
//   COIL-A cost 166.7136 / COIL-B cost 195.84155
// 两位小数后两个候选变成 166.71 / 195.84，用户核对库存档案时无法与正式来源对齐。
//
// 现行契约（Supervisor 已裁定）：
// - 精度以**事实字段合同**为准，不以「表格 vs 正文」为准。
// - 同一 canonical fact 在同一答案里只能有一种一致的展示表示。
// - 面向人的 ¥ 金额沿用原有观感；高精度正式来源按来源精度展示。
// 因此这里改为「最少且忠实」：保留来源有效精度，只清掉浮点尾差（10 位以内），
// 同时由 addRow 保证同一 fact 不会同时出现两种表示。
function formatMoneyDisplay(value) {
    // 展示表示的唯一定义在 moneyFactProjection.moneyDisplayValue（金额事实投影），
    // 保证「同一 canonical fact 只有一种展示表示」在渲染与校验两侧是同一个函数。
    return require('./moneyFactProjection.cjs').moneyDisplayValue(value);
}

// 结构化的 markdown 表格行：把一张表解析为表头 + 规范化后的数据行。
// 用于「同一张金额表是否已经在正文里」的结构判定，避免依赖整块文本逐字相等。
// 只读取首尾竖线包围的行；比较用值会把数字归一化到两位小数，
// 因此模型写 140.43、核对表写 140.43062 时会被认定为同一行，而不是两行。
function markdownTableRows(text) {
    const lines = String(text || '').split(/\r?\n/);
    const cell = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(part => part.replace(/[*_`]/g, '').trim());
    const normalizeCell = value => {
        const numeric = Number(String(value).replaceAll(',', ''));
        return Number.isFinite(numeric) && /^-?\d[\d,]*(?:\.\d+)?$/u.test(String(value).trim())
            ? numeric.toFixed(2)
            : String(value).trim();
    };
    const rows = [];
    for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes('|')) continue;
        if (!/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) continue;
        const header = cell(lines[i]).map(normalizeCell);
        let row = i + 2;
        for (; row < lines.length && lines[row].includes('|'); row += 1) {
            // cells 是**显示归一化**后的单元格（数值两位小数），用于「同一张表是否已出现」的比较；
            // rawCells 是原始单元格，用于金额**数值**比较 —— 真实高精度成本（143.82775）
            // 不能被显示归一化改写，否则正确答案会被判成挂错对象（PHASE-D-DEFECT-04）。
            const rawCells = cell(lines[row]);
            const cells = rawCells.map(normalizeCell);
            if (cells.every(part => part === '')) continue;
            rows.push({ header, cells, rawCells });
        }
        i = row - 1;
    }
    return rows;
}

// 金额表的展示容量。它只是展示容量，不是事实排序：
// 超出容量时必须显式报出未展开的正式事实条数，不得静默丢行。
const MONEY_TABLE_ROW_CAP = 12;

function formatMoneySummary(toolResults = [], { includeQueries = false } = {}) {
    const { projectMoneyFacts } = require('./moneyFactProjection.cjs');
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const escape = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    const configurations = [];
    for (const item of toolResults) {
        // 口径上下文（配方/配置基准、正式配置、未定价告警）与金额表一样只在**本轮可展示的正式结果**
        // 上生成：preview 永远参与，query 需 includeQueries。判据与金额事实投影保持一致。
        const capability = getAiCapability(item.name);
        if (!(item.result?.success !== false && hasVerifiedExecution(item.result) && capability?.access === 'read'
            && (capability.operation === 'preview' || (includeQueries && capability.operation === 'query')))) continue;
        const data = item.result.data;
        if (data?.costPreview && Array.isArray(data.parts)) {
            if (data.configurationBasis) {
                const note = String(data.configurationBasis.note ?? '').trim();
                // 口径文案与展示层 aiResponsePresenter.presentConfiguredBom 保持一致：
                // 同一事实（配方基准）在同一个答案里只用一种说法，不出现「配置基准」与
                // 「配方基准」两种措辞。
                const base = data.configurationBasis.source === 'recipe' && String(data.configurationBasis.recipeName ?? '').trim()
                    ? `配方基准「${escape(data.configurationBasis.recipeName)}」`
                    : '配置基准';
                // note 缺失时不得渲染出 "配方基准「v550-tokoy」；undefined"。
                if (note) configurations.push(`${base}；${escape(note)}`);
                else configurations.push(base);
            }
            const names = data.parts.slice(0, 50).map(part => [part.model, part.name].filter(Boolean).join('（') + (part.model && part.name ? '）' : ''));
            configurations.push(`正式配置：${names.map(escape).join('、')}${data.parts.length > 50 ? '；其余配置见明细' : ''}。`);
            if (data.costPreview.pricingComplete === false) configurations.push('配置尚未全部定价，当前金额不是完整报价。');
        }
    }
    // 金额表 = 正式金额事实的投影。每一行绑定一个带身份的事实（entity + predicate + basis），
    // 不再按「显示名 + 项目」或「金额 + 项目」去重 —— 那会吞掉同价不同实体与同名不同实体。
    const facts = projectMoneyFacts(toolResults, { includeQueries });
    if (!facts.length) return '';
    const tableRows = facts.slice(0, MONEY_TABLE_ROW_CAP)
        .map(fact => `| ${escape(fact.objectLabel)} | ${fact.label} | ${escape(fact.displayValue)} |`)
        .join('\n');
    // 展示容量不是事实完整性：被截断时明确报出未展开的正式事实条数，而不是静默丢行。
    const hidden = facts.length - Math.min(facts.length, MONEY_TABLE_ROW_CAP);
    const truncationNote = hidden > 0
        ? `\n\n（以上为部分明细：本轮正式金额事实共 ${facts.length} 条，已展示 ${MONEY_TABLE_ROW_CAP} 条，另有 ${hidden} 条未展开；需要完整清单请明确说明。）`
        : '';
    return `本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n${tableRows}${truncationNote}\n\n${configurations.join('\n\n')}${configurations.length ? '\n\n' : ''}完整计算明细见本轮工具结果。`;
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
    // 关联校验（A02 根因）：数字合法不等于数字属于正确对象。
    // 渲染出的金额表里，若某一行的「对象 + 项目」能唯一对应到正式事实，但金额与之不符，
    // 该行就是把两个真实数字挂错了对象 —— 必须与「凭空编造」同样被上报。
    for (const claim of misattributedMoneyClaims(answer, toolResults)) unsupported.add(claim.value);
    return [...unsupported];
}

// ── 金额声明的关联校验（A02）────────────────────────────────────────
// 「金额在正式集合里出现过」只证明数字真实，不证明它属于这一行。
// 事实身份由 moneyFactProjection 提供（entity + predicate + basis），这里把
// 渲染出的表格行反向解析成 (对象, 项目, 金额) 声明并逐行比对。

/** 表格里的金额列标题 → 归一化项目名（去掉括号补充说明）。 */
function normalizeMoneyLabel(label) {
    return String(label ?? '').replace(/[（(].*$/u, '').trim();
}

/**
 * 从答案的 markdown 金额表里解析出金额声明。
 * 只读「有金额列」的表格；非金额表格不参与。
 *
 * 表格有两种被实际使用的形状，两种都要能解析：
 *   A. 金额表：  | 对象 | 项目 | 金额 |   → 对象在第 0 列，项目在「项目」列，金额在「金额」列
 *   B. 明细表：  | 线圈 | 档案成本 | …    → 对象在第 0 列，项目就是金额列的表头
 * 因此项目名优先取「项目/口径」列的单元格，没有该列时才退回表头。
 *
 * `canonical` 表示该声明来自「对象列 + 项目列」都被显式分开的表格 —— 只有这种形状
 * 才能把金额**绑定到对象与口径**，因此也只有它能参与关联校验（A02）。
 * 其它形状仍由「金额是否在正式集合内」的既有校验负责（保守，不放宽安全性）。
 * @returns {{ object: string, label: string, value: number, raw: string, canonical: boolean }[]}
 */
function presentedMoneyClaims(answer) {
    const claims = [];
    for (const row of markdownTableRows(answer)) {
        const moneyColumns = row.header
            .map((header, index) => (/金额|成本|单价|价格|费用|工资|[（(]元[）)]|[¥￥]/u.test(header)
                && !/率|占比|比例|数量|编号/u.test(header) ? index : -1))
            .filter(index => index >= 0);
        if (!moneyColumns.length) continue;
        const objectColumn = row.header.findIndex(header => /对象|主体|名称|型号|零件|配方|线圈|方案/u.test(header));
        const predicateColumn = row.header.findIndex(header => /项目|口径|科目|费用项/u.test(header));
        const object = String(row.cells[objectColumn >= 0 ? objectColumn : 0] ?? '').trim();
        if (!object) continue;
        const canonical = objectColumn >= 0 && predicateColumn >= 0;
        for (const column of moneyColumns) {
            // 金额必须按**原始单元格**解析，保留来源精度；不允许显示归一化参与数值比较。
            const raw = String(row.rawCells?.[column] ?? row.cells[column] ?? '').replaceAll(',', '').trim();
            if (!/^-?\d+(?:\.\d+)?$/u.test(raw)) continue;
            const label = predicateColumn >= 0 ? String(row.cells[predicateColumn] ?? '').trim() : String(row.header[column] ?? '').trim();
            if (!label) continue;
            claims.push({ object, label, value: Number(raw), raw, canonical });
        }
    }
    return claims;
}

/**
 * 答案中「对象 + 项目」有正式事实、但金额与之不符的声明。
 *
 * 只在 (对象, 项目) 能唯一确定一组正式金额时才判定 —— 找不到对应事实时不做推断，
 * 交由既有的「金额是否在正式集合内」校验兜底（保守，不放宽安全性）。
 */
function misattributedMoneyClaims(answer, toolResults = []) {
    const { projectMoneyFacts, moneyPredicateFamilyOfLabel } = require('./moneyFactProjection.cjs');
    const facts = projectMoneyFacts(toolResults, { includeQueries: true });
    if (!facts.length) return [];
    const factsByObject = new Map();
    for (const fact of facts) {
        const key = String(fact.objectLabel).trim();
        if (!factsByObject.has(key)) factsByObject.set(key, []);
        factsByObject.get(key).push(fact);
    }
    return presentedMoneyClaims(answer).filter(claim => {
        if (!claim.canonical) return false;
        const candidates = factsByObject.get(claim.object);
        if (!candidates || !candidates.length) return false;
        const label = normalizeMoneyLabel(claim.label);
        // 行的项目名要么直接等于某个正式项目的业务标签，要么反解到同一个 predicate 族。
        // 两者都匹配不到时不做推断。
        const family = moneyPredicateFamilyOfLabel(claim.label);
        const matched = candidates.filter(fact => normalizeMoneyLabel(fact.label) === label || (family && fact.predicate === family));
        if (!matched.length) return false;
        return !matched.some(fact => fact.value === claim.value);
    });
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

module.exports = { MONEY_TABLE_ROW_CAP, monetaryValues, formatMoneyDisplay, markdownTableRows, unsupportedMoneyInAnswer, normalizeMoneyLabel, presentedMoneyClaims, misattributedMoneyClaims, formatMoneySummary, formatDashboardOverview, formatCoilCostComparison, verifiedMissingTarget, verifiedEmptyQuery, unfinishedReply, missingPreviewTotals, semanticOnlyKnowledgeRelationReply, guardedKnowledgeRelationReply, appendMissingCoilIdentities, appendMissingTechnicalFileConclusion, stabilizeLocalAnswer };
