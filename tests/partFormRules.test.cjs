const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/partFormRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const helpers = `
const DEFAULT_FLOAT_ACCESSORY_DELTA = 0.6;
const LONG_SCREW_LENGTH_STEP_MM = 5;
function capacitorValueFromModel(model) {
  const normalized = String(model || '').replace(/[uUμfFvV\\s]/g, '').trim();
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { WIRE_MODE_CONFIG, parsePumpShellMeta, parseCableAccessoryMeta, parseScrewPricingMetaFromNotes, wirePrefixForCategory, isCapacitorCategory, modelFieldsFromPart, finalPartModel, validatePartForm, buildPartNotes, buildCableAccessorySettingsValue, parseFloatAccessoryDelta };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    parsePumpShellMeta,
    parseCableAccessoryMeta,
    parseScrewPricingMetaFromNotes,
    wirePrefixForCategory,
    isCapacitorCategory,
    modelFieldsFromPart,
    finalPartModel,
    validatePartForm,
    buildPartNotes,
    buildCableAccessorySettingsValue,
    parseFloatAccessoryDelta,
} = moduleStub.exports;

function validInput(overrides = {}) {
    return {
        category: '轴承',
        model: '6202',
        price: '1.5',
        supplier: 'A',
        isCapacitorMode: false,
        capacitorUf: '',
        isWireMode: false,
        wireGauge: '',
        isCableMode: false,
        standardCableAccessoryFee: '',
        xinjieCableAccessoryFee: '',
        standardCableAccessoryName: '普通铜套',
        xinjieCableAccessoryName: '新界式',
        isFloatMode: false,
        floatAccessoryDelta: '0.6',
        isScrewMode: false,
        screwPricingEnabled: false,
        screwDiameter: '6',
        ...overrides,
    };
}

test('零件表单规则解析 notes 元数据并兼容旧电缆配件费字段', () => {
    assert.deepEqual(parsePumpShellMeta('{bad'), { isStainless: false });
    const shell = parsePumpShellMeta(JSON.stringify({ isStainless: true, openFactor: 20, barrelLength: 170 }));
    assert.equal(shell.isStainless, true);
    assert.equal(shell.openFactor, 20);

    const legacyCable = parseCableAccessoryMeta(JSON.stringify({ cableAccessoryFee: 1.2 }));
    assert.equal(legacyCable.standardFee, '1.2');
    assert.equal(legacyCable.standardName, '普通铜套');

    const cable = parseCableAccessoryMeta(JSON.stringify({
        cableAccessoryFees: { standard: 1.5, xinjie: 2.5 },
        cableAccessoryNames: { standard: 'A套', xinjie: 'B套' },
    }));
    assert.deepEqual(cable, { standardFee: '1.5', xinjieFee: '2.5', standardName: 'A套', xinjieName: 'B套' });

    const screw = parseScrewPricingMetaFromNotes(JSON.stringify({ screwPricing: { enabled: true, diameter: 6 } }));
    assert.equal(screw.diameter, 6);
});

test('零件表单规则处理结构化型号字段', () => {
    assert.equal(wirePrefixForCategory('浮球'), '浮球-线径');
    assert.equal(isCapacitorCategory('电容'), true);
    assert.deepEqual(modelFieldsFromPart({ category: '电缆线', model: '电缆-线径0.75' }), {
        model: '电缆-线径0.75',
        wireGauge: '0.75',
        capacitorUf: '',
    });
    assert.deepEqual(modelFieldsFromPart({ category: '电容', model: '12uF' }), {
        model: '12uF',
        wireGauge: '',
        capacitorUf: '12',
    });
    assert.equal(finalPartModel({ isCapacitorMode: true, capacitorUf: '12', isWireMode: false, wirePrefix: '', wireGauge: '', model: '' }), '12μF');
    assert.equal(finalPartModel({ isCapacitorMode: false, capacitorUf: '', isWireMode: true, wirePrefix: '浮球-线径', wireGauge: '0.55', model: '' }), '浮球-线径0.55');
});

test('零件表单规则校验基础字段、电缆配件和螺丝参数化配置', () => {
    assert.deepEqual(validatePartForm(validInput()), {});
    assert.equal(validatePartForm(validInput({ model: '' })).model, '型号不能为空');
    assert.equal(validatePartForm(validInput({ isWireMode: true, wireGauge: '' })).model, '请选择线径');
    assert.equal(validatePartForm(validInput({ isCapacitorMode: true, capacitorUf: '0' })).model, '请输入有效的电容值 (μF)');
    assert.equal(validatePartForm(validInput({ supplier: '' })).supplier, '供应商不能为空');
    assert.equal(validatePartForm(validInput({ isCableMode: true, standardCableAccessoryFee: '-1' })).standardCableAccessoryFee, '请输入有效的普通铜套配件费');
    assert.equal(validatePartForm(validInput({ isScrewMode: true, screwPricingEnabled: true, screwDiameter: '' })).screwDiameter, '请输入有效直径');
});

test('零件表单规则组装 notes 和全局设置 payload', () => {
    const shellNotes = buildPartNotes({
        category: '泵壳',
        isCableMode: false,
        isScrewMode: false,
        isStainless: true,
        openOffset: '25',
        defaultUpperBearing: '6202',
        defaultLowerBearing: '',
        defaultOilSealDia: '12',
        defaultBearingSpan: '',
        defaultImpellerDia: '',
        defaultImpellerSpan: '',
        defaultImpellerDepth: '',
        defaultThreadLength: '',
        defaultThreadDia: '',
        defaultStackOffset: '',
        standardCableAccessoryFee: '',
        xinjieCableAccessoryFee: '',
        standardCableAccessoryName: '普通铜套',
        xinjieCableAccessoryName: '新界式',
        screwPricingEnabled: false,
        screwDiameter: '6',
    });
    assert.equal(shellNotes.isStainless, true);
    assert.equal(shellNotes.openOffset, 25);
    assert.equal(shellNotes.barrelLength, undefined);
    assert.equal(shellNotes.barrelLengthPresets, undefined);
    assert.equal(shellNotes.defaultOilSealDia, 12);

    const cableNotes = buildPartNotes({ ...shellNotes, category: '电缆线', isCableMode: true, standardCableAccessoryFee: '1.2', xinjieCableAccessoryFee: '2.3', standardCableAccessoryName: '普通', xinjieCableAccessoryName: '新界' });
    assert.equal(cableNotes.cableAccessoryFees.standard, 1.2);
    assert.deepEqual(buildCableAccessorySettingsValue({ standardCableAccessoryName: ' 普通 ', standardCableAccessoryFee: '1.2', xinjieCableAccessoryName: ' 新界 ', xinjieCableAccessoryFee: '' }), {
        standard: { name: '普通', fee: 1.2 },
        xinjie: { name: '新界', fee: 0 },
    });

    const screwNotes = buildPartNotes({ ...shellNotes, category: '螺丝', isScrewMode: true, screwPricingEnabled: true, screwDiameter: '6' });
    assert.equal(screwNotes.screwPricing.modelPrefix, '6*');
    assert.deepEqual(Object.keys(screwNotes.screwPricing).sort(), ['diameter', 'enabled', 'modelPrefix']);
    assert.equal(parseFloatAccessoryDelta('-1'), 0.6);
    assert.equal(parseFloatAccessoryDelta('0.8'), 0.8);
});
