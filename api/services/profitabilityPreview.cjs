'use strict';

// The only home for pre-tax, pre-freight gross-profit arithmetic. It consumes
// a freshly rebuilt formal Scenario Comparison; it never accepts client cost.
const crypto = require('node:crypto');
const { normalizeScenarioCompareInput, ScenarioComparisonError } = require('./recipeScenarioComparison.cjs');

const VERSION = 1;
const MAX_RESULT_BYTES = 98_304;
const REQUEST_KEYS = new Set(['version', 'basisRef', 'unitPrice', 'quantity', 'currency']);
const BASIS_KEYS = new Set(['kind', 'recipeId', 'comparisonInput', 'scenarioKey']);

class ProfitabilityPreviewError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message || code);
        this.name = 'ProfitabilityPreviewError'; this.code = code; this.statusCode = statusCode;
        if (details !== undefined) this.details = details;
    }
}
function fail(code, message, statusCode = 400, details) { throw new ProfitabilityPreviewError(code, message, statusCode, details); }
function exact(object, keys, code) { if (!object || typeof object !== 'object' || Array.isArray(object)) fail(code, '请求必须是对象'); const unknown = Object.keys(object).filter(key => !keys.has(key)); if (unknown.length) fail(code, `请求含未知字段：${unknown.join('、')}`, 422); }
function finite(value, name, { integer = false, positive = false, nonNegative = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || (positive && value <= 0) || (nonNegative && value < 0)) fail('PROFITABILITY_PREVIEW_INVALID_INPUT', `${name} 不合法`);
    return value;
}
function roundMoney(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

function normalizeProfitabilityPreviewRequest(raw) {
    exact(raw, REQUEST_KEYS, 'PROFITABILITY_PREVIEW_INVALID_INPUT');
    if (raw.version !== VERSION) fail('PROFITABILITY_PREVIEW_VERSION_UNSUPPORTED', 'version 必须为 1');
    exact(raw.basisRef, BASIS_KEYS, 'PROFITABILITY_PREVIEW_BASIS_INVALID');
    if (raw.basisRef.kind !== 'SCENARIO_COMPARISON') fail('PROFITABILITY_PREVIEW_BASIS_UNSUPPORTED', 'basisRef.kind 仅支持 SCENARIO_COMPARISON');
    const recipeId = finite(raw.basisRef.recipeId, 'basisRef.recipeId', { integer: true, positive: true });
    const comparisonInput = normalizeScenarioCompareInput(raw.basisRef.comparisonInput);
    const scenarioKey = typeof raw.basisRef.scenarioKey === 'string' ? raw.basisRef.scenarioKey : '';
    if (!scenarioKey || scenarioKey.length > 48 || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(scenarioKey)) fail('PROFITABILITY_PREVIEW_SCENARIO_INVALID', 'scenarioKey 不合法');
    if (scenarioKey !== 'base' && !comparisonInput.scenarios.some(item => item.scenarioKey === scenarioKey)) fail('PROFITABILITY_PREVIEW_SCENARIO_NOT_FOUND', 'scenarioKey 不在本次正式情景比较中', 422);
    const unitPrice = finite(raw.unitPrice, 'unitPrice', { nonNegative: true });
    const quantity = raw.quantity === null ? null : finite(raw.quantity, 'quantity', { integer: true, positive: true });
    if (raw.currency !== 'CNY') fail('UNSUPPORTED_CURRENCY', '当前盈利试算只支持 CNY', 422);
    return Object.freeze({ version: VERSION, basisRef: Object.freeze({ kind: 'SCENARIO_COMPARISON', recipeId, comparisonInput, scenarioKey }), unitPrice, quantity, currency: 'CNY' });
}

function calculateProfitability({ unitCost, unitPrice, quantity, currency = 'CNY' }) {
    finite(unitPrice, 'unitPrice', { nonNegative: true });
    if (quantity !== null) finite(quantity, 'quantity', { integer: true, positive: true });
    const warnings = ['NET_PROFIT_NOT_CALCULATED'];
    if (unitCost === null || unitCost === undefined || !Number.isFinite(unitCost)) {
        warnings.unshift('COST_INCOMPLETE');
        return { unitCost: null, unitPrice, grossProfitPerUnit: null, grossMarginOnSales: null, markupOnCost: null, quantity, totalCost: null, totalRevenue: quantity === null ? null : roundMoney(unitPrice * quantity), totalGrossProfit: null, costComplete: false, currency, warnings };
    }
    const grossProfitPerUnit = roundMoney(unitPrice - unitCost);
    const grossMarginOnSales = unitPrice === 0 ? null : grossProfitPerUnit / unitPrice;
    const markupOnCost = unitCost === 0 ? null : grossProfitPerUnit / unitCost;
    if (unitPrice === 0) warnings.unshift('GROSS_MARGIN_DENOMINATOR_ZERO');
    if (unitCost === 0) warnings.unshift('MARKUP_DENOMINATOR_ZERO');
    return { unitCost, unitPrice, grossProfitPerUnit, grossMarginOnSales, markupOnCost, quantity, totalCost: quantity === null ? null : roundMoney(unitCost * quantity), totalRevenue: quantity === null ? null : roundMoney(unitPrice * quantity), totalGrossProfit: quantity === null ? null : roundMoney(grossProfitPerUnit * quantity), costComplete: true, currency, warnings };
}

function createProfitabilityPreview({ scenarioComparison }) {
    if (!scenarioComparison || typeof scenarioComparison.compare !== 'function') throw new Error('profitabilityPreview 缺少 scenarioComparison');
    function preview(raw) {
        const request = normalizeProfitabilityPreviewRequest(raw);
        let comparison;
        try { comparison = scenarioComparison.compare(request.basisRef.recipeId, request.basisRef.comparisonInput); }
        catch (error) {
            if (error instanceof ScenarioComparisonError) throw error;
            throw error;
        }
        const scenario = comparison.scenarios.find(item => item.scenarioKey === request.basisRef.scenarioKey);
        if (!scenario) fail('PROFITABILITY_PREVIEW_SCENARIO_NOT_FOUND', '正式情景比较未返回指定 scenarioKey', 422);
        const cost = scenario.cost || {};
        const costComplete = cost.complete === true && Number.isFinite(cost.currentTotalCost);
        const arithmetic = calculateProfitability({ unitCost: costComplete ? cost.currentTotalCost : null, unitPrice: request.unitPrice, quantity: request.quantity, currency: request.currency });
        const result = {
            version: VERSION, preview: true, profitabilityId: crypto.randomUUID(), recipe: comparison.recipe,
            // This is the formal identity of the exact normalized scenario used
            // by the embedded comparison.  Task V2 uses it to prevent joining a
            // profitability receipt with a readiness receipt from another
            // configuration while still allowing their read sets to differ.
            scenarioKey: scenario.scenarioKey, configurationHash: scenario.configurationHash, ...arithmetic, costBasis: cost.costBasis || null,
            readSetId: comparison.readSetId, readSetHash: comparison.readSetHash, calculatedAt: new Date().toISOString(),
            // Small, immutable metadata only. Formal cost remains the scenario response.
            scenario: { scenarioKey: scenario.scenarioKey, configurationHash: scenario.configurationHash, role: scenario.role, label: scenario.label, cost: { complete: cost.complete === true, currentTotalCost: costComplete ? cost.currentTotalCost : null, partialTotalCost: cost.partialTotalCost ?? null, costBasis: cost.costBasis || null, missingParts: Array.isArray(cost.missingParts) ? cost.missingParts : [] } },
            // No BOM is returned. This bounded context lets Task V2 project current
            // cost and scenario facts from the exact same formal read set.
            scenarioContext: { scenarios: scenario.scenarioKey === 'base' ? [comparison.scenarios[0]] : [comparison.scenarios[0], scenario], comparisons: scenario.scenarioKey === 'base' ? [] : [comparison.comparisons.find(item => item.candidateScenarioKey === scenario.scenarioKey) || null].filter(Boolean) },
            comparison: { version: comparison.version, normalizedInput: comparison.normalizedInput, readSetId: comparison.readSetId, readSetHash: comparison.readSetHash },
        };
        const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
        if (bytes > MAX_RESULT_BYTES) fail('PAYLOAD_LIMIT', '盈利试算结果超过安全输出上限', 422, { bytes, maxBytes: MAX_RESULT_BYTES });
        return result;
    }
    return Object.freeze({ preview });
}

module.exports = { ProfitabilityPreviewError, calculateProfitability, createProfitabilityPreview, normalizeProfitabilityPreviewRequest, roundMoney };
