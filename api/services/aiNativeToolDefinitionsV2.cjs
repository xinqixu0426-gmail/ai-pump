'use strict';

// This is a constrained Native-only tool surface.  It is intentionally not
// appended to legacy AI_TOOLS: the frozen Legacy runtime must keep its exact
// tool catalogue until N3 explicitly takes over orchestration.
const AI_NATIVE_TOOLS_V2 = Object.freeze([
    Object.freeze({
        type: 'function',
        function: Object.freeze({
            name: 'compare_recipe_scenarios',
            description: '在同一次正式读取集合中，对一个已确认配方的当前重建成本和最多三个候选配置进行只读比较。不会保存配方、不会写入库存；覆盖只允许正式配置字段。包装必须引用正式包装零件身份，表面处理费用只能由用户或正式配方政策提供，不能传入零件价格、成本或铜价。',
            parameters: Object.freeze({
                type: 'object', additionalProperties: false,
                properties: {
                    recipeId: { type: 'integer', minimum: 1 }, version: { type: 'integer', const: 1 },
                    baselinePolicy: { type: 'string', const: 'CURRENT_REBUILT' },
                    scenarios: { type: 'array', minItems: 1, maxItems: 3, items: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            scenarioKey: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,47}$' },
                            label: { type: 'string', minLength: 1, maxLength: 80 },
                            overrides: { type: 'object', additionalProperties: false, properties: {
                                hasFloat: { type: 'boolean' }, floatWire: { type: 'string' },
                                floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
                                hasCable: { type: 'boolean' }, cableLength: { type: 'number', minimum: 0 },
                                cableWire: { type: 'string' }, cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
                                coilId: { type: 'integer', minimum: 1 }, coilSheets: { type: 'integer', minimum: 1 },
                                customBarrelLength: { type: 'number', exclusiveMinimum: 0 },
                                packingParts: { type: 'array', maxItems: 12, items: {
                                    type: 'object', additionalProperties: false,
                                    properties: {
                                        partId: { type: 'integer', minimum: 1 }, model: { type: 'string', minLength: 1, maxLength: 160 },
                                        supplier: { type: 'string', maxLength: 160 }, qty: { type: 'number', minimum: 0 },
                                        packingRole: { type: 'string', enum: ['container', 'pearlCotton', 'foam', 'fixed'] },
                                    }, required: ['partId', 'model', 'supplier', 'qty', 'packingRole'],
                                } },
                                surfaceTreatmentMode: { type: 'string', enum: ['none', 'painting', 'electrophoresis', 'electrophoresis_powder_coating', 'powder_coating', 'custom'] },
                                surfaceTreatmentCost: { type: 'number', minimum: 0 },
                            } },
                        }, required: ['scenarioKey', 'label', 'overrides'],
                    } },
                }, required: ['recipeId', 'version', 'baselinePolicy', 'scenarios'],
            }),
        }),
    }),
    Object.freeze({
        type: 'function',
        function: Object.freeze({
            name: 'preview_profitability',
            description: '在一次当前正式情景成本重建的同一读取集合上，试算单台毛利、销售毛利率和成本加价率。只读，不保存报价或订单；不接受客户端成本、毛利或历史加价倍数。',
            parameters: Object.freeze({
                type: 'object', additionalProperties: false,
                properties: {
                    version: { type: 'integer', const: 1 },
                    basisRef: { type: 'object', additionalProperties: false, properties: {
                        kind: { type: 'string', const: 'SCENARIO_COMPARISON' }, recipeId: { type: 'integer', minimum: 1 },
                        comparisonInput: { type: 'object', additionalProperties: false, properties: {
                            version: { type: 'integer', const: 1 }, baselinePolicy: { type: 'string', const: 'CURRENT_REBUILT' },
                            scenarios: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
                                scenarioKey: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 80 },
                                overrides: { type: 'object', additionalProperties: false, properties: {
                                    hasFloat: { type: 'boolean' }, floatWire: { type: 'string' }, floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] }, hasCable: { type: 'boolean' }, cableLength: { type: 'number', minimum: 0 }, cableWire: { type: 'string' }, cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] }, coilId: { type: 'integer', minimum: 1 }, coilSheets: { type: 'integer', minimum: 1 }, customBarrelLength: { type: 'number', exclusiveMinimum: 0 },
                                    packingParts: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { partId: { type: 'integer', minimum: 1 }, model: { type: 'string', minLength: 1, maxLength: 160 }, supplier: { type: 'string', maxLength: 160 }, qty: { type: 'number', minimum: 0 }, packingRole: { type: 'string', enum: ['container', 'pearlCotton', 'foam', 'fixed'] } }, required: ['partId', 'model', 'supplier', 'qty', 'packingRole'] } },
                                    surfaceTreatmentMode: { type: 'string', enum: ['none', 'painting', 'electrophoresis', 'electrophoresis_powder_coating', 'powder_coating', 'custom'] }, surfaceTreatmentCost: { type: 'number', minimum: 0 },
                                } },
                            }, required: ['scenarioKey', 'label', 'overrides'] } },
                        }, required: ['version', 'baselinePolicy', 'scenarios'] }, scenarioKey: { type: 'string', pattern: '^(base|[A-Za-z][A-Za-z0-9_-]{0,47})$' },
                    }, required: ['kind', 'recipeId', 'comparisonInput', 'scenarioKey'] },
                    unitPrice: { type: 'number', minimum: 0 }, quantity: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }, currency: { type: 'string', const: 'CNY' },
                }, required: ['version', 'basisRef', 'unitPrice', 'quantity', 'currency'],
            }),
        }),
    }),
    Object.freeze({
        type: 'function',
        function: Object.freeze({
            name: 'preview_virtual_readiness',
            description: '按当前库存并扣除活动订单占用，预览某一已正式绑定配方情景生产指定数量时的库存管理物料齐料情况。只读，不创建订单、不预留库存；不接受客户端库存或忽略订单占用的开关。',
            parameters: Object.freeze({
                type: 'object', additionalProperties: false,
                properties: {
                    version: { type: 'integer', const: 1 },
                    basisRef: { type: 'object', additionalProperties: false, properties: {
                        kind: { type: 'string', const: 'RECIPE_SCENARIO' }, recipeId: { type: 'integer', minimum: 1 },
                        comparisonInput: { type: 'object', additionalProperties: false, properties: {
                            version: { type: 'integer', const: 1 }, baselinePolicy: { type: 'string', const: 'CURRENT_REBUILT' },
                            scenarios: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
                                scenarioKey: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 80 },
                                overrides: { type: 'object', additionalProperties: false, properties: {
                                    hasFloat: { type: 'boolean' }, floatWire: { type: 'string' }, floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
                                    hasCable: { type: 'boolean' }, cableLength: { type: 'number', minimum: 0 }, cableWire: { type: 'string' }, cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
                                    coilId: { type: 'integer', minimum: 1 }, coilSheets: { type: 'integer', minimum: 1 }, customBarrelLength: { type: 'number', exclusiveMinimum: 0 },
                                    packingParts: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { partId: { type: 'integer', minimum: 1 }, model: { type: 'string', minLength: 1, maxLength: 160 }, supplier: { type: 'string', maxLength: 160 }, qty: { type: 'number', minimum: 0 }, packingRole: { type: 'string', enum: ['container', 'pearlCotton', 'foam', 'fixed'] } }, required: ['partId', 'model', 'supplier', 'qty', 'packingRole'] } },
                                    surfaceTreatmentMode: { type: 'string', enum: ['none', 'painting', 'electrophoresis', 'electrophoresis_powder_coating', 'powder_coating', 'custom'] }, surfaceTreatmentCost: { type: 'number', minimum: 0 },
                                } },
                            }, required: ['scenarioKey', 'label', 'overrides'] } },
                        }, required: ['version', 'baselinePolicy', 'scenarios'] },
                        scenarioKey: { type: 'string', pattern: '^(base|[A-Za-z][A-Za-z0-9_-]{0,47})$' },
                    }, required: ['kind', 'recipeId', 'comparisonInput', 'scenarioKey'] },
                    quantity: { type: 'integer', minimum: 1, maximum: 100000 },
                }, required: ['version', 'basisRef', 'quantity'],
            }),
        }),
    }),
]);

function nativeToolDefinition(name) {
    return AI_NATIVE_TOOLS_V2.find(tool => tool.function.name === name) || null;
}

module.exports = { AI_NATIVE_TOOLS_V2, nativeToolDefinition };
