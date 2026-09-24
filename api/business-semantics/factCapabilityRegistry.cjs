'use strict';

const { deepFreeze } = require('./contract.cjs');

// Single reviewed mapping from semantic facts to existing registered read capabilities.
// The planner never calls SQL or business services directly.
const FactCapabilityRegistry = deepFreeze({
    RECIPE_CANONICAL_IDENTITY: { capability: 'get_all_recipes', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    RECIPE_CURRENT_FULL_COST: { capability: ['full_calculate', 'get_recipe_detail', 'preview_recipe_cost'], sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['CANONICAL_SUBJECT_ID', 'VERIFIED_PRIOR_FACT'] },
    RECIPE_COST_COMPARISON: { capability: 'compare_recipes', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    RECIPE_BASE_CONFIGURATION: { capability: 'get_all_recipes', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    COIL_CANONICAL_IDENTITY: { capability: 'search_coils', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    COIL_OFFICIAL_VARIANT_SET: { capability: 'search_coils', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    COIL_SCHEME_COST: { capability: 'search_coils', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    COIL_VARIANT_INVENTORY: { capability: 'search_coils', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    COIL_OVERRIDE_APPLIED: { capability: 'calculate_coil_cost', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['CANONICAL_SUBJECT_ID', 'USER_EXPLICIT_VALUE'] },
    PART_CATALOG_IDENTITY: { capability: 'search_parts', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    PART_CATALOG_UNIT_COST: { capability: 'search_parts', sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    CURRENT_COPPER_PRICE_BASIS: { capability: ['get_copper_price', 'search_coils'], sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['VERIFIED_PRIOR_FACT'] },
    CROSS_CATALOG_CANDIDATES: { capability: ['get_all_recipes', 'search_templates', 'search_parts'], sourcePolicy: 'FORMAL_API_ONLY', argumentPolicy: ['USER_EXPLICIT_VALUE'] },
    FORMAL_RELATION_RESULT: { capability: ['get_recipe_detail', 'search_coils', 'get_recipes_by_coil',
        'get_recipe_parts', 'get_recipes_by_part'], sourcePolicy: 'FORMAL_API_ONLY',
        argumentPolicy: ['CANONICAL_SUBJECT_ID', 'VERIFIED_PRIOR_FACT'] },
    // S2-R3-P1：配方齐料/缺料预览的正式事实来源。
    // 能力 `preview_virtual_readiness` 已登记为正式只读能力（registry.cjs），
    // 但仍是 Native-only 私有能力（NATIVE_ONLY_AI_TOOL_NAMES）：
    // Legacy 侧**不**为它规划调用，只把缺失如实表达成「没有取得正式齐料结论」。
    VIRTUAL_READINESS_PREVIEW: { capability: 'preview_virtual_readiness', sourcePolicy: 'FORMAL_API_ONLY',
        argumentPolicy: ['CANONICAL_SUBJECT_ID', 'VERIFIED_PRIOR_FACT'] },
});

function capabilityForFact(factType) { return FactCapabilityRegistry[factType] || null; }

module.exports = { FactCapabilityRegistry, capabilityForFact };
