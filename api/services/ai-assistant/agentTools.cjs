'use strict';

const { executeToolCall } = require('../../routes/ai/executor.cjs');

class AgentToolError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AgentToolError';
        this.code = code;
    }
}

const AGENT_TOOLS = Object.freeze([
    Object.freeze({
        type: 'function',
        function: Object.freeze({
            name: 'find_recipe',
            description: '在正式配方目录中按用户给出的型号查询候选配方。只返回正式候选，不会猜测或选择身份。',
            parameters: Object.freeze({
                type: 'object', additionalProperties: false,
                properties: { keyword: { type: 'string', minLength: 1, maxLength: 80, description: '用户提及的配方型号，例如 V550' } },
                required: ['keyword'],
            }),
        }),
    }),
    Object.freeze({
        type: 'function',
        function: Object.freeze({
            name: 'preview_profitability',
            description: '对已由 find_recipe 正式确认的配方，按临时电缆长度和售价调用正式毛利试算。只读，不保存配方、报价或订单。',
            parameters: Object.freeze({
                type: 'object', additionalProperties: false,
                properties: {
                    recipeId: { type: 'integer', minimum: 1, description: '必须来自本轮 find_recipe 的唯一正式结果' },
                    cableLength: { type: 'number', minimum: 0, description: '临时电缆长度，单位米' },
                    unitPrice: { type: 'number', minimum: 0, description: '临时售价，单位 CNY' },
                },
                required: ['recipeId', 'cableLength', 'unitPrice'],
            }),
        }),
    }),
]);

function strictObject(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', `${label} 参数必须是对象`);
    }
    const unknown = Object.keys(value).filter(key => !fields.includes(key));
    if (unknown.length > 0) {
        throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', `${label} 包含未声明字段`);
    }
}

function findRecipeArgs(args) {
    strictObject(args, ['keyword'], 'find_recipe');
    const keyword = String(args.keyword || '').trim();
    if (!keyword || keyword.length > 80) {
        throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', 'find_recipe.keyword 无效');
    }
    return { keyword };
}

function profitabilityArgs(args, resolvedRecipeIds) {
    strictObject(args, ['recipeId', 'cableLength', 'unitPrice'], 'preview_profitability');
    const recipeId = Number(args.recipeId);
    const cableLength = Number(args.cableLength);
    const unitPrice = Number(args.unitPrice);
    if (!Number.isSafeInteger(recipeId) || recipeId <= 0 || !resolvedRecipeIds.has(recipeId)) {
        throw new AgentToolError('AGENT_TOOL_IDENTITY_UNVERIFIED', 'recipeId 必须来自本轮正式配方查询结果');
    }
    if (!Number.isFinite(cableLength) || cableLength < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new AgentToolError('AGENT_TOOL_ARGS_INVALID', '电缆长度或售价无效');
    }
    return { recipeId, cableLength, unitPrice };
}

function formalProfitabilityArgs({ recipeId, cableLength, unitPrice }) {
    return {
        version: 1,
        basisRef: {
            kind: 'SCENARIO_COMPARISON',
            recipeId,
            comparisonInput: {
                version: 1,
                baselinePolicy: 'CURRENT_REBUILT',
                scenarios: [{
                    scenarioKey: 'candidate',
                    label: '临时方案',
                    overrides: { cableLength },
                }],
            },
            scenarioKey: 'candidate',
        },
        unitPrice,
        quantity: null,
        currency: 'CNY',
    };
}

function conciseProjection(agentToolName, result, data = result?.data ?? null) {
    const evidence = result?.executionEvidence;
    const success = result?.success !== false;
    return {
        success,
        agentToolName,
        verified: evidence?.verified === true,
        data: success ? data : null,
        ...(success ? {} : {
            code: 'FORMAL_TOOL_FAILED',
            message: '正式业务工具暂不可用，无法完成本次试算。',
        }),
    };
}

function resolvedRecipeIdsFrom(result) {
    return (Array.isArray(result?.data) ? result.data : [])
        .map(recipe => Number(recipe?.id ?? recipe?.Id))
        .filter(id => Number.isSafeInteger(id) && id > 0);
}

function recipeIdentityProjection(result) {
    return (Array.isArray(result?.data) ? result.data : []).slice(0, 10).flatMap(recipe => {
        const id = Number(recipe?.id ?? recipe?.Id);
        const name = String(recipe?.name || '').trim();
        if (!Number.isSafeInteger(id) || id <= 0 || !name) return [];
        return [{ id, name }];
    });
}

function profitabilityProjection(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return {
        costComplete: data.costComplete === true,
        currency: data.currency || null,
        costBasis: data.costBasis || null,
        scenarioKey: data.scenarioKey || null,
        unitPrice: data.unitPrice ?? null,
        unitCost: data.unitCost ?? null,
        grossProfitPerUnit: data.grossProfitPerUnit ?? null,
        grossMarginOnSales: data.grossMarginOnSales ?? null,
        markupOnCost: data.markupOnCost ?? null,
    };
}

async function executeAgentTool(name, args, context = {}, dependencies = {}) {
    const runFormalTool = dependencies.executeToolCall || executeToolCall;
    const resolvedRecipeIds = context.resolvedRecipeIds instanceof Set
        ? context.resolvedRecipeIds
        : new Set();
    if (name === 'find_recipe') {
        const validated = findRecipeArgs(args);
        const result = await runFormalTool('get_all_recipes', validated, { allowWrite: false, signal: context.signal });
        const recipeIds = resolvedRecipeIdsFrom(result);
        const data = recipeIdentityProjection(result);
        if (result?.success !== false && recipeIds.length === 1) resolvedRecipeIds.add(recipeIds[0]);
        return conciseProjection('find_recipe', result, data);
    }
    if (name === 'preview_profitability') {
        const validated = profitabilityArgs(args, resolvedRecipeIds);
        const result = await runFormalTool('preview_profitability', formalProfitabilityArgs(validated), {
            allowWrite: false,
            signal: context.signal,
        });
        return conciseProjection('preview_profitability', result, profitabilityProjection(result?.data));
    }
    throw new AgentToolError('AGENT_TOOL_NOT_ALLOWED', `M1 不允许调用工具：${String(name || '')}`);
}

module.exports = {
    AGENT_TOOLS,
    AgentToolError,
    conciseProjection,
    executeAgentTool,
    formalProfitabilityArgs,
    profitabilityProjection,
    recipeIdentityProjection,
};
