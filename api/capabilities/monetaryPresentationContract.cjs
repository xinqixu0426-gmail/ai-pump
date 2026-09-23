'use strict';
/**
 * 金额展示契约（AI Answer Presentation Remediation V1 — Part 1-R1/R2）。
 *
 * ── 两个必须分开的概念 ──────────────────────────────────────────────
 * A. 能力**能提供**哪些正式金额事实（availability，本文件声明）
 *    `build_recipe_bom_draft` 能给出 BOM 总成本与分项成本 —— 这是能力元数据。
 * B. 本轮**用户目标要求**看到哪些金额事实（turn requirement，由已解析目标层给出）
 *    同一个能力可以服务多个目标：
 *      「这个配置用了哪些零件？」   → 不要求金额
 *      「这套 BOM 一共多少钱？」     → 要求金额
 *      「把零件和成本都列出来」      → 要求金额 + 明细
 *
 * 因此本文件**只**声明 A。B 由 `turnMonetaryPresentation()` 从既有业务语义层
 * （`api/business-semantics` 的已解析 kind/operation）取得，见文件末尾。
 * 不能用 `operation === 'preview'` 代替 B，也不能用关键词/正则意图识别。
 *
 * ── 契约 ────────────────────────────────────────────────────────────
 * 只有显式登记的能力才有**可提供**的金额事实；未登记默认 fail-closed：
 * `availableMoneyFacts = []`。
 *
 * 路径取自**正式服务输出**的真实字段（不是渲染字符串）：
 *   - path  从工具结果根对象或 result.data 读起（数组结果按每个元素展开），点号分隔；
 *   - label 是该事实在用户可见答案里的业务名称。
 */

// compare_recipes 的正式输出（api/routes/ai/executors/recipeExecutors.cjs 第 755-779 行）：
//   { recipe1: { name, cost, ... }, recipe2: { name, cost, ... }, costDiff }
const COMPARE_RECIPES_FACTS = Object.freeze([
    Object.freeze({ path: 'recipe1.cost', label: '成本' }),
    Object.freeze({ path: 'recipe2.cost', label: '成本' }),
    Object.freeze({ path: 'costDiff', label: '成本差额（后者减前者）' }),
]);

// 配置成本试算的正式输出：{ costPreview: { currentTotalCost, partsCost, laborCost }, parts, ... }
// S2-R1 §A：BOM 草稿是**规划/保存口径**（costBasis=configuredBomDraft），不是当前重算结果。
// 该字段名沿用了 currentTotalCost，但业务标签必须显式说明口径，否则会被当成当前成本展示。
const BOM_DRAFT_FACTS = Object.freeze([
    Object.freeze({ path: 'costPreview.currentTotalCost', label: 'BOM 草稿总成本（非当前重算口径）' }),
    Object.freeze({ path: 'costPreview.partsCost', label: '零件成本' }),
    Object.freeze({ path: 'costPreview.laborCost', label: '人工成本' }),
]);

// 配方成本试算有多条输出路径（api/routes/ai/executors/businessExecutors.cjs）：
//   无覆盖：selectCurrentRecipeCost(...)          → 根级 currentTotalCost
//   有覆盖：{ ...preview, ...preview.costPreview } → 根级 currentTotalCost + partsCost/laborCost
//   仅取整机总额的路径                            → 根级 totalCost（canary 语料即此形状：
//                                                   { success, data: [], count: 0, totalCost: 100 }）
// 三条都要声明，否则某些路径会漏掉事实。
const RECIPE_COST_FACTS = Object.freeze([
    Object.freeze({ path: 'currentTotalCost', label: '当前总成本' }),
    Object.freeze({ path: 'partsCost', label: '零件成本' }),
    Object.freeze({ path: 'laborCost', label: '人工成本' }),
    Object.freeze({ path: 'totalCost', label: '总成本' }),
]);

// 线圈成本试算：根级（或 data 下）totalCost（api/services/coilCost.cjs）。
const COIL_COST_FACTS = Object.freeze([
    Object.freeze({ path: 'totalCost', label: '总成本' }),
    Object.freeze({ path: 'data.totalCost', label: '总成本' }),
]);

const MONETARY_PRESENTATION_CONTRACTS = Object.freeze({
    compare_recipes: Object.freeze({ monetary: true, availableMoneyFacts: COMPARE_RECIPES_FACTS }),
    build_recipe_bom_draft: Object.freeze({ monetary: true, availableMoneyFacts: BOM_DRAFT_FACTS }),
    preview_recipe_cost: Object.freeze({ monetary: true, availableMoneyFacts: RECIPE_COST_FACTS }),
    calculate_coil_cost: Object.freeze({ monetary: true, availableMoneyFacts: COIL_COST_FACTS }),
    // 明确**不**提供金额事实的 preview 能力（负向对照）：
    //   preview_pump_shell_cost —— 只回答泵壳本体在不同机筒长度下多少钱，
    //   结果不带整机金额字段，不应被追加金额表。
});

/**
 * 读取一个能力的金额事实**可用性**契约。
 * 未登记 → fail-closed 空契约。
 * @returns {{ monetary: boolean, availableMoneyFacts: ReadonlyArray<{path: string, label: string}> }}
 */
function monetaryPresentationFor(capabilityName) {
    return MONETARY_PRESENTATION_CONTRACTS[capabilityName]
        || Object.freeze({ monetary: false, availableMoneyFacts: Object.freeze([]) });
}

/** 该能力是否显式声明了**可提供**的正式金额事实。 */
function providesMonetaryFacts(capabilityName) {
    const contract = monetaryPresentationFor(capabilityName);
    return contract.monetary === true && contract.availableMoneyFacts.length > 0;
}

/** 按点号路径读取值；路径不存在返回 undefined。 */
function readPath(root, path) {
    let current = root;
    for (const segment of String(path).split('.')) {
        if (current === null || current === undefined || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

/**
 * 本轮工具结果里**可提供**的正式金额事实。
 *
 * 只取契约里显式声明的路径，不做全量金额扫描 —— 未声明能力的结果里附带多少金额字段
 * 都不会产生事实。注意：这只是「能不能给」，**不**代表本轮该不该展示。
 *
 * @returns {{ capability: string, factPath: string, label: string, value: number }[]}
 */
function availableMoneyFacts(toolResults = [], capabilityName = null) {
    const facts = [];
    for (const item of toolResults) {
        if (capabilityName && item?.name !== capabilityName) continue;
        const contract = monetaryPresentationFor(item?.name);
        if (!contract.monetary || contract.availableMoneyFacts.length === 0) continue;
        const result = item?.result;
        if (!result || result.success === false) continue;
        // 事实路径既可能挂在 result.data 下，也可能直接挂在 result 根上
        // （compare_recipes 返回 { recipe1, recipe2, costDiff }；canary 的线圈成本返回
        //  { data: [], count: 0, totalCost: 100 }）。
        // 只有 data 是**非空数组**时才按行展开；空的 data 数组不能遮住根上的真实取值。
        const roots = Array.isArray(result.data) && result.data.length > 0
            ? result.data
            : [result.data, result];
        for (const root of roots) {
            if (!root || typeof root !== 'object') continue;
            for (const fact of contract.availableMoneyFacts) {
                const raw = readPath(root, fact.path);
                if (raw === undefined || raw === null || raw === '') continue;
                const value = Number(raw);
                if (!Number.isFinite(value)) continue;
                if (facts.some(existing => existing.capability === item.name
                    && existing.factPath === fact.path && existing.value === value)) continue;
                facts.push({ capability: item.name, factPath: fact.path, label: fact.label, value });
            }
        }
    }
    return facts;
}

/**
 * 本轮的金额展示**要求**（turn-level presentation obligation）。
 *
 * 来源是既有业务语义层已经解析出的目标
 * （`api/business-semantics/eligibilityBoundary.cjs` 的 `kind` / `operation`），
 * **不是**关键词或正则意图识别，也不是 `operation === 'preview'` 推导。
 *
 * 判据（按能力语义枚举，逐条显式）：
 * - 需要金额结论：COST_QUERY / HYPOTHETICAL_COST_QUERY / CONFIGURATION_OVERRIDE
 *   且 operation 落在金额侧（READ_COST / READ_OR_PREVIEW_COST / PREVIEW_CONFIGURATION_COST）
 * - 不需要金额结论：INVENTORY_QUERY（READ_INVENTORY）、CATALOG_LOOKUP（LOOKUP）、
 *   CONFIGURATION_OVERRIDE 但 operation=DESCRIBE_CONFIGURATION
 *   —— DESCRIBE_CONFIGURATION 正是「这个配置用了哪些零件」这类目标
 *
 * 该字段只约束**补全**（要不要主动补金额表），不约束**安全**：
 * 正文自己写了无依据金额时，金额守卫仍然照常纠正。
 */
// E1-B：成本比较目标（COST_COMPARISON / COMPARE_COST）本质上**要求金额结论** ——
// 与「这个配置用了哪些零件」（DESCRIBE_CONFIGURATION）不同，比较问法没有金额就没有回答。
const MONETARY_TURN_OPERATIONS = Object.freeze(['READ_COST', 'READ_OR_PREVIEW_COST', 'PREVIEW_CONFIGURATION_COST', 'COMPARE_COST']);
const NON_MONETARY_TURN_OPERATIONS = Object.freeze(['READ_INVENTORY', 'LOOKUP', 'DESCRIBE_CONFIGURATION', 'READ_COPPER_PRICE']);

function turnMonetaryPresentation(eligibility) {
    const kind = String(eligibility?.kind || '');
    const operation = String(eligibility?.operation || '');
    // 目标没解析出来（OUT_OF_SCOPE / 未接线）：不把它当成「明确不要求金额」。
    // 返回 monetary=null（unknown），让补全退回能力可用性这一层既有行为，
    // 避免因为分类器没覆盖某种问法就静默改变已验证的行为。
    if (!kind || kind === 'OUT_OF_SCOPE') {
        return Object.freeze({ monetary: null, unknown: true, kind, operation, source: 'unresolved_goal' });
    }
    if (NON_MONETARY_TURN_OPERATIONS.includes(operation)) {
        return Object.freeze({ monetary: false, unknown: false, kind, operation, source: 'resolved_goal_operation' });
    }
    if (MONETARY_TURN_OPERATIONS.includes(operation)) {
        return Object.freeze({ monetary: true, unknown: false, kind, operation, source: 'resolved_goal_operation' });
    }
    // 已解析 kind 但 operation 不在枚举内：补全侧按 fail-closed 处理（不主动补金额）。
    return Object.freeze({ monetary: false, unknown: false, kind, operation, source: 'unresolved_operation' });
}

/**
 * 本轮**应当补全**的正式金额事实 = 本轮要求(monetary) ∧ 能力可提供。
 *
 * @param {{monetary: boolean}|null} turnRequirement 由 turnMonetaryPresentation 得到；
 *        传 null/undefined 表示「本轮要求未知」——此时退回能力可用性，
 *        保持 Part 1-R1 的既有行为（避免调用方未接线时行为静默改变）。
 * @returns {{ capability: string, factPath: string, label: string, value: number }[]}
 */
function requiredMoneyFacts(toolResults = [], turnRequirement = undefined) {
    // monetary === false → 本轮目标明确不要求金额 → 不补全（但安全校验仍在守卫里照常运行）。
    // monetary === null/true 或未接线（undefined）→ 退回能力可用性这一层。
    if (turnRequirement && turnRequirement.monetary === false) return [];
    return availableMoneyFacts(toolResults);
}

module.exports = {
    MONETARY_PRESENTATION_CONTRACTS,
    MONETARY_TURN_OPERATIONS,
    NON_MONETARY_TURN_OPERATIONS,
    monetaryPresentationFor,
    providesMonetaryFacts,
    availableMoneyFacts,
    requiredMoneyFacts,
    turnMonetaryPresentation,
};
