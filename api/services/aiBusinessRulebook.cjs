'use strict';
// 业务规矩册（可执行部分）。
//
// 背景：规矩只写在提示词里，等于"靠模型自觉"——同一个问题今天答对、明天答错。
// 这里把成本/价格口径类规矩做成确定性检查：命中条件成立时，由系统在回答后面补一条口径说明，
// 而不是指望模型每次都记得说。
//
// 每条规矩的完整说明（含"未支持"的口径）见 docs/ai-business-rulebook.md。
// 这里只放能在回答层确定性执行的规矩；能被工具层/执行层强制的规矩在册子里登记为 enforced，
// 但不在本文件重复实现。

const COIL_COST_TOOLS = new Set(['search_coils', 'calculate_coil_cost', 'get_coil_specs', 'get_coils_by_spec']);
const MACHINE_COST_TOOLS = new Set([
    'preview_recipe_cost',
    'build_recipe_bom_draft',
    'full_calculate',
    'compare_recipes',
    'explain_cost_change',
]);

const MACHINE_COST_INTENT_RE = /(配方|成品|整机|整机成本|机器|产品).{0,6}(?:成本|价格|多少钱|报价)|(?:成本|价格|多少钱|报价).{0,6}(?:配方|成品|整机|机器|产品)/u;
const COIL_LABEL_RE = /(线圈|定子)/u;
const HYPOTHETICAL_PRICE_RE = /(?:按|如果|假如|假设|要是)[^。\n]{0,12}(?:铜价|铜|铝价|材料价|料价|价格|单价)[^。\n]{0,10}(\d+(?:\.\d+)?)/u;
const PRICE_BASIS_RE = /(铜价|铜基价|copperBase|报价基数)/u;

function verifiedResults(toolResults = []) {
    return (Array.isArray(toolResults) ? toolResults : [])
        .filter(item => item?.result && item.result.success !== false);
}

function hasResultFrom(toolResults, toolNames) {
    return verifiedResults(toolResults).some(item => toolNames.has(item.name));
}

function answerHasAmount(answer) {
    const text = String(answer || '');
    if (/[¥￥]\s*-?\d|\d+(?:\.\d+)?\s*元/u.test(text)) return true;
    // 正式金额表也是金额（金额守卫在无法核对时会输出这种表）：识别"表格行里有一格是纯数字"。
    return text.split(/\r?\n/).some(line => (
        line.includes('|')
        && line.trim().replace(/^\||\|$/g, '').split('|')
            .some(cell => /^\s*\*{0,2}-?\d+(?:\.\d+)?\*{0,2}\s*$/u.test(cell))
    ));
}

/** 从本轮正式结果里取铜基价（元/千克），用于口径说明。 */
function copperBaseFromResults(toolResults = []) {
    const values = [];
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        for (const [key, nested] of Object.entries(value)) {
            if (key === 'copperBase' && Number.isFinite(Number(nested))) values.push(Number(nested));
            else if (key === 'copperPricePerKg' && Number.isFinite(Number(nested))) values.push(Number(nested));
            else if (nested && typeof nested === 'object') visit(nested);
        }
    };
    for (const item of verifiedResults(toolResults)) visit(item.result?.data ?? item.result);
    return values.length ? values[0] : null;
}

/**
 * 整机成本问题不能用线圈成本代替：问的是配方/成品/整机的成本，本轮却只有线圈级正式金额，
 * 而回答里连"线圈"两个字都没提。命中则补一条口径说明。
 */
function machineVsCoilRule({ answer, userText, toolResults }) {
    if (!MACHINE_COST_INTENT_RE.test(String(userText || ''))) return null;
    if (!hasResultFrom(toolResults, COIL_COST_TOOLS)) return null;
    if (hasResultFrom(toolResults, MACHINE_COST_TOOLS)) return null;
    if (COIL_LABEL_RE.test(String(answer || ''))) return null;
    return {
        id: 'BR-COST-BASIS',
        text: '口径说明：上面的金额是**线圈方案成本**。整机（成品）成本要按在售配方为基准重新核算，'
            + '包含泵壳、零件、人工、包装等；需要的话我按你指定的配方继续算。',
    };
}

/**
 * 假设价格：用户问"按铜价95算"，而系统不会按假设价格试算，回答也没说明用的是哪个铜价口径。
 * 命中则补一条口径说明（含本轮正式档案里的铜基价，避免用户误以为已按假设价算过）。
 */
function hypotheticalPriceRule({ answer, userText, toolResults }) {
    const match = HYPOTHETICAL_PRICE_RE.exec(String(userText || ''));
    if (!match) return null;
    if (!answerHasAmount(answer)) return null;
    if (PRICE_BASIS_RE.test(String(answer || ''))) return null;
    const copperBase = copperBaseFromResults(toolResults);
    const basis = copperBase === null
        ? '系统当前的正式铜基价'
        : `系统当前正式铜基价 ${copperBase} 元/千克`;
    return {
        id: 'BR-HYPOTHETICAL-PRICE',
        text: `口径说明：本轮金额按${basis}核算，**不是**按你假设的价格算出来的；`
            + 'AI 工具目前不接受指定铜价（线圈级服务已支持该参数但未开放），整机级成本也不支持假设铜价。'
            + '需要按假设铜价评估，请先确认这个口径要不要做进系统。',
    };
}

const RULES = Object.freeze([
    { id: 'BR-COST-BASIS', enforce: machineVsCoilRule },
    { id: 'BR-HYPOTHETICAL-PRICE', enforce: hypotheticalPriceRule },
]);

/**
 * 按业务规矩册检查并补齐回答。
 * @returns {{ answer: string, applied: string[] }}
 */
function enforceBusinessRules({ answer, userText, toolResults } = {}) {
    const text = String(answer ?? '');
    if (!text.trim()) return { answer, applied: [] };
    const applied = [];
    const notes = [];
    for (const rule of RULES) {
        const hit = rule.enforce({ answer: text, userText, toolResults });
        if (!hit) continue;
        applied.push(hit.id);
        notes.push(hit.text);
    }
    if (notes.length === 0) return { answer, applied };
    return { answer: `${text}\n\n${notes.join('\n')}`, applied };
}

module.exports = {
    COIL_COST_TOOLS,
    MACHINE_COST_TOOLS,
    RULES,
    copperBaseFromResults,
    enforceBusinessRules,
    hypotheticalPriceRule,
    machineVsCoilRule,
};
