const {
    buildCurrentRecipeCostBasis,
} = require('./currentRecipeCost.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function normalize(value) {
    return String(value || '').trim();
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function resolveRecipe(recipes, idOrName, role) {
    const text = normalize(idOrName);
    const label = role === 'left' ? '基准配方' : '对比配方';
    if (!text) throw Object.assign(new Error(`未找到${label}`), {
        statusCode: 404,
        code: 'RECIPE_SELECTOR_NOT_FOUND',
    });
    const id = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
    const exact = recipes.filter(recipe => (
        (id != null && Number(recipe.id ?? recipe.Id) === id)
        || normalize(recipe.name).toLowerCase() === text.toLowerCase()
    ));
    const matches = exact.length > 0
        ? exact
        : recipes.filter(recipe => normalize(recipe.name).toLowerCase().includes(text.toLowerCase()));
    if (matches.length === 0) throw Object.assign(new Error(`未找到${label}`), {
        statusCode: 404,
        code: 'RECIPE_SELECTOR_NOT_FOUND',
        details: { role, selector: text },
    });
    if (matches.length > 1) throw Object.assign(
        new Error(`${label}“${text}”匹配到 ${matches.length} 条记录，请使用配方ID或完整名称`),
        {
            statusCode: 409,
            code: 'RECIPE_SELECTOR_AMBIGUOUS',
            details: {
                role,
                selector: text,
                candidates: matches.slice(0, 10).map(recipe => ({
                    id: recipe.id ?? recipe.Id,
                    name: recipe.name,
                    spec: recipe.spec,
                })),
            },
        }
    );
    return matches[0];
}

function itemKey(item) {
    const name = normalize(item.name || item.model);
    if (name) return name.replace(/\s+/g, '');
    return normalize(item.model).replace(/\s+/g, '');
}

function itemIdentity(item) {
    return [item.model, item.supplier].filter(Boolean).join(' / ') || item.name || item.model || '-';
}

function aggregateDetails(details = []) {
    const map = new Map();
    for (const item of details || []) {
        const key = itemKey(item);
        if (!key) continue;
        const current = map.get(key) || {
            key,
            name: item.name || item.model || key,
            amount: 0,
            qty: 0,
            identities: new Set(),
        };
        current.amount += Number(item.subtotal || 0);
        current.qty += Number(item.qty || 0);
        current.identities.add(itemIdentity(item));
        map.set(key, current);
    }
    return map;
}

function driverReason(left, right) {
    if (left && !right) return '只存在于基准配方';
    if (!left && right) return '只存在于对比配方';
    const leftModels = [...(left?.identities || [])].join('、');
    const rightModels = [...(right?.identities || [])].join('、');
    if (leftModels !== rightModels) return '型号或供应商不同';
    if (Number((left?.qty || 0).toFixed(4)) !== Number((right?.qty || 0).toFixed(4))) return '数量不同';
    return '单价或动态成本不同';
}

function incompleteRecipeCostError(recipe, missingParts) {
    const error = new Error(
        `配方“${recipe.name}”当前成本不完整，缺少价格：${missingParts.join('、')}`
    );
    error.statusCode = 422;
    error.code = 'RECIPE_COST_INCOMPLETE';
    error.details = {
        recipeId: recipe.id ?? recipe.Id,
        recipeName: recipe.name,
        missingParts,
    };
    return error;
}

function buildRecipeCost(recipe, dependencies = {}) {
    const basis = buildCurrentRecipeCostBasis(recipe, dependencies);
    if (!basis.costComplete) {
        throw incompleteRecipeCostError(recipe, basis.missingParts);
    }
    return {
        totalCost: basis.partialTotalCost,
        itemCount: Number(basis.partsResult.itemCount || basis.parts.length),
        details: [
            ...(basis.partsResult.details || []),
            ...basis.laborDetails,
        ],
        partsCost: basis.partialPartsCost,
        laborCost: basis.laborCost,
        missingParts: [],
    };
}

function buildCostDifference(input = {}, options = {}) {
    let db = options.dbAccessors || null;
    const getDb = () => {
        if (!db) db = loadDbAccessors();
        return db;
    };
    const recipes = Object.prototype.hasOwnProperty.call(options, 'recipes')
        ? options.recipes
        : getDb().dbGetAllRecipes();
    const left = resolveRecipe(
        recipes,
        input.leftRecipeId || input.leftRecipeName || input.recipe1,
        'left'
    );
    const right = resolveRecipe(
        recipes,
        input.rightRecipeId || input.rightRecipeName || input.recipe2,
        'right'
    );

    const leftCost = Object.prototype.hasOwnProperty.call(options, 'leftCost')
        ? options.leftCost
        : buildRecipeCost(left, options.currentCostDependencies || getDb());
    const rightCost = Object.prototype.hasOwnProperty.call(options, 'rightCost')
        ? options.rightCost
        : buildRecipeCost(right, options.currentCostDependencies || getDb());
    const leftMap = aggregateDetails(leftCost.details || []);
    const rightMap = aggregateDetails(rightCost.details || []);
    const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
    const drivers = keys.map((key) => {
        const leftItem = leftMap.get(key);
        const rightItem = rightMap.get(key);
        const leftAmount = roundMoney(leftItem?.amount || 0);
        const rightAmount = roundMoney(rightItem?.amount || 0);
        return {
            key,
            name: leftItem?.name || rightItem?.name || key,
            leftAmount,
            rightAmount,
            diff: roundMoney(rightAmount - leftAmount),
            leftQty: roundMoney(leftItem?.qty || 0),
            rightQty: roundMoney(rightItem?.qty || 0),
            leftIdentities: [...(leftItem?.identities || [])],
            rightIdentities: [...(rightItem?.identities || [])],
            reason: driverReason(leftItem, rightItem),
        };
    }).filter(item => item.diff !== 0)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name, 'zh-CN'));

    const leftTotal = roundMoney(leftCost.totalCost);
    const rightTotal = roundMoney(rightCost.totalCost);
    const totalDiff = roundMoney(rightTotal - leftTotal);
    const direction = totalDiff > 0 ? '增加' : totalDiff < 0 ? '降低' : '持平';

    return {
        generatedAt: new Date().toISOString(),
        sourceOfTruth: 'costEngine',
        costBasis: 'currentFullCost',
        left: {
            id: left.id ?? left.Id,
            name: left.name,
            spec: left.spec,
            totalCost: leftTotal,
            partsCost: roundMoney(leftCost.partsCost ?? leftTotal),
            laborCost: roundMoney(leftCost.laborCost || 0),
            itemCount: Number(leftCost.itemCount || 0),
        },
        right: {
            id: right.id ?? right.Id,
            name: right.name,
            spec: right.spec,
            totalCost: rightTotal,
            partsCost: roundMoney(rightCost.partsCost ?? rightTotal),
            laborCost: roundMoney(rightCost.laborCost || 0),
            itemCount: Number(rightCost.itemCount || 0),
        },
        totalDiff,
        direction,
        drivers: drivers.slice(0, input.limit || 20),
        warnings: [],
        summary: `对比 ${right.name} 相对 ${left.name} 成本${direction} ${Math.abs(totalDiff).toFixed(2)} 元。`,
    };
}

module.exports = { buildCostDifference };
