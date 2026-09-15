const crypto = require('node:crypto');
const { z } = require('zod');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');

const RULES_CAPABILITY_ID = requireBusinessCapability('catalog.naming_rules').capabilityId;
const PREVIEW_CAPABILITY_ID = requireBusinessCapability('catalog.name_preview').capabilityId;
const RULE_VERSION = 1;
const text = (key, label, optional = false, uppercase = false) => ({ key, label, type: 'text', optional, uppercase, maxLength: 64 });
const number = (key, label, unit = '', integer = false) => ({ key, label, type: 'number', unit, integer });
const choice = (key, label, values, optional = false) => ({ key, label, type: 'choice', values, optional });
const field = (key, suffix = '') => ({ fields: [key], suffix });
const dimensions = (...keys) => ({ fields: keys, separator: '*' });
const variant = text('variant', '必要区别', true);
const dimensionsMm = [number('innerDiameterMm', '内径', 'mm'), number('outerDiameterMm', '外径', 'mm'), number('heightMm', '高度或厚度', 'mm')];

// Both form descriptors and name rendering come from this registry. Existing
// catalog strings are never parsed here; only explicitly supplied specifications.
const DEFINITIONS = [
    { id: 'bearing', category: '轴承', fields: [text('code', '轴承代号', false, true), variant], nameParts: ['轴承', field('code'), field('variant')] },
    { id: 'capacitor', category: '电容', fields: [number('capacitanceUf', '容量', 'μF'), variant], nameParts: ['电容', field('capacitanceUf', 'μF'), field('variant')] },
    { id: 'screw', category: '螺丝', fields: [choice('headStyle', '头型', ['内六角', '外六角', '法兰', '十字', '空气', '长螺杆', '其他']), number('diameterMm', '直径', 'mm'), number('lengthMm', '长度', 'mm'), text('material', '材质', false, true), variant], nameParts: [field('headStyle', '螺丝'), dimensions('diameterMm', 'lengthMm'), field('material'), field('variant')] },
    { id: 'seal', category: '油封', fields: [choice('sealType', '密封类型', ['机械密封', '骨架油封']), ...dimensionsMm, variant], nameParts: [field('sealType'), dimensions('innerDiameterMm', 'outerDiameterMm', 'heightMm'), field('variant')] },
    { id: 'shell', category: '泵壳', fields: [text('series', '系列或原厂型号', false, true), text('specification', '明确规格'), variant], nameParts: ['泵壳', field('series'), field('specification'), field('variant')] },
    { id: 'shell-component', category: '泵壳搭配', fields: [text('kind', '组件或套件品名'), text('specification', '明确规格'), variant], nameParts: [field('kind'), field('specification'), field('variant')] },
    ...[['float', '浮球', '浮球'], ['cable', '电缆线', '电缆']].map(([id, category, label]) => ({
        id, category, fields: [number('wireValue', '导线规格值'), choice('wireMeasure', '导线规格含义', ['直径', '截面积']), choice('wireUnit', '导线规格单位', ['mm', 'mm²']), variant],
        nameParts: [label, { fields: ['wireMeasure', 'wireValue', 'wireUnit'], separator: '' }, field('variant')],
    })),
    ...[['gasket', '皮垫'], ['accessory', '配件'], ['packaging', '包装'], ['custom-part', '其他']].map(([id, category]) => ({
        id, category, fields: [text('kind', '品名'), text('specification', '明确规格'), variant], nameParts: [field('kind'), field('specification'), field('variant')],
    })),
    { id: 'coil', entityType: 'coil', fields: [text('statorCode', '定子组合代号', false, true), number('sheets', '片数', '片', true), choice('material', '材质', ['钢带', '冷轧']), choice('slotType', '槽眼', ['小眼', '国标眼']), text('scheme', '方案区别')], nameParts: ['线圈', field('statorCode'), field('sheets', '片'), field('material'), field('slotType'), field('scheme')] },
    { id: 'template', entityType: 'template', fields: [text('series', '系列', false, true), text('configuration', '结构或套件规格'), variant], nameParts: ['模板', field('series'), field('configuration'), field('variant')] },
    { id: 'recipe', entityType: 'recipe', fields: [text('series', '系列', false, true), text('statorCode', '定子组合代号', false, true), number('sheets', '片数', '片', true), number('barrelLengthMm', '机筒长度', 'mm'), text('configuration', '配置区别')], nameParts: ['水泵', field('series'), field('statorCode'), field('sheets', '片'), { ...field('barrelLengthMm', 'mm'), prefix: '筒' }, field('configuration')] },
    { id: 'model-variant', entityType: 'modelVariant', fields: [text('series', '系列', false, true), text('configuration', '配置区别')], nameParts: ['配置', field('series'), field('configuration')] },
].map(definition => ({ entityType: 'part', category: null, version: RULE_VERSION, ...definition }));

function namingError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 400;
    if (details) error.details = details;
    return error;
}

function schemaForField(descriptor) {
    let schema;
    if (descriptor.type === 'number') {
        schema = z.number().finite().positive().max(1000000);
        if (descriptor.integer) schema = schema.int();
        else schema = schema.refine(value => Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001, '最多四位小数');
    } else if (descriptor.type === 'choice') {
        schema = z.enum(descriptor.values);
    } else {
        schema = z.string().transform(value => value.normalize('NFC').trim())
            .pipe(z.string().min(1).max(descriptor.maxLength).refine(value => !/[\u0000-\u001f\u007f]/u.test(value), '不得包含控制字符'))
            .transform(value => descriptor.uppercase ? value.replace(/[a-z]/g, character => character.toUpperCase()) : value);
    }
    return descriptor.optional ? z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, schema.optional()) : schema;
}

const RULES = new Map(DEFINITIONS.map(definition => [definition.id, {
    definition,
    schema: z.object(Object.fromEntries(definition.fields.map(descriptor => [descriptor.key, schemaForField(descriptor)]))).strict(),
}]));
const REQUEST_SCHEMA = z.object({ ruleId: z.string().min(1).max(40), spec: z.record(z.unknown()) }).strict();

function getNamingRules() {
    return { version: RULE_VERSION, sourceOfTruth: RULES_CAPABILITY_ID, rules: structuredClone(DEFINITIONS) };
}

function generateCatalogName(input) {
    const request = REQUEST_SCHEMA.safeParse(input);
    if (!request.success) throw namingError('NAMING_INPUT_INVALID', '命名请求必须包含 ruleId 和规格对象 spec', request.error.issues);
    const rule = RULES.get(request.data.ruleId);
    if (!rule) throw namingError('NAMING_RULE_UNKNOWN', '不支持的命名规则');
    const parsed = rule.schema.safeParse(request.data.spec);
    if (!parsed.success) throw namingError('NAMING_SPEC_INVALID', '请补齐并检查命名规格', parsed.error.issues);
    const spec = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
    if (spec.wireMeasure && (spec.wireMeasure === '直径' ? spec.wireUnit !== 'mm' : spec.wireUnit !== 'mm²')) {
        throw namingError('NAMING_WIRE_UNIT_MISMATCH', '直径使用 mm，截面积使用 mm²；不能自动换算旧线径');
    }
    if (spec.innerDiameterMm != null && spec.outerDiameterMm <= spec.innerDiameterMm) {
        throw namingError('NAMING_DIMENSIONS_INVALID', '外径必须大于内径');
    }
    const name = rule.definition.nameParts.map(part => {
        if (typeof part === 'string') return part;
        const values = part.fields.map(key => spec[key]).filter(value => value != null);
        return values.length ? `${part.prefix || ''}${values.join(part.separator ?? '')}${part.suffix || ''}` : '';
    }).filter(Boolean).join('-');
    if (name.length > 180) throw namingError('NAMING_NAME_TOO_LONG', '生成的名称超过 180 字，请精简规格描述');
    const namingInputFingerprint = crypto.createHash('sha256').update(JSON.stringify({ ruleId: rule.definition.id, spec })).digest('hex');
    return { ruleId: rule.definition.id, ruleVersion: RULE_VERSION, entityType: rule.definition.entityType,
        category: rule.definition.category, normalizedSpec: spec, name, namingInputFingerprint };
}

function previewCatalogName(input) {
    const result = generateCatalogName(input);
    return { preview: true, sourceOfTruth: PREVIEW_CAPABILITY_ID, ...result,
        normalizedInput: { ruleId: result.ruleId, spec: result.normalizedSpec },
        changes: [{ field: 'name', proposedValue: result.name }],
        warnings: [{ code: 'NAMING_PREVIEW_ONLY', message: '仅预览名称；不代表已核实实物规格、排除重名或完成引用迁移。' }] };
}

module.exports = { getNamingRules, generateCatalogName, previewCatalogName };
