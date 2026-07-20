function loadDbAccessors() {
    return require('../db.cjs');
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalize(value) {
    return String(value || '').trim();
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function findRecipe(recipes, idOrName) {
    const text = normalize(idOrName);
    if (!text) return null;
    const id = Number.parseInt(text, 10);
    return recipes.find(recipe => {
        if (Number.isFinite(id) && (recipe.id === id || recipe.Id === id)) return true;
        return normalize(recipe.name) === text || normalize(recipe.name).includes(text);
    });
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

function buildRecipeCost(recipe) {
    const { loadPartsData, calculateRecipeCost } = loadDbAccessors();
    const { partsCache, partsByModel } = loadPartsData();
    const parts = parseJsonArray(recipe.partsJson);
    return calculateRecipeCost(parts, partsCache, partsByModel);
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
    const left = findRecipe(recipes, input.leftRecipeId || input.leftRecipeName || input.recipe1);
    const right = findRecipe(recipes, input.rightRecipeId || input.rightRecipeName || input.recipe2);
    if (!left) throw new Error('未找到基准配方');
    if (!right) throw new Error('未找到对比配方');

    const leftCost = Object.prototype.hasOwnProperty.call(options, 'leftCost')
        ? options.leftCost
        : buildRecipeCost(left);
    const rightCost = Object.prototype.hasOwnProperty.call(options, 'rightCost')
        ? options.rightCost
        : buildRecipeCost(right);
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
        left: { id: left.id ?? left.Id, name: left.name, spec: left.spec, totalCost: leftTotal },
        right: { id: right.id ?? right.Id, name: right.name, spec: right.spec, totalCost: rightTotal },
        totalDiff,
        direction,
        drivers: drivers.slice(0, input.limit || 20),
        summary: `对比 ${right.name} 相对 ${left.name} 成本${direction} ${Math.abs(totalDiff).toFixed(2)} 元。`,
    };
}

module.exports = { buildCostDifference };
